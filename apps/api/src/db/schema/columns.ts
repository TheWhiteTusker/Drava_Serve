// Column shapes shared by every table.
import { integer, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ts = (n?: string) => (n ? timestamp(n, { withTimezone: true }) : timestamp({ withTimezone: true }));
export const money = () => numeric({ precision: 12, scale: 2 }); // ₹
export const qty = () => numeric({ precision: 14, scale: 3 }); // g / ml / pc
export const unitCost = () => numeric({ precision: 16, scale: 6 }); // ₹ per base unit
export const pct = () => numeric({ precision: 5, scale: 2 });
export const id = () => uuid().primaryKey().defaultRandom();
export const stamps = {
  version: integer().notNull().default(1),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
};
