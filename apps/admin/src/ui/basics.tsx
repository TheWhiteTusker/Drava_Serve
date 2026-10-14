import type { ReactNode } from 'react';
import { AlertCircle, Inbox } from 'lucide-react';

// ---------- Small pieces ----------

export function Page({ title, eyebrow, intro, actions, children }: { title: ReactNode; eyebrow?: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {intro && <p className="muted">{intro}</p>}
        </div>
        <div className="row">{actions}</div>
      </header>
      {children}
    </section>
  );
}

export function ErrorNote({ error }: { error?: string | null }) {
  return error ? (
    <p className="note danger" role="alert">
      <AlertCircle className="icon" aria-hidden /> {error}
    </p>
  ) : null;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden>
        <Inbox className="icon" />
      </span>
      <strong>{title}</strong>
      {children && <div>{children}</div>}
      {action && <div style={{ marginTop: '1rem' }}>{action}</div>}
    </div>
  );
}

export function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} aria-hidden>
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}>
              <div className="skeleton" style={{ width: `${50 + ((i * 7 + j * 13) % 40)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
