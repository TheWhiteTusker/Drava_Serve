// List / get / create / update controllers for simple tables.
import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { withVersion, type Permission } from '@fnb/shared';
import type { ZodType } from 'zod';
import { C, Ctx, findOr404, parse, Permit, updateVersioned } from './common.js';
import type { Tx } from './db/index.js';

interface CrudOpts {
  path: string;
  table: any;
  schema: ZodType<any>;
  view: Permission;
  manage: Permission;
  outletScoped?: boolean; // rows carry outletId and users only see their outlets
  orderBy: (table: any) => any[];
  // Validates, may adjust data, and may return extra fields for the response.
  check?: (ctx: Ctx, tx: Tx, data: any, before?: any) => Promise<Record<string, unknown> | void>;
  after?: (ctx: Ctx, row: any) => void;
}

// List / get / create / update for simple tables. Customer-wide tables (no outletId) need the
// permission at any outlet; outlet tables need it at the row's outlet.
export function crud(o: CrudOpts) {
  @Controller(o.path)
  class CrudController {
    @Get()
    @Permit(o.view)
    list(@C() ctx: Ctx, @Query('outletId') outletId?: string) {
      let where;
      if (o.outletScoped) {
        if (outletId) ctx.assert(o.view, outletId);
        const allowed = ctx.outletsWith(o.view);
        where = outletId ? eq(o.table.outletId, outletId) : allowed === 'all' ? undefined : inArray(o.table.outletId, allowed);
      }
      return ctx.db.select().from(o.table).where(where).orderBy(...o.orderBy(o.table));
    }

    @Get(':id')
    @Permit(o.view)
    async get(@C() ctx: Ctx, @Param('id') id: string) {
      const row = await findOr404(ctx.db.select().from(o.table).where(eq(o.table.id, id)));
      if (o.outletScoped) ctx.assert(o.view, row.outletId);
      return row;
    }

    @Post()
    @Permit(o.manage)
    create(@C() ctx: Ctx, @Body() body: unknown) {
      const data = parse(o.schema, body);
      if (o.outletScoped) ctx.assert(o.manage, data.outletId);
      return ctx.tx(async (tx) => {
        await o.check?.(ctx, tx, data);
        const [row] = (await tx.insert(o.table).values(data).returning()) as any[];
        o.after?.(ctx, row);
        return row;
      });
    }

    @Put(':id')
    @Permit(o.manage)
    update(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
      const { version, ...data } = parse(withVersion(o.schema), body);
      return ctx.tx(async (tx) => {
        const before = await findOr404(tx.select().from(o.table).where(eq(o.table.id, id)));
        if (o.outletScoped) {
          ctx.assert(o.manage, before.outletId);
          ctx.assert(o.manage, data.outletId);
        }
        const extra = await o.check?.(ctx, tx, data, before);
        const row = await updateVersioned(tx, o.table, id, version, data);
        o.after?.(ctx, row);
        return { ...row, ...extra };
      });
    }
  }
  Object.defineProperty(CrudController, 'name', { value: `${o.path.replace(/\W/g, '_')}Controller` });
  return CrudController;
}
