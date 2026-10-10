import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import {
  OUTLET_SETTING_KEYS, PERMISSIONS, SETTING_DEFAULTS, withVersion, zOutlet, zRole, zUser,
  type SettingKey,
} from '@fnb/shared';
import { z } from 'zod';
import { createOutlet } from './bootstrap.js';
import { C, Ctx, findOr404, hashSecret, parse, Permit, updateVersioned } from './common.js';
import { controlDb, controlSchema, tenantSchema as t, type Q, type Tx } from './db/index.js';

const pgCode = (e: any) => e?.cause?.code ?? e?.code;

// ---------- Users ----------

// Sign-in routing lives in the control database, so a login is unique across all customers.
async function claimLogin(customerId: string, login: string) {
  try {
    await controlDb().insert(controlSchema.loginRoute).values({ login, customerId });
  } catch (e) {
    if (pgCode(e) !== '23505') throw e;
    const [r] = await controlDb().select().from(controlSchema.loginRoute).where(eq(controlSchema.loginRoute.login, login));
    if (r?.customerId !== customerId) throw new ConflictException('This sign-in name is already in use. Choose another');
  }
}
const releaseLogin = (customerId: string, login: string) =>
  controlDb()
    .delete(controlSchema.loginRoute)
    .where(and(eq(controlSchema.loginRoute.login, login), eq(controlSchema.loginRoute.customerId, customerId)));

const userCols = {
  id: t.appUser.id,
  name: t.appUser.name,
  login: t.appUser.login,
  phone: t.appUser.phone,
  active: t.appUser.active,
  hasPin: t.appUser.pinHash,
  version: t.appUser.version,
};

async function withRoles(db: Q, users: any[]) {
  const roles = users.length
    ? await db.select().from(t.userRole).where(inArray(t.userRole.userId, users.map((u) => u.id)))
    : [];
  return users.map((u) => ({
    ...u,
    hasPin: !!u.hasPin,
    roles: roles.filter((r) => r.userId === u.id).map((r) => ({ roleId: r.roleId, outletId: r.outletId })),
  }));
}

async function setRoles(tx: Tx, userId: string, roles: { roleId: string; outletId: string | null }[]) {
  await tx.delete(t.userRole).where(eq(t.userRole.userId, userId));
  if (roles.length) await tx.insert(t.userRole).values(roles.map((r) => ({ ...r, userId })));
}

// Managing people needs the permission for every outlet; otherwise an outlet manager could
// hand themselves an all-outlet role.
@Controller('users')
export class UsersController {
  @Get()
  async list(@C() ctx: Ctx) {
    ctx.assert('users.manage', null);
    return withRoles(ctx.db, await ctx.db.select(userCols).from(t.appUser).orderBy(t.appUser.name));
  }

  @Get(':id')
  async get(@C() ctx: Ctx, @Param('id') id: string) {
    ctx.assert('users.manage', null);
    return (await withRoles(ctx.db, [await findOr404(ctx.db.select(userCols).from(t.appUser).where(eq(t.appUser.id, id)))]))[0];
  }

  @Post()
  async create(@C() ctx: Ctx, @Body() body: unknown) {
    ctx.assert('users.manage', null);
    const { roles, password, pin, ...data } = parse(zUser, body);
    if (!password) throw new BadRequestException('A password is required for a new user');
    await claimLogin(ctx.customerId, data.login);
    try {
      return await ctx.tx(async (tx) => {
        const [u] = await tx
          .insert(t.appUser)
          .values({ ...data, passwordHash: await hashSecret(password), pinHash: pin ? await hashSecret(pin) : null })
          .returning({ id: t.appUser.id });
        await setRoles(tx, u.id, roles);
        return { id: u.id };
      });
    } catch (e) {
      await releaseLogin(ctx.customerId, data.login);
      throw e;
    }
  }

  @Put(':id')
  async update(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    ctx.assert('users.manage', null);
    const { roles, password, pin, version, ...data } = parse(withVersion(zUser), body);
    const before = await findOr404(ctx.db.select().from(t.appUser).where(eq(t.appUser.id, id)));
    const loginChanged = before.login !== data.login;
    if (loginChanged) await claimLogin(ctx.customerId, data.login);
    try {
      await ctx.tx(async (tx) => {
        await updateVersioned(tx, t.appUser, id, version, {
          ...data,
          ...(password ? { passwordHash: await hashSecret(password), failedAttempts: 0, lockedUntil: null } : {}),
          ...(pin ? { pinHash: await hashSecret(pin) } : {}),
        });
        await setRoles(tx, id, roles);
      });
    } catch (e) {
      if (loginChanged) await releaseLogin(ctx.customerId, data.login);
      throw e;
    }
    if (loginChanged) await releaseLogin(ctx.customerId, before.login);
    return { id };
  }

  // Anyone can set their own PIN for shared devices.
  @Post('me/pin')
  async setOwnPin(@C() ctx: Ctx, @Body() body: unknown) {
    const { pin } = parse(z.object({ pin: z.string().regex(/^\d{4,6}$/, 'PIN is 4 to 6 digits') }), body);
    const pinHash = await hashSecret(pin);
    await ctx.tx((tx) => tx.update(t.appUser).set({ pinHash }).where(eq(t.appUser.id, ctx.userId!)));
    return { ok: true };
  }
}

// ---------- Roles ----------

@Controller()
export class RolesController {
  @Get('permissions')
  permissions() {
    return PERMISSIONS;
  }

  @Get('roles')
  @Permit('users.manage')
  async list(@C() ctx: Ctx) {
    const roles = await ctx.db.select().from(t.role).orderBy(t.role.name);
    const perms = await ctx.db.select().from(t.rolePermission);
    return roles.map((r) => ({ ...r, permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permission) }));
  }

  @Post('roles')
  async create(@C() ctx: Ctx, @Body() body: unknown) {
    ctx.assert('users.manage', null);
    const { permissions, ...data } = parse(zRole, body);
    return ctx.tx(async (tx) => {
      const [r] = await tx.insert(t.role).values(data).returning();
      if (permissions.length) await tx.insert(t.rolePermission).values(permissions.map((permission) => ({ roleId: r.id, permission })));
      return r;
    });
  }

  @Put('roles/:id')
  async update(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    ctx.assert('users.manage', null);
    const { permissions, version, ...data } = parse(withVersion(zRole), body);
    return ctx.tx(async (tx) => {
      const r = await updateVersioned(tx, t.role, id, version, data);
      await tx.delete(t.rolePermission).where(eq(t.rolePermission.roleId, id));
      if (permissions.length) await tx.insert(t.rolePermission).values(permissions.map((permission) => ({ roleId: id, permission })));
      return r;
    });
  }
}

// ---------- Outlets ----------

@Controller('outlets')
export class OutletsController {
  @Get()
  async list(@C() ctx: Ctx) {
    const everywhere = ctx.grants.some((g) => g.outletId === null);
    const ids = [...new Set(ctx.grants.map((g) => g.outletId!).filter(Boolean))];
    return ctx.db
      .select()
      .from(t.outlet)
      .where(everywhere ? undefined : inArray(t.outlet.id, ids))
      .orderBy(t.outlet.name);
  }

  @Get(':id/stores')
  stores(@C() ctx: Ctx, @Param('id') id: string) {
    if (!ctx.grants.some((g) => g.outletId === null || g.outletId === id)) ctx.assert('outlets.manage', id);
    return ctx.db.select().from(t.store).where(eq(t.store.outletId, id)).orderBy(t.store.kind);
  }

  // Every outlet starts with a main store, a kitchen store and a bar store.
  @Post()
  async create(@C() ctx: Ctx, @Body() body: unknown) {
    ctx.assert('outlets.manage', null);
    const data = parse(zOutlet, body);
    return ctx.tx((tx) => createOutlet(tx, data));
  }

  @Put(':id')
  async update(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    ctx.assert('outlets.manage', id);
    const { version, ...data } = parse(withVersion(zOutlet), body);
    return ctx.tx((tx) => updateVersioned(tx, t.outlet, id, version, data));
  }
}

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
    return getSettings(ctx.db, outletId);
  }
}

// ---------- Audit log ----------

@Controller('audit')
export class AuditController {
  @Get()
  @Permit('audit.view')
  async list(
    @C() ctx: Ctx,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('before') before?: string,
  ) {
    const outlets = ctx.outletsWith('audit.view');
    const rows = await ctx.db
      .select({ log: t.auditLog, userName: t.appUser.name })
      .from(t.auditLog)
      .leftJoin(t.appUser, eq(t.appUser.id, t.auditLog.userId))
      .where(
        and(
          outlets === 'all' ? undefined : inArray(t.auditLog.outletId, outlets),
          entity ? eq(t.auditLog.entity, entity) : undefined,
          entityId ? eq(t.auditLog.entityId, entityId) : undefined,
          before ? lt(t.auditLog.id, Number(before)) : undefined,
        ),
      )
      .orderBy(desc(t.auditLog.id))
      .limit(100);
    return rows.map((r) => ({ ...r.log, userName: r.userName }));
  }
}
