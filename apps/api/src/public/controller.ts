// Guest QR menu endpoints: no sign-in, nothing about the guest is stored.
import {
  Body, ConflictException, Controller, ForbiddenException, Get, HttpException, HttpStatus, NotFoundException, Param, Post, Query,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { parse, Public } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { publish } from '../events.js';
import { MAX_WAITING, cachedMenu, publicTable, zGuestOrder } from './menu.js';

@Controller('public')
export class PublicMenuController {
  @Public()
  @Get('menu/:customer/:outlet')
  async menu(@Param('customer') customerCode: string, @Param('outlet') outletCode: string, @Query('table') tableId?: string) {
    const m = await cachedMenu(customerCode, outletCode);
    const table = publicTable(m, tableId);
    const pick = m.ordering && m.pickTable;
    return { ...m.body, table, ordering: m.ordering && !!table, pickTable: pick, tables: pick && !table ? [...m.tables.values()].map(({ code: _c, ...x }) => x) : undefined };
  }

  // A guest's order waits for a cashier; it is not a bill, holds no stock and costs nothing yet.
  @Public()
  @Post('orders/:customer/:outlet')
  async order(@Param('customer') customerCode: string, @Param('outlet') outletCode: string, @Body() body: unknown) {
    const o = parse(zGuestOrder, body);
    const m = await cachedMenu(customerCode, outletCode);
    if (!m.ordering) throw new ForbiddenException('Ordering from the table is switched off here. Please ask your server.');
    const table = publicTable(m, o.tableId);
    if (!table) throw new NotFoundException('This table is not taking orders. Please ask your server.');
    const [seen] = await m.db.select().from(t.guestOrder).where(eq(t.guestOrder.clientId, o.clientId));
    if (seen) return { id: seen.id, status: seen.status };
    const lines = [...new Map(o.lines.map((l) => [l.menuItemId, l])).values()];
    const item = (id: string) => m.body.items.find((i) => i.id === id);
    const out = lines.filter((l) => (item(l.menuItemId)?.status ?? 'out') === 'out');
    if (out.length) {
      const names = out.map((l) => item(l.menuItemId)?.name).filter(Boolean);
      throw new ConflictException({ statusCode: 409, message: names.length ? `Sold out: ${names.join(', ')}` : 'An item is no longer on the menu', soldOut: out.map((l) => l.menuItemId) });
    }
    // ponytail: count-then-insert without a lock; two phones racing can leave MAX_WAITING + 1 waiting.
    const [{ waiting }] = (await m.db.execute(sql`select count(*)::int as waiting from guest_order where table_id = ${table.id} and status = 'pending'`)).rows as any[];
    if (waiting >= MAX_WAITING) throw new HttpException('Your earlier orders are still waiting for staff. Please give them a moment.', HttpStatus.TOO_MANY_REQUESTS);
    const [row] = await m.db.insert(t.guestOrder).values({ outletId: m.outletId, tableId: table.id, clientId: o.clientId, lines }).returning();
    publish(m.customerId, m.outletId, 'guestOrder', { order: { ...row, table: table.name } }); // counters add it without asking
    return { id: row.id, status: row.status };
  }

  // The guest's phone asks how its order is doing. Only the order's own random id finds it.
  @Public()
  @Get('orders/:customer/:outlet/:id')
  async orderStatus(@Param('customer') customerCode: string, @Param('outlet') outletCode: string, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('Order not found');
    const m = await cachedMenu(customerCode, outletCode); // cached: this is a single primary-key read
    const [g] = await m.db
      .select({ id: t.guestOrder.id, status: t.guestOrder.status, reason: t.guestOrder.reason })
      .from(t.guestOrder)
      .where(and(eq(t.guestOrder.id, id), eq(t.guestOrder.outletId, m.outletId)));
    if (!g) throw new NotFoundException('Order not found');
    return g;
  }
}
