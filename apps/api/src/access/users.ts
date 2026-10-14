import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { withVersion, zUser } from '@fnb/shared';
import { z } from 'zod';
import { C, Ctx, findOr404, parse, updateVersioned } from '../common.js';
import { hashSecret } from '../secrets.js';
import { controlDb, controlSchema, tenantSchema as t, type Q, type Tx } from '../db/index.js';

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
