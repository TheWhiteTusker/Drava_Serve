import { useEffect, useState } from 'react';
import { istDate } from '@fnb/shared';
import { rupee } from '../lib/ui';
import { session } from './device';
import { Dialog } from './dialog';

export function DayClose({ outletId, onClose }: { outletId: string; onClose: () => void }) {
  const [date, setDate] = useState(() => {
    const d = new Date(Date.now() - 5 * 3600_000);
    return istDate(d);
  });
  const [data, setData] = useState<any>(null);
  const [cash, setCash] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    session.api(`/pos/day-close?outletId=${outletId}&date=${date}`).then(setData).catch((e) => setError(e.message));
  }, [outletId, date]);
  const t = data?.totals;
  async function close() {
    try {
      const r = await session.api('/pos/day-close', { body: { outletId, businessDate: date, cashCounted: cash || null } });
      setData({ closed: r, totals: r.totals });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog title="Day close" onClose={onClose}>
      <label className="field">
        Business day
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {t && (
        <table className="sums">
          <tbody>
            <tr><td>Bills</td><td>{t.bills}</td></tr>
            <tr><td>Food sales</td><td>{rupee(t.foodSales)}</td></tr>
            <tr><td>Food tax</td><td>{rupee(t.foodTax)}</td></tr>
            <tr><td>Liquor sales</td><td>{rupee(t.liquorSales)}</td></tr>
            <tr><td>Liquor tax</td><td>{rupee(t.liquorTax)}</td></tr>
            <tr><td>Discounts</td><td>{rupee(t.discounts)}</td></tr>
            <tr><td><strong>Total</strong></td><td><strong>{rupee(t.total)}</strong></td></tr>
            {Object.entries(t.byMode).map(([k, v]) => (
              <tr key={k}><td>{k.toUpperCase()}</td><td>{rupee(v as string)}</td></tr>
            ))}
            <tr><td>Cancelled / refunded</td><td>{t.cancelled} / {t.refunded}</td></tr>
            {t.openBills > 0 && <tr><td colSpan={2} className="note danger">{t.openBills} bill(s) still open</td></tr>}
            {t.cashDifference && <tr><td>Cash difference</td><td>{rupee(t.cashDifference)}</td></tr>}
          </tbody>
        </table>
      )}
      {data?.closed ? (
        <p className="note">Closed. The liquor register for the day is closed too.</p>
      ) : (
        <div className="stack">
          <label className="field">
            Cash counted in the drawer
            <input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
          </label>
          <button className="huge" onClick={close} disabled={t?.openBills > 0}>
            Close the day
          </button>
        </div>
      )}
      {error && <p className="note danger">{error}</p>}
    </Dialog>
  );
}

// Orders guests sent from the QR code at their table. Nothing is on a bill until accepted here.
