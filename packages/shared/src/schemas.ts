import { z } from 'zod';
import {
  ALLERGENS, BASE_UNITS, CATEGORY_KINDS, DEPARTMENTS, DIET_TYPES, ORIGINS, PRICE_TIERS,
} from './constants';
import { PERMISSION_CODES } from './permissions';

// Input validation shared by the API (enforced) and the admin app (early feedback).
// Decimals travel as strings so no value ever passes through a float.

const decimal = (places: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(new RegExp(`^\\d+(\\.\\d{1,${places}})?$`), `Enter a number with up to ${places} decimals`));

export const zMoney = decimal(2);
export const zQty = decimal(3);
export const zUnitCost = decimal(6); // ₹ per gram or ml can be small
export const zPct = decimal(2).refine((v) => Number(v) <= 100, 'Must be 100 or less');
const id = z.uuid();
const optText = z.string().trim().max(500).optional().nullable().transform((v) => v || null);
const name = z.string().trim().min(1, 'Required').max(200);

export const zLogin = z.object({
  login: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});

const newPassword = z.string().min(8, 'At least 8 characters');
export const zChangePassword = z.object({ currentPassword: z.string().min(1), newPassword });
export const zForgotPassword = zLogin.pick({ login: true });
export const zResetPassword = z.object({ token: z.string().min(1), password: newPassword });

export const zPinSwitch = z.object({
  userId: id,
  pin: z.string().regex(/^\d{4,6}$/, 'PIN is 4 to 6 digits'),
});

export const zOutlet = z.object({
  name,
  code: z.string().trim().min(1).max(20),
  state: z.string().trim().min(1).default('Karnataka'),
  address: optText,
  gstin: optText,
  fssaiNumber: z
    .string()
    .trim()
    .regex(/^\d{14}$/, 'FSSAI licence number is 14 digits')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  exciseLicence: optText,
  active: z.boolean().default(true),
});

export const zUser = z.object({
  name,
  login: z.string().trim().toLowerCase().min(3).max(200),
  phone: optText,
  active: z.boolean().default(true),
  password: z.string().min(8, 'At least 8 characters').nullish(),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN is 4 to 6 digits').nullish(),
  // outletId null = all outlets
  roles: z.array(z.object({ roleId: id, outletId: id.nullable() })).default([]),
});

export const zRole = z.object({
  name,
  description: optText,
  permissions: z.array(z.enum(PERMISSION_CODES as [string, ...string[]])).default([]),
});

export const zCategory = z.object({
  name,
  kind: z.enum(CATEGORY_KINDS),
  parentId: id.nullable().optional(),
  sortOrder: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});

export const zBrand = z.object({ name, active: z.boolean().default(true) });

export const zTaxClass = z.object({
  code: z.string().trim().min(1).max(30),
  name,
  kind: z.enum(['food', 'liquor']),
  components: z.array(z.object({ name: z.string().trim().min(1), ratePct: zPct })).min(0),
  active: z.boolean().default(true),
});

export const zStockItem = z
  .object({
    name,
    sku: optText,
    department: z.enum(DEPARTMENTS),
    categoryId: id.nullable().optional(),
    brandId: id.nullable().optional(),
    baseUnit: z.enum(BASE_UNITS),
    bottleSizeMl: zQty.nullable().optional(),
    abvPct: zPct.nullable().optional(),
    origin: z.enum(ORIGINS).nullable().optional(),
    priceTier: z.enum(PRICE_TIERS).nullable().optional(),
    perishable: z.boolean().default(false),
    shelfLifeDays: z.coerce.number().int().positive().nullable().optional(),
    currentCost: zUnitCost.default('0'), // ₹ per base unit, from the latest billed rate
    active: z.boolean().default(true),
    // Purchase units: e.g. "kg" = 1000 g, "case of 12" = 9000 ml.
    units: z
      .array(z.object({ name: z.string().trim().min(1), factor: zQty, isDefault: z.boolean().default(false) }))
      .default([]),
    // Per-outlet levels in base units.
    levels: z
      .array(z.object({ outletId: id, parLevel: zQty, reorderLevel: zQty, criticalLevel: zQty }))
      .default([]),
  })
  .refine((v) => !v.bottleSizeMl || v.baseUnit === 'ml', {
    message: 'Bottle size needs the base unit ml',
    path: ['bottleSizeMl'],
  });

export const zMenuItem = z
  .object({
    outletId: id,
    name,
    code: optText,
    department: z.enum(DEPARTMENTS),
    categoryId: id,
    brandId: id.nullable().optional(),
    dietType: z.enum(DIET_TYPES).nullable().optional(),
    serveSizeMl: zQty.nullable().optional(),
    sellingPrice: zMoney,
    taxClassId: id,
    targetMarginPct: zPct.nullable().optional(),
    lowThreshold: z.coerce.number().int().nonnegative().nullable().optional(),
    calories: z.coerce.number().int().nonnegative().nullable().optional(),
    description: optText,
    tags: z.array(z.string().trim().min(1)).default([]),
    allergens: z.array(z.enum(ALLERGENS)).default([]),
    active: z.boolean().default(true),
  })
  .refine((v) => v.department !== 'food' || !!v.dietType, {
    message: 'Veg, non-veg or egg is required for food',
    path: ['dietType'],
  });

export const zDiningTable = z.object({
  outletId: id,
  name: z.string().trim().min(1, 'Required').max(40),
  sortOrder: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});

// Every update carries the version the editor started from.
export const withVersion = <T extends z.ZodTypeAny>(s: T) => z.intersection(s, z.object({ version: z.coerce.number().int() }));

export type OutletInput = z.infer<typeof zOutlet>;
export type StockItemInput = z.infer<typeof zStockItem>;
