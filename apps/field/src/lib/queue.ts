import { useEffect, useSyncExternalStore } from 'react';
import type { SessionStore } from './session';

// Offline queue in IndexedDB. Every change the app makes goes through here: it is stored on the
// device first and sent in order when the connection allows. The API makes each request
// idempotent (client ids, or "set this line to …"), so a resend after a lost reply is harmless.

export type QueueItem =
  | { kind: 'json'; method: string; path: string; body?: unknown; label: string }
  | { kind: 'upload'; path: string; fields: Record<string, string>; file: Blob; filename: string; label: string };

interface Stored {
  id?: number;
  item: QueueItem;
  at: number;
}

function openDb(name: string) {
  return new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(`fnb-${name}`, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('q', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function createQueue(name: string, session: SessionStore) {
  const dbp = openDb(name);
  const store = async (mode: IDBTransactionMode) => (await dbp).transaction('q', mode).objectStore('q');
  let state = { pending: 0, online: navigator.onLine, sending: false, failed: [] as { label: string; message: string }[] };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const count = async () => update({ pending: await req((await store('readonly')).count()) });

  async function send(item: QueueItem) {
    if (item.kind === 'json') return session.api(item.path, { method: item.method, body: item.body ?? {} });
    const form = new FormData();
    Object.entries(item.fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', item.file, item.filename);
    return session.api(item.path, { form });
  }

  let flushing: Promise<void> | null = null;
  async function flushOnce() {
    if (!session.get()) return;
    update({ sending: true });
    try {
      for (;;) {
        const all = (await req((await store('readonly')).getAll())) as Stored[];
        const next = all[0];
        if (!next) break;
        try {
          await send(next.item);
          update({ online: true });
        } catch (e: any) {
          if (!e.status || e.status >= 500 || e.status === 401) {
            // Network down, server busy or signed out: keep it and try later.
            update({ online: !!e.status });
            break;
          }
          // Refused by the server (e.g. already done, or not allowed): drop it and say so.
          update({ failed: [...state.failed, { label: next.item.label, message: e.message }].slice(-20) });
        }
        await req((await store('readwrite')).delete(next.id!));
        await count();
      }
    } finally {
      update({ sending: false });
      await count();
    }
  }
  const flush = () => (flushing ??= flushOnce().finally(() => (flushing = null)));

  window.addEventListener('online', () => (update({ online: true }), flush()));
  window.addEventListener('offline', () => update({ online: false }));
  setInterval(flush, 15_000);
  count().then(flush);

  return {
    async add(item: QueueItem) {
      await req((await store('readwrite')).add({ item, at: Date.now() } satisfies Stored));
      await count();
      void flush();
    },
    flush,
    state: () => state,
    clearFailed: () => update({ failed: [] }),
    use: () =>
      useSyncExternalStore(
        (l) => (listeners.add(l), () => listeners.delete(l)),
        () => state,
      ),
  };
}

// Re-run a loader whenever the queue empties (our changes have reached the server).
export function useWhenSynced(pending: number, fn: () => void) {
  useEffect(() => {
    if (pending === 0) fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
}
