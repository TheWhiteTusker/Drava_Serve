import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { dec } from '@fnb/shared';
import { z } from 'zod';
import { registerApproval } from '../approvals.js';
import { findOr404 } from '../common.js';
import { tenantSchema as t, type Q } from '../db/index.js';

export const zId = z.uuid();
export const WRITE_OFFS = ['wastage', 'spillage', 'breakage'] as const;
export const GIVEAWAYS = ['complimentary', 'staff_meal'] as const;

export async function storeOf(q: Q, storeId: string) {
  return findOr404(q.select().from(t.store).where(eq(t.store.id, storeId)));
}

// ---------- Approval handlers ----------

// proposed: { storeId, stockItemId, qty (positive), movement, reason }
registerApproval('stock_out', 'Wastage, spillage, breakage, complimentary or staff meal', async (ctx, _tx, req, post) => {
  const p = req.proposed as any;
  await post([{ storeId: p.storeId, stockItemId: p.stockItemId, qty: dec(p.qty).neg().toString(), movement: p.movement, reason: p.reason, refType: 'approval', refId: req.id, approvalId: req.id }]);
});

// proposed: { ledgerId, reason }
registerApproval('stock_reversal', 'Reverse a stock entry', async (_ctx, tx, req, post) => {
  const p = req.proposed as any;
  const [row] = await tx.select().from(t.stockLedger).where(eq(t.stockLedger.id, p.ledgerId));
  const [already] = await tx.select({ id: t.stockLedger.id }).from(t.stockLedger).where(eq(t.stockLedger.reversesId, p.ledgerId));
  if (already) throw new ConflictException('This entry has already been reversed');
  await post(
    [{ storeId: row.storeId, stockItemId: row.stockItemId, qty: dec(row.qty).neg().toString(), unitCost: row.unitCost, lotId: row.lotId, movement: 'reversal', reason: p.reason, reversesId: row.id, refType: 'approval', refId: req.id, approvalId: req.id }],
    { allowNegative: true },
  );
});

// proposed: { countId }. Posts counted − expected for every counted line.
registerApproval('count_correction', 'Stock count correction', async (_ctx, tx, req, post) => {
  const { countId } = req.proposed as any;
  const count = await findOr404(tx.select().from(t.stockCount).where(eq(t.stockCount.id, countId)));
  const lines = await tx.select().from(t.stockCountLine).where(eq(t.stockCountLine.countId, countId));
  await post(
    lines
      .filter((l) => l.countedQty != null && !dec(l.countedQty).eq(l.expectedQty))
      .map((l) => ({
        storeId: count.storeId, stockItemId: l.stockItemId, qty: dec(l.countedQty!).minus(l.expectedQty).toString(),
        movement: 'count_correction' as const, reason: l.cause ?? 'Stock count', refType: 'stock_count', refId: countId, approvalId: req.id,
      })),
    { allowNegative: true },
  );
  await tx.update(t.stockCount).set({ status: 'approved', approvalId: req.id, updatedAt: new Date() }).where(eq(t.stockCount.id, countId));
});
