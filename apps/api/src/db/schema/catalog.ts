import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { BaseUnit, CategoryKind, Department, DietType, TaxComponent } from '@fnb/shared';
import { id, money, pct, qty, stamps, ts, unitCost } from './columns.js';
import { outlet } from './access.js';

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
    check('category_kind', sql`${t.kind} in ('course','liquor_type','liquor_subtype','drink_type','stock')`),
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
