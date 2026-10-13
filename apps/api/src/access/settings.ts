import { BadRequestException, Body, Controller, Get, Put, Query } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import { OUTLET_SETTING_KEYS, SETTING_DEFAULTS, type SettingKey } from '@fnb/shared';
import { z } from 'zod';
import { runOffers } from '../pricing/offers.js';
import { C, Ctx, parse } from '../common.js';
import { tenantSchema as t, type Q } from '../db/index.js';

// ---------- Settings ----------

export async function getSettings(db: Q, outletId?: string | null) {
  const rows = await db
    .select()
    .from(t.setting)
    .where(outletId ? or(isNull(t.setting.outletId), eq(t.setting.outletId, outletId)) : isNull(t.setting.outletId));
  const pick = (o: string | null) => Object.fromEntries(rows.filter((r) => r.outletId === o).map((r) => [r.key, r.value]));
  const customer = pick(null);
  const outlet = outletId ? pick(outletId) : {};
  return { defaults: SETTING_DEFAULTS, customer, outlet, effective: { ...SETTING_DEFAULTS, ...customer, ...outlet } };
}

const settingValue: Record<SettingKey, z.ZodType> = {
  'indent.cutoff': z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 23:00'),
  'indent.mode': z.enum(['approval', 'auto']),
  'offers.liquorEnabled': z.boolean(),
  'receiving.rateTolerancePct': z.number().min(0).max(100),
  'approvals.priceChangeLimitPct': z.number().min(0).max(100),
  'menu.lowThresholdServes': z.number().int().min(0),
  'pricing.flagTolerancePct': z.number().min(0).max(100),
  'business.dayStart': z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 05:00'),
  'guest.ordering': z.boolean(),
  'guest.pickTable': z.boolean(),
};

@Controller('settings')
export class SettingsController {
  @Get()
  get(@C() ctx: Ctx, @Query('outletId') outletId?: string) {
    if (outletId && !ctx.grants.some((g) => g.outletId === null || g.outletId === outletId)) ctx.assert('settings.manage', outletId);
    return getSettings(ctx.db, outletId);
  }

  // value null clears an override, falling back to the customer value or the default.
  @Put()
  async put(@C() ctx: Ctx, @Body() body: unknown) {
    const { outletId, key, value } = parse(
      z.object({ outletId: z.uuid().nullable(), key: z.enum(Object.keys(settingValue) as [SettingKey]), value: z.unknown() }),
      body,
    );
    // The liquor offer switch is an owner-level decision, per outlet.
    ctx.assert(key === 'offers.liquorEnabled' ? 'offers.liquorSwitch' : 'settings.manage', outletId);
    if (outletId && !OUTLET_SETTING_KEYS.includes(key)) throw new BadRequestException(`${key} is set for the whole business, not per outlet`);
    if (key === 'offers.liquorEnabled' && !outletId) throw new BadRequestException('The beverage offer switch is set per outlet');
    await ctx.tx(async (tx) => {
      const where = and(outletId ? eq(t.setting.outletId, outletId) : isNull(t.setting.outletId), eq(t.setting.key, key));
      if (value === null) return tx.delete(t.setting).where(where);
      const v = parse(settingValue[key], value);
      await tx
        .insert(t.setting)
        .values({ outletId, key, value: v })
        .onConflictDoUpdate({ target: [t.setting.outletId, t.setting.key], set: { value: v, updatedAt: new Date() } });
    });
    // The owner's switch takes effect at once: offers start (or end) now.
    if (key === 'offers.liquorEnabled' && outletId) await runOffers(ctx, outletId);
    return getSettings(ctx.db, outletId);
  }
}
