import path from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { deleteBucket } from '../storage.js';
import * as controlSchema from './control-schema.js';
import * as tenantSchema from './tenant-schema.js';

// pg returns numeric as string already; keep bigint ids (ledger, audit) as numbers.
pg.types.setTypeParser(20, (v) => Number(v));

export type ControlDb = NodePgDatabase<typeof controlSchema>;
export type TenantDb = NodePgDatabase<typeof tenantSchema>;
export type Tx = Parameters<Parameters<TenantDb['transaction']>[0]>[0];
export type Q = TenantDb | Tx;

const MIGRATIONS = path.resolve(import.meta.dirname, '../../migrations');
const CODE_RE = /^[a-z][a-z0-9_]{1,29}$/;

// POSTGRES_URL points at the server (any database). Each customer gets its own database on it.
export function dbUrl(dbName: string) {
  const url = new URL(process.env.POSTGRES_URL ?? 'postgres://fnb:fnb@localhost:5432/postgres');
  url.pathname = `/${dbName}`;
  return url.toString();
}

const controlDbName = () => process.env.CONTROL_DB_NAME ?? 'fnb_control';
let control: { pool: pg.Pool; db: ControlDb } | undefined;
export function controlDb(): ControlDb {
  if (!control) {
    const pool = new pg.Pool({ connectionString: dbUrl(controlDbName()), max: 5 });
    control = { pool, db: drizzle(pool, { schema: controlSchema, casing: 'snake_case' }) };
  }
  return control.db;
}

// ponytail: one small pool per customer database in this process. Fine for tens of customers;
// put PgBouncer in front (or evict idle pools) when there are hundreds.
const tenantPools = new Map<string, { pool: pg.Pool; db: TenantDb }>();
export function tenantDb(dbName: string): TenantDb {
  let t = tenantPools.get(dbName);
  if (!t) {
    const pool = new pg.Pool({ connectionString: dbUrl(dbName), max: Number(process.env.TENANT_POOL_MAX ?? 5) });
    t = { pool, db: drizzle(pool, { schema: tenantSchema, casing: 'snake_case' }) };
    tenantPools.set(dbName, t);
  }
  return t.db;
}

export type Customer = typeof controlSchema.customer.$inferSelect;

// Resolve a customer and its database. Cached briefly; a suspended customer is refused.
const customerCache = new Map<string, { at: number; customer: Customer }>();
export async function resolveCustomer(customerId: string): Promise<{ customer: Customer; db: TenantDb } | null> {
  let hit = customerCache.get(customerId);
  if (!hit || Date.now() - hit.at > 60_000) {
    const [c] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.id, customerId));
    if (!c) return null;
    hit = { at: Date.now(), customer: c };
    customerCache.set(customerId, hit);
  }
  if (hit.customer.status !== 'active') return null;
  return { customer: hit.customer, db: tenantDb(hit.customer.dbName) };
}

async function withServer<T>(fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: dbUrl('postgres') });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function ensureDatabase(name: string) {
  await withServer(async (c) => {
    const { rowCount } = await c.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) await c.query(`create database "${name}"`);
    // Every schedule, report and date function runs in India time.
    await c.query(`alter database "${name}" set timezone to 'Asia/Kolkata'`);
  });
}

export async function migrateControl() {
  await ensureDatabase(controlDbName());
  await migrate(controlDb(), { migrationsFolder: path.join(MIGRATIONS, 'control') });
}

export async function migrateTenant(dbName: string) {
  await migrate(tenantDb(dbName), { migrationsFolder: path.join(MIGRATIONS, 'tenant') });
}

// One command: control database first, then every customer database.
export async function migrateAll(log = console.log) {
  await migrateControl();
  const customers = await controlDb().select().from(controlSchema.customer);
  for (const c of customers) {
    await migrateTenant(c.dbName);
    log(`migrated ${c.code} (${c.dbName})`);
  }
  return customers.length;
}

// Adding a customer creates its database and brings it to the latest schema automatically.
export async function createCustomer(input: { code: string; name: string }) {
  if (!CODE_RE.test(input.code)) throw new Error('Customer code: lowercase letters, digits and _ only, 2 to 30 long');
  await migrateControl();
  const dbName = `fnb_c_${input.code}`;
  const [existing] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.code, input.code));
  if (existing) throw new Error(`Customer "${input.code}" already exists`);
  await ensureDatabase(dbName);
  await migrateTenant(dbName);
  const [c] = await controlDb().insert(controlSchema.customer).values({ code: input.code, name: input.name, dbName }).returning();
  return { customer: c, db: tenantDb(dbName) };
}

// Removes a customer and its whole database. Used for the demo reset and for deletion on leaving.
export async function dropCustomer(code: string) {
  const [c] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.code, code));
  if (!c) return false;
  const t = tenantPools.get(c.dbName);
  tenantPools.delete(c.dbName);
  await t?.pool.end();
  customerCache.delete(c.id);
  await controlDb().delete(controlSchema.customer).where(eq(controlSchema.customer.id, c.id)); // login routes cascade
  await withServer((s) => s.query(`drop database if exists "${c.dbName}" with (force)`));
  await deleteBucket(c.code);
  return true;
}

export async function closeAll() {
  await Promise.all([...tenantPools.values()].map((t) => t.pool.end()));
  tenantPools.clear();
  customerCache.clear();
  await control?.pool.end();
  control = undefined;
}

export { controlSchema, tenantSchema };
