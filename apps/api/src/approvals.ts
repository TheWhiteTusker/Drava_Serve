import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { alias } from 'drizzle-orm/pg-core';
import { C, Ctx, findOr404, parse } from './common.js';
import { tenantSchema as t, type Tx } from './db/index.js';
import { publish } from './events.js';
import { stockTx, type Post as PostStock } from './stock.js';

// Two-person approval. A request carries what is proposed; when someone with approvals.decide
// at that outlet (and who is not the proposer) approves it, the handler for its type applies it.
// A proposer who could approve it anyway (a manager recording their own write-off) skips the queue.

export type ApprovalRow = typeof t.approvalRequest.$inferSelect;
type Handler = (ctx: Ctx, tx: Tx, req: ApprovalRow, post: PostStock) => Promise<void>;
const handlers = new Map<string, { label: string; apply: Handler }>();

export function registerApproval(type: string, label: string, apply: Handler) {
  handlers.set(type, { label, apply });
}

export interface Proposal {
  outletId: string | null;
  type: string;
  entity: string;
  entityId?: string | null;
  current?: unknown;
  proposed: unknown;
  reason?: string | null;
}

// Applies straight away when the proposer may decide (unless forceQueue); otherwise queues it.
export async function proposeOrApply(ctx: Ctx, tx: Tx, post: PostStock, p: Proposal, opts: { forceQueue?: boolean } = {}) {
  if (!handlers.has(p.type)) throw new Error(`No approval handler for ${p.type}`);
  const direct = !opts.forceQueue && ctx.can('approvals.decide', p.outletId);
  if (!direct && !ctx.userId) throw new Error('System requests must be applied directly');
  const [req] = await tx
    .insert(t.approvalRequest)
    .values({
      outletId: p.outletId, type: p.type, entity: p.entity, entityId: p.entityId ?? null, current: p.current ?? null,
      proposed: p.proposed as object, reason: p.reason ?? null, status: direct ? 'approved' : 'pending',
      proposedBy: ctx.userId!, ...(direct ? { decidedBy: ctx.userId!, decidedAt: new Date(), decisionNote: 'Applied directly by an approver' } : {}),
    })
    .returning();
  if (direct) await handlers.get(p.type)!.apply(ctx, tx, req, post);
  else if (p.outletId) publish(ctx.customerId, p.outletId, 'approval', { id: req.id, type: p.type });
  return { status: direct ? ('applied' as const) : ('pending' as const), id: req.id };
}

// Requests raised by the system itself (e.g. a price flag after re-costing) always wait for a person.
export async function queueSystemRequest(tx: Tx, p: Proposal & { proposedBy: string }) {
  const [existing] = await tx
    .select()
    .from(t.approvalRequest)
    .where(and(eq(t.approvalRequest.type, p.type), eq(t.approvalRequest.entityId, p.entityId ?? ''), eq(t.approvalRequest.status, 'pending')));
  if (existing) {
    await tx.update(t.approvalRequest).set({ proposed: p.proposed as object, current: p.current ?? null, reason: p.reason ?? null, updatedAt: new Date() }).where(eq(t.approvalRequest.id, existing.id));
    return existing.id;
  }
  const [req] = await tx
    .insert(t.approvalRequest)
    .values({ outletId: p.outletId, type: p.type, entity: p.entity, entityId: p.entityId ?? null, current: p.current ?? null, proposed: p.proposed as object, reason: p.reason ?? null, proposedBy: p.proposedBy })
    .returning();
  return req.id;
}

const proposer = alias(t.appUser, 'proposer');
const decider = alias(t.appUser, 'decider');

@Controller('approvals')
export class ApprovalsController {
  @Get()
  async list(@C() ctx: Ctx, @Query('status') status = 'pending', @Query('outletId') outletId?: string) {
    // Approvers see their outlets' queue; everyone sees what they proposed.
    const outlets = ctx.outletsWith('approvals.decide');
    const scope =
      outlets === 'all'
        ? undefined
        : or(eq(t.approvalRequest.proposedBy, ctx.userId!), outlets.length ? inArray(t.approvalRequest.outletId, outlets) : undefined);
    const rows = await ctx.db
      .select({ r: t.approvalRequest, proposedByName: proposer.name, decidedByName: decider.name, outletName: t.outlet.name })
      .from(t.approvalRequest)
      .innerJoin(proposer, eq(proposer.id, t.approvalRequest.proposedBy))
      .leftJoin(decider, eq(decider.id, t.approvalRequest.decidedBy))
      .leftJoin(t.outlet, eq(t.outlet.id, t.approvalRequest.outletId))
      .where(
        and(
          scope,
          status === 'all' ? undefined : eq(t.approvalRequest.status, status as any),
          outletId ? or(eq(t.approvalRequest.outletId, outletId), isNull(t.approvalRequest.outletId)) : undefined,
        ),
      )
      .orderBy(desc(t.approvalRequest.proposedAt))
      .limit(200);
    return rows.map((x) => ({ ...x.r, proposedByName: x.proposedByName, decidedByName: x.decidedByName, outletName: x.outletName, label: handlers.get(x.r.type)?.label ?? x.r.type }));
  }

  @Post(':id/decide')
  async decide(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { approve, note } = parse(z.object({ approve: z.boolean(), note: z.string().max(500).optional() }), body);
    const req = await findOr404(ctx.db.select().from(t.approvalRequest).where(eq(t.approvalRequest.id, id)));
    if (req.proposedBy === ctx.userId && approve) throw new ForbiddenException('Someone other than the proposer must approve this');
    if (req.proposedBy !== ctx.userId) ctx.assert('approvals.decide', req.outletId);
    const result = await stockTx(ctx, async (tx, post) => {
      // Lock the request so two approvers cannot both apply it.
      const [locked] = await tx.select().from(t.approvalRequest).where(eq(t.approvalRequest.id, id)).for('update');
      if (locked.status !== 'pending') throw new ConflictException(`This request is already ${locked.status}`);
      const status = approve ? 'approved' : req.proposedBy === ctx.userId ? 'cancelled' : 'rejected';
      if (approve) {
        const h = handlers.get(locked.type);
        if (!h) throw new BadRequestException(`Unknown request type ${locked.type}`);
        await h.apply(ctx, tx, locked, post);
      }
      const [row] = await tx
        .update(t.approvalRequest)
        .set({ status, decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note ?? null, updatedAt: new Date() })
        .where(eq(t.approvalRequest.id, id))
        .returning();
      return row;
    });
    if (req.outletId) publish(ctx.customerId, req.outletId, 'approval', { id, status: result.status });
    return result;
  }
}
