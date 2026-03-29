import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef, useCallback } from 'react';

// ════════════════════════════════════════════════════════════
// SOCKET MANAGER
// Auto-reconnects with exponential backoff
// Reconnects after: 1s, 2s, 4s, 8s, 16s, 30s (max)
// ════════════════════════════════════════════════════════════

const NOTIF_URL = import.meta.env.VITE_NOTIF_SERVICE_URL || 'http://localhost:3010';
const MAX_BACKOFF_MS = 30_000;

let _socket: Socket | null = null;
let _backoff = 1000;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _listeners: Map<string, Set<(data: unknown) => void>> = new Map();

function getSocket(userId: string): Socket {
  if (_socket?.connected) return _socket;

  _socket = io(NOTIF_URL, {
    auth: { userId },
    reconnection: false,           // we manage reconnection ourselves
    timeout: 10_000,
    transports: ['websocket', 'polling'],
  });

  _socket.on('connect', () => {
    console.log('[Socket] Connected');
    _backoff = 1000; // reset on successful connect
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  });

  _socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: ${reason}`);
    if (reason !== 'io client disconnect') {
      scheduleReconnect(userId);
    }
  });

  _socket.on('connect_error', () => {
    scheduleReconnect(userId);
  });

  // Forward all events to registered listeners
  _socket.onAny((event, data) => {
    const handlers = _listeners.get(event);
    if (handlers) handlers.forEach(fn => fn(data));
  });

  return _socket;
}

function scheduleReconnect(userId: string) {
  if (_reconnectTimer) return; // already scheduled
  console.log(`[Socket] Reconnecting in ${_backoff}ms`);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _backoff = Math.min(_backoff * 2, MAX_BACKOFF_MS);
    if (_socket) { _socket.removeAllListeners(); _socket.disconnect(); _socket = null; }
    getSocket(userId);
  }, _backoff);
}

export function disconnectSocket() {
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  if (_socket) { _socket.removeAllListeners(); _socket.disconnect(); _socket = null; }
  _backoff = 1000;
}

// ── React hook ───────────────────────────────────────────────
export function useSocket(
  userId: string | undefined,
  event: string,
  handler: (data: unknown) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!userId) return;

    const socket = getSocket(userId);
    const stableHandler = (data: unknown) => handlerRef.current(data);

    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event)!.add(stableHandler);

    return () => {
      _listeners.get(event)?.delete(stableHandler);
    };
  }, [userId, event]);
}

// ── Usage in a component: ────────────────────────────────────
//
// useSocket(user?.id, 'notification', (data) => {
//   setNotifications(prev => [data as Notification, ...prev]);
// });
//
// useSocket(user?.id, 'score.updated', (data) => {
//   queryClient.invalidateQueries({ queryKey: ['score'] });
// });
