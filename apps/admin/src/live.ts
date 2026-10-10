import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useSession } from './api';

// One live connection per signed-in session; screens subscribe to the events they show.
let socket: Socket | null = null;
let socketToken: string | null = null;

function connect(token: string) {
  if (socket && socketToken === token) return socket;
  socket?.close();
  socketToken = token;
  socket = io({ path: '/api/socket', auth: { token }, transports: ['websocket', 'polling'] });
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
