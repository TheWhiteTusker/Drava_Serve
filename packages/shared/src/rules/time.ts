import { TIME_ZONE } from '../constants';

// ---------- Business day ----------

// A business day runs from dayStart (India time) to dayStart the next day, so a bar bill paid
// at 1:30 am belongs to the evening before.
export function businessDate(at: Date, dayStart = '05:00'): string {
  const [h, m] = dayStart.split(':').map(Number);
  const shifted = new Date(at.getTime() - (h * 60 + m) * 60_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(shifted);
}

// Hour of the day (0–23) in India time.
export const istHour = (at: Date) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hour12: false }).format(at)) % 24;

export const istDate = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(at);

export const istTime = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
