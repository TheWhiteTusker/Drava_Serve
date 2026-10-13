import { useState } from 'react';
import { api, can, useApi, useCurrentOutlet, useSession } from '../../api';
import { ErrorNote, Page } from '../../ui';

// ---------- Margin targets ----------

export function MarginTargetsPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const targets = useApi<any[]>(outletId ? `/margin-targets?outletId=${outletId}` : null);
  const cats = useApi<any[]>('/categories');
  const [error, setError] = useState<string | null>(null);
  if (!outletId) return null;
  const manage = can(s, 'pricing.rules', outletId);
  const value = (categoryId: string | null) => targets.data?.find((x) => x.categoryId === categoryId)?.targetPct ?? '';
  const save = (categoryId: string | null, v: string) =>
    api('/margin-targets', { method: 'PUT', body: { outletId, categoryId, targetPct: v === '' ? null : v } })
      .then(() => targets.reload())
      .catch((e) => setError(e.message));
  const rows = [{ id: null, name: 'Whole outlet (default)' }, ...(cats.data ?? []).filter((c) => c.kind === 'course' || c.kind === 'liquor_type')];
  return (
    <Page title="Margin targets" intro="The most specific target wins: a dish's own target, then its course or type, then the outlet. Dishes that fall under target after a price rise are flagged with a suggested price for a manager to approve.">
      <ErrorNote error={error ?? targets.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Applies to</th>
              <th>Target margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id ?? 'outlet'}>
                <td>{r.name}</td>
                <td>
                  <input
                    aria-label={`Target for ${r.name}`}
                    inputMode="decimal"
                    disabled={!manage}
                    defaultValue={value(r.id)}
                    key={`${r.id}-${value(r.id)}`}
                    onBlur={(e) => e.target.value !== String(value(r.id)) && save(r.id, e.target.value)}
                    style={{ maxWidth: 120 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
