import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useApi } from '../../api';
import { Empty, Page, rupee, SearchBox } from '../../ui';

export function RateHistory() {
  const [dept, setDept] = useState('food');
  const [search, setSearch] = useState('');
  const rates = useApi<any[]>(`/vendor-rates?department=${dept}`);

  const filtered = useMemo(() => {
    const list = rates.data ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((r) => r.item?.toLowerCase().includes(q) || r.vendor?.toLowerCase().includes(q));
  }, [rates.data, search]);

  return (
    <Page title="Rate history" intro="Every billed rate from vendors' bills, newest first. The latest rate drives menu costing.">
      <div className="toolbar" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div className="tabs" role="tablist">
          {['food', 'beverage'].map((d) => (
            <button key={d} role="tab" aria-selected={dept === d} className={dept === d ? '' : 'ghost'} onClick={() => { setDept(d); setSearch(''); }}>
              {d === 'food' ? 'Food' : 'Beverage'}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, maxWidth: 360, minWidth: 200 }}>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={`Search ${dept} rate history…`}
          />
        </div>
        <span className="muted" style={{ fontSize: '0.88rem', fontWeight: 600 }}>
          {filtered.length} billed rate{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Empty
          icon={<TrendingUp size={24} />}
          title={search ? 'No matching rates found' : 'No rate history yet'}
        >
          <span className="muted">
            {search
              ? `No billed rates matched "${search}". Try clearing the search.`
              : `Billed rates for ${dept} items from vendors will appear here once Goods Received Notes are processed.`}
          </span>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Vendor</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.billedOn}</td>
                  <td><strong>{r.item}</strong></td>
                  <td>{r.vendor}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>
                    {rupee(r.rate)} <span className="muted" style={{ fontWeight: 400 }}>/ {r.unit ?? 'unit'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
