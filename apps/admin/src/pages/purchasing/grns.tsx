import { useState } from 'react';
import { istDate } from '@fnb/shared';
import { apiBlob, can, saveBlob, useApi, useCurrentOutlet, useSession } from '../../api';
import { useRecordPath } from '../../routing';
import { BackButton, ErrorNote, Page, rupee } from '../../ui';
import { GRN_STATUS } from './shared';
import { GrnDetail } from './grn-detail';

// /accounts lists goods received notes by status; /accounts/<id> is one note.
export function GrnsPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const [status, setStatus] = useState('approved');
  const list = useApi<any[]>(outletId ? `/grns?outletId=${outletId}&status=${status}` : null);
  const rec = useRecordPath();
  const [range, setRange] = useState({ from: istDate(new Date(Date.now() - 30 * 86_400_000)), to: istDate(new Date()) });
  if (!outletId) return null;
  if (rec.slug) {
    return (
      <Page eyebrow="Bills to pay" title="Delivery receipt" actions={<BackButton onClick={() => (rec.close(), list.reload())} label="All notes" />}>
        <GrnDetail id={rec.slug} />
      </Page>
    );
  }
  async function exportCsv() {
    saveBlob(await apiBlob(`/grns/export/csv?outletId=${outletId}&from=${range.from}&to=${range.to}`), `goods-received-${range.from}-to-${range.to}.csv`);
  }
  return (
    <Page
      title="Bills to pay"
      intro="Each delivery appears here once the gate and the kitchen have both checked it. If a price went up, a manager must approve it before you can pay."
      actions={
        <>
          <input type="date" aria-label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <input type="date" aria-label="To" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <button className="secondary" onClick={exportCsv}>
            Export CSV
          </button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {['approved', 'held_rate', 'awaiting_signoff', 'paid'].map((x) => (
          <button key={x} role="tab" aria-selected={status === x} className={status === x ? '' : 'ghost'} onClick={() => setStatus(x)}>
            {GRN_STATUS[x][0]}
          </button>
        ))}
      </div>
      <ErrorNote error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Note</th>
              <th>Received</th>
              <th>Vendor</th>
              <th>Bill</th>
              <th>Returns</th>
              <th>Payable</th>
              <th>Paid</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((g) => (
              <tr key={g.id}>
                <td><strong>{g.number}</strong></td>
                <td>{istDate(new Date(g.createdAt))}</td>
                <td>{g.vendor}</td>
                <td className="num">{rupee(g.amountGross)}</td>
                <td className="num">{Number(g.returnDeduction) ? `− ${rupee(g.returnDeduction)}` : '—'}</td>
                <td className="num">
                  <strong>{rupee(g.amountPayable)}</strong>
                </td>
                <td className="num">{rupee(g.paid)}</td>
                <td className="actions">
                  <button className="link" onClick={() => rec.open(g.id)}>
                    {can(s, 'accounts.pay', outletId) && g.status === 'approved' ? 'Record payment' : 'Open'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
