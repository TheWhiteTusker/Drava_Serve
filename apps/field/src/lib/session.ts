import { useSyncExternalStore } from 'react';
import type { Permission } from '@fnb/shared';

// Sign-in for the field apps (POS, receiving). Each app keeps its own session so a shared
// tablet can run the POS while a phone runs receiving.

export interface Session {
  token: string;
  user: { id: string; name: string; login: string };
  customer: { code: string; name: string };
  outlets: { id: string; name: string; code: string }[];
  grants: { outletId: string | null; permission: string }[];
}

export const deviceId = (() => {
  let id = localStorage.getItem('fnb.device');
  if (!id) localStorage.setItem('fnb.device', (id = crypto.randomUUID()));
  return id;
})();

export function createSession(app: string) {
  const key = `fnb.${app}.session`;
  const outletKey = `fnb.${app}.outlet`;
  let session: Session | null = (() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  })();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const set = (s: Session | null) => {
    session = s;
    if (s) localStorage.setItem(key, JSON.stringify(s));
    else localStorage.removeItem(key);
    notify();
  };
  const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

  return {
    get: () => session,
    set,
    use: () => useSyncExternalStore(subscribe, () => session),
    outletId: () => session?.outlets.find((o) => o.id === localStorage.getItem(outletKey))?.id ?? session?.outlets[0]?.id ?? null,
    setOutlet: (id: string) => (localStorage.setItem(outletKey, id), notify()),
    can: (perm: Permission, outletId?: string | null) =>
      !!session?.grants.some((g) => g.permission === perm && (outletId === undefined || g.outletId === null || g.outletId === outletId)),
    async api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
      const res = await fetch(`/api${path}`, {
        method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
        headers: {
          ...(opts.form ? {} : { 'content-type': 'application/json' }),
          'x-device-id': deviceId,
          ...(session ? { authorization: `Bearer ${session.token}` } : {}),
        },
        body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401 && session && !path.startsWith('/auth/')) set(null);
      if (!res.ok) throw Object.assign(new Error(data?.message ?? `Request failed (${res.status})`), { status: res.status, data });
      return data as T;
    },
  };
}
export type SessionStore = ReturnType<typeof createSession>;
