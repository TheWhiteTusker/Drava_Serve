import { boolean, date, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { Department } from '@fnb/shared';
import { id, money, qty, stamps, ts, unitCost } from './columns.js';
import { appUser, outlet } from './access.js';
import { stockItem, stockItemUnit } from './catalog.js';
import { store } from './inventory.js';

// ---------- Purchasing and receiving ----------

export const vendor = pgTable('vendor', {
  id: id(),
  name: text().notNull().unique(),
  department: text().$type<Department | 'both'>().notNull(),
  contactName: text(),
  phone: text(),
  email: text(),
  gstin: text(),
  address: text(),
  active: boolean().notNull().default(true),
  ...stamps,
});

// What a vendor supplies, in which purchase unit and pack size (for rounding the indent).
export const vendorItem = pgTable(
  'vendor_item',
  {
    id: id(),
    vendorId: uuid().notNull().references(() => vendor.id, { onDelete: 'cascade' }),
    stockItemId: uuid().notNull().references(() => stockItem.id),
    unitId: uuid().references(() => stockItemUnit.id),
    packSize: qty().notNull().default('1'), // in purchase units
    preferred: boolean().notNull().default(true),
  },
  (t) => [unique().on(t.vendorId, t.stockItemId)],
);

// Running price history: one row per billed rate.
export const vendorRate = pgTable(
  'vendor_rate',
  {
    id: id(),
    vendorId: uuid().notNull().references(() => vendor.id),
    stockItemId: uuid().notNull().references(() => stockItem.id),
    unitId: uuid().references(() => stockItemUnit.id),
    rate: money().notNull(), // per purchase unit
    ratePerBase: unitCost().notNull(),
    billedOn: date().notNull(),
    grnId: uuid(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.stockItemId, t.billedOn)],
);

export const indent = pgTable(
  'indent',
  {
    id: id(),
    outletId: uuid().notNull().references(() => outlet.id),
    vendorId: uuid().notNull().references(() => vendor.id),
    forDate: date().notNull(),
    status: text().$type<'pending_approval' | 'approved' | 'sent' | 'cancelled'>().notNull(),
    generatedAt: ts().notNull().defaultNow(),
    approvedBy: uuid().references(() => appUser.id),
    approvedAt: ts(),
    pdfKey: text(),
    ...stamps,
  },
  (t) => [unique().on(t.outletId, t.vendorId, t.forDate)],
);

export const indentLine = pgTable('indent_line', {
  id: id(),
  indentId: uuid().notNull().references(() => indent.id, { onDelete: 'cascade' }),
  stockItemId: uuid().notNull().references(() => stockItem.id),
  unitId: uuid().references(() => stockItemUnit.id),
  parQty: qty().notNull(),
  onHandQty: qty().notNull(),
  onOrderQty: qty().notNull(),
  suggestedQty: qty().notNull(), // purchase units, rounded up to pack size
  approvedQty: qty(),
  lastRate: money(),
});

// Log of every attempt to send a vendor order, whatever the channel.
export const deliverySend = pgTable('delivery_send', {
  id: id(),
  indentId: uuid().notNull().references(() => indent.id),
  channel: text().notNull(), // manual_share, download, print, later whatsapp_business
  attemptedAt: ts().notNull().defaultNow(),
  userId: uuid().references(() => appUser.id),
  result: text().$type<'ok' | 'failed'>().notNull(),
  detail: text(),
});

// One delivery: gate check by the watchman, then the staff re-check.
export const receiptCheck = pgTable('receipt_check', {
  id: id(),
  outletId: uuid().notNull().references(() => outlet.id),
  indentId: uuid().unique().references(() => indent.id),
  vendorId: uuid().notNull().references(() => vendor.id),
  expectedOn: date().notNull(),
  status: text().$type<'expected' | 'gate_checked' | 'rechecked' | 'closed'>().notNull().default('expected'),
  gateBy: uuid().references(() => appUser.id),
  gateAt: ts(),
  recheckBy: uuid().references(() => appUser.id),
  recheckAt: ts(),
  vendorBillNo: text(),
  ...stamps,
});

export const receiptCheckLine = pgTable('receipt_check_line', {
  id: id(),
  receiptCheckId: uuid().notNull().references(() => receiptCheck.id, { onDelete: 'cascade' }),
  stockItemId: uuid().notNull().references(() => stockItem.id),
  unitId: uuid().references(() => stockItemUnit.id),
  orderedQty: qty().notNull(),
  gateStatus: text().$type<'pending' | 'accepted' | 'short' | 'rejected'>().notNull().default('pending'),
  gateQty: qty(),
  gateReason: text(),
  recheckAcceptedQty: qty(),
  recheckRejectedQty: qty(),
  recheckReason: text(), // spoiled, expired, unusable
  measuredQty: qty(), // weight or count measured by staff
  billedRate: money(), // per purchase unit, from the vendor's bill
  expiresOn: date(),
});

export const goodsReceivedNote = pgTable('goods_received_note', {
  id: id(),
  outletId: uuid().notNull().references(() => outlet.id),
  receiptCheckId: uuid().notNull().unique().references(() => receiptCheck.id),
  vendorId: uuid().notNull().references(() => vendor.id),
  number: text().notNull(),
  status: text().$type<'awaiting_signoff' | 'held_rate' | 'approved' | 'paid' | 'cancelled'>().notNull(),
  watchmanConfirmedBy: uuid().references(() => appUser.id),
  watchmanConfirmedAt: ts(),
  staffConfirmedBy: uuid().references(() => appUser.id),
  staffConfirmedAt: ts(),
  releasedBy: uuid().references(() => appUser.id), // manager releasing a rate hold
  releasedAt: ts(),
  approvedAt: ts(),
  amountGross: money().notNull().default('0'),
  returnDeduction: money().notNull().default('0'),
  amountPayable: money().notNull().default('0'),
  ...stamps,
});

export const grnLine = pgTable('grn_line', {
  id: id(),
  grnId: uuid().notNull().references(() => goodsReceivedNote.id, { onDelete: 'cascade' }),
  stockItemId: uuid().notNull().references(() => stockItem.id),
  storeId: uuid().notNull().references(() => store.id),
  unitId: uuid().references(() => stockItemUnit.id),
  acceptedQty: qty().notNull(), // purchase units
  acceptedBaseQty: qty().notNull(),
  billedRate: money().notNull(),
  ratePerBase: unitCost().notNull(),
  lastRatePerBase: unitCost(),
  amount: money().notNull(),
  expiresOn: date(),
});

export const returnNote = pgTable('return_note', {
  id: id(),
  outletId: uuid().notNull().references(() => outlet.id),
  receiptCheckId: uuid().notNull().references(() => receiptCheck.id),
  grnId: uuid().references(() => goodsReceivedNote.id),
  vendorId: uuid().notNull().references(() => vendor.id),
  stockItemId: uuid().notNull().references(() => stockItem.id),
  qty: qty().notNull(),
  reason: text().notNull(),
  amount: money().notNull().default('0'),
  createdBy: uuid().notNull().references(() => appUser.id),
  createdAt: ts().notNull().defaultNow(),
});

export const vendorPayment = pgTable('vendor_payment', {
  id: id(),
  grnId: uuid().notNull().references(() => goodsReceivedNote.id),
  paidOn: date().notNull(),
  mode: text().notNull(), // bank transfer, cheque, UPI, cash
  reference: text(),
  amount: money().notNull(),
  recordedBy: uuid().notNull().references(() => appUser.id),
  createdAt: ts().notNull().defaultNow(),
});
