import { and, asc, eq, inArray } from 'drizzle-orm';
import { dec, rupees } from '@fnb/shared';
import type { Tx } from '../db/index.js';
import { tenantSchema as t } from '../db/index.js';
import { liquorRegister } from '../inventory/liquor-register.js';
import { dayTotals } from '../pos/day-close.js';
import { istDate } from './data.js';
import { seedLiquor } from './liquor.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

// Fills the screens the main seed leaves empty (deliveries, GRNs, payments, returns, counts,
// transfers, approvals, day close, guest orders, activity, liquor), 3 to 5 rows each. Safe to run twice.
export async function seedExtras(tx: Tx, log: (s: string) => void = console.log) {
  await seedLiquor(tx, log); // its own check, so it also fills a database seeded before it existed
  if ((await tx.select({ id: t.goodsReceivedNote.id }).from(t.goodsReceivedNote).limit(1)).length) {
    log('Extra sample data is already there.');
    return;
  }
  const outlets = await tx.select().from(t.outlet).orderBy(asc(t.outlet.code));
  const users = await tx.select().from(t.appUser);
  const u = (login: string) => users.find((x) => x.login === login)!.id;
  const [owner, manager, watchman, store, cashier] = ['owner@demo.test', 'manager@demo.test', 'watchman@demo.test', 'store@demo.test', 'cashier@demo.test'].map(u);
  const [blr, mys] = outlets;
  const stores = await tx.select().from(t.store);
  const storeOf = (o: string, kind: string) => stores.find((s) => s.outletId === o && s.kind === kind)!;
  const vendors = await tx.select().from(t.vendor).orderBy(asc(t.vendor.name));
  const items = await tx.select().from(t.stockItem);
  const units = await tx.select().from(t.stockItemUnit).where(eq(t.stockItemUnit.isDefault, true));
  const unitOf = (id: string) => units.find((x) => x.stockItemId === id)!;
  const byName = (n: string) => items.find((i) => i.name === n)!;

  // ---------- Deliveries: four receipts at Indiranagar, one per stage ----------
  const supplied = async (vendorId: string) => {
    const rows = await tx.select().from(t.vendorItem).where(eq(t.vendorItem.vendorId, vendorId)).limit(3);
    return rows.map((r) => items.find((i) => i.id === r.stockItemId)!);
  };
  const plan: { vendor: number; stage: 'closed' | 'paid' | 'held' | 'awaiting'; ago: number; bill: string }[] = [
    { vendor: 0, stage: 'paid', ago: 9, bill: 'GV-20418' },
    { vendor: 1, stage: 'closed', ago: 6, bill: 'HF-7731' },
    { vendor: 2, stage: 'held', ago: 3, bill: 'MG-5502' },
    { vendor: 3, stage: 'awaiting', ago: 1, bill: 'SC-1187' },
  ];
  const grns: { id: string; amount: string; paid: boolean }[] = [];
  for (const [n, p] of plan.entries()) {
    const v = vendors[p.vendor];
    const picks = await supplied(v.id);
    const when = daysAgo(p.ago);
    const [rc] = await tx
      .insert(t.receiptCheck)
      .values({
        outletId: blr.id, vendorId: v.id, expectedOn: istDate(when), status: 'closed', gateBy: watchman, gateAt: when, recheckBy: store, recheckAt: when, vendorBillNo: p.bill,
      })
      .returning();
    let gross = dec(0);
    for (const [i, s] of picks.entries()) {
      const unit = unitOf(s.id);
      const orderedQty = 10 + i * 5;
      const accepted = i === 1 ? orderedQty - 2 : orderedQty;
      const rate = dec(s.currentCost).times(unit.factor);
      const amount = rate.times(accepted);
      gross = gross.plus(amount);
      await tx.insert(t.receiptCheckLine).values({
        receiptCheckId: rc.id, stockItemId: s.id, unitId: unit.id, orderedQty: String(orderedQty),
        gateStatus: i === 1 ? 'short' : 'accepted', gateQty: String(accepted), gateReason: i === 1 ? 'Two units short on the truck' : null,
        recheckAcceptedQty: String(accepted), recheckRejectedQty: '0', measuredQty: String(accepted), billedRate: rupees(rate),
        expiresOn: s.perishable ? istDate(daysAgo(p.ago - 4)) : null,
      });
    }
    const [grn] = await tx
      .insert(t.goodsReceivedNote)
      .values({
        outletId: blr.id, receiptCheckId: rc.id, vendorId: v.id, number: `GRN-${String(1001 + n)}`,
        status: p.stage === 'paid' ? 'paid' : p.stage === 'held' ? 'held_rate' : p.stage === 'awaiting' ? 'awaiting_signoff' : 'approved',
        watchmanConfirmedBy: watchman, watchmanConfirmedAt: when, staffConfirmedBy: p.stage === 'awaiting' ? null : store, staffConfirmedAt: p.stage === 'awaiting' ? null : when,
        approvedAt: p.stage === 'paid' || p.stage === 'closed' ? when : null,
        amountGross: rupees(gross), amountPayable: rupees(gross),
      })
      .returning();
    for (const [i, s] of picks.entries()) {
      const unit = unitOf(s.id);
      const accepted = i === 1 ? 8 : 10 + i * 5;
      const rate = dec(s.currentCost).times(unit.factor);
      const [line] = await tx
        .insert(t.grnLine)
        .values({
          grnId: grn.id, stockItemId: s.id, storeId: storeOf(blr.id, s.department === 'beverage' ? 'bar' : 'main').id, unitId: unit.id,
          acceptedQty: String(accepted), acceptedBaseQty: String(dec(accepted).times(unit.factor)), billedRate: rupees(rate), ratePerBase: s.currentCost,
          lastRatePerBase: s.currentCost, amount: rupees(rate.times(accepted)), expiresOn: s.perishable ? istDate(daysAgo(p.ago - 4)) : null,
        })
        .returning();
      await tx.insert(t.stockLot).values({
        stockItemId: s.id, storeId: line.storeId, receivedOn: istDate(when), expiresOn: s.perishable ? istDate(daysAgo(p.ago - 4)) : istDate(daysAgo(-120)), grnLineId: line.id,
      });
    }
    grns.push({ id: grn.id, amount: rupees(gross), paid: p.stage === 'paid' });
    if (i0(n)) await tx.insert(t.returnNote).values({
      outletId: blr.id, receiptCheckId: rc.id, grnId: grn.id, vendorId: v.id, stockItemId: picks[1].id, qty: '2', reason: n === 0 ? 'Spoiled on arrival' : 'Wrong grade supplied',
      amount: rupees(dec(picks[1].currentCost).times(unitOf(picks[1].id).factor).times(2)), createdBy: store,
    });
  }
  // One more return from a delivery with no note yet, and one at the other outlet's vendor.
  const [anyRc] = await tx.select().from(t.receiptCheck).where(eq(t.receiptCheck.outletId, blr.id)).limit(1);
  const extraItems = [byName('Tomato'), byName('Paneer')];
  for (const [i, s] of extraItems.entries()) {
    await tx.insert(t.returnNote).values({
      outletId: blr.id, receiptCheckId: anyRc.id, vendorId: vendors[i].id, stockItemId: s.id, qty: String(1 + i), reason: i ? 'Expired before delivery' : 'Crushed in transit',
      amount: rupees(dec(s.currentCost).times(unitOf(s.id).factor).times(1 + i)), createdBy: watchman,
    });
  }

  // Vendor payments: the paid note in full, an approved note in two instalments.
  const paid = grns.find((g) => g.paid)!;
  const approved = grns[1];
  await tx.insert(t.vendorPayment).values([
    { grnId: paid.id, paidOn: istDate(daysAgo(7)), mode: 'bank transfer', reference: 'NEFT-884210', amount: paid.amount, recordedBy: owner },
    { grnId: approved.id, paidOn: istDate(daysAgo(4)), mode: 'UPI', reference: 'UPI-5521907', amount: rupees(dec(approved.amount).div(2)), recordedBy: owner },
    { grnId: approved.id, paidOn: istDate(daysAgo(2)), mode: 'cheque', reference: 'CHQ-004127', amount: rupees(dec(approved.amount).div(4)), recordedBy: owner },
  ]);

  // Vendor orders sent: log of how each existing indent went out.
  const indents = await tx.select().from(t.indent).orderBy(asc(t.indent.forDate)).limit(5);
  const channels = ['manual_share', 'download', 'print', 'manual_share', 'download'];
  for (const [i, ind] of indents.entries()) {
    await tx.insert(t.deliverySend).values({
      indentId: ind.id, channel: channels[i], attemptedAt: daysAgo(5 - i), userId: manager, result: i === 3 ? 'failed' : 'ok', detail: i === 3 ? 'Share sheet was closed before sending' : 'Sent to the vendor',
    });
  }

  // ---------- Stock counts and transfers ----------
  const counts: [typeof blr, string, 'scheduled' | 'counting' | 'submitted' | 'approved', number][] = [
    [blr, 'bar', 'approved', 8], [blr, 'kitchen', 'submitted', 2], [blr, 'main', 'counting', 0], [mys, 'bar', 'scheduled', -3],
  ];
  for (const [o, kind, status, ago] of counts) {
    const st = storeOf(o.id, kind);
    const [c] = await tx
      .insert(t.stockCount)
      .values({ outletId: o.id, storeId: st.id, scheduledFor: istDate(daysAgo(ago)), status, submittedBy: status === 'submitted' || status === 'approved' ? store : null, submittedAt: status === 'submitted' || status === 'approved' ? daysAgo(ago) : null })
      .returning();
    const bal = await tx.select().from(t.stockBalance).where(eq(t.stockBalance.storeId, st.id)).limit(4);
    for (const [i, b] of bal.entries()) {
      const done = status === 'submitted' || status === 'approved';
      const expected = dec(b.qty);
      const counted = done ? expected.minus(i === 0 ? expected.times(0.04) : 0) : null;
      await tx.insert(t.stockCountLine).values({
        countId: c.id, stockItemId: b.stockItemId, expectedQty: expected.toFixed(3), countedQty: counted?.toFixed(3) ?? null, cause: done && i === 0 ? 'Spillage and free pours' : null,
      });
    }
  }
  const [main, kitchen, bar] = ['main', 'kitchen', 'bar'].map((k) => storeOf(blr.id, k));
  await tx.insert(t.stockTransfer).values([
    { outletId: blr.id, fromStoreId: main.id, toStoreId: kitchen.id, note: 'Morning issue for the lunch service', createdBy: store, createdAt: daysAgo(3) },
    { outletId: blr.id, fromStoreId: main.id, toStoreId: bar.id, note: 'Mixers and soda for the weekend', createdBy: store, createdAt: daysAgo(2) },
    { outletId: blr.id, fromStoreId: main.id, toStoreId: kitchen.id, note: 'Extra cooking oil and rice', createdBy: manager, createdAt: daysAgo(1) },
    { outletId: mys.id, fromStoreId: storeOf(mys.id, 'main').id, toStoreId: storeOf(mys.id, 'bar').id, note: 'Restock the bar shelf', createdBy: manager, createdAt: daysAgo(1) },
  ]);

  // ---------- Approvals ----------
  const [menuItem] = await tx.select().from(t.menuItem).where(eq(t.menuItem.outletId, blr.id)).limit(1);
  await tx.insert(t.approvalRequest).values([
    { outletId: blr.id, type: 'price_change', entity: 'menu_item', entityId: menuItem.id, current: { sellingPrice: menuItem.sellingPrice }, proposed: { sellingPrice: rupees(dec(menuItem.sellingPrice).times(1.08)) }, reason: 'Vendor rates went up this month', status: 'pending', proposedBy: manager },
    { outletId: blr.id, type: 'wastage', entity: 'stock_item', entityId: byName('Tomato').id, proposed: { qty: 3000, unit: 'g' }, reason: 'Crate spoiled in the heat', status: 'pending', proposedBy: store },
    { outletId: blr.id, type: 'count_correction', entity: 'stock_count', proposed: { adjust: 'bar count' }, reason: 'Bar count was short by one bottle', status: 'approved', proposedBy: store, decidedBy: owner, decidedAt: daysAgo(7), decisionNote: 'Checked against the pour log' },
    { outletId: mys.id, type: 'bill_cancel', entity: 'bill', proposed: { cancel: true }, reason: 'Guest left before the order was served', status: 'rejected', proposedBy: cashier, decidedBy: owner, decidedAt: daysAgo(3), decisionNote: 'Food was already prepared' },
  ]);

  // ---------- Day close: the real totals of the last few settled days ----------
  for (const o of outlets) {
    let closed = 0;
    for (let ago = 5; ago >= 1 && closed < 4; ago--) {
      const date = istDate(daysAgo(ago));
      const totals = await dayTotals(tx, o.id, date);
      if (totals.openBills > 0) continue;
      const reg = await liquorRegister(tx, o.id, date);
      const cash = Number(totals.byMode.cash ?? 0);
      const counted = rupees(dec(cash).plus(closed === 1 ? -150 : 0));
      await tx.insert(t.dayClose).values({
        outletId: o.id, businessDate: date, closedBy: manager, closedAt: daysAgo(ago - 1), cashCounted: counted,
        totals: { ...totals, cashCounted: counted, cashDifference: rupees(dec(counted).minus(cash)), liquorRegister: reg.rows.map((r: any) => ({ name: r.name, closingMl: r.ml.closing, closingBottles: r.bottles.closing, salesMl: r.ml.sales })) },
        notes: closed === 1 ? 'Cash short, change given to a guest' : null,
      });
      closed++;
    }
  }

  // ---------- Guest orders from the QR menu ----------
  const tables = await tx.select().from(t.diningTable).where(eq(t.diningTable.outletId, blr.id)).orderBy(asc(t.diningTable.sortOrder)).limit(4);
  const dishes = await tx.select().from(t.menuItem).where(and(eq(t.menuItem.outletId, blr.id), eq(t.menuItem.department, 'food'))).limit(6);
  const [aBill] = await tx.select().from(t.bill).where(eq(t.bill.outletId, blr.id)).limit(1);
  const statuses: ['pending' | 'accepted' | 'rejected', string | null][] = [['pending', null], ['pending', null], ['accepted', null], ['rejected', 'Kitchen is out of that dish']];
  for (const [i, [status, reason]] of statuses.entries()) {
    await tx.insert(t.guestOrder).values({
      outletId: blr.id, tableId: tables[i].id, clientId: crypto.randomUUID(),
      lines: [{ menuItemId: dishes[i].id, qty: 1 + (i % 2) }, { menuItemId: dishes[i + 1].id, qty: 1 }],
      status, reason, billId: status === 'accepted' ? aBill.id : null, decidedBy: status === 'pending' ? null : cashier, decidedAt: status === 'pending' ? null : daysAgo(0),
      createdAt: new Date(Date.now() - (i + 1) * 600_000),
    });
  }

  // ---------- Activity feed ----------
  await tx.insert(t.activity).values([
    { outletId: blr.id, at: daysAgo(9), kind: 'delivery', title: 'Delivery received', message: 'Green Valley Agro delivered tomatoes, onions and potatoes. All accepted.' },
    { outletId: blr.id, at: daysAgo(6), kind: 'delivery', title: 'Delivery received', message: 'Heritage Farms & Dairy delivered paneer and chicken; two units were short.' },
    { outletId: blr.id, at: daysAgo(3), kind: 'delivery_held', title: 'Delivery held', message: 'Maharaja Grains rate for cooking oil is higher than the last rate. Waiting for a manager.' },
    { outletId: blr.id, at: daysAgo(2), kind: 'sold_out', title: 'Sold out', message: 'Royal Stag bottle ran out.' },
    { outletId: blr.id, at: daysAgo(1), kind: 'day_closed', title: 'Day closed', message: 'Yesterday was closed with all bills settled.' },
    { outletId: mys.id, at: daysAgo(2), kind: 'price_flag', title: 'Margin flag', message: 'Paneer Tikka margin fell below its target after a rate change.' },
    { outletId: mys.id, at: daysAgo(1), kind: 'back_in_stock', title: 'Back in stock', message: 'Sweet Corn Soup is available again.' },
  ]);

  log('Extra sample data added: deliveries, GRNs, payments, returns, counts, transfers, approvals, day close, guest orders, activity.');
}

// The first two deliveries carry a return note.
const i0 = (n: number) => n < 2;
