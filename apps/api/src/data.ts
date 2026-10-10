import { spawn } from 'node:child_process';
import { Controller, Get, Logger, Res } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { istDate } from '@fnb/shared';
import { C, Ctx } from './common.js';
import { controlDb, controlSchema, dbUrl, dropCustomer, tenantDb, type Customer, type TenantDb } from './db/index.js';
import { toCsv } from './receiving.controller.js';
import { deleteRaw, getRaw, listRaw, putRaw } from './storage.js';

// Backups, restore, per-customer export and deletion (handoff 6.14 safeguards).

const log = new Logger('Data');
export const BACKUP_BUCKET = process.env.BACKUP_BUCKET ?? 'fnb-backups';
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 30);

// Runs a PostgreSQL client tool, feeding stdin and collecting stdout.
function run(cmd: string, args: string[], input?: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => err.push(c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} failed: ${Buffer.concat(err).toString().slice(0, 500)}`))));
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

// One customer's whole database, in pg_dump's compressed custom format, kept 30 days.
export async function backupCustomer(c: Customer, now = new Date()) {
  const dump = await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--dbname=${dbUrl(c.dbName)}`]);
  const key = `${c.code}/${istDate(now)}.dump`;
  await putRaw(BACKUP_BUCKET, key, dump, 'application/octet-stream');
  const cutoff = istDate(new Date(now.getTime() - KEEP_DAYS * 86_400_000));
  const old = (await listRaw(BACKUP_BUCKET, `${c.code}/`)).filter((o) => o.key.slice(c.code.length + 1, -5) < cutoff);
  await deleteRaw(BACKUP_BUCKET, old.map((o) => o.key));
  return { key, bytes: dump.length };
}

export async function backupAll() {
  const customers = await controlDb().select().from(controlSchema.customer);
  for (const c of customers) {
    try {
      const r = await backupCustomer(c);
      log.log(`backup ${c.code}: ${r.key} (${Math.round(r.bytes / 1024)} KB)`);
    } catch (e) {
      log.error(`backup ${c.code} failed: ${(e as Error).message}`);
    }
  }
}

export async function listBackups(code: string) {
  return listRaw(BACKUP_BUCKET, `${code}/`);
}

// Replaces the customer's database contents with a backup (latest, or a given date).
export async function restoreCustomer(code: string, date?: string) {
  const [c] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.code, code));
  if (!c) throw new Error(`No customer "${code}"`);
  const backups = (await listBackups(code)).map((b) => b.key).sort();
  const key = date ? `${code}/${date}.dump` : backups.at(-1);
  if (!key || !backups.includes(key)) throw new Error(`No backup ${date ?? ''} for ${code}. Available: ${backups.join(', ') || 'none'}`);
  const dump = await getRaw(BACKUP_BUCKET, key);
  await run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', `--dbname=${dbUrl(c.dbName)}`], dump);
  return key;
}

// Every table as a CSV file in one zip (password and PIN hashes left out).
export async function exportCustomer(db: TenantDb) {
  const tables = (
    await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)
  ).rows.map((r: any) => r.table_name as string);
  const files: Record<string, Uint8Array> = {};
  for (const name of tables) {
    const rows = (await db.execute(sql.raw(`select * from "${name}"`))).rows as Record<string, unknown>[];
    for (const r of rows) {
      delete r.password_hash;
      delete r.pin_hash;
    }
    files[`${name}.csv`] = strToU8(toCsv(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v])))));
  }
  files['README.txt'] = strToU8(`Full export of this business's data, ${new Date().toISOString()}.\nOne CSV file per table. Password and PIN hashes are not included.\n`);
  return Buffer.from(zipSync(files, { level: 6 }));
}

// Leaving the service: a final backup, then the database, files and sign-in routes are removed.
export async function deleteCustomer(code: string) {
  const [c] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.code, code));
  if (!c) throw new Error(`No customer "${code}"`);
  const final = await backupCustomer(c).catch((e) => ({ key: `failed: ${(e as Error).message}`, bytes: 0 }));
  await dropCustomer(code);
  return final.key;
}

@Controller('data')
export class DataController {
  // The owner downloads everything the business has stored.
  @Get('export')
  async export(@C() ctx: Ctx, @Res() res: any) {
    ctx.assert('data.export', null);
    const [c] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.id, ctx.customerId));
    const zip = await exportCustomer(tenantDb(c.dbName));
    res.set({ 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${c.code}-export-${istDate(new Date())}.zip"` }).send(zip);
  }
}
