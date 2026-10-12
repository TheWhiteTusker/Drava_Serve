import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { eq } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import { loadGrants, type TokenClaims } from './common.js';
import { resolveCustomer, tenantSchema as t } from './db/index.js';

// Live updates. Each signed-in device joins one room per outlet it works at
// ("<customer>:<outlet>"); stock, sold-out, price and offer changes go to that room only.
// With REDIS_URL set, main.ts plugs in the Redis adapter so every API instance shares rooms.

export type LiveEvent =
  | 'stock' // { storeId, stockItemId, qty, status }
  | 'availability' // { items: [{ menuItemId, portions, status }] }
  | 'menu' // menu order, prices or offers changed: reload the catalog
  | 'bill' // a bill changed (open bills list)
  | 'approval' // approval queue changed
  | 'activity'; // a new entry in the activity feed

let io: Server | undefined;

export function publish(customerId: string, outletId: string, event: LiveEvent, data: unknown) {
  io?.to(`${customerId}:${outletId}`).emit(event, data);
}

@WebSocketGateway({ path: '/api/socket', cors: { origin: true } })
export class LiveGateway implements OnGatewayInit, OnGatewayConnection {
  private log = new Logger('Live');

  afterInit(server: Server) {
    io = server;
  }

  constructor(private jwt: JwtService) {}

  async handleConnection(socket: Socket) {
    try {
      const claims = await this.jwt.verifyAsync<TokenClaims>(socket.handshake.auth?.token);
      const tenant = await resolveCustomer(claims.cid);
      if (!tenant) throw new Error('inactive customer');
      const grants = await loadGrants(tenant.db, claims.sub);
      const outlets = grants.some((g) => g.outletId === null)
        ? (await tenant.db.select({ id: t.outlet.id }).from(t.outlet).where(eq(t.outlet.active, true))).map((o) => o.id)
        : [...new Set(grants.map((g) => g.outletId!))];
      await socket.join(outlets.map((o) => `${claims.cid}:${o}`));
    } catch (e) {
      this.log.debug(`refused socket: ${(e as Error).message}`);
      socket.disconnect(true);
    }
  }
}
