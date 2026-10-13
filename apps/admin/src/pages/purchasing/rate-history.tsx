import { useState } from 'react';
import { useApi } from '../../api';
import { Page, rupee } from '../../ui';

export function RateHistory() {
  const [dept, setDept] = useState('food');
  const rates = useApi<any[]>(`/vendor-rates?department=${dept}`);
  return (
    <Page title="Rate history" intro="Every billed rate from vendors' bills, newest first. The latest rate drives menu costing.">
      <div className="tabs" role="tablist">
        {['food', 'beverage'].map((d) => (
          <button key={d} role="tab" aria-selected={dept === d} className={dept === d ? '' : 'ghost'} onClick={() => setDept(d)}>
            {d === 'food' ? 'Food' : 'Beverage'}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Vendor</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {(rates.data ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.billedOn}</td>
                <td>{r.item}</td>
                <td>{r.vendor}</td>
                <td>
                  {rupee(r.rate)} <span className="muted">/ {r.unit ?? 'unit'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
