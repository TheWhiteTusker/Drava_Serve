import { describe, expect, it } from 'vitest';
import {
  isLow, margin, menuEngineering, portionCost, pourCostPct, rankCourse, resolveTarget, selectOffers, shouldRelease, suggestedPrice, type OfferRule,
} from '../rules';

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
