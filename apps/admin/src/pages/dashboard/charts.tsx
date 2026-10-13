import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { WEEKDAYS, num } from './shared';

// ---------- Small chart pieces ----------

function Tip({ tip }: { tip: { x: number; y: number; text: ReactNode } | null }) {
  return tip ? (
    <div className="chart-tip" role="status" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  ) : null;
}

// Ranked list with thin bars: one series, so no legend; the value sits in text beside it.
export function BarList({ rows, label }: { rows: { name: ReactNode; value: number; display: string; key: string }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted">No sales in this range.</p>;
  return (
    <ol className="barlist" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="barlist-name">{r.name}</span>
          <span className="barlist-track" aria-hidden>
            <span className="barlist-bar" style={{ width: `${(Math.max(0, r.value) / max) * 100}%` }} />
          </span>
          <span className="barlist-value">{r.display}</span>
        </li>
      ))}
    </ol>
  );
}

// Columns by hour of the day, with a hover / focus tooltip per column.
export function HourColumns({ rows, unit, label }: { rows: { hour: number; value: number; detail: string }[]; label: string; unit: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: ReactNode } | null>(null);
  const hours = rows.length ? Array.from({ length: Math.max(...rows.map((r) => r.hour)) - Math.min(...rows.map((r) => r.hour)) + 1 }, (_, i) => Math.min(...rows.map((r) => r.hour)) + i) : [];
  const max = Math.max(1, ...rows.map((r) => r.value));
  const peak = rows.reduce((a, r) => (r.value > (a?.value ?? -1) ? r : a), null as (typeof rows)[number] | null);
  if (!rows.length) return <p className="muted">No bills in this range.</p>;
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <div className="columns" role="img" aria-label={label}>
        {hours.map((h) => {
          const r = rows.find((x) => x.hour === h);
          const show = (e: React.MouseEvent | React.FocusEvent) => {
            const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const host = (e.currentTarget as HTMLElement).closest('.chart')!.getBoundingClientRect();
            setTip({ x: box.left - host.left + box.width / 2, y: box.top - host.top, text: r ? `${String(h).padStart(2, '0')}:00 · ${r.detail}` : `${String(h).padStart(2, '0')}:00 · none` });
          };
          return (
            <div key={h} className="col" tabIndex={0} onMouseEnter={show} onFocus={show} onBlur={() => setTip(null)}>
              {r && r === peak && <span className="col-label">{num(r.value)}</span>}
              <span className="col-bar" style={{ height: `${((r?.value ?? 0) / max) * 100}%` }} />
              <span className="col-hour">{h}</span>
            </div>
          );
        })}
      </div>
      <p className="muted axis-note">Hour of the day · {unit}</p>
      <Tip tip={tip} />
    </div>
  );
}

// Weekday × hour grid: one hue, light to dark with the number of units.
export function Heatmap({ cells }: { cells: { weekday: number; hour: number; units: number }[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: ReactNode } | null>(null);
  const [table, setTable] = useState(false);
  if (!cells.length) return <p className="muted">No sales in this range.</p>;
  const hours = Array.from({ length: Math.max(...cells.map((c) => c.hour)) - Math.min(...cells.map((c) => c.hour)) + 1 }, (_, i) => Math.min(...cells.map((c) => c.hour)) + i);
  const max = Math.max(...cells.map((c) => c.units));
  const at = (d: number, h: number) => cells.find((c) => c.weekday === d && c.hour === h)?.units ?? 0;
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <button className="ghost" onClick={() => setTable(!table)} style={{ float: 'right' }}>
        {table ? 'Show grid' : 'Show as table'}
      </button>
      {table ? (
        <div className="table-wrap" style={{ clear: 'both' }}>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                {hours.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((d, i) => (
                <tr key={d}>
                  <td>{d}</td>
                  {hours.map((h) => (
                    <td key={h}>{at(i + 1, h) || ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="heat" style={{ gridTemplateColumns: `3rem repeat(${hours.length}, minmax(22px, 1fr))` }} role="img" aria-label="Units sold by weekday and hour">
          <span />
          {hours.map((h) => (
            <span key={h} className="heat-hour">
              {h}
            </span>
          ))}
          {WEEKDAYS.map((d, i) => (
            <div key={d} style={{ display: 'contents' }}>
              <span className="heat-day">{d}</span>
              {hours.map((h) => {
                const u = at(i + 1, h);
                const show = (e: React.MouseEvent | React.FocusEvent) => {
                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const host = (e.currentTarget as HTMLElement).closest('.chart')!.getBoundingClientRect();
                  setTip({ x: box.left - host.left + box.width / 2, y: box.top - host.top, text: `${d} ${String(h).padStart(2, '0')}:00 · ${num(u)} sold` });
                };
                return (
                  <span
                    key={h}
                    className="heat-cell"
                    tabIndex={0}
                    onMouseEnter={show}
                    onFocus={show}
                    onBlur={() => setTip(null)}
                    style={{ background: u ? `color-mix(in oklab, var(--chart-seq-high) ${Math.round(15 + (u / max) * 85)}%, var(--chart-seq-low))` : 'var(--brand-surface-2)' }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
      <p className="muted axis-note">Darker = more sold. Busiest: {num(max)} in an hour.</p>
      <Tip tip={tip} />
    </div>
  );
}

export function Tile({ label, value, note, icon: Icon }: { label: string; value: ReactNode; note?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="tile">
      <span className="tile-label">
        {Icon && <Icon className="icon" aria-hidden />}
        {label}
      </span>
      <strong>{value}</strong>
      {note && <small className="muted">{note}</small>}
    </div>
  );
}

export function Block({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`card block${wide ? ' wide' : ''}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
