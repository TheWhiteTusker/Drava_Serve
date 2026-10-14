import { istDate } from '@fnb/shared';

export const qty = (v: string | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
// The next 5:00 am delivery.
export const nextDelivery = () => {
  const now = new Date();
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return hhmm >= '05:00' ? istDate(new Date(now.getTime() + 86_400_000)) : istDate(now);
};
export const GRN_STATUS: Record<string, [string, 'neutral' | 'success' | 'warning' | 'danger']> = {
  awaiting_signoff: ['Awaiting signatures', 'neutral'],
  held_rate: ['Held: rate rise', 'danger'],
  approved: ['Awaiting payment', 'warning'],
  paid: ['Paid', 'success'],
  cancelled: ['Cancelled', 'neutral'],
};
