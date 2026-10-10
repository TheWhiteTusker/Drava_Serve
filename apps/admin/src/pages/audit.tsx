import { useState } from 'react';
import { useApi } from '../api';
import { ErrorNote, Page } from '../ui';

const IGNORE = new Set(['updated_at', 'version', 'created_at']);

// Only the fields that changed, before → after.
function diff(before: any, after: any) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !IGNORE.has(k));
  return keys
    .filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
    .map((k) => ({ k, b: before?.[k], a: after?.[k] }));
}
const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AuditPage() {
  const [entity, setEntity] = useState('');
  const log = useApi<any[]>(`/audit${entity ? `?entity=${entity}` : ''}`);
  return (
    <Page
      title="Change history"
      intro="Every change records who made it, when, on which device, and the values before and after. Entries cannot be edited or deleted."
      actions={
        <label>
          <span className="sr-only">Record type</span>
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">All records</option>
            {['menu_item', 'stock_item', 'outlet', 'app_user', 'role', 'role_permission', 'user_role', 'setting', 'tax_class', 'category', 'brand'].map((x) => (
              <option key={x} value={x}>
                {x.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <ErrorNote error={log.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Device</th>
              <th>Record</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {(log.data ?? []).map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                <td>{l.userName ?? <span className="muted">system</span>}</td>
                <td className="muted">{l.deviceId?.slice(0, 13) ?? '—'}</td>
                <td>
                  {l.entity.replace('_', ' ')} <span className="muted">· {l.action}</span>
                  <div className="muted">{(l.after ?? l.before)?.name}</div>
                </td>
                <td>
                  {l.action === 'update' ? (
                    <ul className="plain">
                      {diff(l.before, l.after).map((d) => (
                        <li key={d.k}>
                          <code>{d.k}</code>: {show(d.b)} → <strong>{show(d.a)}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="muted">{l.action === 'insert' ? 'created' : 'removed'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
