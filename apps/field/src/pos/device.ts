// This counter's session, offline queue and saved bills, and the bill maths shared by its screens.
import { billTotals, istDate, type BillTotals } from '@fnb/shared';
import { createQueue } from '../lib/queue';
import { createSession, deviceId } from '../lib/session';
import type { Catalog, LocalBill } from './types';

export const session = createSession('pos');
export const queue = createQueue('pos', session);
export const store = {
  get<T>(k: string, fallback: T): T {
    try {
      return JSON.parse(localStorage.getItem(`fnb.pos.${k}`) ?? 'null') ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (k: string, v: unknown) => localStorage.setItem(`fnb.pos.${k}`, JSON.stringify(v)),
};

// Bill numbers come from the device so a bill can be numbered offline: OUTLET-YYMMDD-<tag><seq>.
export function nextBillNumber(outletCode: string) {
  const tag = store.get<string>('deviceTag', deviceId.slice(0, 2).toUpperCase());
  const day = istDate(new Date()).slice(2).replaceAll('-', '');
  const key = `seq.${day}`;
  const n = store.get<number>(key, 0) + 1;
  store.set(key, n);
  return `${outletCode}-${day}-${tag}${String(n).padStart(3, '0')}`;
}

export function totalsFor(bill: LocalBill, cat: Catalog, withCart = true): BillTotals {
  const lines = [...bill.lines.filter((l) => l.status !== 'voided'), ...(withCart ? bill.cart : [])];
  return billTotals(
    lines.map((l) => {
      const item = cat.menu.find((m) => m.id === l.menuItemId);
      const tc = cat.taxClasses.find((x) => x.id === (l.taxClassId ?? item?.taxClassId)) ?? { kind: 'food' as const, components: [] };
      return { qty: l.qty, unitPrice: l.price, taxClass: tc };
    }),
    { discountPct: bill.manualDiscountPct ?? 0 },
  );
}

// How long a table has been seated: "25 min", "1 h 40 min", "2 days".
export function since(at: string) {
  const min = Math.max(1, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `${Math.floor(min / 1440)} day${min >= 2880 ? 's' : ''}`;
}

export function fromServer(srv: any): LocalBill {
  return {
    clientId: srv.clientId, id: srv.id, number: srv.number, kind: srv.kind, tableId: srv.tableId, table: srv.table, openedAt: srv.openedAt,
    lines: srv.lines.map((l: any) => ({ id: l.id, menuItemId: l.menuItemId, name: l.name, qty: l.qty, price: l.price, dietType: l.dietType, status: l.status })),
    cart: [], status: srv.status, totals: srv.taxes ?? undefined, total: srv.total, paidAt: srv.paidAt ?? undefined,
    payments: srv.payments?.map((p: any) => ({ mode: p.mode, amount: p.amount })), manualDiscountPct: srv.manualDiscountPct,
  };
}
