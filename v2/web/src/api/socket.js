import { io } from 'socket.io-client';
import { API_BASE, getToken } from './client';

let socket = null;

export function connectSocket() {
  const token = getToken();
  if (!token) return null;
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();

  socket = io(API_BASE || undefined, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => console.log('[socket] connected'));
  socket.on('disconnect', (r) => console.log('[socket] disconnected:', r));
  socket.on('connect_error', (e) => console.warn('[socket] error:', e.message));
  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}

export function getSocket() { return socket; }
