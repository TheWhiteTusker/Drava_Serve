import { Controller, Get, Query } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { rupees } from '@fnb/shared';
import { C, Ctx } from './common.js';
import { tenantSchema as t, type Q } from './db/index.js';
import { publish } from './events.js';

// The activity feed: what happened and why, in plain words, as it happens.

export type ActivityKind = 'offer_started' | 'offer_ended' | 'sold_out' | 'back_in_stock' | 'delivery' | 'delivery_held' | 'price_flag' | 'day_closed';

export async function logActivity(ctx: Pick<Ctx, 'customerId'>, q: Q, e: { outletId: string | null; kind: ActivityKind; title: string; message: string; data?: unknown }) {
  const [row] = await q.insert(t.activity).values({ outletId: e.outletId, kind: e.kind, title: e.title, message: e.message, data: (e.data ?? null) as any }).returning();
  // Devices add the row as it arrives, so the feed never has to reload.
  if (e.outletId) publish(ctx.customerId, e.outletId, 'activity', row);
  return row;
}

export const money = (v: string | number) => `₹${Number(rupees(v)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const left = (n: number | null | undefined, unit = 'left') => (n == null ? '' : ` (${n} ${unit})`);

@Controller('activity')
export class ActivityController {
  // Newest first; `before` (an id) pages back through older entries.
  @Get()
  async list(@C() ctx: Ctx, @Query('outletId') outletId?: string, @Query('kind') kind?: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    const outlets = ctx.outletsWith('reports.view');
    if (outletId) ctx.assert('reports.view', outletId);
    else if (outlets !== 'all' && !outlets.length) ctx.assert('reports.view');
    return ctx.db
      .select()
      .from(t.activity)
      .where(
        and(
          outletId ? eq(t.activity.outletId, outletId) : outlets === 'all' ? undefined : or(inArray(t.activity.outletId, outlets), isNull(t.activity.outletId)),
          kind ? inArray(t.activity.kind, kind.split(',')) : undefined,
          before ? lt(t.activity.id, Number(before)) : undefined,
        ),
      )
      .orderBy(desc(t.activity.id))
      .limit(Math.min(Number(limit) || 50, 200));
  }
}
