import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { Department, PaymentMode } from '@fnb/shared';
import { id, money, pct, qty, stamps, ts, unitCost } from './columns.js';
import { appUser, approvalRequest, outlet } from './access.js';
import { menuItem, taxClass } from './catalog.js';

// ---------- Pricing and offers ----------

export const priceRule = pgTable('price_rule', {
  id: id(),
  outletId: uuid().notNull().references(() => outlet.id),
  name: text().notNull(),
  active: boolean().notNull().default(true),
  triggerServes: integer().notNull().default(5),
  discountPct: pct().notNull().default('10'),
  bandMinPct: pct().notNull().default('1'),
  bandMaxPct: pct().notNull().default('25'),
  matchScope: text().$type<'type_and_serve' | 'subtype_and_serve'>().notNull().default('type_and_serve'),
  marginFloorPct: pct().notNull().default('55'),
  minSubstituteServes: integer().notNull().default(15),
  maxItems: integer().notNull().default(3),
  releaseBufferServes: integer().notNull().default(3),
  mode: text().$type<'auto'>().notNull().default('auto'),
  ...stamps,
});

// An offer that is running (or ran). Prices change silently for guests; this record keeps the story.
export const activeDiscount = pgTable(
  'active_discount',
  {
    id: id(),
    outletId: uuid().notNull().references(() => outlet.id),
    menuItemId: uuid().notNull().references(() => menuItem.id),
    priceRuleId: uuid().notNull().references(() => priceRule.id),
    triggerMenuItemId: uuid().notNull().references(() => menuItem.id),
    discountPct: pct().notNull(),
    menuPrice: money().notNull(),
    offerPrice: money().notNull(),
    startedAt: ts().notNull().defaultNow(),
    endedAt: ts(),
    status: text().$type<'active' | 'ended'>().notNull().default('active'),
    endReason: text(),
  },
  (t) => [index().on(t.outletId, t.status)],
);

// ---------- Billing ----------

export const diningTable = pgTable(
  'dining_table',
  {
    id: id(),
    outletId: uuid().notNull().references(() => outlet.id),
    name: text().notNull(),
    // Short random code in the table's QR link (/m/<business>/<outlet>/<name>-<code>). Only the code
    // is looked up, so renaming a table keeps printed codes working; it cannot be guessed from outside.
    code: text().notNull().default(sql`table_code()`),
    sortOrder: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    ...stamps,
  },
  (t) => [unique().on(t.outletId, t.name), unique().on(t.outletId, t.code)],
);

export const bill = pgTable(
  'bill',
  {
    id: id(),
    outletId: uuid().notNull().references(() => outlet.id),
    number: text(),
    clientId: uuid().unique(), // set by the POS device, so an offline bill is stored exactly once
    kind: text().$type<'dine_in' | 'takeaway'>().notNull(),
    tableId: uuid().references(() => diningTable.id),
    status: text().$type<'open' | 'paid' | 'cancelled' | 'refunded'>().notNull().default('open'),
    openedAt: ts().notNull(), // first order
    paidAt: ts(),
    businessDate: date().notNull(),
    openedBy: uuid().notNull().references(() => appUser.id),
    closedBy: uuid().references(() => appUser.id),
    deviceId: text(),
    foodSubtotal: money().notNull().default('0'),
    foodTax: money().notNull().default('0'),
    liquorSubtotal: money().notNull().default('0'),
    liquorTax: money().notNull().default('0'),
    taxes: jsonb(), // full breakdown as printed
    manualDiscount: money().notNull().default('0'), // ₹ taken off (food + liquor) by an approved discount
    manualDiscountPct: pct().notNull().default('0'),
    roundOff: money().notNull().default('0'),
    total: money().notNull().default('0'),
    cancelReason: text(),
    approvalId: uuid().references(() => approvalRequest.id),
    ...stamps,
  },
  (t) => [index().on(t.outletId, t.businessDate), index().on(t.outletId, t.status), unique().on(t.outletId, t.number)],
);

// One round of ordering on a bill. The first one sets bill.openedAt.
export const billOrder = pgTable('bill_order', {
  id: id(),
  billId: uuid().notNull().references(() => bill.id),
  clientId: uuid().unique(),
  placedAt: ts().notNull(),
  placedBy: uuid().notNull().references(() => appUser.id),
});

export const orderLine = pgTable(
  'order_line',
  {
    id: id(),
    billId: uuid().notNull().references(() => bill.id),
    orderId: uuid().notNull().references(() => billOrder.id),
    menuItemId: uuid().notNull().references(() => menuItem.id),
    name: text().notNull(), // as printed
    department: text().$type<Department>().notNull(),
    taxClassId: uuid().notNull().references(() => taxClass.id),
    taxKind: text().$type<'food' | 'liquor'>().notNull(),
    qty: qty().notNull(),
    menuPrice: money().notNull(), // list price at the time
    priceCharged: money().notNull(), // what the guest paid per unit, before tax
    activeDiscountId: uuid().references(() => activeDiscount.id), // offer behind the price, if any
    costAtSale: unitCost(), // portion cost when sold, for margin reports
    status: text().$type<'active' | 'voided'>().notNull().default('active'),
    voidReason: text(),
    readyAt: ts(), // the kitchen or bar marked it ready on the kitchen screen
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.billId), index().on(t.menuItemId, t.createdAt)],
);

// An order a guest sent from the QR menu at their table. Nothing reaches a bill or the stock
// until a cashier accepts it; it then becomes an ordinary order on that table's bill.
export const guestOrder = pgTable(
  'guest_order',
  {
    id: id(),
    outletId: uuid().notNull().references(() => outlet.id),
    tableId: uuid().notNull().references(() => diningTable.id),
    clientId: uuid().notNull().unique(), // from the guest's phone, so a resend is stored once
    lines: jsonb().$type<{ menuItemId: string; qty: number }[]>().notNull(),
    status: text().$type<'pending' | 'accepted' | 'rejected'>().notNull().default('pending'),
    reason: text(), // why it was turned down, shown to the guest
    billId: uuid().references(() => bill.id),
    decidedBy: uuid().references(() => appUser.id),
    decidedAt: ts(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.outletId, t.status), index().on(t.tableId, t.status)],
);

export const payment = pgTable('payment', {
  id: id(),
  billId: uuid().notNull().references(() => bill.id),
  clientId: uuid().unique(),
  mode: text().$type<PaymentMode>().notNull(),
  amount: money().notNull(),
  reference: text(),
  receivedAt: ts().notNull().defaultNow(),
  receivedBy: uuid().notNull().references(() => appUser.id),
});

export const dayClose = pgTable(
  'day_close',
  {
    id: id(),
    outletId: uuid().notNull().references(() => outlet.id),
    businessDate: date().notNull(),
    closedBy: uuid().notNull().references(() => appUser.id),
    closedAt: ts().notNull().defaultNow(),
    totals: jsonb().notNull(),
    cashCounted: money(),
    notes: text(),
  },
  (t) => [unique().on(t.outletId, t.businessDate)],
);
