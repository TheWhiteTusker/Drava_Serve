import { timingSafeEqual } from 'node:crypto';
import { Controller, ForbiddenException, Get, Headers, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { istDate, istTime } from '@fnb/shared';
import { getSettings } from './access/settings.js';
import { Ctx, Public } from './common.js';
import { controlDb, controlSchema, tenantDb, tenantSchema as t } from './db/index.js';
import { endOffersForDay } from './pricing/offers.js';
import { buildIndents, createDelivery, deliveryDateFor } from './purchasing/indents.js';

// Scheduled work. A tick checks every customer and outlet; job_run rows make each job happen once
// per outlet and day, and let it catch up if no tick came at the time. A long-running server ticks
// every minute itself (main.ts); on Vercel, where nothing runs between requests, an external
// scheduler calls GET /api/jobs/tick every few minutes.

const log = new Logger('Jobs');
const minus = (date: string, days: number) => istDate(new Date(new Date(`${date}T12:00:00+05:30`).getTime() - days * 86_400_000));

// Claims a run; false if it already happened.
async function claim(ctx: Ctx, job: string, scope: string, key: string, detail?: unknown) {
  const r = await ctx.db.insert(t.jobRun).values({ job, scope, key, detail: detail as any }).onConflictDoNothing().returning();
  return r.length > 0;
}

// The moment the indent for a delivery date is due: the cut-off on the evening before (or,
// for a cut-off after midnight and before 5:00 am, that night).
export function indentDueAt(deliveryDate: string, cutoff: string) {
  const day = cutoff >= '05:00' ? minus(deliveryDate, 1) : deliveryDate;
  return new Date(`${day}T${cutoff}:00+05:30`);
}

export async function tickCustomer(ctx: Ctx, now = new Date()) {
  const outlets = await ctx.db.select().from(t.outlet).where(eq(t.outlet.active, true));
  for (const o of outlets) {
    const s = (await getSettings(ctx.db, o.id)).effective;
    // Nightly indent at the cut-off (default 23:00).
    const forDate = deliveryDateFor(now);
    if (now >= indentDueAt(forDate, s['indent.cutoff'] as string) && (await claim(ctx, 'indent', o.id, forDate))) {
      const r = await buildIndents(ctx, o.id, forDate);
      log.log(`indent for ${o.code} ${forDate}: ${r.indents.length} vendor order(s)`);
    }
    // Delivery list ready on the receiving app before 5:00 am: any approved indent for today
    // without an expected delivery gets one.
    const today = istDate(now);
    if (istTime(now) >= '04:30' && (await claim(ctx, 'deliveries', o.id, today))) {
      const missing = await ctx.db
        .select()
        .from(t.indent)
        .where(and(eq(t.indent.outletId, o.id), eq(t.indent.forDate, today), sql`${t.indent.status} in ('approved', 'sent')`, sql`not exists (select 1 from receipt_check c where c.indent_id = ${t.indent.id})`));
      for (const ind of missing) await ctx.tx((tx) => createDelivery(tx, ind));
    }
    // End of the business day: running offers end.
    const dayStart = s['business.dayStart'] as string;
    if (istTime(now) >= dayStart && (await claim(ctx, 'offers-day-end', o.id, today))) {
      await endOffersForDay(ctx, o.id, new Date(`${today}T${dayStart}:00+05:30`));
    }
  }
}

export async function tick(now = new Date()) {
  const customers = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.status, 'active'));
  for (const c of customers) {
    try {
      await tickCustomer(Ctx.system(c.id, tenantDb(c.dbName), 'system:jobs'), now);
    } catch (e) {
      log.error(`tick failed for ${c.code}: ${(e as Error).message}`);
    }
  }
}

// The external scheduler's door. Extra or overlapping calls do nothing, thanks to the job_run claims.
@Controller('jobs')
export class JobsController {
  @Public()
  @Get('tick')
  async run(@Headers('authorization') auth?: string) {
    const secret = process.env.CRON_SECRET;
    const [given, want] = [Buffer.from(auth ?? ''), Buffer.from(`Bearer ${secret}`)];
    if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) throw new ForbiddenException('Not allowed');
    await tick();
    return { ok: true };
  }
}
