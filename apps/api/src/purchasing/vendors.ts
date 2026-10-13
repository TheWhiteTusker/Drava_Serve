import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { C, Ctx, parse, Permit } from '../common.js';
import { tenantSchema as t, type Q } from '../db/index.js';
import { crud } from '../crud.js';

// ---------- Vendors ----------

const zVendor = z.object({
  name: z.string().trim().min(1),
  department: z.enum(['food', 'beverage', 'both']),
  contactName: z.string().trim().nullish(),
  phone: z.string().trim().nullish(),
  email: z.string().trim().nullish(),
  gstin: z.string().trim().nullish(),
  address: z.string().trim().nullish(),
  active: z.boolean().default(true),
});

export const VendorsController = crud({
  path: 'vendors',
  table: t.vendor,
  schema: zVendor,
  view: 'vendors.manage',
  manage: 'vendors.manage',
  orderBy: (v) => [asc(v.department), asc(v.name)],
});

@Controller('vendors')
export class VendorItemsController {
  // What a vendor supplies, in which purchase unit and pack size, with the last rate paid.
  @Get(':id/items')
  @Permit('vendors.manage')
  async items(@C() ctx: Ctx, @Param('id') id: string) {
    const rows = await ctx.db
      .select({ vi: t.vendorItem, name: t.stockItem.name, baseUnit: t.stockItem.baseUnit, unitName: t.stockItemUnit.name, factor: t.stockItemUnit.factor })
      .from(t.vendorItem)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.vendorItem.stockItemId))
      .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.vendorItem.unitId))
      .where(eq(t.vendorItem.vendorId, id))
      .orderBy(t.stockItem.name);
    const showRates = ctx.can('rates.view');
    const last = showRates ? await lastRates(ctx.db, rows.map((r) => r.vi.stockItemId), id) : new Map();
    return rows.map((r) => ({ ...r.vi, name: r.name, baseUnit: r.baseUnit, unitName: r.unitName, factor: r.factor, lastRate: last.get(r.vi.stockItemId) ?? null }));
  }

  @Put(':id/items')
  @Permit('vendors.manage')
  async setItems(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const items = parse(
      z.array(z.object({ stockItemId: z.uuid(), unitId: z.uuid().nullish(), packSize: z.string().regex(/^\d+(\.\d{1,3})?$/).default('1'), preferred: z.boolean().default(true) })),
      body,
    );
    await ctx.tx(async (tx) => {
      await tx.delete(t.vendorItem).where(and(eq(t.vendorItem.vendorId, id), items.length ? notInArray(t.vendorItem.stockItemId, items.map((i) => i.stockItemId)) : undefined));
      for (const i of items) {
        await tx
          .insert(t.vendorItem)
          .values({ ...i, vendorId: id })
          .onConflictDoUpdate({ target: [t.vendorItem.vendorId, t.vendorItem.stockItemId], set: { unitId: i.unitId, packSize: i.packSize, preferred: i.preferred } });
      }
    });
    return this.items(ctx, id);
  }
}

// Latest billed rate per stock item (optionally from one vendor).
export async function lastRates(q: Q, stockItemIds: string[], vendorId?: string) {
  if (!stockItemIds.length) return new Map<string, { rate: string; ratePerBase: string; billedOn: string; vendorId: string }>();
  const rows = await q
    .selectDistinctOn([t.vendorRate.stockItemId])
    .from(t.vendorRate)
    .where(and(inArray(t.vendorRate.stockItemId, stockItemIds), vendorId ? eq(t.vendorRate.vendorId, vendorId) : undefined))
    .orderBy(t.vendorRate.stockItemId, desc(t.vendorRate.billedOn), desc(t.vendorRate.createdAt));
  return new Map(rows.map((r) => [r.stockItemId, { rate: r.rate, ratePerBase: r.ratePerBase, billedOn: r.billedOn, vendorId: r.vendorId }]));
}

@Controller('vendor-rates')
export class VendorRatesController {
  // Running price history, newest first: Food and Beverage parts by department.
  @Get()
  @Permit('rates.view')
  async list(@C() ctx: Ctx, @Query('stockItemId') stockItemId?: string, @Query('vendorId') vendorId?: string, @Query('department') department?: string) {
    return ctx.db
      .select({ r: t.vendorRate, item: t.stockItem.name, department: t.stockItem.department, vendor: t.vendor.name, unit: t.stockItemUnit.name })
      .from(t.vendorRate)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.vendorRate.stockItemId))
      .innerJoin(t.vendor, eq(t.vendor.id, t.vendorRate.vendorId))
      .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.vendorRate.unitId))
      .where(
        and(
          stockItemId ? eq(t.vendorRate.stockItemId, stockItemId) : undefined,
          vendorId ? eq(t.vendorRate.vendorId, vendorId) : undefined,
          department ? eq(t.stockItem.department, department as any) : undefined,
        ),
      )
      .orderBy(desc(t.vendorRate.billedOn), desc(t.vendorRate.createdAt))
      .limit(300)
      .then((rows) => rows.map((x) => ({ ...x.r, item: x.item, department: x.department, vendor: x.vendor, unit: x.unit })));
  }
}
