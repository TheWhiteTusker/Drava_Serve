import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Permission } from '@fnb/shared';

export interface Session {
  token: string;
  user: { id: string; name: string; login: string };
  customer: { code: string; name: string };
  outlets: { id: string; name: string; code: string }[];
  grants: { outletId: string | null; permission: string }[];
}

const KEY = 'fnb.session';
const read = <T,>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null');
  } catch {
    return null;
  }
};

// One id per browser, sent with every request so the audit trail records the device.
export const deviceId = (() => {
  let id = localStorage.getItem('fnb.device');
  if (!id) localStorage.setItem('fnb.device', (id = crypto.randomUUID()));
  return id;
})();

let session = read<Session>(KEY);
const listeners = new Set<() => void>();
export function setSession(s: Session | null) {
  session = s;
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}
export const useSession = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => session,
  );

// Mirrors the API rule, only to tidy the screen. The API enforces it regardless.
export function can(s: Session | null, perm: Permission, outletId?: string | null) {
  return !!s?.grants.some(
    (g) => g.permission === perm && (outletId === undefined || g.outletId === null || (outletId !== null && g.outletId === outletId)),
  );
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      'x-device-id': deviceId,
      ...(session ? { authorization: `Bearer ${session.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && session && !path.startsWith('/auth/')) setSession(null);
  if (!res.ok) throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
  return data as T;
}

export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload };
}

// The outlet the admin is looking at, remembered per browser.
const OUTLET_KEY = 'fnb.outlet';
const outletListeners = new Set<() => void>();
export function setCurrentOutlet(id: string) {
  localStorage.setItem(OUTLET_KEY, id);
  outletListeners.forEach((l) => l());
}
export function useCurrentOutlet() {
  const s = useSession();
  const stored = useSyncExternalStore(
    (l) => (outletListeners.add(l), () => outletListeners.delete(l)),
    () => localStorage.getItem(OUTLET_KEY),
  );
  return s?.outlets.find((o) => o.id === stored)?.id ?? s?.outlets[0]?.id ?? null;
}

// Files behind sign-in (PDFs, photos, CSV exports).
export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`/api${path}`, {
    headers: { 'x-device-id': deviceId, ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
  });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? `Request failed (${res.status})`);
  return res.blob();
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
