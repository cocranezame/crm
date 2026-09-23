// Tiempo real con Socket.IO. Cada socket se autentica con el JWT y entra a:
//   empresa:<empresa_id>  → eventos del CRM (mensajes, conversaciones, tablero)
//   usuario:<usuario_id>  → eventos personales (chat interno)
import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { ENV } from '../config/env';
import { pool } from '../db/pool';
import { verificarToken } from '../middlewares/auth';

let io: Server | null = null;

export function iniciarRealtime(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: ENV.WEB_URL.split(','), credentials: true }, path: '/socket.io' });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('no_autenticado'));
      const p = verificarToken(token);
      if (!p.emp) return next(new Error('sin_empresa'));
      const { rows } = await pool.query('SELECT 1 FROM app.miembros WHERE usuario_id = $1 AND empresa_id = $2 AND activo', [p.sub, p.emp]);
      if (!rows[0]) return next(new Error('prohibido'));
      socket.data.usuarioId = p.sub;
      socket.data.empresaId = p.emp;
      next();
    } catch {
      next(new Error('token_invalido'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`empresa:${socket.data.empresaId}`);
    socket.join(`usuario:${socket.data.usuarioId}`);
    // "escribiendo…" en la bandeja: se reenvía al resto del equipo
    socket.on('conversacion:escribiendo', (d: { conversacion_id: number }) => {
      socket.to(`empresa:${socket.data.empresaId}`).emit('conversacion:escribiendo', { ...d, usuario_id: socket.data.usuarioId });
    });
  });

  return io;
}

export function emitirEmpresa(empresaId: string, evento: string, data: unknown): void {
  io?.to(`empresa:${empresaId}`).emit(evento, data);
}

export function emitirUsuarios(usuarioIds: string[], evento: string, data: unknown): void {
  if (!io || !usuarioIds.length) return;
  io.to(usuarioIds.map((u) => `usuario:${u}`)).emit(evento, data);
}
