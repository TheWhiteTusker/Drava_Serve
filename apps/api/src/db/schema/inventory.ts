import { bigint, boolean, date, index, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { MovementType, StoreKind } from '@fnb/shared';
import { id, qty, stamps, ts, unitCost } from './columns.js';
import { appUser, approvalRequest, outlet } from './access.js';
import { stockItem } from './catalog.js';

// ---------- Inventory ----------

export const store = pgTable(
  'store',
  {
    id: id(),
    outletId: uuid().notNull().references(() => outlet.id),
    name: text().notNull(),
    kind: text().$type<StoreKind>().notNull(),
    active: boolean().notNull().default(true),
    ...stamps,
  },
  (t) => [unique().on(t.outletId, t.name)],
);

// A received batch, for expiry dates and earliest-expiry-first issuing.
export const stockLot = pgTable('stock_lot', {
  id: id(),
  stockItemId: uuid().notNull().references(() => stockItem.id),
  storeId: uuid().notNull().references(() => store.id),
  receivedOn: date().notNull(),
  expiresOn: date(),
  grnLineId: uuid(),
  createdAt: ts().notNull().defaultNow(),
});

// Append-only. A trigger rejects UPDATE and DELETE; corrections are reversing rows.
export const stockLedger = pgTable(
  'stock_ledger',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    outletId: uuid().notNull().references(() => outlet.id),
    storeId: uuid().notNull().references(() => store.id),
    stockItemId: uuid().notNull().references(() => stockItem.id),
    lotId: uuid().references(() => stockLot.id),
    qty: qty().notNull(), // + in, − out, base units
    unitCost: unitCost().notNull(),
    movement: text().$type<MovementType>().notNull(),
    reason: text(),
    refType: text(),
    refId: text(),
    reversesId: bigint({ mode: 'number' }),
    approvalId: uuid().references(() => approvalRequest.id),
    userId: uuid().references(() => appUser.id),
    deviceId: text(),
    at: ts().notNull().defaultNow(),
  },
  (t) => [
    index().on(t.storeId, t.stockItemId, t.at),
    index().on(t.refType, t.refId),
    index().on(t.outletId, t.at),
    index().on(t.lotId),
  ],
);

export const stockBalance = pgTable(
  'stock_balance',
  {
    storeId: uuid().notNull().references(() => store.id),
    stockItemId: uuid().notNull().references(() => stockItem.id),
    qty: qty().notNull().default('0'),
    avgCost: unitCost().notNull().default('0'), // weighted average, for stock value
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.stockItemId] })],
);

export const stockTransfer = pgTable('stock_transfer', {
  id: id(),
  outletId: uuid().notNull().references(() => outlet.id),
  fromStoreId: uuid().notNull().references(() => store.id),
  toStoreId: uuid().notNull().references(() => store.id),
  note: text(),
  createdBy: uuid().notNull().references(() => appUser.id),
  createdAt: ts().notNull().defaultNow(),
});

export const stockCount = pgTable('stock_count', {
  id: id(),
  outletId: uuid().notNull().references(() => outlet.id),
  storeId: uuid().notNull().references(() => store.id),
  scheduledFor: date().notNull(),
  status: text().$type<'scheduled' | 'counting' | 'submitted' | 'approved' | 'rejected'>().notNull().default('scheduled'),
  submittedBy: uuid().references(() => appUser.id),
  submittedAt: ts(),
  approvalId: uuid().references(() => approvalRequest.id),
  ...stamps,
});

export const stockCountLine = pgTable(
  'stock_count_line',
  {
    id: id(),
    countId: uuid().notNull().references(() => stockCount.id, { onDelete: 'cascade' }),
    stockItemId: uuid().notNull().references(() => stockItem.id),
    expectedQty: qty().notNull(),
    countedQty: qty(),
    cause: text(),
  },
  (t) => [unique().on(t.countId, t.stockItemId)],
);
