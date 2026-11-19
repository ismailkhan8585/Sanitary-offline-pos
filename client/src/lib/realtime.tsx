import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { setSession, useSession } from './session';

export interface Presence {
  deviceId: number | null;
  userName: string;
}

interface RealtimeState {
  /** True while this screen has a live link to the server. */
  connected: boolean;
  /** Who is logged in on which counter right now. */
  presence: Presence[];
}

const RealtimeContext = createContext<RealtimeState>({ connected: false, presence: [] });

/** Keeps every counter's data fresh: the server says which lists changed, we refetch them. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const qc = useQueryClient();
  const [state, setState] = useState<RealtimeState>({ connected: false, presence: [] });

  useEffect(() => {
    if (!session) return;
    const socket = io({ path: '/socket.io', auth: { token: session.token }, transports: ['websocket', 'polling'] });
    let wasDisconnected = false;
    socket.on('connect', () => {
      setState((s) => ({ ...s, connected: true }));
      // Anything may have changed while we were offline.
      if (wasDisconnected) qc.invalidateQueries();
    });
    socket.on('disconnect', () => {
      wasDisconnected = true;
      setState((s) => ({ ...s, connected: false }));
    });
    socket.on('connect_error', (err) => {
      setState((s) => ({ ...s, connected: false }));
      wasDisconnected = true;
      if (err.message === 'UNAUTHORIZED') setSession(null);
    });
    socket.on('changed', (msg: { topics: string[] }) => {
      for (const topic of msg.topics) qc.invalidateQueries({ queryKey: [topic] });
    });
    socket.on('presence', (presence: Presence[]) => setState((s) => ({ ...s, presence })));
    return () => {
      socket.close();
    };
  }, [session, qc]);

  return <RealtimeContext.Provider value={state}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
