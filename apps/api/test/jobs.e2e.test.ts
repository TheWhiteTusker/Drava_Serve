import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx } from '../src/common.js';
import { closeAll, tenantSchema as t } from '../src/db/index.js';
import { indentDueAt, tickCustomer } from '../src/jobs.js';
import { setupFixture, type Fixture } from './fixture.js';
import { client, startApp } from './helpers.js';

// The scheduler: the nightly indent is due at the cut-off the evening before delivery and runs once.

let app: INestApplication;
let f: Fixture;

beforeAll(async () => {
  app = await startApp();
  f = await setupFixture(app, 'jobs');
});

afterAll(async () => {
  await f?.drop();
  await app?.close();
  await closeAll();
});

describe('scheduled jobs', () => {
  it('the scheduler endpoint refuses anyone without the secret', async () => {
    delete process.env.CRON_SECRET;
    expect((await client(app).get('/jobs/tick')).status).toBe(403); // no secret set: always refused
    process.env.CRON_SECRET = 'test-secret';
    expect((await client(app).get('/jobs/tick')).status).toBe(403);
    expect((await client(app, 'wrong-secret').get('/jobs/tick')).status).toBe(403);
    delete process.env.CRON_SECRET;
  });

  it('the indent is due at the cut-off the evening before delivery', () => {
    expect(indentDueAt('2026-10-11', '23:00').toISOString()).toBe(new Date('2026-10-10T23:00:00+05:30').toISOString());
    expect(indentDueAt('2026-10-11', '01:00').toISOString()).toBe(new Date('2026-10-11T01:00:00+05:30').toISOString());
  });


  it('the scheduler builds the nightly indent once, at the cut-off', async () => {
    const ctx = Ctx.system(f.cust.customer.id, f.db, 'test');
    await f.owner.put('/settings', { outletId: f.outlet.id, key: 'indent.cutoff', value: '22:30' });
    await tickCustomer(ctx, new Date('2026-10-24T22:00:00+05:30')); // before the cut-off
    expect(await f.db.select().from(t.jobRun).where(eq(t.jobRun.job, 'indent'))).toHaveLength(0);
    await tickCustomer(ctx, new Date('2026-10-24T22:31:00+05:30'));
    await tickCustomer(ctx, new Date('2026-10-24T22:32:00+05:30'));
    const runs = await f.db.select().from(t.jobRun).where(eq(t.jobRun.job, 'indent'));
    expect(runs.map((r) => r.key)).toEqual(['2026-10-25']);
  });
});
