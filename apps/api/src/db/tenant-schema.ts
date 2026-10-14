// One of these databases per customer (restaurant business). There is deliberately no
// customer column anywhere: separation comes from the database itself.
// Columns are snake_case in SQL (drizzle `casing: 'snake_case'`). Tables live in ./schema by area.

export * from './schema/access.js';
export * from './schema/catalog.js';
export * from './schema/inventory.js';
export * from './schema/purchasing.js';
export * from './schema/billing.js';
export * from './schema/records.js';
