// Files, reporting summaries, jobs and the activity feed.
import { bigint, date, index, integer, jsonb, pgTable, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';
import type { Department } from '@fnb/shared';
import { id, money, qty, ts } from './columns.js';
import { appUser, outlet } from './access.js';
import { menuItem } from './catalog.js';

// Photos and documents. The file itself lives in the customer's private object storage.
export const attachment = pgTable(
  'attachment',
  {
    id: id(),
    entity: text().notNull(),
    entityId: text().notNull(),
    purpose: text(), // gate_photo, recheck_photo, vendor_bill, menu_photo
    objectKey: text().notNull(),
    contentType: text().notNull(),
    takenBy: uuid().references(() => appUser.id),
    takenAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.entity, t.entityId)],
);

// ---------- Reporting summaries (filled by the roll-up job) ----------

export const salesHourly = pgTable(
  'sales_hourly',
  {
    outletId: uuid().notNull().references(() => outlet.id),
    businessDate: date().notNull(),
    hour: smallint().notNull(),
    menuItemId: uuid().notNull().references(() => menuItem.id),
    units: qty().notNull().default('0'),
    revenue: money().notNull().default('0'),
    cost: money().notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.businessDate, t.hour, t.menuItemId] })],
);

export const salesDaily = pgTable(
  'sales_daily',
  {
    outletId: uuid().notNull().references(() => outlet.id),
    businessDate: date().notNull(),
    department: text().$type<Department>().notNull(),
    bills: integer().notNull().default(0),
    revenue: money().notNull().default('0'),
    cost: money().notNull().default('0'),
    alcoholMl: qty().notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.businessDate, t.department] })],
);

// ---------- Jobs ----------

// Marks a scheduled job as done for a scope and key (e.g. indent / outlet / 2026-10-11),
// so the minute-by-minute scheduler runs each one exactly once and catches up after downtime.
export const jobRun = pgTable(
  'job_run',
  {
    job: text().notNull(),
    scope: text().notNull(),
    key: text().notNull(),
    ranAt: ts().notNull().defaultNow(),
    detail: jsonb(),
  },
  (t) => [primaryKey({ columns: [t.job, t.scope, t.key] })],
);

// Bills by the hour they opened: count, takings before tax and minutes from first order to
// payment. Feeds "average bill value" and "time spent by time of day" on the dashboard.
export const billHourly = pgTable(
  'bill_hourly',
  {
    outletId: uuid().notNull().references(() => outlet.id),
    businessDate: date().notNull(),
    hour: smallint().notNull(),
    bills: integer().notNull().default(0),
    revenue: money().notNull().default('0'),
    minutesSpent: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.businessDate, t.hour] })],
);

// ---------- Activity ----------

// A plain-language timeline of what happened and why: offers starting and ending (with the
// drink that triggered them), dishes selling out or coming back, deliveries, price flags,
// day close. Append-only, written as the events happen.
export const activity = pgTable(
  'activity',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    outletId: uuid().references(() => outlet.id),
    at: ts().notNull().defaultNow(),
    kind: text().notNull(), // offer_started, offer_ended, sold_out, back_in_stock, delivery, delivery_held, price_flag, day_closed
    title: text().notNull(),
    message: text().notNull(),
    data: jsonb(),
  },
  (t) => [index().on(t.outletId, t.at), index().on(t.kind)],
);
