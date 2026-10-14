import { z } from 'zod';
import { Ctx, parse } from '../common.js';
import { tenantSchema as t } from '../db/index.js';

// ---------- Filters ----------

const zFilter = z.object({
  outletId: z.uuid().optional(),
  from: z.iso.date(),
  to: z.iso.date(),
  department: z.enum(['food', 'beverage', 'all']).default('all'),
});
export type Filter = z.infer<typeof zFilter> & { outlets: string[] };

export async function filterFor(ctx: Ctx, query: unknown, perm: 'reports.view' | 'reports.export' = 'reports.view'): Promise<Filter> {
  const f = parse(zFilter, query);
  if (f.outletId) {
    ctx.assert(perm, f.outletId);
    return { ...f, outlets: [f.outletId] };
  }
  const allowed = ctx.outletsWith(perm);
  const outlets = allowed === 'all' ? (await ctx.db.select({ id: t.outlet.id }).from(t.outlet)).map((o) => o.id) : allowed;
  if (!outlets.length) ctx.assert(perm);
  return { ...f, outlets };
}

export const n = (v: unknown) => Number(v ?? 0);
