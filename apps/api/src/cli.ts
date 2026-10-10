import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { provisionCustomer } from './bootstrap.js';
import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { backupCustomer, deleteCustomer, exportCustomer, listBackups, restoreCustomer } from './data.js';
import { closeAll, controlDb, controlSchema, migrateAll, tenantDb } from './db/index.js';
import { rebuildRollups } from './reports.js';
import { seedDemo } from './seed.js';

// pnpm db:migrate                       control database, then every customer database
// pnpm customer:create <code> "<name>" --owner-login x --owner-name y --owner-password z
// pnpm seed [--reset]                   demo customer with SAMPLE data
// seed-if-empty                         used by Docker on start: migrates, and seeds the demo when SEED_DEMO=true and there are no customers
// backup [code]                         back up one customer (or all) to object storage now
// backups <code>                        list a customer's backups
// restore <code> [YYYY-MM-DD]           restore a customer's database from a backup (latest by default)
// customer:export <code> <file.zip>     every table as CSV, for a customer who asks for their data
// customer:delete <code> --confirm      final backup, then remove the database, files and sign-ins
// rollups:rebuild [code]                rebuild the dashboard summaries from bills
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    reset: { type: 'boolean' },
    confirm: { type: 'boolean' },
    'owner-login': { type: 'string' },
    'owner-name': { type: 'string' },
    'owner-password': { type: 'string' },
  },
});
const [cmd, ...args] = positionals;

try {
  switch (cmd) {
    case 'migrate':
      console.log(`Migrated control database and ${await migrateAll()} customer database(s)`);
      break;
    case 'customer:create': {
      const [code, name] = args;
      const login = values['owner-login'];
      const password = values['owner-password'];
      if (!code || !name || !login || !password) {
        throw new Error('Usage: customer:create <code> "<name>" --owner-login <login> --owner-password <password> [--owner-name <name>]');
      }
      const c = await provisionCustomer({ code, name, owner: { login, password, name: values['owner-name'] ?? 'Owner' } });
      console.log(`Created customer ${c.code} with database ${c.dbName}. Owner signs in as ${login}`);
      break;
    }
    case 'seed':
      await migrateAll(() => {});
      await seedDemo({ reset: values.reset });
      break;
    case 'seed-if-empty': {
      await migrateAll(() => {});
      // Only where SEED_DEMO=true (the local Docker setup); never on a real server by accident.
      const any = await controlDb().select().from(controlSchema.customer).limit(1);
      if (!any.length && process.env.SEED_DEMO === 'true') await seedDemo();
      break;
    }
    case 'backup': {
      const all = await controlDb().select().from(controlSchema.customer);
      for (const c of all.filter((c) => !args[0] || c.code === args[0])) console.log(`${c.code}: ${(await backupCustomer(c)).key}`);
      break;
    }
    case 'backups':
      for (const b of await listBackups(args[0])) console.log(`${b.key}	${Math.round(b.size / 1024)} KB`);
      break;
    case 'restore':
      console.log(`Restored ${args[0]} from ${await restoreCustomer(args[0], args[1])}`);
      break;
    case 'customer:export': {
      const [c] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.code, args[0]));
      if (!c || !args[1]) throw new Error('Usage: customer:export <code> <file.zip>');
      writeFileSync(args[1], await exportCustomer(tenantDb(c.dbName)));
      console.log(`Wrote ${args[1]}`);
      break;
    }
    case 'customer:delete':
      if (!values.confirm) throw new Error(`This permanently deletes ${args[0]}'s data. Add --confirm to proceed.`);
      console.log(`Deleted ${args[0]}. Final backup: ${await deleteCustomer(args[0])}`);
      break;
    case 'rollups:rebuild': {
      const all = await controlDb().select().from(controlSchema.customer);
      for (const c of all.filter((c) => !args[0] || c.code === args[0])) {
        const n = await tenantDb(c.dbName).transaction((tx) => rebuildRollups(tx));
        console.log(`${c.code}: ${n} bills rolled up`);
      }
      break;
    }
    default:
      throw new Error('Commands: migrate | customer:create | seed [--reset] | seed-if-empty | backup | backups | restore | customer:export | customer:delete | rollups:rebuild');
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await closeAll();
}
