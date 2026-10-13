import { Controller, Get, Query } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { C, Ctx, Permit } from '../common.js';
import { tenantSchema as t } from '../db/index.js';

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
