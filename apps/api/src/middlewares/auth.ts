import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env';
import { pool } from '../db/pool';
import { HttpError, prohibido } from '../lib/http';

export type Rol = 'propietario' | 'admin' | 'supervisor' | 'agente';
const NIVEL: Record<Rol, number> = { agente: 1, supervisor: 2, admin: 3, propietario: 4 };

export interface AuthCtx {
  usuarioId:  string;
  empresaId:  string;
  rol:        Rol;
  superadmin: boolean;
  nombre:     string;
}

export interface TokenPayload { sub: string; emp: string | null }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: AuthCtx; usuarioId?: string; tokenEmpresaId?: string | null; esSuperadmin?: boolean; rawBody?: Buffer }
  }
}

export function firmarToken(usuarioId: string, empresaId: string | null): string {
  return jwt.sign({ sub: usuarioId, emp: empresaId } satisfies TokenPayload, ENV.JWT_SECRET, { expiresIn: ENV.JWT_EXPIRES } as jwt.SignOptions);
}

export function verificarToken(token: string): TokenPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as TokenPayload;
}

function tokenDe(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return null;
}

/** Solo exige usuario válido (sin empresa activa): /auth/me, /auth/cambiar-empresa, /admin. */
export async function requireUsuario(req: Request, _res: Response, next: NextFunction) {
  try {
    const t = tokenDe(req);
    if (!t) throw new HttpError(401, 'Sesión requerida', 'no_autenticado');
    let p: TokenPayload;
    try { p = verificarToken(t); } catch { throw new HttpError(401, 'Sesión vencida, vuelve a ingresar', 'token_invalido'); }
    const { rows } = await pool.query<{ activo: boolean; es_superadmin: boolean }>(
      'SELECT activo, es_superadmin FROM app.usuarios WHERE usuario_id = $1', [p.sub]);
    if (!rows[0]?.activo) throw new HttpError(401, 'Usuario inactivo', 'token_invalido');
    req.usuarioId = p.sub;
    req.tokenEmpresaId = p.emp;
    req.esSuperadmin = rows[0].es_superadmin;
    next();
  } catch (e) { next(e); }
}

/** Exige usuario + membresía activa en la empresa del token. Llena req.auth. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const t = tokenDe(req);
    if (!t) throw new HttpError(401, 'Sesión requerida', 'no_autenticado');
    let p: TokenPayload;
    try { p = verificarToken(t); } catch { throw new HttpError(401, 'Sesión vencida, vuelve a ingresar', 'token_invalido'); }
    if (!p.emp) throw new HttpError(403, 'Selecciona una empresa', 'sin_empresa');
    const { rows } = await pool.query<{ rol: Rol; nombre: string; es_superadmin: boolean; emp_activa: boolean }>(
      `SELECT m.rol, u.nombre, u.es_superadmin, e.activo AS emp_activa
         FROM app.miembros m
         JOIN app.usuarios u ON u.usuario_id = m.usuario_id AND u.activo
         JOIN app.empresas e ON e.empresa_id = m.empresa_id
        WHERE m.usuario_id = $1 AND m.empresa_id = $2 AND m.activo`,
      [p.sub, p.emp]);
    const r = rows[0];
    if (!r) throw new HttpError(401, 'Ya no perteneces a esta empresa', 'token_invalido');
    if (!r.emp_activa) throw new HttpError(403, 'La empresa está suspendida. Contacta a soporte.', 'empresa_suspendida');
    req.auth = { usuarioId: p.sub, empresaId: p.emp, rol: r.rol, superadmin: r.es_superadmin, nombre: r.nombre };
    req.usuarioId = p.sub;
    req.esSuperadmin = r.es_superadmin;
    next();
  } catch (e) { next(e); }
}

export function tieneRol(rol: Rol, minimo: Rol): boolean {
  return NIVEL[rol] >= NIVEL[minimo];
}

export function requireRol(minimo: Rol) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !tieneRol(req.auth.rol, minimo)) return next(prohibido(`Requiere rol ${minimo} o superior`));
    next();
  };
}

export function requireSuperadmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.esSuperadmin) return next(prohibido('Solo el superadministrador de la plataforma'));
  next();
}

/** Acceso tipado al contexto (lanza si la ruta no pasó por requireAuth). */
export function ctx(req: Request): AuthCtx {
  if (!req.auth) throw new HttpError(401, 'Sesión requerida');
  return req.auth;
}
