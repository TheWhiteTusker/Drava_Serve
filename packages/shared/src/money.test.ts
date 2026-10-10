import { describe, expect, it } from 'vitest';
import { billTotals, rupees } from './money';

const gst5 = { kind: 'food' as const, components: [{ name: 'CGST', ratePct: '2.5' }, { name: 'SGST', ratePct: '2.5' }] };
const liquorTax = { kind: 'liquor' as const, components: [{ name: 'VAT', ratePct: '10' }] };

describe('billTotals', () => {
  it('totals food and liquor separately, each with its own taxes', () => {
    const t = billTotals([
      { qty: 2, unitPrice: '160.00', taxClass: gst5 }, // 320
      { qty: 1, unitPrice: '280.00', taxClass: gst5 }, // 280
      { qty: 3, unitPrice: '320.00', taxClass: liquorTax }, // 960
    ]);
    expect(t.food).toEqual({
      subtotal: '600.00',
      taxes: [
        { name: 'CGST', ratePct: '2.5', amount: '15.00' },
        { name: 'SGST', ratePct: '2.5', amount: '15.00' },
      ],
      discount: '0.00',
      total: '630.00',
    });
    expect(t.liquor).toEqual({ subtotal: '960.00', discount: '0.00', taxes: [{ name: 'VAT', ratePct: '10', amount: '96.00' }], total: '1056.00' });
    expect(t.grandTotal).toBe('1686.00');
    expect(t.roundOff).toBe('0.00');
  });

  it('rounds the grand total to the nearest rupee and shows the round-off', () => {
    const t = billTotals([{ qty: 1, unitPrice: '99.00', taxClass: gst5 }]); // 99 + 2.48 + 2.48 = 103.96
    expect(t.food.total).toBe('103.96');
    expect(t.grandTotal).toBe('104.00');
    expect(t.roundOff).toBe('0.04');
  });

  it('never drifts like floating point does', () => {
    const t = billTotals(Array.from({ length: 10 }, () => ({ qty: 1, unitPrice: '0.10', taxClass: { kind: 'food' as const, components: [] } })));
    expect(t.food.subtotal).toBe('1.00');
    expect(rupees('0.105')).toBe('0.11');
  });

  it('an empty side totals zero', () => {
    const t = billTotals([{ qty: 1, unitPrice: '50', taxClass: gst5 }]);
    expect(t.liquor).toEqual({ subtotal: '0.00', discount: '0.00', taxes: [], total: '0.00' });
  });

  it('an approved 10% discount comes off before tax, on both sides of the bill', () => {
    const t = billTotals(
      [
        { qty: 1, unitPrice: '200', taxClass: gst5 },
        { qty: 1, unitPrice: '300', taxClass: liquorTax },
      ],
      { discountPct: 10 },
    );
    expect(t.food).toMatchObject({ subtotal: '200.00', discount: '20.00', total: '189.00' }); // 180 + 4.50 + 4.50
    expect(t.liquor).toMatchObject({ subtotal: '300.00', discount: '30.00', total: '297.00' }); // 270 + 27
    expect(t.discount).toBe('50.00');
    expect(t.grandTotal).toBe('486.00');
  });
});
