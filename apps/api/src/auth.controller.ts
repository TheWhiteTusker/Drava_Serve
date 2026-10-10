import { Body, Controller, ForbiddenException, Get, Post, Query, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { zLogin, zPinSwitch } from '@fnb/shared';
import { C, Ctx, loadGrants, parse, Public, verifySecret, type TokenClaims } from './common.js';
import { controlDb, controlSchema, resolveCustomer, tenantSchema as t, type TenantDb } from './db/index.js';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const WRONG = 'Sign-in details are not right';

// Counts a failed attempt; five in a row locks the user for 15 minutes.
async function checkSecret(db: TenantDb, user: typeof t.appUser.$inferSelect, secret: string, stored: string | null) {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new UnauthorizedException(`Too many attempts. Try again after ${LOCK_MINUTES} minutes`);
  }
  const ok = await verifySecret(secret, stored);
  const failed = ok ? 0 : user.failedAttempts + 1;
  await db
    .update(t.appUser)
    .set({
      failedAttempts: failed >= MAX_ATTEMPTS ? 0 : failed,
      lockedUntil: failed >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
    })
    .where(eq(t.appUser.id, user.id));
  if (!ok) throw new UnauthorizedException(WRONG);
}

@Controller('auth')
export class AuthController {
  constructor(private jwt: JwtService) {}

  private async session(db: TenantDb, customerId: string, userId: string) {
    const token = await this.jwt.signAsync({ sub: userId, cid: customerId } satisfies TokenClaims);
    return { token, ...(await me(db, customerId, userId)) };
  }

  // The login decides the customer (control database); everything after that uses only
  // that customer's database.
  @Public()
  @Post('login')
  async login(@Body() body: unknown) {
    const { login, password } = parse(zLogin, body);
    const [route] = await controlDb()
      .select()
      .from(controlSchema.loginRoute)
      .where(eq(controlSchema.loginRoute.login, login));
    const tenant = route && (await resolveCustomer(route.customerId));
    if (!tenant) throw new UnauthorizedException(WRONG);
    const [user] = await tenant.db.select().from(t.appUser).where(eq(t.appUser.login, login));
    if (!user?.active) throw new UnauthorizedException(WRONG);
    await checkSecret(tenant.db, user, password, user.passwordHash);
    return this.session(tenant.db, tenant.customer.id, user.id);
  }

  // Shared devices: someone already signed in on this device; another staff member takes over with their PIN.
  @Post('pin')
  async pin(@C() ctx: Ctx, @Body() body: unknown, @Query('outletId') outletId?: string) {
    const { userId, pin } = parse(zPinSwitch, body);
    const [user] = await ctx.db.select().from(t.appUser).where(eq(t.appUser.id, userId));
    if (!user?.active || !user.pinHash) throw new UnauthorizedException(WRONG);
    await checkSecret(ctx.db, user, pin, user.pinHash);
    if (outletId) {
      const grants = await loadGrants(ctx.db, user.id);
      if (!grants.some((g) => g.outletId === null || g.outletId === outletId)) {
        throw new ForbiddenException('This person does not work at this outlet');
      }
    }
    return this.session(ctx.db, ctx.customerId, user.id);
  }

  // Names on the PIN pad: active users with a PIN who work at this outlet.
  @Get('pin-users')
  async pinUsers(@C() ctx: Ctx, @Query('outletId') outletId?: string) {
    const atOutlet = outletId ? or(isNull(t.userRole.outletId), eq(t.userRole.outletId, outletId)) : undefined;
    return ctx.db
      .selectDistinct({ id: t.appUser.id, name: t.appUser.name })
      .from(t.appUser)
      .innerJoin(t.userRole, eq(t.userRole.userId, t.appUser.id))
      .where(and(eq(t.appUser.active, true), isNotNull(t.appUser.pinHash), atOutlet))
      .orderBy(t.appUser.name);
  }

  @Get('me')
  me(@C() ctx: Ctx) {
    return me(ctx.db, ctx.customerId, ctx.userId);
  }
}

async function me(db: TenantDb, customerId: string, userId: string) {
  const [user] = await db
    .select({ id: t.appUser.id, name: t.appUser.name, login: t.appUser.login })
    .from(t.appUser)
    .where(eq(t.appUser.id, userId));
  const grants = await loadGrants(db, userId);
  const everywhere = grants.some((g) => g.outletId === null);
  const outletIds = [...new Set(grants.map((g) => g.outletId).filter(Boolean))] as string[];
  const outlets = await db
    .select({ id: t.outlet.id, name: t.outlet.name, code: t.outlet.code })
    .from(t.outlet)
    .where(and(eq(t.outlet.active, true), everywhere ? undefined : inArray(t.outlet.id, outletIds)))
    .orderBy(t.outlet.name);
  const [customer] = await controlDb()
    .select({ code: controlSchema.customer.code, name: controlSchema.customer.name })
    .from(controlSchema.customer)
    .where(eq(controlSchema.customer.id, customerId));
  return { user, customer, outlets, grants };
}
