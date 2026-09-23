'use client';
// Conexión Socket.IO única por sesión. Los eventos del API invalidan las consultas
// de React Query; las pantallas se suscriben con useEvento() para reacciones finas.
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

const useSocket = create<{ socket: Socket | null; conectado: boolean; set: (s: Partial<{ socket: Socket | null; conectado: boolean }>) => void }>((set) => ({
  socket: null, conectado: false, set: (s) => set(s),
}));

export function useConectado() { return useSocket((s) => s.conectado); }

export function RealtimeBridge() {
  const token = useAuth((s) => s.token);
  const qc = useQueryClient();
  const set = useSocket((s) => s.set);

  useEffect(() => {
    if (!token) return;
    const socket = io(API_URL, { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
    set({ socket });
    socket.on('connect', () => set({ conectado: true }));
    socket.on('disconnect', () => set({ conectado: false }));

    const inv = (k: unknown[]) => qc.invalidateQueries({ queryKey: k });
    socket.on('conversacion:actualizada', () => { inv(['conversaciones']); inv(['contadores']); });
    socket.on('mensaje:nuevo', (d: { conversacion_id: number }) => { inv(['conversacion', d.conversacion_id]); });
    socket.on('tablero:cambio', () => { inv(['tablero']); inv(['pipelines']); });
    socket.on('pipelines:cambio', () => { inv(['pipelines']); inv(['tablero']); });
    socket.on('contactos:cambio', () => { inv(['contactos']); inv(['contacto']); });
    socket.on('plantillas:cambio', () => inv(['plantillas']));
    socket.on('difusion:progreso', () => { inv(['difusiones']); inv(['difusion']); });
    socket.on('chat:mensaje', () => { inv(['chat']); });
    socket.on('chat:conversaciones', () => inv(['chat']));
    socket.on('chat:leido', () => inv(['chat']));
    return () => { socket.disconnect(); set({ socket: null, conectado: false }); };
  }, [token, qc, set]);

  return null;
}

/** Suscripción a un evento del socket mientras el componente está montado. */
export function useEvento<T = unknown>(evento: string, fn: (d: T) => void) {
  const socket = useSocket((s) => s.socket);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!socket) return;
    const h = (d: T) => ref.current(d);
    socket.on(evento, h);
    return () => { socket.off(evento, h); };
  }, [socket, evento]);
}

export function emitir(evento: string, data: unknown) {
  useSocket.getState().socket?.emit(evento, data);
}
