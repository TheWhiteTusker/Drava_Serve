import { useState } from 'react';
import { api, useApi } from '../../api';
import { Badge, ErrorNote, rupee } from '../../ui';
import { fmtQty } from './format';

export function CountSheet({ id }: { id: string }) {
  const count = useApi<any>(`/inventory/counts/${id}`);
  const [edits, setEdits] = useState<Record<string, { countedQty: string; cause: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const c = count.data;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      await count.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = () =>
    run(() =>
      api(`/inventory/counts/${id}/lines`, {
        method: 'PUT',
        body: Object.entries(edits).map(([stockItemId, v]) => ({ stockItemId, countedQty: v.countedQty === '' ? null : v.countedQty, cause: v.cause || null })),
      }),
    );
  if (!c) return <ErrorNote error={count.error} />;
  return (
    <>
      <p>
        {c.scheduledFor} · <Badge>{c.status}</Badge>
      </p>
      {c.status === 'scheduled' && <button onClick={() => run(() => api(`/inventory/counts/${id}/start`, { method: 'POST' }))}>Start counting</button>}
      {c.lines.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Books say</th>
                <th>Counted</th>
                <th>Variance</th>
                <th>Cause</th>
              </tr>
            </thead>
            <tbody>
              {c.lines.map((l: any) => (
                <tr key={l.stockItemId}>
                  <td>{l.name}</td>
                  <td>{fmtQty(l.expectedQty, l.unit)}</td>
                  <td>
                    {c.status === 'counting' ? (
                      <input
                        aria-label={`Counted ${l.name}`}
                        inputMode="decimal"
                        defaultValue={l.countedQty ?? ''}
                        onChange={(e) => setEdits({ ...edits, [l.stockItemId]: { cause: edits[l.stockItemId]?.cause ?? l.cause ?? '', countedQty: e.target.value } })}
                      />
                    ) : (
                      fmtQty(l.countedQty, l.unit)
                    )}
                  </td>
                  <td>
                    {l.variance != null && Number(l.variance) !== 0 ? (
                      <span style={{ color: 'var(--brand-danger)' }}>
                        {fmtQty(l.variance, l.unit)} {l.varianceValue && `(${rupee(l.varianceValue)})`}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {c.status === 'counting' ? (
                      <input
                        aria-label={`Cause for ${l.name}`}
                        defaultValue={l.cause ?? ''}
                        onChange={(e) => setEdits({ ...edits, [l.stockItemId]: { countedQty: edits[l.stockItemId]?.countedQty ?? l.countedQty ?? '', cause: e.target.value } })}
                      />
                    ) : (
                      l.cause
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorNote error={error} />
      {c.status === 'counting' && (
        <footer className="row end">
          <button className="secondary" onClick={save}>
            Save counts
          </button>
          <button onClick={() => run(async () => (await save(), api(`/inventory/counts/${id}/submit`, { method: 'POST' })))}>Submit for approval</button>
        </footer>
      )}
    </>
  );
}
