import { describe, expect, it } from 'vitest';
import { businessDate, istHour } from '../rules';

describe('business day and India time', () => {
  it('a bill paid at 1:30 am belongs to the evening before', () => {
    expect(businessDate(new Date('2026-10-11T01:30:00+05:30'))).toBe('2026-10-10');
    expect(businessDate(new Date('2026-10-11T05:30:00+05:30'))).toBe('2026-10-11');
  });
  it('hours are India time', () => {
    expect(istHour(new Date('2026-10-10T14:45:00Z'))).toBe(20);
  });
});
