import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { provisionCustomer } from './bootstrap.js';
import { closeAll, controlDb, controlSchema, migrateAll } from './db/index.js';
import { seedDemo } from './seed.js';

// pnpm db:migrate                       control database, then every customer database
// pnpm customer:create <code> "<name>" --owner-login x --owner-name y --owner-password z
// pnpm seed [--reset]                   demo customer with SAMPLE data
// seed-if-empty                         used by Docker on start: seeds only when there are no customers
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    reset: { type: 'boolean' },
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
      const any = await controlDb().select().from(controlSchema.customer).limit(1);
      if (!any.length) await seedDemo();
      break;
    }
    default:
      throw new Error('Commands: migrate | customer:create | seed [--reset] | seed-if-empty');
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await closeAll();
}
