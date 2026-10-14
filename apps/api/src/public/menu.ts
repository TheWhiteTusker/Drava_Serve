import { NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { tableCodeOf, tableSlug } from '@fnb/shared';
import { z } from 'zod';
import { getSettings } from '../access/settings.js';
import { controlDb, controlSchema, tenantDb, tenantSchema as t } from '../db/index.js';
import { menuForSale } from '../pricing/menu.js';

// ---------- Guest QR menu (no sign-in, collects nothing about guests) ----------

type PublicMenu = Awaited<ReturnType<typeof publicMenu>>;
export const publicCache = new Map<string, { at: number; menu: Promise<PublicMenu> }>();

async function publicMenu(customerCode: string, outletCode: string) {
  const [c] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.code, customerCode));
  if (!c || c.status !== 'active') throw new NotFoundException('Menu not found');
  const db = tenantDb(c.dbName);
  const [outlet] = await db.select().from(t.outlet).where(and(eq(t.outlet.code, outletCode.toUpperCase()), eq(t.outlet.active, true)));
  if (!outlet) throw new NotFoundException('Menu not found');
  const [items, settings, tables] = await Promise.all([
    menuForSale(db, outlet.id),
    getSettings(db, outlet.id),
    db
      .select({ id: t.diningTable.id, name: t.diningTable.name, code: t.diningTable.code })
      .from(t.diningTable)
      .where(and(eq(t.diningTable.outletId, outlet.id), eq(t.diningTable.active, true)))
      .orderBy(t.diningTable.sortOrder, t.diningTable.name),
  ]);
  return {
    customerId: c.id, db, outletId: outlet.id,
    ordering: settings.effective['guest.ordering'] as boolean,
    pickTable: settings.effective['guest.pickTable'] as boolean, // demo switch: list the tables to pick from
    tables: new Map(tables.map((x) => [x.id, { id: x.id, name: x.name, slug: tableSlug(x), code: x.code }])), // looked up per phone without touching the database
    body: {
      outlet: { name: outlet.name, address: outlet.address, fssaiNumber: outlet.fssaiNumber },
      items: items.map(({ taxClassId: _t, activeDiscountId: _d, portions, ...i }) => ({ ...i, fewLeft: i.status === 'low' ? portions : null })),
    },
  };
}

// One build per outlet every 15 s, shared by every phone. The promise is cached, so a full
// restaurant scanning at the moment it expires waits on a single rebuild instead of starting one each.
export function cachedMenu(customerCode: string, outletCode: string) {
  const key = `${customerCode}/${outletCode.toUpperCase()}`;
  const hit = publicCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.menu;
  const menu = publicMenu(customerCode, outletCode);
  publicCache.set(key, { at: Date.now(), menu });
  menu.catch(() => publicCache.delete(key)); // unknown codes are not remembered
  return menu;
}

// The table a QR code was printed for, from its link ("t4-k7q2": only the code counts) or its id.
export function publicTable(m: PublicMenu, ref: string | undefined) {
  if (!ref) return null;
  const code = tableCodeOf(ref);
  const t = m.tables.get(ref) ?? [...m.tables.values()].find((x) => x.code === code);
  return t ? { id: t.id, name: t.name, slug: t.slug } : null;
}

export const zGuestOrder = z.object({
  clientId: z.uuid(),
  tableId: z.uuid(),
  lines: z.array(z.object({ menuItemId: z.uuid(), qty: z.number().int().min(1).max(20) })).min(1, 'Add something first').max(30),
});
export const MAX_WAITING = 3; // per table: stops a stray phone flooding the counter
