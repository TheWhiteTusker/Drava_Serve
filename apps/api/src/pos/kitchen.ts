import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { C, Ctx, findOr404, parse } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { publish } from '../events.js';

// ---------- Kitchen screen: each round of ordering is a ticket, per station ----------
// The kitchen sees food lines, the bar sees beverage lines. A ticket leaves the screen when its
// station marks it ready, and stays under "Just done" for 15 minutes in case it was a mistake.

const zStation = z.enum(['food', 'beverage']);

@Controller('kitchen')
export class KitchenController {
  @Get()
  async tickets(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('station') station: string) {
    ctx.assert('kitchen.view', outletId);
    const dept = zStation.parse(station);
    const rows = await ctx.db
      .select({ l: t.orderLine, o: t.billOrder, b: t.bill, table: t.diningTable.name, by: t.appUser.name })
      .from(t.orderLine)
      .innerJoin(t.billOrder, eq(t.billOrder.id, t.orderLine.orderId))
      .innerJoin(t.bill, eq(t.bill.id, t.orderLine.billId))
      .leftJoin(t.diningTable, eq(t.diningTable.id, t.bill.tableId))
      .leftJoin(t.appUser, eq(t.appUser.id, t.billOrder.placedBy))
      .where(
        and(
          eq(t.bill.outletId, outletId),
          inArray(t.bill.status, ['open', 'paid']),
          eq(t.orderLine.department, dept),
          gt(t.billOrder.placedAt, sql`now() - interval '12 hours'`),
          or(isNull(t.orderLine.readyAt), gt(t.orderLine.readyAt, sql`now() - interval '15 minutes'`)),
        ),
      )
      .orderBy(asc(t.billOrder.placedAt), asc(t.orderLine.createdAt));
    const tickets = new Map<string, any>();
    for (const r of rows) {
      const tk = tickets.get(r.o.id) ?? {
        id: r.o.id, billNumber: r.b.number, kind: r.b.kind, table: r.table, placedAt: r.o.placedAt, placedBy: r.by, lines: [], readyAt: null,
      };
      tk.lines.push({ id: r.l.id, name: r.l.name, qty: r.l.qty, voided: r.l.status === 'voided', readyAt: r.l.readyAt });
      tickets.set(r.o.id, tk);
    }
    // Ready when every line still being made is ready; a ticket of only voided lines is dropped.
    return [...tickets.values()]
      .map((tk) => {
        const live = tk.lines.filter((l: any) => !l.voided);
        return { ...tk, readyAt: live.length && live.every((l: any) => l.readyAt) ? live[0].readyAt : null, empty: !live.length };
      })
      .filter((tk) => !tk.empty);
  }

  @Post(':orderId/ready')
  async ready(@C() ctx: Ctx, @Param('orderId') orderId: string, @Body() body: unknown) {
    const b = parse(z.object({ station: zStation, ready: z.boolean() }), body);
    const bill = await findOr404(
      ctx.db.select({ outletId: t.bill.outletId }).from(t.billOrder).innerJoin(t.bill, eq(t.bill.id, t.billOrder.billId)).where(eq(t.billOrder.id, orderId)),
    );
    ctx.assert('kitchen.view', bill.outletId);
    await ctx.tx((tx) =>
      tx
        .update(t.orderLine)
        .set({ readyAt: b.ready ? new Date() : null })
        .where(and(eq(t.orderLine.orderId, orderId), eq(t.orderLine.department, b.station))),
    );
    publish(ctx.customerId, bill.outletId, 'kitchen', { orderId, station: b.station, ready: b.ready });
    return { orderId, ready: b.ready };
  }
}
