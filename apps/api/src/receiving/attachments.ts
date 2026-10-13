import { BadRequestException, Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { C, Ctx, findOr404, parse } from '../common.js';
import { controlDb, controlSchema, tenantSchema as t, type Q } from '../db/index.js';
import { getObject, putObject } from '../storage.js';

// ---------- Photos and documents ----------

@Controller('attachments')
export class AttachmentsController {
  // Photo from the gate check or re-check, or the vendor's bill. Stored privately per customer.
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@C() ctx: Ctx, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    const b = parse(
      z.object({ entity: z.enum(['receipt_check', 'menu_item']), entityId: z.uuid(), lineId: z.uuid().nullish(), purpose: z.enum(['gate_photo', 'recheck_photo', 'vendor_bill', 'menu_photo']) }),
      body,
    );
    if (!file) throw new BadRequestException('Attach a photo or PDF');
    if (!/^image\/|^application\/pdf$/.test(file.mimetype)) throw new BadRequestException('Only photos or PDFs');
    const outletId = await outletOf(ctx.db, b.entity, b.entityId);
    if (b.entity === 'menu_item') ctx.assert('catalog.manage', outletId);
    else ctx.assert(b.purpose === 'gate_photo' ? 'receiving.gate' : 'receiving.recheck', outletId);
    const [cust] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.id, ctx.customerId));
    const ext = file.mimetype === 'application/pdf' ? 'pdf' : (file.mimetype.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
    const key = `${b.entity}/${b.entityId}/${b.lineId ?? 'all'}/${randomUUID()}.${ext}`;
    await putObject(cust.code, key, file.buffer, file.mimetype);
    const [a] = await ctx.tx((tx) =>
      tx.insert(t.attachment).values({ entity: b.entity, entityId: b.entityId, purpose: b.purpose, objectKey: key, contentType: file.mimetype, takenBy: ctx.userId }).returning(),
    );
    if (b.entity === 'menu_item') await ctx.tx((tx) => tx.update(t.menuItem).set({ photoKey: a.id }).where(eq(t.menuItem.id, b.entityId)));
    return { id: a.id };
  }

  @Get(':id')
  async file(@C() ctx: Ctx, @Param('id') id: string, @Res() res: any) {
    const a = await findOr404(ctx.db.select().from(t.attachment).where(eq(t.attachment.id, id)));
    const outletId = await outletOf(ctx.db, a.entity, a.entityId);
    if (a.purpose === 'vendor_bill') ctx.assert('rates.view', outletId);
    else if (!['receiving.gate', 'receiving.recheck', 'rates.view', 'catalog.view', 'approvals.decide'].some((p) => ctx.can(p as any, outletId))) ctx.assert('rates.view', outletId);
    const [cust] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.id, ctx.customerId));
    res.set({ 'content-type': a.contentType, 'cache-control': 'private, max-age=3600' }).send(await getObject(cust.code, a.objectKey));
  }
}

async function outletOf(q: Q, entity: string, entityId: string) {
  const table = entity === 'menu_item' ? t.menuItem : t.receiptCheck;
  const row = await findOr404(q.select({ outletId: table.outletId }).from(table).where(eq(table.id, entityId)));
  return row.outletId;
}
