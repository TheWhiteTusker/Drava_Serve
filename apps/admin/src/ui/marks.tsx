import type { ReactNode } from 'react';

// FSSAI marks: veg = green circle in a green square; non-veg (and egg) = brown triangle in a
// brown square. Shape carries the meaning, not colour alone, and there is a text label for screen readers.
export function DietMark({ diet }: { diet?: string | null }) {
  if (!diet) return null;
  const veg = diet === 'veg';
  const label = veg ? 'Veg' : diet === 'egg' ? 'Contains egg (non-veg)' : 'Non-veg';
  const color = veg ? 'var(--mark-veg)' : 'var(--mark-nonveg)';
  return (
    <svg className="diet-mark" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label={label}>
      <title>{label}</title>
      <rect x="1" y="1" width="14" height="14" fill="none" stroke={color} strokeWidth="1.6" rx="2" />
      {veg ? <circle cx="8" cy="8" r="3.6" fill={color} /> : <path d="M8 3.8 12.2 11.6H3.8Z" fill={color} />}
    </svg>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'gold' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const opts = (rows: { id: string; name: string }[] | null | undefined) => (rows ?? []).map((r) => ({ value: r.id, label: r.name }));
export const yesNo = (b: boolean) => (b ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>);
export const rupee = (v: string | number | null | undefined) =>
  v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
