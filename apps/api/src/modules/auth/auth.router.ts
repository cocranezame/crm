import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { pool, tx } from '../../db/pool';
import { ah, HttpError, invalido, noEncontrado } from '../../lib/http';
import { firmarToken, mensajeSuspension, requireUsuario } from '../../middlewares/auth';
import { ENV } from '../../config/env';
import { VENTANAS, ventanasDelPlan } from '../../lib/catalogo';
import { sembrarEmpresa, slugDe } from '../empresas/defaults';
import { PLANES, limitesEmpresa, usoEmpresa } from '../../lib/planes';

const router = Router();
const limitador = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos, espera un minuto' } });

const COLORES = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
const colorAleatorio = () => COLORES[Math.floor(Math.random() * COLORES.length)];

const sRegistro = z.object({
  empresa_nombre: z.string().trim().min(2).max(80),
  nombre:         z.string().trim().min(2).max(80),
  email:          z.string().trim().email().max(120),
  password:       z.string().min(6).max(100),
});

router.post('/registro', limitador, ah(async (req, res) => {
  const d = sRegistro.parse(req.body);
  const r = await tx(async (c) => {
    const hash = await bcrypt.hash(d.password, 10);
    const { rows: [u] } = await c.query<{ usuario_id: string }>(
      `INSERT INTO app.usuarios (email, password_hash, nombre, color) VALUES (lower($1), $2, $3, $4) RETURNING usuario_id`,
      [d.email, hash, d.nombre, colorAleatorio()]);
    const { rows: [e] } = await c.query<{ empresa_id: string }>(
      `INSERT INTO app.empresas (nombre, slug) VALUES ($1, $2) RETURNING empresa_id`, [d.empresa_nombre, slugDe(d.empresa_nombre)]);
    await c.query(`INSERT INTO app.miembros (empresa_id, usuario_id, rol) VALUES ($1, $2, 'propietario')`, [e.empresa_id, u.usuario_id]);
    await sembrarEmpresa(c, e.empresa_id, u.usuario_id);
    return { usuarioId: u.usuario_id, empresaId: e.empresa_id };
  });
  res.status(201).json({ ok: true, token: firmarToken(r.usuarioId, r.empresaId) });
}));

const sLogin = z.object({ email: z.string().trim().email(), password: z.string().min(1) });

router.post('/login', limitador, ah(async (req, res) => {
  const d = sLogin.parse(req.body);
  const { rows: [u] } = await pool.query<{ usuario_id: string; password_hash: string; activo: boolean; es_superadmin: boolean }>(
    `SELECT usuario_id, password_hash, activo, es_superadmin FROM app.usuarios WHERE lower(email) = lower($1)`, [d.email]);
  if (!u || !(await bcrypt.compare(d.password, u.password_hash))) throw new HttpError(401, 'Email o contraseña incorrectos', 'credenciales');
  if (!u.activo) throw new HttpError(403, 'Tu usuario está desactivado', 'inactivo');
  const { rows: [m] } = await pool.query<{ empresa_id: string }>(
    `SELECT m.empresa_id FROM app.miembros m JOIN app.empresas e USING (empresa_id)
      WHERE m.usuario_id = $1 AND m.activo AND e.activo ORDER BY m.creado_en LIMIT 1`, [u.usuario_id]);
  if (!m && !u.es_superadmin) {
    // Ficha Kallpasoft §6.3: tenant suspendido → login bloqueado mostrando el motivo.
    const { rows: [s] } = await pool.query<{ motivo_suspension: string | null }>(
      `SELECT tc.motivo_suspension FROM app.miembros m JOIN app.empresas e USING (empresa_id)
         LEFT JOIN app.tenant_config tc ON tc.empresa_id = m.empresa_id
        WHERE m.usuario_id = $1 AND m.activo AND NOT e.activo ORDER BY m.creado_en LIMIT 1`, [u.usuario_id]);
    if (s) throw new HttpError(403, mensajeSuspension(s.motivo_suspension), 'empresa_suspendida');
  }
  await pool.query('UPDATE app.usuarios SET ultimo_acceso = now() WHERE usuario_id = $1', [u.usuario_id]);
  res.json({ ok: true, token: firmarToken(u.usuario_id, m?.empresa_id ?? null) });
}));

router.get('/me', requireUsuario, ah(async (req, res) => {
  const uid = req.usuarioId!;
  const emp = req.tokenEmpresaId ?? null;
  const { rows: [u] } = await pool.query(
    `SELECT usuario_id, email, nombre, color, es_superadmin FROM app.usuarios WHERE usuario_id = $1`, [uid]);
  const { rows: empresas } = await pool.query(
    `SELECT e.empresa_id, e.nombre, e.slug, e.plan, e.activo, m.rol
       FROM app.miembros m JOIN app.empresas e USING (empresa_id)
      WHERE m.usuario_id = $1 AND m.activo ORDER BY e.nombre`, [uid]);
  const activa = empresas.find((e) => e.empresa_id === emp) ?? null;
  let plan = null;
  let acceso = null;
  if (activa) {
    const { rows: [e] } = await pool.query(
      `SELECT e.trial_hasta, e.zona_horaria, tc.tenant_id, tc.estado, tc.plan AS plan_kallpasoft, tc.modulos_activos,
              tc.ventanas_habilitadas, to_char(tc.fecha_fin, 'YYYY-MM-DD') AS fecha_fin
         FROM app.empresas e LEFT JOIN app.tenant_config tc USING (empresa_id) WHERE e.empresa_id = $1`, [activa.empresa_id]);
    const limites = await limitesEmpresa(activa.empresa_id);
    plan = { codigo: activa.plan, ...limites, nombre: e.plan_kallpasoft ?? limites.nombre, uso: await usoEmpresa(activa.empresa_id), trial_hasta: e.trial_hasta };
    const modulos: string[] | null = e.tenant_id ? (e.modulos_activos ?? []) : null;
    // Lo que el menú puede mostrar: plan (Kallpasoft) — el rol recorta aparte en el frontend.
    acceso = {
      gestionado: !!e.tenant_id, tenant_id: e.tenant_id, estado: e.estado ?? 'activo', fecha_fin: e.fecha_fin,
      modulos, ventanas: ventanasDelPlan(modulos, e.tenant_id ? e.ventanas_habilitadas : null),
      catalogo: VENTANAS.map((v) => v.href), // rutas que gobierna el plan (el resto: perfil, admin… siempre visibles)
    };
  }
  res.json({ ok: true, usuario: u, empresas, empresa: activa, rol: activa?.rol ?? null, plan, acceso,
    permite_nueva_empresa: ENV.PERMITIR_NUEVA_EMPRESA });
}));

router.post('/cambiar-empresa', requireUsuario, ah(async (req, res) => {
  const { empresa_id } = z.object({ empresa_id: z.string().uuid() }).parse(req.body);
  const { rows } = await pool.query(
    `SELECT 1 FROM app.miembros m JOIN app.empresas e USING (empresa_id)
      WHERE m.usuario_id = $1 AND m.empresa_id = $2 AND m.activo AND e.activo`, [req.usuarioId, empresa_id]);
  if (!rows[0]) throw new HttpError(403, 'No perteneces a esa empresa');
  res.json({ ok: true, token: firmarToken(req.usuarioId!, empresa_id) });
}));

router.post('/nueva-empresa', requireUsuario, ah(async (req, res) => {
  // Deshabilitado por ahora: las empresas se crean desde Kallpasoft (POST /internal/v1/tenants).
  if (!ENV.PERMITIR_NUEVA_EMPRESA) throw new HttpError(403, 'Crear empresas desde el CRM está deshabilitado por ahora.', 'nueva_empresa_deshabilitada');
  const { nombre } = z.object({ nombre: z.string().trim().min(2).max(80) }).parse(req.body);
  const empresaId = await tx(async (c) => {
    const { rows: [e] } = await c.query<{ empresa_id: string }>(
      `INSERT INTO app.empresas (nombre, slug) VALUES ($1, $2) RETURNING empresa_id`, [nombre, slugDe(nombre)]);
    await c.query(`INSERT INTO app.miembros (empresa_id, usuario_id, rol) VALUES ($1, $2, 'propietario')`, [e.empresa_id, req.usuarioId]);
    await sembrarEmpresa(c, e.empresa_id, req.usuarioId!);
    return e.empresa_id;
  });
  res.status(201).json({ ok: true, token: firmarToken(req.usuarioId!, empresaId) });
}));

router.patch('/perfil', requireUsuario, ah(async (req, res) => {
  const d = z.object({
    nombre: z.string().trim().min(2).max(80).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    password_actual: z.string().optional(),
    password_nueva: z.string().min(6).max(100).optional(),
  }).parse(req.body);
  if (d.password_nueva) {
    const { rows: [u] } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM app.usuarios WHERE usuario_id = $1', [req.usuarioId]);
    if (!d.password_actual || !(await bcrypt.compare(d.password_actual, u.password_hash))) throw invalido('La contraseña actual no es correcta');
    await pool.query('UPDATE app.usuarios SET password_hash = $2 WHERE usuario_id = $1', [req.usuarioId, await bcrypt.hash(d.password_nueva, 10)]);
  }
  await pool.query(
    `UPDATE app.usuarios SET nombre = COALESCE($2, nombre), color = COALESCE($3, color) WHERE usuario_id = $1`,
    [req.usuarioId, d.nombre ?? null, d.color ?? null]);
  res.json({ ok: true });
}));

// ── Invitaciones (públicas: el invitado aún no tiene sesión) ────────────────

router.get('/invitacion/:token', ah(async (req, res) => {
  const { rows: [i] } = await pool.query(
    `SELECT i.email, i.rol, i.expira_en, i.aceptada_en, e.nombre AS empresa,
            EXISTS (SELECT 1 FROM app.usuarios u WHERE lower(u.email) = lower(i.email)) AS usuario_existe
       FROM app.invitaciones i JOIN app.empresas e USING (empresa_id) WHERE i.token = $1`, [req.params.token]);
  if (!i) throw noEncontrado('Invitación');
  if (i.aceptada_en) throw new HttpError(410, 'Esta invitación ya fue usada');
  if (new Date(i.expira_en) < new Date()) throw new HttpError(410, 'Esta invitación venció. Pide una nueva.');
  res.json({ ok: true, invitacion: i });
}));

router.post('/invitacion/:token/aceptar', limitador, ah(async (req, res) => {
  const d = z.object({ nombre: z.string().trim().min(2).max(80).optional(), password: z.string().min(6).max(100) }).parse(req.body);
  const r = await tx(async (c) => {
    const { rows: [i] } = await c.query(
      `SELECT * FROM app.invitaciones WHERE token = $1 AND aceptada_en IS NULL AND expira_en > now() FOR UPDATE`, [req.params.token]);
    if (!i) throw new HttpError(410, 'Invitación inválida o vencida');
    let { rows: [u] } = await c.query<{ usuario_id: string; password_hash: string }>(
      `SELECT usuario_id, password_hash FROM app.usuarios WHERE lower(email) = lower($1)`, [i.email]);
    if (u) {
      if (!(await bcrypt.compare(d.password, u.password_hash))) throw new HttpError(401, 'Contraseña incorrecta para esa cuenta existente');
    } else {
      if (!d.nombre) throw invalido('nombre: requerido');
      ({ rows: [u] } = await c.query(
        `INSERT INTO app.usuarios (email, password_hash, nombre, color) VALUES (lower($1), $2, $3, $4) RETURNING usuario_id, password_hash`,
        [i.email, await bcrypt.hash(d.password, 10), d.nombre, colorAleatorio()]));
    }
    await c.query(
      `INSERT INTO app.miembros (empresa_id, usuario_id, rol) VALUES ($1, $2, $3)
       ON CONFLICT (empresa_id, usuario_id) DO UPDATE SET activo = true, rol = EXCLUDED.rol`,
      [i.empresa_id, u.usuario_id, i.rol]);
    await c.query('UPDATE app.invitaciones SET aceptada_en = now() WHERE invitacion_id = $1', [i.invitacion_id]);
    return { usuarioId: u.usuario_id, empresaId: i.empresa_id as string };
  });
  res.json({ ok: true, token: firmarToken(r.usuarioId, r.empresaId) });
}));

export default router;
