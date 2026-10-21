import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { businessDate } from '@fnb/shared';
import { useApi, useCurrentOutlet } from '../../api';
import { useLiveReload } from '../../live';
import { Badge, ErrorNote, Page } from '../../ui';
import { GRN_STATUS } from './shared';

const STAGE_TONES: Record<string, 'neutral' | 'warning' | 'gold' | 'success'> = {
  expected: 'neutral',
  gate_checked: 'warning',
  rechecked: 'gold',
  closed: 'success',
};

// ---------- Deliveries and goods received notes ----------

// A delivery's goods received note opens at its own address under Accounts.
export function DeliveriesPage() {
  const outletId = useCurrentOutlet();
  const [date, setDate] = useState(businessDate(new Date()));
  const list = useApi<any[]>(outletId ? `/deliveries?outletId=${outletId}&date=${date}` : null);
  const go = useNavigate();
  useLiveReload(['stock'], list.reload);
  return (
    <Page
      title="Deliveries"
      intro="This morning's deliveries as they move through the gate check, the staff re-check and the goods received note. The watchman and staff use the receiving app on their phones at /receiving/."
      actions={<input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />}
    >
      <ErrorNote error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Items</th>
              <th>Stage</th>
              <th>Goods received note</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((d) => (
              <tr key={d.id}>
                <td><strong>{d.vendor}</strong></td>
                <td>{d.lineCount}</td>
                <td>
                  <Badge tone={STAGE_TONES[d.status] ?? 'neutral'}>
                    {{ expected: 'At the gate', gate_checked: 'Re-check', rechecked: 'Signatures', closed: 'Done' }[d.status as string]}
                  </Badge>
                </td>
                <td>
                  {d.grn ? (
                    <button className="link" onClick={() => go(`/accounts/${d.grn.id}`)}>
                      {d.grn.number} · {GRN_STATUS[d.grn.status]?.[0]}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No deliveries on this date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
