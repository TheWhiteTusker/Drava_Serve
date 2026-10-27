import { useState } from 'react';
import { slugify } from '@fnb/shared';
import { can, useApi, useCurrentOutlet, useSession } from '../../api';
import { useLiveReload } from '../../live';
import { useRecordPath } from '../../routing';
import { BackButton, Badge, Empty, ErrorNote, Modal, Page, rupee, SearchBox } from '../../ui';
import { STATUS_LABEL, STATUS_TONE, fmtQty } from './format';
import { TransferForm, WastageForm } from './stock-forms';
import { Ledger } from './ledger';

// /stock is live stock by store; /stock/<item> is one item's movements.
export function StockPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const [dept, setDept] = useState<'food' | 'beverage'>('food');
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<'all' | keyof typeof STATUS_LABEL>('all');
  const stock = useApi<any>(outletId ? `/inventory/stock?outletId=${outletId}&department=${dept}` : null);
  const [dialog, setDialog] = useState<null | 'wastage' | 'transfer'>(null);
  const rec = useRecordPath();
  const all = useApi<any[]>(rec.slug ? '/stock-items' : null);
  useLiveReload(['stock'], stock.reload);
  if (!outletId) return null;
  const items = (stock.data?.items ?? []).filter((i: any) => (status === 'all' || i.status === status) && i.name.toLowerCase().includes(filter.toLowerCase()));
  const stores = stock.data?.stores ?? [];
  const totalValue = items.reduce((a: number, i: any) => a + Number(i.value ?? 0), 0);

  if (rec.slug) {
    const item = all.data?.find((x) => slugify(x.name) === rec.slug);
    return (
      <Page eyebrow="Stock" title={item ? `Movements: ${item.name}` : 'Movements'} actions={<BackButton onClick={rec.close} label="All stock" />}>
        {item ? <Ledger outletId={outletId} item={item} /> : all.data ? <Empty title="No stock item at this address" /> : <p className="muted">Loading…</p>}
      </Page>
    );
  }

  return (
    <Page
      title="Stock"
      intro="Live stock by store. Every change is a ledger entry; open an item to see its movements. Updates arrive as they happen."
      actions={
        <>
          {can(s, 'inventory.wastage', outletId) && (
            <button className="secondary" onClick={() => setDialog('wastage')}>
              Record wastage
            </button>
          )}
          {can(s, 'inventory.transfer', outletId) && <button className="gold" onClick={() => setDialog('transfer')}>Transfer</button>}
        </>
      }
    >
      <div className="toolbar" style={{ marginBottom: '1.25rem' }}>
        <div className="tabs" role="tablist" style={{ margin: 0 }}>
          {(['food', 'beverage'] as const).map((d) => (
            <button key={d} role="tab" aria-selected={dept === d} className={dept === d ? '' : 'ghost'} onClick={() => setDept(d)}>
              {d === 'food' ? 'Food' : 'Beverage'}
            </button>
          ))}
          {(['all', 'reorder', 'critical', 'out', 'healthy'] as const).map((x) => (
            <button key={x} role="tab" aria-selected={status === x} className={status === x ? 'secondary' : 'ghost'} onClick={() => setStatus(x)}>
              {x === 'all' ? 'All' : STATUS_LABEL[x]}
            </button>
          ))}
        </div>
        <SearchBox placeholder="Search stock items…" value={filter} onChange={setFilter} />
        {stock.data?.items.some((i: any) => i.value != null) && <span className="badge gold">Total value: {rupee(totalValue)}</span>}
      </div>
      <ErrorNote error={stock.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              {stores.map((st: any) => (
                <th key={st.id}>{st.name}</th>
              ))}
              <th>Total</th>
              <th>Par</th>
              <th>Status</th>
              {items.some((i: any) => i.value != null) && <th>Value</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((i: any) => (
              <tr key={i.id}>
                <td>
                  <button className="ghost" style={{ padding: 0, minHeight: 0 }} onClick={() => rec.open(slugify(i.name))}>
                    {i.name}
                  </button>
                </td>
                {stores.map((st: any) => (
                  <td key={st.id}>{i.byStore[st.id] ? fmtQty(i.byStore[st.id], i.baseUnit) : <span className="muted">—</span>}</td>
                ))}
                <td>
                  <strong>{fmtQty(i.total, i.baseUnit)}</strong>
                  {i.bottleSizeMl && <div className="muted">{(Number(i.total) / Number(i.bottleSizeMl)).toFixed(2)} bottles</div>}
                </td>
                <td>{i.levels ? fmtQty(i.levels.parLevel, i.baseUnit) : '—'}</td>
                <td>
                  <Badge tone={STATUS_TONE[i.status as keyof typeof STATUS_TONE]}>{STATUS_LABEL[i.status as keyof typeof STATUS_LABEL]}</Badge>
                </td>
                {i.value != null && <td>{rupee(i.value)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {stock.data && !items.length && <Empty title="Nothing matches">Try another status or search word.</Empty>}
      </div>
      <Modal open={dialog === 'wastage'} title="Record wastage" onClose={() => setDialog(null)}>
        <WastageForm outletId={outletId} stores={stores} onDone={() => (setDialog(null), stock.reload())} />
      </Modal>
      <Modal open={dialog === 'transfer'} title="Transfer between stores" onClose={() => setDialog(null)} wide>
        <TransferForm stores={stores} onDone={() => (setDialog(null), stock.reload())} />
      </Modal>
    </Page>
  );
}
