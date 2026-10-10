import { eq, sql } from 'drizzle-orm';
import { SEED_ROLES, STORE_KINDS, type OutletInput } from '@fnb/shared';
import { hashSecret } from './common.js';
import { controlDb, controlSchema, createCustomer, tenantSchema as t, type TenantDb, type Tx } from './db/index.js';

// Starting catalog every new customer gets. All of it is editable afterwards.
export const COURSES = [
  'Starters', 'Appetizers', 'Soups and salads', 'Main course', 'Breads and rice', 'Sides', 'Desserts', 'Soft beverages',
];

// Liquor tree from handoff 6.6 (a seed list from general knowledge, to be edited per customer).
// "Cocktails" is added as a type so cocktails sit on the beverage side with liquor tax.
export const LIQUOR_TREE: [string, string[]][] = [
  ['Whisky', ['Indian', 'Blended Scotch', 'Single malt', 'Irish', 'Bourbon', 'Japanese']],
  ['Rum', ['White', 'Dark', 'Spiced']],
  ['Vodka', ['Plain', 'Flavoured']],
  ['Gin', ['London dry', 'Indian craft', 'Flavoured']],
  ['Brandy', ['Indian', 'Cognac']],
  ['Tequila and mezcal', ['Blanco', 'Reposado', 'Añejo']],
  ['Liqueurs', ['Coffee', 'Cream', 'Herbal', 'Orange']],
  ['Beer', ['Lager', 'Strong', 'Wheat', 'Craft', 'Draught']],
  ['Wine', ['Red', 'White', 'Rosé', 'Sparkling']],
  ['Ready-to-drink', ['Breezers', 'Hard seltzers']],
  ['Cocktails', []],
];

export const SEED_BRANDS = [
  'Royal Stag', 'Blenders Pride', 'Johnnie Walker', 'Glenfiddich', 'Jameson', 'Jim Beam', 'Old Monk', 'Bacardi',
  'Captain Morgan', 'Smirnoff', 'Absolut', 'Magic Moments', 'Bombay Sapphire', 'Tanqueray', 'Greater Than',
  "McDowell's No.1", 'Hennessy', 'Jose Cuervo', 'Patrón', 'Kahlúa', 'Baileys', 'Jägermeister', 'Cointreau',
  'Kingfisher', 'Budweiser', 'Bira 91', 'Hoegaarden', 'Sula', 'Grover Zampa', "Jacob's Creek", 'Bacardi Breezer',
];

// Tax rates are configuration, not code, and must be confirmed with a CA before go-live.
export const SEED_TAX_CLASSES = [
  {
    code: 'FOOD_GST5',
    name: 'Food – GST 5% (confirm with CA)',
    kind: 'food' as const,
    components: [{ name: 'CGST', ratePct: '2.5' }, { name: 'SGST', ratePct: '2.5' }],
  },
  {
    code: 'LIQUOR',
    name: 'Liquor – rate not set (confirm with CA)',
    kind: 'liquor' as const,
    components: [{ name: 'Liquor VAT', ratePct: '0' }],
  },
];

export async function asSystem<T>(db: TenantDb, device: string, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.device_id', ${device}, true)`);
    return fn(tx);
  });
}

export async function createOutlet(tx: Tx, data: OutletInput) {
  const [o] = await tx.insert(t.outlet).values(data).returning();
  const names = { main: 'Main store', kitchen: 'Kitchen', bar: 'Bar' };
  await tx.insert(t.store).values(STORE_KINDS.map((kind) => ({ outletId: o.id, kind, name: names[kind] })));
  // Beverage offer rule with the handoff's example settings. Nothing runs until the owner
  // switches offers on for this outlet.
  await tx.insert(t.priceRule).values({ outletId: o.id, name: 'Beverage offers (example settings)' });
  return o;
}

export async function bootstrapCustomer(db: TenantDb) {
  await asSystem(db, 'system:bootstrap', async (tx) => {
    for (const r of SEED_ROLES) {
      const [role] = await tx.insert(t.role).values({ name: r.name, description: r.description }).returning();
      await tx.insert(t.rolePermission).values(r.permissions.map((permission) => ({ roleId: role.id, permission })));
    }
    await tx.insert(t.category).values(COURSES.map((name, i) => ({ name, kind: 'course' as const, sortOrder: i })));
    for (const [i, [type, subs]] of LIQUOR_TREE.entries()) {
      const [c] = await tx.insert(t.category).values({ name: type, kind: 'liquor_type', sortOrder: i }).returning();
      if (subs.length) {
        await tx
          .insert(t.category)
          .values(subs.map((name, j) => ({ name, kind: 'liquor_subtype' as const, parentId: c.id, sortOrder: j })));
      }
    }
    await tx.insert(t.brand).values(SEED_BRANDS.map((name) => ({ name })));
    await tx.insert(t.taxClass).values(SEED_TAX_CLASSES);
  });
}

// The first sign-in for a new customer: an owner with every permission at every outlet.
export async function addOwner(customerId: string, db: TenantDb, owner: { login: string; name: string; password: string; pin?: string }) {
  const login = owner.login.trim().toLowerCase();
  await controlDb().insert(controlSchema.loginRoute).values({ login, customerId });
  return asSystem(db, 'system:bootstrap', async (tx) => {
    const [role] = await tx.select().from(t.role).where(eq(t.role.name, SEED_ROLES[0].name));
    const [u] = await tx
      .insert(t.appUser)
      .values({
        login,
        name: owner.name,
        passwordHash: await hashSecret(owner.password),
        pinHash: owner.pin ? await hashSecret(owner.pin) : null,
      })
      .returning();
    await tx.insert(t.userRole).values({ userId: u.id, roleId: role.id, outletId: null });
    return u;
  });
}

export async function provisionCustomer(input: { code: string; name: string; owner: { login: string; name: string; password: string } }) {
  const { customer, db } = await createCustomer(input);
  await bootstrapCustomer(db);
  await addOwner(customer.id, db, input.owner);
  return customer;
}
