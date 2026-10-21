import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Ban, BadgePercent, CalendarCheck, CircleCheck, RotateCcw, TrendingDown, Truck, type LucideIcon,
} from 'lucide-react';
import { api, useCurrentOutlet } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, Page } from '../ui';
import { PriceSuggestion } from './inventory/approvals';

// The activity feed: what the system did by itself and why, newest first, updating live.

interface Entry {
  id: number;
  outletId: string | null;
  at: string;
  kind: string;
  title: string;
  message: string;
  data?: any;
}

const KIND: Record<string, { icon: LucideIcon; tone: string }> = {
  offer_started: { icon: BadgePercent, tone: 'gold' },
  offer_ended: { icon: RotateCcw, tone: 'neutral' },
  sold_out: { icon: Ban, tone: 'danger' },
  back_in_stock: { icon: CircleCheck, tone: 'success' },
  delivery: { icon: Truck, tone: 'success' },
  delivery_held: { icon: AlertTriangle, tone: 'warning' },
  price_flag: { icon: TrendingDown, tone: 'warning' },
  day_closed: { icon: CalendarCheck, tone: 'neutral' },
};

const FILTERS: [string, string][] = [
  ['', 'Everything'],
  ['offer_started,offer_ended', 'Offers'],
  ['sold_out,back_in_stock', 'Stock'],
  ['delivery,delivery_held', 'Deliveries'],
  ['price_flag', 'Prices'],
  ['day_closed', 'Day close'],
];

// "just now", "12 min ago", "3 h ago", then the date and time.
export function ago(at: string) {
  const min = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 12 * 60) return `${Math.floor(min / 60)} h ago`;
  return new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function ActivityList({ outletId, kind = '', limit = 50, compact = false }: { outletId: string | null; kind?: string; limit?: number; compact?: boolean }) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const query = useCallback(
    (before?: number) => `/activity?limit=${limit}${outletId ? `&outletId=${outletId}` : ''}${kind ? `&kind=${kind}` : ''}${before ? `&before=${before}` : ''}`,
    [outletId, kind, limit],
  );
  useEffect(() => {
    setRows(null);
    api<Entry[]>(query())
      .then((r) => {
        setRows(r);
        setMore(r.length === limit);
      })
      .catch((e) => setError(e.message));
  }, [query, limit]);
  // New entries arrive over the live connection and go straight to the top.
  useLive(['activity'], (_e, row: Entry) => {
    if ((outletId && row.outletId !== outletId) || (kind && !kind.split(',').includes(row.kind))) return;
    setRows((r) => (r && !r.some((x) => x.id === row.id) ? [row, ...r].slice(0, compact ? limit : undefined) : r));
  });
  // Keep "5 min ago" fresh.
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  if (error) return <ErrorNote error={error} />;
  if (!rows) return <div className="skeleton" style={{ height: 120 }} />;
  if (!rows.length) return <Empty title="Nothing yet">Offers, sold-out dishes, deliveries and price suggestions will appear here as they happen.</Empty>;
  return (
    <>
      <ol className="feed">
        {rows.map((e) => {
          const k = KIND[e.kind] ?? { icon: CircleCheck, tone: 'neutral' };
          return (
            <li key={e.id}>
              <span className={`feed-icon ${k.tone}`} aria-hidden>
                <k.icon className="icon" />
              </span>
              <div>
                <div className="feed-head">
                  <strong>{e.title}</strong>
                  <time dateTime={e.at} title={new Date(e.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}>
                    {ago(e.at)}
                  </time>
                </div>
                <p>{e.message}</p>
                {!compact && e.kind === 'price_flag' && e.data?.suggested && <PriceSuggestion previous={e.data.previous} current={e.data.current} suggested={e.data.suggested} />}
              </div>
            </li>
          );
        })}
      </ol>
      {!compact && more && (
        <button
          className="secondary"
          style={{ marginTop: '0.75rem' }}
          onClick={() =>
            api<Entry[]>(query(rows.at(-1)!.id)).then((older) => {
              setRows([...rows, ...older]);
              setMore(older.length === limit);
            })
          }
        >
          Show older
        </button>
      )}
    </>
  );
}

// Dashboard card: the latest few, with a link to the full page.
export function ActivityCard({ outletId }: { outletId: string | null }) {
  return (
    <section className="card block">
      <div className="row between" style={{ marginBottom: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>Activity</h2>
        <Link to="/activity">See all</Link>
      </div>
      <ActivityList outletId={outletId} limit={6} compact />
    </section>
  );
}

export function ActivityPage() {
  const outletId = useCurrentOutlet();
  const [kind, setKind] = useState('');
  return (
    <Page
      eyebrow="Overview"
      title="Activity"
      intro="What happened and why, in plain words: offers starting and ending (and which drink ran low), dishes selling out or coming back, deliveries, price suggestions and day close. It updates as things happen."
    >
      <div className="tabs" role="tablist">
        {FILTERS.map(([k, label]) => (
          <button key={label} role="tab" aria-selected={kind === k} className={kind === k ? '' : 'ghost'} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <section className="card">
        <ActivityList key={`${outletId}-${kind}`} outletId={outletId} kind={kind} />
      </section>
    </Page>
  );
}
