import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// The control database holds only the customer list, which database each customer uses,
// and the sign-in routing. No business data lives here.

export const customer = pgTable('customer', {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(), // short slug, e.g. "demo"
  name: text().notNull(),
  dbName: text().notNull().unique(),
  status: text().$type<'active' | 'suspended'>().notNull().default('active'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Sign-in routing: which customer a login belongs to. Holds the login string only.
export const loginRoute = pgTable('login_route', {
  login: text().primaryKey(),
  customerId: uuid()
    .notNull()
    .references(() => customer.id, { onDelete: 'cascade' }),
});
