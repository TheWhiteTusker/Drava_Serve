import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { billTotals, dec, rupees } from '@fnb/shared';
import type { Tx } from '../db/index.js';
import { tenantSchema as t } from '../db/index.js';
import { rebuildRollups } from '../reports/rollup.js';
import { postMoves, type Move } from '../stock/ledger.js';
import { istDate } from './data.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const VENDOR = 'United Spirits & Beverages Distributorship';

// Liquor sample data for the liquor register: a delivery per outlet (receipts), breakage,
// spillage and a complimentary pour (other), and bar bills earlier today (sales). Royal Stag
// and Blenders Pride at Indiranagar stay as the main seed left them: they drive the offer demo.
// Safe to run twice.
export async function seedLiquor(tx: Tx, log: (s: string) => void = console.log) {
  const liquor = await tx.select().from(t.stockItem).where(and(eq(t.stockItem.department, 'beverage'), gt(t.stockItem.abvPct, '0')));
  const done = await tx
    .select({ id: t.stockLedger.id })
    .from(t.stockLedger)
    .where(and(eq(t.stockLedger.movement, 'goods_receipt'), inArray(t.stockLedger.stockItemId, liquor.map((s) => s.id))))
    .limit(1);
  if (done.length) {
    log('Liquor sample data is already there.');
    return;
  }
  const outlets = await tx.select().from(t.outlet).orderBy(asc(t.outlet.code));
  const users = await tx.select().from(t.appUser);
  const u = (login: string) => users.find((x) => x.login === login)!.id;
  const [owner, watchman, store, cashier] = ['owner@demo.test', 'watchman@demo.test', 'store@demo.test', 'cashier@demo.test'].map(u);
  const [vendor] = await tx.select().from(t.vendor).where(eq(t.vendor.name, VENDOR));
  const stores = await tx.select().from(t.store).where(eq(t.store.kind, 'bar'));
  const byName = (n: string) => liquor.find((s) => s.name === n)!;
  const liquorTax = (await tx.select().from(t.taxClass).where(eq(t.taxClass.code, 'LIQUOR')))[0];
  const post = (moves: Move[], userId: string) => postMoves(tx, { userId, deviceId: 'system:seed' }, moves);

  // [outlet code, days ago, vendor bill, [label, cases]]
  const deliveries: [string, number, string, [string, number][]][] = [
    ['BLR1', 3, 'USB-30917', [['Johnnie Walker Black Label 750 ml', 1], ['Old Monk 750 ml', 2], ['Kingfisher Premium 650 ml', 4], ['Bombay Sapphire 750 ml', 1]]],
    ['MYS1', 4, 'USB-30962', [['Royal Stag 750 ml', 2], ['Smirnoff 750 ml', 1], ['Kingfisher Premium 650 ml', 3], ['Sula Shiraz 750 ml', 1]]],
  ];
  for (const [n, [code, ago, bill, lines]] of deliveries.entries()) {
    const o = outlets.find((x) => x.code === code)!;
    const bar = stores.find((s) => s.outletId === o.id)!;
    const when = daysAgo(ago);
    const [rc] = await tx
      .insert(t.receiptCheck)
      .values({ outletId: o.id, vendorId: vendor.id, expectedOn: istDate(when), status: 'closed', gateBy: watchman, gateAt: when, recheckBy: store, recheckAt: when, vendorBillNo: bill })
      .returning();
    const rows = lines.map(([name, cases]) => {
      const s = byName(name);
      const bottles = cases * 12;
      return { s, bottles, ml: dec(s.bottleSizeMl!).times(bottles), rate: dec(s.currentCost).times(s.bottleSizeMl!) };
    });
    const units = await tx.select().from(t.stockItemUnit).where(and(inArray(t.stockItemUnit.stockItemId, rows.map((r) => r.s.id)), eq(t.stockItemUnit.isDefault, true)));
    const unitOf = (id: string) => units.find((x) => x.stockItemId === id)!.id;
    const gross = rows.reduce((a, r) => a.plus(r.rate.times(r.bottles)), dec(0));
    await tx.insert(t.receiptCheckLine).values(
      rows.map((r) => ({
        receiptCheckId: rc.id, stockItemId: r.s.id, unitId: unitOf(r.s.id), orderedQty: String(r.bottles), gateStatus: 'accepted' as const, gateQty: String(r.bottles),
        recheckAcceptedQty: String(r.bottles), recheckRejectedQty: '0', measuredQty: String(r.bottles), billedRate: rupees(r.rate),
      })),
    );
    const [grn] = await tx
      .insert(t.goodsReceivedNote)
      .values({
        outletId: o.id, receiptCheckId: rc.id, vendorId: vendor.id, number: `GRN-${2001 + n}`, status: n === 0 ? 'paid' : 'approved',
        watchmanConfirmedBy: watchman, watchmanConfirmedAt: when, staffConfirmedBy: store, staffConfirmedAt: when, approvedAt: when,
        amountGross: rupees(gross), amountPayable: rupees(gross),
      })
      .returning();
    await tx.insert(t.grnLine).values(
      rows.map((r) => ({
        grnId: grn.id, stockItemId: r.s.id, storeId: bar.id, unitId: unitOf(r.s.id), acceptedQty: String(r.bottles), acceptedBaseQty: r.ml.toFixed(3),
        billedRate: rupees(r.rate), ratePerBase: r.s.currentCost, lastRatePerBase: r.s.currentCost, amount: rupees(r.rate.times(r.bottles)),
      })),
    );
    if (n === 0) await tx.insert(t.vendorPayment).values({ grnId: grn.id, paidOn: istDate(daysAgo(1)), mode: 'bank transfer', reference: 'NEFT-902317', amount: rupees(gross), recordedBy: owner });
    await post(
      rows.map((r) => ({ storeId: bar.id, stockItemId: r.s.id, qty: r.ml.toFixed(3), movement: 'goods_receipt', unitCost: r.s.currentCost, refType: 'grn', refId: grn.id, at: when })),
      store,
    );
  }

  // Other movements: [outlet code, days ago, label, ml, movement, reason]
  const other: [string, number, string, number, Move['movement'], string][] = [
    ['BLR1', 2, 'Kingfisher Premium 650 ml', 650, 'breakage', 'Bottle dropped while restocking the chiller'],
    ['BLR1', 1, 'Old Monk 750 ml', 30, 'spillage', 'Peg knocked over at the counter'],
    ['BLR1', 0, 'Johnnie Walker Black Label 750 ml', 60, 'complimentary', 'On the house for a regular guest'],
    ['MYS1', 1, 'Sula Shiraz 750 ml', 750, 'breakage', 'Corked bottle, returned by the guest'],
    ['MYS1', 0, 'Smirnoff 750 ml', 30, 'spillage', 'Spilt while pouring'],
  ];
  for (const [code, ago, name, ml, movement, reason] of other) {
    const o = outlets.find((x) => x.code === code)!;
    await post([{ storeId: stores.find((s) => s.outletId === o.id)!.id, stockItemId: byName(name).id, qty: String(-ml), movement, reason, at: daysAgo(ago) }], store);
  }

  // Bar bills earlier today: [outlet code, minutes ago, [menu item, qty]]
  const bills: [string, number, [string, number][]][] = [
    ['BLR1', 200, [['Old Monk 60 ml', 2], ['Kingfisher Premium bottle', 1]]],
    ['BLR1', 150, [['Johnnie Walker Black Label 60 ml', 2]]],
    ['BLR1', 110, [['Kingfisher Premium bottle', 3]]],
    ['BLR1', 70, [['Bombay Sapphire 60 ml', 1], ['Old Monk 60 ml', 1]]],
    ['BLR1', 30, [['Glenfiddich 12 60 ml', 1], ['Kingfisher Premium bottle', 2]]],
    ['MYS1', 180, [['Royal Stag 60 ml', 2], ['Kingfisher Premium bottle', 1]]],
    ['MYS1', 120, [['Smirnoff 60 ml', 2]]],
    ['MYS1', 60, [['Sula Shiraz glass', 2], ['Royal Stag 30 ml', 1]]],
    ['MYS1', 20, [['Kingfisher Premium bottle', 2]]],
  ];
  const menu = await tx.select().from(t.menuItem).where(eq(t.menuItem.taxClassId, liquorTax.id));
  const recipes = await tx.select().from(t.recipeLine).where(inArray(t.recipeLine.menuItemId, menu.map((m) => m.id)));
  for (const [n, [code, mins, lines]] of bills.entries()) {
    const o = outlets.find((x) => x.code === code)!;
    const bar = stores.find((s) => s.outletId === o.id)!;
    const paid = new Date(Date.now() - mins * 60_000);
    const opened = new Date(paid.getTime() - 40 * 60_000);
    const date = istDate(opened);
    const picked = lines.map(([name, qty]) => ({ item: menu.find((m) => m.outletId === o.id && m.name === name)!, qty }));
    const totals = billTotals(picked.map((l) => ({ qty: l.qty, unitPrice: l.item.sellingPrice, taxClass: liquorTax })));
    const [table] = await tx.select().from(t.diningTable).where(eq(t.diningTable.outletId, o.id)).orderBy(asc(t.diningTable.sortOrder)).offset(n % 4).limit(1);
    const [bill] = await tx
      .insert(t.bill)
      .values({
        outletId: o.id, number: `${o.code}-${date.replaceAll('-', '')}-B${String(n + 1).padStart(2, '0')}`, kind: 'dine_in', tableId: table.id, status: 'paid',
        openedAt: opened, paidAt: paid, businessDate: date, openedBy: cashier, closedBy: cashier, deviceId: 'system:seed',
        foodSubtotal: totals.food.subtotal, foodTax: rupees(dec(totals.food.total).minus(totals.food.subtotal)),
        liquorSubtotal: totals.liquor.subtotal, liquorTax: rupees(dec(totals.liquor.total).minus(totals.liquor.subtotal)),
        taxes: totals, roundOff: totals.roundOff, total: totals.grandTotal,
      })
      .returning();
    const [order] = await tx.insert(t.billOrder).values({ billId: bill.id, placedAt: opened, placedBy: cashier }).returning();
    const moves: Move[] = [];
    for (const l of picked) {
      const recipe = recipes.filter((r) => r.menuItemId === l.item.id);
      const cost = recipe.reduce((a, r) => a.plus(dec(liquor.find((s) => s.id === r.stockItemId)!.currentCost).times(r.quantity)), dec(0));
      await tx.insert(t.orderLine).values({
        billId: bill.id, orderId: order.id, menuItemId: l.item.id, name: l.item.name, department: l.item.department, taxClassId: liquorTax.id, taxKind: liquorTax.kind,
        qty: String(l.qty), menuPrice: l.item.sellingPrice, priceCharged: l.item.sellingPrice, costAtSale: rupees(cost), createdAt: opened, readyAt: paid,
      });
      for (const r of recipe) moves.push({ storeId: bar.id, stockItemId: r.stockItemId, qty: dec(r.quantity).times(l.qty).neg().toFixed(3), movement: 'sale', refType: 'bill', refId: bill.id, at: paid });
    }
    await tx.insert(t.payment).values({ billId: bill.id, mode: n % 3 === 0 ? 'cash' : n % 3 === 1 ? 'upi' : 'card', amount: totals.grandTotal, receivedAt: paid, receivedBy: cashier });
    await post(moves, cashier);
  }
  await rebuildRollups(tx); // today's bar bills on the dashboard

  log('Liquor sample data added: deliveries at both outlets, breakage, spillage, a complimentary pour and bar bills earlier today.');
}
