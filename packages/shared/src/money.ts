import Decimal from 'decimal.js';

// Rupees and quantities are exact decimals end to end. The database stores numeric,
// the API moves them as strings, and arithmetic happens here, never in JS floats.
export { Decimal };
export type Num = Decimal.Value;

export const dec = (v: Num) => new Decimal(v);
export const rupees = (v: Num) => dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export const qty = (v: Num) => dec(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
export const sum = (vs: Num[]) => vs.reduce<Decimal>((a, v) => a.plus(v), dec(0));

export type TaxKind = 'food' | 'liquor';
export interface TaxComponent {
  name: string;
  ratePct: string;
}
export interface TaxClassLike {
  kind: TaxKind;
  components: TaxComponent[];
}
export interface BillLineInput {
  qty: Num;
  unitPrice: Num; // price charged per unit, before tax
  taxClass: TaxClassLike;
}
export interface TaxLine {
  name: string;
  ratePct: string;
  amount: string;
}
export interface DepartmentTotal {
  subtotal: string;
  discount: string;
  taxes: TaxLine[];
  total: string;
}
export interface BillTotals {
  food: DepartmentTotal;
  liquor: DepartmentTotal;
  discount: string;
  roundOff: string;
  grandTotal: string;
}

// Menu prices are before tax. Food and liquor are totalled separately, each with its own
// taxes worked out on its subtotal (after any approved manual discount); the grand total is
// rounded to the nearest rupee.
export function billTotals(lines: BillLineInput[], opts: { discountPct?: Num } = {}): BillTotals {
  const keep = dec(1).minus(dec(opts.discountPct ?? 0).div(100));
  const part = (kind: TaxKind): DepartmentTotal => {
    const mine = lines.filter((l) => l.taxClass.kind === kind);
    const subtotal = sum(mine.map((l) => dec(l.qty).times(l.unitPrice))).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const discount = subtotal.minus(subtotal.times(keep)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    // Group by component name + rate so two classes with the same CGST rate merge into one line.
    const byKey = new Map<string, { name: string; ratePct: string; base: Decimal }>();
    for (const l of mine) {
      for (const c of l.taxClass.components) {
        const key = `${c.name}@${dec(c.ratePct).toString()}`;
        const row = byKey.get(key) ?? { name: c.name, ratePct: dec(c.ratePct).toString(), base: dec(0) };
        row.base = row.base.plus(dec(l.qty).times(l.unitPrice).times(keep));
        byKey.set(key, row);
      }
    }
    const taxes = [...byKey.values()].map((t) => ({
      name: t.name,
      ratePct: t.ratePct,
      amount: rupees(t.base.times(t.ratePct).div(100)),
    }));
    const total = subtotal.minus(discount).plus(sum(taxes.map((t) => t.amount)));
    return { subtotal: subtotal.toFixed(2), discount: discount.toFixed(2), taxes, total: total.toFixed(2) };
  };
  const food = part('food');
  const liquor = part('liquor');
  const exact = dec(food.total).plus(liquor.total);
  const rounded = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return {
    food, liquor, discount: dec(food.discount).plus(liquor.discount).toFixed(2), roundOff: rounded.minus(exact).toFixed(2), grandTotal: rounded.toFixed(2),
  };
}
