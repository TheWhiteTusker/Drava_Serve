// Every permission the API checks. Roles are editable sets of these codes.
export const PERMISSIONS = {
  // Access and audit
  'users.manage': 'Add and edit users and roles',
  'outlets.manage': 'Add and edit outlets',
  'settings.manage': 'Change settings (indent cut-off, tolerances)',
  'audit.view': 'See the change history',
  'approvals.decide': 'Approve or reject requests in the approval queue',
  'data.export': 'Export or delete the business data',
  // Catalog and pricing
  'catalog.view': 'See menu items, stock items and the liquor list',
  'catalog.manage': 'Add and edit menu items, stock items, categories and brands',
  'recipes.manage': 'Add and edit recipes',
  'prices.manage': 'Change menu prices (large changes still need approval)',
  'pricing.rules': 'Set margin targets and beverage offer rules',
  'menu.pins': 'Pin dishes and exclude beverages from offers',
  'offers.liquorSwitch': 'Turn beverage offers on or off for an outlet',
  'tax.manage': 'Edit tax classes and rates',
  // Inventory
  'inventory.view': 'See stock levels and movements',
  'inventory.transfer': 'Move stock between stores',
  'inventory.wastage': 'Record wastage, spillage and breakage (goes for approval)',
  'inventory.writeOff': 'Record wastage, spillage and breakage without approval',
  'inventory.count': 'Enter stock counts',
  // Purchasing and receiving
  'vendors.manage': 'Add and edit vendors',
  'rates.view': 'See purchase rates and amounts',
  'indent.manage': 'Review, approve and send the nightly indent',
  'receiving.gate': 'Gate check deliveries (accept, short, reject)',
  'receiving.recheck': 'Re-check deliveries and raise return notes',
  'grn.approve': 'Release goods received notes held for a rate difference',
  'accounts.pay': 'Record vendor payments',
  // POS
  'pos.bill': 'Open bills, take orders and payments',
  'pos.dayClose': 'Close the day',
  'kitchen.view': 'See kitchen and bar orders and mark them ready',
  // Reports
  'reports.view': 'See the dashboard and reports',
  'reports.export': 'Export reports',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as Permission[];

// Seed roles from handoff 6.12. Customers can reshape them in the admin app.
export const SEED_ROLES: { name: string; description: string; permissions: Permission[] }[] = [
  {
    name: 'Owner / admin',
    description: 'All modules, all outlets',
    permissions: PERMISSION_CODES,
  },
  {
    name: 'Outlet manager',
    description: 'Menu, prices, offers, nightly indent, stock corrections for their outlet',
    permissions: [
      'catalog.view', 'catalog.manage', 'recipes.manage', 'prices.manage', 'menu.pins',
      'inventory.view', 'inventory.transfer', 'inventory.wastage', 'inventory.writeOff', 'inventory.count',
      'vendors.manage', 'rates.view', 'indent.manage', 'receiving.recheck', 'grn.approve',
      'approvals.decide', 'pos.bill', 'pos.dayClose', 'kitchen.view', 'reports.view', 'reports.export', 'audit.view',
    ],
  },
  {
    name: 'Watchman',
    description: 'Gate check only; sees quantities, not rates',
    permissions: ['receiving.gate'],
  },
  {
    name: 'Storekeeper / kitchen staff',
    description: 'Re-check, return notes, transfers, stock counts',
    permissions: [
      'catalog.view', 'inventory.view', 'inventory.transfer', 'inventory.wastage', 'inventory.count',
      'receiving.recheck', 'rates.view', 'kitchen.view',
    ],
  },
  {
    name: 'Chef / bar manager',
    description: 'Recipes, kitchen or bar stock, wastage and spillage',
    permissions: ['catalog.view', 'recipes.manage', 'inventory.view', 'inventory.wastage', 'inventory.writeOff', 'rates.view', 'kitchen.view'],
  },
  {
    name: 'Cashier',
    description: 'Bills, payments, receipts',
    permissions: ['pos.bill'],
  },
  {
    name: 'Accounts',
    description: 'Goods received notes, vendor payments, reports',
    permissions: ['rates.view', 'accounts.pay', 'reports.view', 'reports.export'],
  },
];
