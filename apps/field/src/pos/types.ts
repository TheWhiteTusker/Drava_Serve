import type { BillTotals } from '@fnb/shared';

export interface MenuItem {
  id: string;
  name: string;
  department: 'food' | 'beverage';
  course: string | null;
  type: string | null;
  brand: string | null;
  dietType: string | null;
  serveSizeMl: string | null;
  taxClassId: string;
  taxKind: 'food' | 'liquor';
  price: string;
  activeDiscountId: string | null;
  portions: number | null;
  status: 'available' | 'low' | 'out';
  rank: number;
  code: string | null;
}
export interface Catalog {
  outlet: { id: string; name: string; code: string; address: string | null; gstin: string | null; fssaiNumber: string | null };
  dayStart: string;
  menu: MenuItem[];
  taxClasses: { id: string; kind: 'food' | 'liquor'; components: { name: string; ratePct: string }[] }[];
  tables: { id: string; name: string }[];
  syncedAt: string;
}
interface Line {
  id?: string;
  menuItemId: string;
  name: string;
  qty: string;
  price: string;
  dietType: string | null;
  taxClassId?: string;
  status?: string;
  activeDiscountId?: string | null;
}
export interface GuestOrder {
  id: string;
  tableId: string;
  table: string;
  createdAt: string;
  lines: { menuItemId: string; qty: number }[];
}
export interface LocalBill {
  clientId: string;
  id?: string; // server id once known
  number: string;
  kind: 'dine_in' | 'takeaway';
  tableId: string | null;
  table: string | null;
  openedAt: string | null;
  lines: Line[]; // sent to the kitchen / counter
  cart: Line[]; // not sent yet
  status: 'open' | 'paid' | 'cancelled' | 'refunded';
  totals?: BillTotals;
  total?: string;
  paidAt?: string;
  payments?: { mode: string; amount: string }[];
  manualDiscountPct?: string;
  unsent?: boolean; // changes saved on this device, not yet on the server
}
