import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { C, Ctx, findOr404, parse } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { publish, publishGuest } from '../events.js';
import { billView } from './bills.js';
import { placeOrder } from './orders.js';

// ---------- Orders guests sent from the table QR menu ----------

@Controller('pos/guest-orders')
export class GuestOrdersController {
  @Get()
  async guestOrders(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    ctx.assert('pos.bill', outletId);
    return ctx.db
      .select({ g: t.guestOrder, table: t.diningTable.name })
      .from(t.guestOrder)
      .innerJoin(t.diningTable, eq(t.diningTable.id, t.guestOrder.tableId))
      .where(and(eq(t.guestOrder.outletId, outletId), eq(t.guestOrder.status, 'pending')))
      .orderBy(asc(t.guestOrder.createdAt))
      .then((rows) => rows.map(({ g, table }) => ({ ...g, table })));
  }

  // Accepting puts the guest's items on the table's bill exactly as a cashier's order would:
  // today's prices and a stock check under lock. The bill is the table's open one, or a new one.
  @Post(':id/accept')
  async acceptGuest(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ bill: z.object({ clientId: z.uuid(), number: z.string().trim().max(40).nullish() }) }), body);
    const g = await findOr404(ctx.db.select().from(t.guestOrder).where(eq(t.guestOrder.id, id)));
    ctx.assert('pos.bill', g.outletId);
    const o = {
      outletId: g.outletId,
      bill: { clientId: b.bill.clientId, kind: 'dine_in' as const, tableId: g.tableId, number: b.bill.number },
      order: { clientId: randomUUID(), placedAt: new Date().toISOString(), lines: g.lines.map((l) => ({ menuItemId: l.menuItemId, qty: String(l.qty) })) },
      offline: false,
    };
    const billId = await placeOrder(ctx, o, async (tx, bill) => {
      const [locked] = await tx.select().from(t.guestOrder).where(eq(t.guestOrder.id, id)).for('update');
      if (locked.status !== 'pending') throw new ConflictException(`This order was already ${locked.status === 'accepted' ? 'accepted' : 'turned down'}`);
      if (bill.tableId !== g.tableId) throw new BadRequestException('That bill is for another table');
      await tx.update(t.guestOrder).set({ status: 'accepted', billId: bill.id, decidedBy: ctx.userId, decidedAt: new Date() }).where(eq(t.guestOrder.id, id));
    });
    this.guestDecided(ctx, g.outletId, id, 'accepted');
    return billView(ctx.db, billId);
  }

  @Post(':id/reject')
  async rejectGuest(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(z.object({ reason: z.string().trim().max(200).nullish() }), body);
    const g = await findOr404(ctx.db.select().from(t.guestOrder).where(eq(t.guestOrder.id, id)));
    ctx.assert('pos.bill', g.outletId);
    const [row] = await ctx.tx((tx) =>
      tx
        .update(t.guestOrder)
        .set({ status: 'rejected', reason: reason || null, decidedBy: ctx.userId, decidedAt: new Date() })
        .where(and(eq(t.guestOrder.id, id), eq(t.guestOrder.status, 'pending')))
        .returning(),
    );
    if (!row) throw new ConflictException('This order was already decided');
    this.guestDecided(ctx, g.outletId, id, 'rejected', row.reason);
    return { id, status: 'rejected' };
  }

  // Tells the other counters to drop it from their list, and the guest's phone how it went.
  private guestDecided(ctx: Ctx, outletId: string, id: string, status: string, reason: string | null = null) {
    publish(ctx.customerId, outletId, 'guestOrder', { id, status });
    publishGuest(id, { status, reason });
  }
}
