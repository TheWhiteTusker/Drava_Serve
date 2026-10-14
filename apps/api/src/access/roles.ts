import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PERMISSIONS, withVersion, zRole } from '@fnb/shared';
import { C, Ctx, parse, Permit, updateVersioned } from '../common.js';
import { tenantSchema as t } from '../db/index.js';

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
