import { dec, type BillTotals } from '@fnb/shared';
import type { Catalog, LocalBill } from './types';
import { totalsFor } from './device';

// ---------- Receipt ----------

function Mark({ diet }: { diet: string | null }) {
  if (!diet) return null;
  const veg = diet === 'veg';
  const c = veg ? '#1a8a3a' : '#7b3f12';
  const label = veg ? 'Veg' : 'Non-veg';
  return (
    <svg className="mark" width="11" height="11" viewBox="0 0 16 16" role="img" aria-label={label}>
      <rect x="1" y="1" width="14" height="14" fill="none" stroke={c} strokeWidth="2" />
      {veg ? <circle cx="8" cy="8" r="3.8" fill={c} /> : <path d="M8 3.5 12.5 12H3.5Z" fill={c} />}
    </svg>
  );
}

// The receipt shows the price charged for each item and nothing about offers.
export function Receipt({ bill, cat, cashier }: { bill: LocalBill; cat: Catalog; cashier: string }) {
  const t = bill.totals ?? totalsFor(bill, cat, false);
  const lines = bill.lines.filter((l) => l.status !== 'voided');
  const taxLines = (d: BillTotals['food']) =>
    d.taxes.map((x) => (
      <div key={x.name + x.ratePct} className="row">
        <span>
          {x.name} {x.ratePct}%
        </span>
        <span>{dec(x.amount).toFixed(2)}</span>
      </div>
    ));
  return (
    <div className="receipt" id="receipt">
      <h1>{cat.outlet.name}</h1>
      {cat.outlet.address && <p className="center">{cat.outlet.address}</p>}
      {cat.outlet.gstin && <p className="center">GSTIN {cat.outlet.gstin}</p>}
      {cat.outlet.fssaiNumber && <p className="center">FSSAI Lic. No. {cat.outlet.fssaiNumber}</p>}
      <hr />
      <div className="row">
        <span>Bill {bill.number}</span>
        <span>{bill.kind === 'takeaway' ? 'Takeaway' : `Table ${bill.table ?? ''}`}</span>
      </div>
      <div className="row">
        <span>{new Date(bill.paidAt ?? Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</span>
        <span>{cashier}</span>
      </div>
      <hr />
      {lines.map((l, i) => (
        <div key={l.id ?? i} className="row">
          <span>
            <Mark diet={l.dietType} />
            {l.name} × {dec(l.qty).toString()}
          </span>
          <span>{dec(l.qty).times(l.price).toFixed(2)}</span>
        </div>
      ))}
      <hr />
      {dec(t.food.subtotal).gt(0) && (
        <>
          <div className="row">
            <span>Food</span>
            <span>{t.food.subtotal}</span>
          </div>
          {dec(t.food.discount).gt(0) && (
            <div className="row">
              <span>Discount</span>
              <span>−{t.food.discount}</span>
            </div>
          )}
          {taxLines(t.food)}
          <div className="row">
            <span>Food total</span>
            <span>{t.food.total}</span>
          </div>
          <hr />
        </>
      )}
      {dec(t.liquor.subtotal).gt(0) && (
        <>
          <div className="row">
            <span>Liquor</span>
            <span>{t.liquor.subtotal}</span>
          </div>
          {dec(t.liquor.discount).gt(0) && (
            <div className="row">
              <span>Discount</span>
              <span>−{t.liquor.discount}</span>
            </div>
          )}
          {taxLines(t.liquor)}
          <div className="row">
            <span>Liquor total</span>
            <span>{t.liquor.total}</span>
          </div>
          <hr />
        </>
      )}
      {!dec(t.roundOff).isZero() && (
        <div className="row">
          <span>Round off</span>
          <span>{t.roundOff}</span>
        </div>
      )}
      <div className="row total">
        <span>TOTAL ₹</span>
        <span>{t.grandTotal}</span>
      </div>
      {(bill.payments ?? []).map((p, i) => (
        <div key={i} className="row">
          <span>Paid by {p.mode.toUpperCase()}</span>
          <span>{dec(p.amount).toFixed(2)}</span>
        </div>
      ))}
      <hr />
      <p className="center">
        <Mark diet="veg" /> Veg &nbsp; <Mark diet="non_veg" /> Non-veg
      </p>
      <p className="center">Thank you!</p>
    </div>
  );
}

export function receiptText(bill: LocalBill, cat: Catalog) {
  const t = bill.totals ?? totalsFor(bill, cat, false);
  const lines = bill.lines.filter((l) => l.status !== 'voided').map((l) => `${l.dietType === 'veg' ? '(Veg) ' : l.dietType ? '(Non-veg) ' : ''}${l.name} x ${dec(l.qty)}  ₹${dec(l.qty).times(l.price).toFixed(2)}`);
  return [
    cat.outlet.name, cat.outlet.fssaiNumber ? `FSSAI Lic. No. ${cat.outlet.fssaiNumber}` : '', `Bill ${bill.number}`, '', ...lines, '',
    dec(t.food.subtotal).gt(0) ? `Food ₹${t.food.subtotal} + taxes = ₹${t.food.total}` : '',
    dec(t.liquor.subtotal).gt(0) ? `Liquor ₹${t.liquor.subtotal} + taxes = ₹${t.liquor.total}` : '',
    `TOTAL ₹${t.grandTotal}`,
  ]
    .filter(Boolean)
    .join('\n');
}
