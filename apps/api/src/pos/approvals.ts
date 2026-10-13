// Changes to money after the fact, applied once a manager approves (see approvals.ts).
import { ConflictException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { dec } from '@fnb/shared';
import { registerApproval } from '../approvals.js';
import { tenantSchema as t } from '../db/index.js';
import { rollupBill } from '../reports/rollup.js';
import { refreshAvailability } from '../stock/availability.js';
import { publishBill, recomputeBill, saleMoves } from './bills.js';

// ---------- Approval handlers ----------

registerApproval('bill_cancel', 'Cancel a bill', async (ctx, tx, req, post) => {
  const [bill] = await tx.select().from(t.bill).where(eq(t.bill.id, req.entityId!)).for('update');
  if (!['open', 'paid'].includes(bill.status)) throw new ConflictException(`This bill is already ${bill.status}`);
  if (bill.status === 'paid') {
    // Stock comes back and the sale leaves the dashboard.
    await post(await saleMoves(tx, bill, -1), { allowNegative: true });
    await rollupBill(tx, bill, -1);
  }
  await tx.update(t.bill).set({ status: 'cancelled', cancelReason: req.reason, approvalId: req.id, updatedAt: new Date() }).where(eq(t.bill.id, bill.id));
  ctx.afterCommit(() => publishBill(ctx, bill.outletId, bill.id));
});

registerApproval('refund', 'Refund on a paid bill', async (ctx, tx, req) => {
  const p = req.proposed as { amount: string; mode: string; reference?: string };
  const [bill] = await tx.select().from(t.bill).where(eq(t.bill.id, req.entityId!)).for('update');
  if (bill.status !== 'paid') throw new ConflictException('Only a paid bill can be refunded');
  await tx.insert(t.payment).values({ billId: bill.id, mode: p.mode as any, amount: dec(p.amount).neg().toFixed(2), reference: p.reference ?? `refund: ${req.reason ?? ''}`, receivedBy: ctx.userId ?? bill.closedBy! });
  const [{ net }] = (await tx.execute(sql`select coalesce(sum(amount), 0) as net from payment where bill_id = ${bill.id}`)).rows as any[];
  if (dec(net).lte(0)) await tx.update(t.bill).set({ status: 'refunded', approvalId: req.id, updatedAt: new Date() }).where(eq(t.bill.id, bill.id));
});

registerApproval('manual_discount', 'Manual discount on a bill', async (ctx, tx, req) => {
  const p = req.proposed as { discountPct: string };
  const [bill] = await tx.select().from(t.bill).where(eq(t.bill.id, req.entityId!)).for('update');
  if (bill.status !== 'open') throw new ConflictException('Discounts apply to open bills only');
  await tx.update(t.bill).set({ manualDiscountPct: p.discountPct, approvalId: req.id }).where(eq(t.bill.id, bill.id));
  await recomputeBill(tx, bill.id);
  ctx.afterCommit(() => publishBill(ctx, bill.outletId, bill.id));
});

registerApproval('line_void', 'Remove an item from a bill', async (ctx, tx, req) => {
  const p = req.proposed as { lineId: string };
  const [bill] = await tx.select().from(t.bill).where(eq(t.bill.id, req.entityId!)).for('update');
  if (bill.status !== 'open') throw new ConflictException('Items can be removed from open bills only');
  await tx.update(t.orderLine).set({ status: 'voided', voidReason: req.reason }).where(and(eq(t.orderLine.id, p.lineId), eq(t.orderLine.billId, bill.id)));
  await recomputeBill(tx, bill.id);
  ctx.afterCommit(async () => {
    await refreshAvailability(ctx, bill.outletId);
    publishBill(ctx, bill.outletId, bill.id);
  });
});
