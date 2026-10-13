import { describe, expect, it } from 'vitest';
import { applyMovement, fefoSplit, grossQty, indentQuantity, menuStatus, portionsAvailable, stockStatus } from '../rules';

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
