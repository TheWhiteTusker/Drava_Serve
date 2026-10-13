import { businessDate, istDate } from '@fnb/shared';

// Dashboard (handoff 6.11). Every block reads the hourly and daily summary tables and follows
// the same filters: dates, outlet, Food or Beverage. Charts use the --chart-* theme tokens.

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const days = (n: number) => istDate(new Date(Date.now() - n * 86_400_000));
export const PRESETS: [string, () => [string, string]][] = [
  ['Today', () => [businessDate(new Date()), businessDate(new Date())]],
  ['Last 7 days', () => [days(6), businessDate(new Date())]],
  ['Last 30 days', () => [days(29), businessDate(new Date())]],
  ['This month', () => [`${businessDate(new Date()).slice(0, 8)}01`, businessDate(new Date())]],
];
export const num = (v: number | string) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
