import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  ArgumentsHost, BadRequestException, CanActivate, Catch, ConflictException, createParamDecorator,
  ExceptionFilter, ExecutionContext, ForbiddenException, HttpException, Injectable, NotFoundException,
  SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq, sql } from 'drizzle-orm';
import type { Permission } from '@fnb/shared';
import type { ZodType } from 'zod';
import { resolveCustomer, tenantSchema as t, type TenantDb, type Tx } from './db/index.js';

// ---------- Request context ----------

export interface Grant {
  outletId: string | null; // null = every outlet
  permission: string;
}

// Everything a request may touch: one customer's database and the signed-in user's grants.
export class Ctx {
  constructor(
    readonly customerId: string,
    readonly db: TenantDb,
    readonly userId: string | null, // null for scheduled jobs
    readonly deviceId: string | null,
    readonly grants: Grant[],
  ) {}

  // Background jobs act as the system, with every permission.
  static system(customerId: string, db: TenantDb, device: string) {
    return new Ctx(customerId, db, null, device, [{ outletId: null, permission: '*' }]);
  }

  // outletId undefined: held anywhere. null: held for every outlet. string: held at that outlet.
  can(perm: Permission, outletId?: string | null) {
    return this.grants.some(
      (g) =>
        (g.permission === perm || g.permission === '*') &&
        (outletId === undefined || g.outletId === null || (outletId !== null && g.outletId === outletId)),
    );
  }

  assert(perm: Permission, outletId?: string | null) {
    if (!this.can(perm, outletId)) throw new ForbiddenException(`You do not have permission: ${perm}`);
  }

  outletsWith(perm: Permission): 'all' | string[] {
    const mine = this.grants.filter((g) => g.permission === perm || g.permission === '*');
    if (mine.some((g) => g.outletId === null)) return 'all';
    return [...new Set(mine.map((g) => g.outletId!))];
  }

  // Every write goes through here so the audit trigger knows who and which device.
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.user_id', ${this.userId ?? ''}, true), set_config('app.device_id', ${this.deviceId ?? ''}, true)`,
      );
      return fn(tx);
    });
  }
}

export const C = createParamDecorator((_: unknown, ec: ExecutionContext) => ec.switchToHttp().getRequest().ctx as Ctx);
export const Public = () => SetMetadata('public', true);
export const Permit = (perm: Permission) => SetMetadata('permit', perm);

export interface TokenClaims {
  sub: string; // user id
  cid: string; // customer id
}

export async function loadGrants(db: TenantDb, userId: string): Promise<Grant[]> {
  return db
    .select({ outletId: t.userRole.outletId, permission: t.rolePermission.permission })
    .from(t.userRole)
    .innerJoin(t.rolePermission, eq(t.rolePermission.roleId, t.userRole.roleId))
    .where(eq(t.userRole.userId, userId));
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwt: JwtService,
  ) {}

  async canActivate(ec: ExecutionContext) {
    if (this.reflector.getAllAndOverride('public', [ec.getHandler(), ec.getClass()])) return true;
    const req = ec.switchToHttp().getRequest();
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Please sign in');
    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(token);
    } catch {
      throw new UnauthorizedException('Your session has ended. Please sign in again');
    }
    // Customer first: from here on this request can only reach that customer's database.
    const tenant = await resolveCustomer(claims.cid);
    if (!tenant) throw new UnauthorizedException('This business account is not active');
    const [user] = await tenant.db
      .select({ id: t.appUser.id, active: t.appUser.active })
      .from(t.appUser)
      .where(eq(t.appUser.id, claims.sub));
    if (!user?.active) throw new UnauthorizedException('This user is not active');
    const deviceId = String(req.headers['x-device-id'] ?? '').slice(0, 100) || null;
    req.ctx = new Ctx(claims.cid, tenant.db, user.id, deviceId, await loadGrants(tenant.db, user.id));
    const perm = this.reflector.getAllAndOverride<Permission | undefined>('permit', [ec.getHandler(), ec.getClass()]);
    if (perm) req.ctx.assert(perm);
    return true;
  }
}

// ---------- Errors ----------

// Database constraint errors become plain-language HTTP errors.
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (err instanceof HttpException) return res.status(err.getStatus()).json(err.getResponse());
    const pgErr = err?.cause?.code ? err.cause : err;
    const map: Record<string, [number, string]> = {
      '23505': [409, 'That already exists'],
      '23503': [400, 'That refers to something that does not exist, or is still in use'],
      '23514': [400, 'That value is not allowed'],
      '23502': [400, 'A required value is missing'],
      '23001': [409, pgErr?.message ?? 'Not allowed'],
    };
    const hit = map[pgErr?.code];
    if (hit) {
      return res.status(hit[0]).json({ statusCode: hit[0], message: hit[1], detail: pgErr.detail ?? pgErr.constraint });
    }
    console.error(err);
    res.status(500).json({ statusCode: 500, message: 'Something went wrong' });
  }
}

// ---------- Helpers ----------

export function parse<S extends ZodType>(schema: S, body: unknown): S['_output'] {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException({
      statusCode: 400,
      message: r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
      issues: r.error.issues,
    });
  }
  return r.data;
}

// Optimistic locking: the update only lands if nobody changed the row since the editor loaded it.
export async function updateVersioned(tx: Tx, table: any, id: string, version: number, patch: Record<string, unknown>) {
  const rows = await tx
    .update(table)
    .set({ ...patch, version: sql`${table.version} + 1`, updatedAt: new Date() })
    .where(and(eq(table.id, id), eq(table.version, version)))
    .returning();
  if (rows.length) return rows[0] as any;
  const [exists] = await tx.select({ id: table.id }).from(table).where(eq(table.id, id));
  if (!exists) throw new NotFoundException('Not found');
  throw new ConflictException('Someone else changed this record after you opened it. Reload and try again.');
}

export async function findOr404<T>(p: Promise<T[]>): Promise<T> {
  const [row] = await p;
  if (!row) throw new NotFoundException('Not found');
  return row;
}

// Passwords and PINs: scrypt from the Node standard library.
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export async function hashSecret(secret: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifySecret(secret: string, stored: string | null | undefined) {
  const [, salt, hash] = stored?.split('$') ?? [];
  if (!salt || !hash) return false;
  const actual = await scryptAsync(secret, Buffer.from(salt, 'base64'), 32);
  return timingSafeEqual(actual, Buffer.from(hash, 'base64'));
}
