import { describe, expect, it } from 'vitest';
import {
  applyMovement, businessDate, fefoSplit, grossQty, indentQuantity, isLow, istHour, margin, menuEngineering,
  menuStatus, portionCost, portionsAvailable, pourCostPct, rankCourse, resolveTarget, selectOffers, shouldRelease,
  stockStatus, suggestedPrice, type OfferRule,
} from './rules';

describe('stock balance and weighted average cost', () => {
  it('averages receipts by quantity', () => {
    // 10 kg tomato at ₹20, then 10 kg at ₹50 → 20 kg at ₹35/kg
    const b = applyMovement({ qty: '10000', avgCost: '0.020000' }, '10000', '0.05');
    expect(b).toEqual({ qty: '20000.000', avgCost: '0.035000' });
  });
  it('issues reduce quantity and keep the average', () => {
    expect(applyMovement({ qty: '20000', avgCost: '0.035' }, '-250', '0.035')).toEqual({ qty: '19750.000', avgCost: '0.035' });
  });
  it('a receipt after a shortfall takes the new cost', () => {
    expect(applyMovement({ qty: '-500', avgCost: '0.02' }, '10000', '0.05')).toEqual({ qty: '9500.000', avgCost: '0.050000' });
  });
});

describe('earliest expiry first', () => {
  const lots = [
    { id: 'late', remaining: '5', expiresOn: '2026-10-20', receivedOn: '2026-10-09' },
    { id: 'none', remaining: '5', expiresOn: null, receivedOn: '2026-10-01' },
    { id: 'soon', remaining: '3', expiresOn: '2026-10-12', receivedOn: '2026-10-10' },
  ];
  it('issues the soonest expiry first, then the next', () => {
    expect(fefoSplit(lots, '6')).toEqual([
      { lotId: 'soon', qty: '3.000' },
      { lotId: 'late', qty: '3.000' },
    ]);
  });
  it('records what lots cannot cover as a shortfall', () => {
    expect(fefoSplit(lots, '15').at(-1)).toEqual({ lotId: null, qty: '2.000' });
  });
});

describe('availability and status', () => {
  it('portions = smallest stock ÷ recipe quantity across ingredients', () => {
    // Tomato soup: 250 g tomato (have 1 kg) and 75 ml cream (have 200 ml) → 2 portions
    expect(portionsAvailable([{ perPortion: 250, free: 1000 }, { perPortion: 75, free: 200 }])).toBe(2);
  });
  it('a 60 ml peg from 300 ml left is 5 serves; nothing left is 0', () => {
    expect(portionsAvailable([{ perPortion: 60, free: 300 }])).toBe(5);
    expect(portionsAvailable([{ perPortion: 60, free: -20 }])).toBe(0);
  });
  it('yield raises what is drawn from stock', () => {
    expect(grossQty(250, 80).toString()).toBe('312.5');
  });
  it('stock status follows reorder and critical levels', () => {
    const levels = { reorderLevel: 5000, criticalLevel: 2000 };
    expect(stockStatus(6000, levels)).toBe('healthy');
    expect(stockStatus(5000, levels)).toBe('reorder');
    expect(stockStatus(2000, levels)).toBe('critical');
    expect(stockStatus(0, levels)).toBe('out');
  });
  it('menu status: low at or below the threshold, out at zero', () => {
    expect(menuStatus(6, 5)).toBe('available');
    expect(menuStatus(5, 5)).toBe('low');
    expect(menuStatus(0, 5)).toBe('out');
  });
});

describe('nightly indent quantity', () => {
  it('par − on hand − on order, rounded up to the pack size', () => {
    // par 10 kg, have 3.2 kg, 2 kg already ordered → 4.8 kg short
    expect(indentQuantity({ par: 10000, onHand: 3200, onOrder: 2000, unitFactor: 1000, packSize: 1 })).toBe('5');
    expect(indentQuantity({ par: 10000, onHand: 3200, onOrder: 2000, unitFactor: 1000, packSize: 5 })).toBe('5');
    expect(indentQuantity({ par: 10000, onHand: 3200, onOrder: 2000, unitFactor: 1000, packSize: 25 })).toBe('25');
    expect(indentQuantity({ par: 10000, onHand: 3200, onOrder: 2000, unitFactor: 1000, packSize: 0.5 })).toBe('5');
  });
  it('nothing is ordered when stock and orders cover par', () => {
    expect(indentQuantity({ par: 10000, onHand: 9000, onOrder: 1000, unitFactor: 1000, packSize: 1 })).toBe('0');
  });
  it('bottles: par 12 bottles of 750 ml, 4.5 on hand → 8 bottles', () => {
    expect(indentQuantity({ par: 9000, onHand: 3375, onOrder: 0, unitFactor: 750, packSize: 1 })).toBe('8');
  });
});

describe('costing and margins (handoff 6.10 worked example)', () => {
  it('portion cost sums quantity × unit cost, adjusted for yield', () => {
    expect(portionCost([{ qty: 250, yieldPct: 100, unitCost: '0.02' }, { qty: 10, yieldPct: 50, unitCost: '1' }])).toBe('25.000000');
  });
  it('tomato from ₹20 to ₹50/kg adds ₹7.50 to tomato soup (250 g) and its margin falls', () => {
    const extra = portionCost([{ qty: 250, yieldPct: 100, unitCost: '0.05' }]);
    const old = portionCost([{ qty: 250, yieldPct: 100, unitCost: '0.02' }]);
    expect(Number(extra) - Number(old)).toBeCloseTo(7.5, 6);
    expect(margin(160, '38.00')).toEqual({ amount: '122.00', pct: '76.25' });
    expect(margin(160, '45.50')).toEqual({ amount: '114.50', pct: '71.56' });
  });
  it('suggested price = portion cost ÷ (1 − target), rounded up to the rupee', () => {
    expect(suggestedPrice('45.50', 75)).toBe('182.00');
    expect(suggestedPrice('42.00', 70)).toBe('140.00');
  });
  it('the most specific target wins', () => {
    expect(resolveTarget({ item: 70, category: 65, outlet: 60 })).toBe(70);
    expect(resolveTarget({ item: null, category: 65, outlet: 60 })).toBe(65);
    expect(resolveTarget({ outlet: 60 })).toBe(60);
  });
});

describe('menu ranking inside a course', () => {
  const soups = (tomatoMargin: string) => [
    { id: 'tomato', available: true, marginPct: tomatoMargin, units30d: 40, pin: null },
    { id: 'corn', available: true, marginPct: '73.75', units30d: 30, pin: null },
  ];
  it('tomato soup leads at ₹20 tomato; sweet corn soup leads at ₹50 tomato', () => {
    expect(rankCourse(soups('76.25'))).toEqual(['tomato', 'corn']);
    expect(rankCourse(soups('71.56'))).toEqual(['corn', 'tomato']);
  });
  it('available items come before sold-out ones, whatever their margin', () => {
    expect(
      rankCourse([
        { id: 'a', available: false, marginPct: 90, units30d: 0, pin: null },
        { id: 'b', available: true, marginPct: 10, units30d: 0, pin: null },
      ]),
    ).toEqual(['b', 'a']);
  });
  it('ties on margin are broken by units sold in the last 30 days', () => {
    expect(
      rankCourse([
        { id: 'a', available: true, marginPct: 70, units30d: 5, pin: null },
        { id: 'b', available: true, marginPct: 70, units30d: 9, pin: null },
      ]),
    ).toEqual(['b', 'a']);
  });
  it('a manager pin goes first', () => {
    expect(
      rankCourse([
        { id: 'a', available: true, marginPct: 90, units30d: 0, pin: null },
        { id: 'b', available: true, marginPct: 10, units30d: 0, pin: 1 },
      ]),
    ).toEqual(['b', 'a']);
  });
});

describe('beverage offers (handoff 6.9 worked example)', () => {
  const rule: OfferRule = {
    triggerServes: 5, discountPct: 10, bandMinPct: 1, bandMaxPct: 25, marginFloorPct: 55,
    minSubstituteServes: 15, maxItems: 3, releaseBufferServes: 3,
  };
  const candidates = [
    { id: 'B', price: 360, serveCost: 110, serves: 40 },
    { id: 'C', price: 340, serveCost: 95, serves: 30 },
    { id: 'D', price: 380, serveCost: 170, serves: 50 },
    { id: 'E-420', price: 420, serveCost: 100, serves: 50 },
  ];
  it('Whisky A (₹320, 4 serves left): B and C go on offer, D is under the floor, ₹420 is above the band', () => {
    expect(isLow(4, rule)).toBe(true);
    expect(selectOffers(320, candidates, rule)).toEqual([
      { id: 'C', offerPrice: '306.00', marginAfter: '68.95' },
      { id: 'B', offerPrice: '324.00', marginAfter: '66.05' },
    ]);
  });
  it('never promotes something itself low on stock, or excluded by a manager', () => {
    const r = selectOffers(
      320,
      [
        { id: 'B', price: 360, serveCost: 110, serves: 10 },
        { id: 'C', price: 340, serveCost: 95, serves: 30, excluded: true },
      ],
      rule,
    );
    expect(r).toEqual([]);
  });
  it('keeps at most the limit, best margin first', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, price: 330 + i * 10, serveCost: 50, serves: 30 }));
    expect(selectOffers(320, many, rule)).toHaveLength(3);
  });
  it('releases only above trigger plus buffer, so offers do not flap', () => {
    expect(shouldRelease(6, rule)).toBe(false);
    expect(shouldRelease(8, rule)).toBe(false);
    expect(shouldRelease(9, rule)).toBe(true);
  });
});

describe('menu engineering and pour cost', () => {
  it('sorts items into four groups by margin and popularity', () => {
    const r = menuEngineering([
      { id: 'star', units: 50, marginAmount: 200 },
      { id: 'plowhorse', units: 50, marginAmount: 50 },
      { id: 'puzzle', units: 5, marginAmount: 300 },
      { id: 'dog', units: 5, marginAmount: 40 },
    ]);
    expect(Object.fromEntries(r.map((x) => [x.id, x.class]))).toEqual({ star: 'star', plowhorse: 'plowhorse', puzzle: 'puzzle', dog: 'dog' });
  });
  it('pour cost = liquor cost ÷ liquor sales', () => {
    expect(pourCostPct(2000, 10000)).toBe('20.00');
  });
});

describe('business day and India time', () => {
  it('a bill paid at 1:30 am belongs to the evening before', () => {
    expect(businessDate(new Date('2026-10-11T01:30:00+05:30'))).toBe('2026-10-10');
    expect(businessDate(new Date('2026-10-11T05:30:00+05:30'))).toBe('2026-10-11');
  });
  it('hours are India time', () => {
    expect(istHour(new Date('2026-10-10T14:45:00Z'))).toBe(20);
  });
});
