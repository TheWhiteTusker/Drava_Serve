import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { api, can, useApi, useSession } from '../../api';
import { AskDialog, Badge, Empty, ErrorNote, toast } from '../../ui';
import { fmtQty } from './format';

export const MOVE_LABEL: Record<string, string> = {
  opening: 'Opening', goods_receipt: 'Goods receipt', sale: 'Sale', transfer_out: 'Transfer out', transfer_in: 'Transfer in',
  wastage: 'Wastage', spillage: 'Spillage', breakage: 'Breakage', complimentary: 'Complimentary', staff_meal: 'Staff meal',
  count_correction: 'Count correction', return_to_vendor: 'Return to vendor', reversal: 'Reversal',
};

const MOVE_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'gold'> = {
  opening: 'neutral',
  goods_receipt: 'success',
  sale: 'neutral',
  transfer_in: 'success',
  transfer_out: 'warning',
  wastage: 'danger',
  spillage: 'danger',
  breakage: 'danger',
  complimentary: 'gold',
  staff_meal: 'warning',
  count_correction: 'warning',
  return_to_vendor: 'danger',
  reversal: 'danger',
};

export function Ledger({ outletId, item }: { outletId: string; item: any }) {
  const s = useSession();
  const rows = useApi<any[]>(`/inventory/ledger?outletId=${outletId}&stockItemId=${item.id}`);
  const [error, setError] = useState<string | null>(null);
  const [reversing, setReversing] = useState<number | null>(null);
  async function reverse(id: number, reason: string) {
    setReversing(null);
    try {
      const r = await api('/inventory/reversals', { body: { ledgerId: id, reason } });
      toast(r.status === 'pending' ? 'Reversal sent for approval' : 'Entry reversed');
      rows.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <ErrorNote error={error ?? rows.error} />
      {rows.data && rows.data.length === 0 ? (
        <Empty
          icon={<History size={24} />}
          title="No inventory movements"
        >
          <span className="muted">Movements from sales, goods receipts, transfers, and wastage will appear here.</span>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Movement</th>
                <th>Store</th>
                <th style={{ textAlign: 'right' }}>Quantity</th>
                <th style={{ textAlign: 'right' }}>Cost / unit</th>
                <th>By</th>
                <th>Reason</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {(rows.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(r.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td>
                    <Badge tone={MOVE_TONE[r.movement] ?? 'neutral'}>
                      {MOVE_LABEL[r.movement] ?? r.movement}
                    </Badge>
                  </td>
                  <td>{r.store}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 650,
                      color: Number(r.qty) < 0 ? 'var(--brand-danger)' : 'var(--brand-success)',
                    }}
                  >
                    {fmtQty(r.qty, r.unit)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.unitCost ? `₹${Number(r.unitCost).toFixed(4)}` : '—'}
                  </td>
                  <td>{r.user ?? <span className="muted">system</span>}</td>
                  <td>{r.reason || '—'}</td>
                  <td>
                    {can(s, 'inventory.wastage', outletId) && !['sale', 'reversal'].includes(r.movement) && (
                      <button className="link" onClick={() => setReversing(r.id)} style={{ color: 'var(--brand-danger)' }}>
                        <RotateCcw size={13} style={{ verticalAlign: -1, marginRight: 4 }} />
                        Reverse
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AskDialog
        open={reversing != null}
        title="Reverse this entry"
        label="Why? (for example: entered twice)"
        confirm="Reverse"
        onAnswer={(reason) => reverse(reversing!, reason)}
        onClose={() => setReversing(null)}
      />
    </>
  );
}
