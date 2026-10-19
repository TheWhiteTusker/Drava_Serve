// Fixed vocabularies shared by the API, the apps and the database checks.

export const TIME_ZONE = 'Asia/Kolkata';

export const DEPARTMENTS = ['food', 'beverage'] as const;
export type Department = (typeof DEPARTMENTS)[number];

// Egg is treated as non-veg on menus and bills (handoff 6.6).
export const DIET_TYPES = ['veg', 'non_veg', 'egg'] as const;
export type DietType = (typeof DIET_TYPES)[number];

export const ALLERGENS = ['milk', 'nuts', 'gluten', 'egg', 'soy', 'shellfish'] as const;

// Suggested tag prefixes; tags are free text so customers can add their own.
export const TAG_SUGGESTIONS = [
  'cuisine:North Indian',
  'cuisine:South Indian',
  'cuisine:Chinese',
  'cuisine:Continental',
  'spice:mild',
  'spice:medium',
  'spice:hot',
  "chef's special",
  'jain',
] as const;

export const BASE_UNITS = ['g', 'ml', 'pc'] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

// course = food course; liquor_type / liquor_subtype = the liquor tree (alcoholic beverages);
// drink_type = non-alcoholic beverages (soft drinks, mocktails…); stock = ingredient grouping.
export const CATEGORY_KINDS = ['course', 'liquor_type', 'liquor_subtype', 'drink_type', 'stock'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const ORIGINS = ['indian', 'imported'] as const;
export const PRICE_TIERS = ['economy', 'standard', 'premium', 'luxury'] as const;

export const STORE_KINDS = ['main', 'kitchen', 'bar'] as const;
export type StoreKind = (typeof STORE_KINDS)[number];

// Ledger movements from handoff 6.7. Quantity sign: receipts add, everything else per row.
export const MOVEMENT_TYPES = [
  'opening',
  'goods_receipt',
  'sale',
  'transfer_out',
  'transfer_in',
  'wastage',
  'spillage',
  'breakage',
  'complimentary',
  'staff_meal',
  'count_correction',
  'return_to_vendor',
  'reversal',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const PAYMENT_MODES = ['cash', 'upi', 'card'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

// Settings with their defaults. Outlet values override customer values.
export const SETTING_DEFAULTS = {
  'indent.cutoff': '23:00',
  'indent.mode': 'approval' as 'approval' | 'auto',
  'offers.liquorEnabled': false,
  'receiving.rateTolerancePct': 10,
  'approvals.priceChangeLimitPct': 10,
  'menu.lowThresholdServes': 5,
  'pricing.flagTolerancePct': 2,
  'business.dayStart': '05:00',
  'guest.ordering': true, // guests can send orders from the table QR menu; staff accept each one
  'guest.pickTable': false, // for demos: the outlet QR menu lets a guest pick any table to order for
} as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;
// Settings that make sense per outlet (the rest are customer-wide only).
export const OUTLET_SETTING_KEYS: SettingKey[] = [
  'indent.cutoff',
  'offers.liquorEnabled',
  'receiving.rateTolerancePct',
  'menu.lowThresholdServes',
  'guest.ordering',
  'guest.pickTable',
];
