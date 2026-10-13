import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text,
  timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import type {
  BaseUnit, CategoryKind, Department, DietType, MovementType, PaymentMode, StoreKind, TaxComponent,
} from '@fnb/shared';

// One of these databases per customer (restaurant business). There is deliberately no
// customer column anywhere: separation comes from the database itself.
// Columns are snake_case in SQL (drizzle `casing: 'snake_case'`).

const ts = (n?: string) => (n ? timestamp(n, { withTimezone: true }) : timestamp({ withTimezone: true }));
const money = () => numeric({ precision: 12, scale: 2 }); // ₹
const qty = () => numeric({ precision: 14, scale: 3 }); // g / ml / pc
const unitCost = () => numeric({ precision: 16, scale: 6 }); // ₹ per base unit
const pct = () => numeric({ precision: 5, scale: 2 });
const id = () => uuid().primaryKey().defaultRandom();
const stamps = {
  version: integer().notNull().default(1),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
};

// ---------- Access and audit ----------

export const outlet = pgTable('outlet', {
  id: id(),
  name: text().notNull(),
  code: text().notNull().unique(),
  state: text().notNull(),
  address: text(),
  gstin: text(),
  fssaiNumber: text(),
  exciseLicence: text(),
  active: boolean().notNull().default(true),
  ...stamps,
});

export const appUser = pgTable('app_user', {
  id: id(),
  name: text().notNull(),
  login: text().notNull().unique(),
  phone: text(),
  passwordHash: text(),
  pinHash: text(),
  failedAttempts: integer().notNull().default(0),
  lockedUntil: ts(),
  active: boolean().notNull().default(true),
  ...stamps,
});

export const role = pgTable('role', {
  id: id(),
  name: text().notNull().unique(),
  description: text(),
  ...stamps,
});

export const rolePermission = pgTable(
  'role_permission',
  {
    roleId: uuid().notNull().references(() => role.id, { onDelete: 'cascade' }),
    permission: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

// outletId null = the role applies at every outlet.
export const userRole = pgTable(
  'user_role',
  {
    id: id(),
    userId: uuid().notNull().references(() => appUser.id, { onDelete: 'cascade' }),
    roleId: uuid().notNull().references(() => role.id, { onDelete: 'cascade' }),
    outletId: uuid().references(() => outlet.id),
  },
  (t) => [unique().on(t.userId, t.roleId, t.outletId).nullsNotDistinct()],
);

// Customer-wide setting when outletId is null; an outlet row overrides it.
export const setting = pgTable(
  'setting',
  {
    id: id(),
    outletId: uuid().references(() => outlet.id),
    key: text().notNull(),
    value: jsonb().notNull(),
    ...stamps,
  },
  (t) => [unique().on(t.outletId, t.key).nullsNotDistinct()],
);

export const approvalRequest = pgTable(
  'approval_request',
  {
    id: id(),
    outletId: uuid().references(() => outlet.id),
    type: text().notNull(), // e.g. price_change, wastage, count_correction, bill_cancel
    entity: text().notNull(),
    entityId: text(),
    current: jsonb(),
    proposed: jsonb().notNull(),
    reason: text(),
    status: text().$type<'pending' | 'approved' | 'rejected' | 'cancelled'>().notNull().default('pending'),
    proposedBy: uuid().references(() => appUser.id), // null when raised by the system (e.g. a margin flag)
    proposedAt: ts().notNull().defaultNow(),
    decidedBy: uuid().references(() => appUser.id),
    decidedAt: ts(),
    decisionNote: text(),
    ...stamps,
  },
  (t) => [index().on(t.status, t.outletId)],
);

// Written by a database trigger on every audited table (see migrations), so no code path can skip it.
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: ts().notNull().defaultNow(),
    userId: uuid(),
    deviceId: text(),
    outletId: uuid(),
    entity: text().notNull(),
    entityId: text(),
    action: text().notNull(),
    before: jsonb(),
    after: jsonb(),
  },
  (t) => [index().on(t.entity, t.entityId), index().on(t.at)],
);

// ---------- Catalog ----------

export const taxClass = pgTable('tax_class', {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  kind: text().$type<'food' | 'liquor'>().notNull(),
  components: jsonb().$type<TaxComponent[]>().notNull(),
  active: boolean().notNull().default(true),
  ...stamps,
});

export const category = pgTable(
  'category',
  {
    id: id(),
    name: text().notNull(),
    kind: text().$type<CategoryKind>().notNull(),
    parentId: uuid().references((): any => category.id),
    sortOrder: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    ...stamps,
  },
  (t) => [
    unique().on(t.kind, t.parentId, t.name).nullsNotDistinct(),
    check('category_kind', sql`${t.kind} in ('course','liquor_type','liquor_subtype','stock')`),
  ],
);

export const brand = pgTable('brand', {
  id: id(),
  name: text().notNull().unique(),
  active: boolean().notNull().default(true),
  ...stamps,
});

// Ingredients and bottles. For liquor this is the "product" level of the tree:
// one bottle size of one label, under a liquor sub-type category and a brand.
export const stockItem = pgTable(
  'stock_item',
  {
    id: id(),
    name: text().notNull(),
    sku: text(),
    department: text().$type<Department>().notNull(),
    categoryId: uuid().references(() => category.id),
    brandId: uuid().references(() => brand.id),
    baseUnit: text().$type<BaseUnit>().notNull(),
    bottleSizeMl: qty(),
    abvPct: pct(),
    origin: text(),
    priceTier: text(),
    perishable: boolean().notNull().default(false),
    shelfLifeDays: integer(),
    currentCost: unitCost().notNull().default('0'), // latest billed rate per base unit
    active: boolean().notNull().default(true),
    ...stamps,
  },
  (t) => [
    unique().on(t.name),
    check('stock_item_department', sql`${t.department} in ('food','beverage')`),
    check('stock_item_base_unit', sql`${t.baseUnit} in ('g','ml','pc')`),
  ],
);

// Purchase units: "kg" = 1000 g, "case of 12 x 750 ml" = 9000 ml.
export const stockItemUnit = pgTable(
  'stock_item_unit',
  {
    id: id(),
    stockItemId: uuid().notNull().references(() => stockItem.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    factor: qty().notNull(), // base units per purchase unit
    isDefault: boolean().notNull().default(false),
  },
  (t) => [unique().on(t.stockItemId, t.name), check('unit_factor_positive', sql`${t.factor} > 0`)],
);

// Par / reorder / critical levels per outlet, in base units.
export const stockLevel = pgTable(
  'stock_level',
  {
    stockItemId: uuid().notNull().references(() => stockItem.id, { onDelete: 'cascade' }),
    outletId: uuid().notNull().references(() => outlet.id),
    parLevel: qty().notNull().default('0'),
    reorderLevel: qty().notNull().default('0'),
    criticalLevel: qty().notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.stockItemId, t.outletId] })],
);

export const menuItem = pgTable(
  'menu_item',
  {
    id: id(),
    outletId: uuid().notNull().references(() => outlet.id),
    name: text().notNull(),
    code: text(),
    department: text().$type<Department>().notNull(),
    categoryId: uuid().notNull().references(() => category.id),
    brandId: uuid().references(() => brand.id),
    dietType: text().$type<DietType>(),
    serveSizeMl: qty(),
    sellingPrice: money().notNull(), // before tax
    taxClassId: uuid().notNull().references(() => taxClass.id),
    targetMarginPct: pct(),
    lowThreshold: integer(), // portions; falls back to the outlet setting
    calories: integer(),
    description: text(),
    photoKey: text(),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    allergens: text().array().notNull().default(sql`'{}'::text[]`),
    pinPosition: integer(), // manager pin inside its course
    offerExcluded: boolean().notNull().default(false),
    recipeVersion: integer().notNull().default(1),
    active: boolean().notNull().default(true),
    ...stamps,
  },
  (t) => [
    unique().on(t.outletId, t.name),
    index().on(t.outletId, t.categoryId),
    check('menu_item_diet', sql`${t.department} <> 'food' or ${t.dietType} in ('veg','non_veg','egg')`),
    check('menu_item_price', sql`${t.sellingPrice} >= 0`),
  ],
);

export const recipeLine = pgTable(
  'recipe_line',
  {
    id: id(),
    menuItemId: uuid().notNull().references(() => menuItem.id, { onDelete: 'cascade' }),
    stockItemId: uuid().notNull().references(() => stockItem.id),
    quantity: qty().notNull(), // base units in one portion; stock drawn = quantity ÷ yield
    yieldPct: pct().notNull().default('100'),
  },
  (t) => [
    unique().on(t.menuItemId, t.stockItemId),
    check('recipe_qty_positive', sql`${t.quantity} > 0`),
    check('recipe_yield', sql`${t.yieldPct} > 0 and ${t.yieldPct} <= 100`),
  ],
);

export const menuItemCost = pgTable(
  'menu_item_cost',
  {
    id: id(),
    menuItemId: uuid().notNull().references(() => menuItem.id, { onDelete: 'cascade' }),
    portionCost: unitCost().notNull(),
    sellingPrice: money().notNull(),
    marginAmount: unitCost().notNull(),
    marginPct: numeric({ precision: 7, scale: 2 }).notNull(),
    reason: text(),
    calculatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.menuItemId, t.calculatedAt)],
);

// Target margin per outlet (categoryId null) or per outlet + category. Item-level lives on menu_item.
export const marginTarget = pgTable(
  'margin_target',
  {
    id: id(),
    outletId: uuid().notNull().references(() => outlet.id),
    categoryId: uuid().references(() => category.id),
    targetPct: pct().notNull(),
    ...stamps,
  },
  (t) => [unique().on(t.outletId, t.categoryId).nullsNotDistinct()],
);

export const menuRank = pgTable('menu_rank', {
  menuItemId: uuid().primaryKey().references(() => menuItem.id, { onDelete: 'cascade' }),
  outletId: uuid().notNull().references(() => outlet.id),
  position: integer().notNull(),
  availablePortions: qty(),
  computedAt: ts().notNull().defaultNow(),
});

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
    sortOrder: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    ...stamps,
  },
  (t) => [unique().on(t.outletId, t.name)],
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
