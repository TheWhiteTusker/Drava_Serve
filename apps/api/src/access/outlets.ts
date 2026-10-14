import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { withVersion, zOutlet } from '@fnb/shared';
import { createOutlet } from '../bootstrap.js';
import { C, Ctx, parse, updateVersioned } from '../common.js';
import { tenantSchema as t } from '../db/index.js';

// ---------- Outlets ----------

@Controller('outlets')
export class OutletsController {
  @Get()
  async list(@C() ctx: Ctx) {
    const everywhere = ctx.grants.some((g) => g.outletId === null);
    const ids = [...new Set(ctx.grants.map((g) => g.outletId!).filter(Boolean))];
    return ctx.db
      .select()
      .from(t.outlet)
      .where(everywhere ? undefined : inArray(t.outlet.id, ids))
      .orderBy(t.outlet.name);
  }

  @Get(':id/stores')
  stores(@C() ctx: Ctx, @Param('id') id: string) {
    if (!ctx.grants.some((g) => g.outletId === null || g.outletId === id)) ctx.assert('outlets.manage', id);
    return ctx.db.select().from(t.store).where(eq(t.store.outletId, id)).orderBy(t.store.kind);
  }

  // Every outlet starts with a main store, a kitchen store and a bar store.
  @Post()
  async create(@C() ctx: Ctx, @Body() body: unknown) {
    ctx.assert('outlets.manage', null);
    const data = parse(zOutlet, body);
    return ctx.tx((tx) => createOutlet(tx, data));
  }

  @Put(':id')
  async update(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    ctx.assert('outlets.manage', id);
    const { version, ...data } = parse(withVersion(zOutlet), body);
    return ctx.tx((tx) => updateVersioned(tx, t.outlet, id, version, data));
  }
}
