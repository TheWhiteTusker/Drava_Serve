// Base units read better as kg / L once they are large.
export function fmtQty(q: string | number | null | undefined, unit: string) {
  if (q == null) return '—';
  const n = Number(q);
  if ((unit === 'g' || unit === 'ml') && Math.abs(n) >= 1000) return `${(n / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit === 'g' ? 'kg' : 'L'}`;
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit}`;
}

export const STATUS_TONE = { healthy: 'success', reorder: 'warning', critical: 'danger', out: 'danger' } as const;
export const STATUS_LABEL = { healthy: 'Healthy', reorder: 'Reorder', critical: 'Critical', out: 'Out' } as const;
