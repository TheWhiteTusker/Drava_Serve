import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useSession } from './api';

// One live connection per signed-in session; screens subscribe to the events they show.
let socket: Socket | null = null;
let socketToken: string | null = null;

function connect(token: string) {
  if (socket && socketToken === token) return socket;
  socket?.close();
  socketToken = token;
  socket = io({ path: '/api/socket', auth: { token }, transports: ['websocket'] });
  return socket;
}

export function useLive(events: string[], onEvent: (event: string, data: any) => void) {
  const s = useSession();
  useEffect(() => {
    if (!s) return;
    const sock = connect(s.token);
    const handlers = events.map((e) => [e, (d: any) => onEvent(e, d)] as const);
    handlers.forEach(([e, h]) => sock.on(e, h));
    return () => handlers.forEach(([e, h]) => sock.off(e, h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.token, events.join(',')]);
}

// For screens that just reload: a burst of events (one payment moves many stock items) becomes
// one reload a moment later instead of one per event.
export function useLiveReload(events: string[], reload: () => unknown, waitMs = 2000) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
  useLive(events, () => {
    timer.current ??= setTimeout(() => {
      timer.current = null;
      latest.current();
    }, waitMs);
  });
}
