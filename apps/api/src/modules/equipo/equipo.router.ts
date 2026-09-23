import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ENV } from '../../config/env';
import { ah, conflicto, idParam, invalido, noEncontrado, prohibido } from '../../lib/http';
import { tokenAleatorio } from '../../lib/crypto';
import { verificarLimite } from '../../lib/planes';
import { ctx, requireRol, tieneRol } from '../../middlewares/auth';

const router = Router();

router.get('/', ah(async (req, res) => {
  const { empresaId, rol } = ctx(req);
  const { rows: miembros } = await pool.query(
    `SELECT u.usuario_id, u.nombre, u.email, u.color, u.ultimo_acceso, m.rol, m.activo, m.creado_en,
            (SELECT count(*) FROM crm.conversaciones c WHERE c.asignado_a = u.usuario_id AND c.empresa_id = $1 AND c.estado <> 'resuelta')::int AS conversaciones_abiertas
       FROM app.miembros m JOIN app.usuarios u USING (usuario_id)
      WHERE m.empresa_id = $1
      ORDER BY m.activo DESC, CASE m.rol WHEN 'propietario' THEN 0 WHEN 'admin' THEN 1 WHEN 'supervisor' THEN 2 ELSE 3 END, u.nombre`, [empresaId]);
  let invitaciones: unknown[] = [];
  if (tieneRol(rol, 'admin')) {
    ({ rows: invitaciones } = await pool.query(
      `SELECT i.invitacion_id, i.email, i.rol, i.token, i.expira_en, i.creado_en, u.nombre AS invitado_por_nombre
         FROM app.invitaciones i LEFT JOIN app.usuarios u ON u.usuario_id = i.invitado_por
        WHERE i.empresa_id = $1 AND i.aceptada_en IS NULL AND i.expira_en > now() ORDER BY i.creado_en DESC`, [empresaId]));
    invitaciones = (invitaciones as Array<{ token: string }>).map((i) => ({ ...i, enlace: `${ENV.WEB_URL}/invitacion/${i.token}` }));
  }
  res.json({ ok: true, miembros, invitaciones });
}));

router.post('/invitaciones', requireRol('admin'), ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const d = z.object({ email: z.string().trim().toLowerCase().email(), rol: z.enum(['admin', 'supervisor', 'agente']) }).parse(req.body);
  const { rows: [ya] } = await pool.query(
    `SELECT 1 FROM app.miembros m JOIN app.usuarios u USING (usuario_id) WHERE m.empresa_id = $1 AND lower(u.email) = $2 AND m.activo`,
    [empresaId, d.email]);
  if (ya) throw conflicto('Esa persona ya es parte del equipo');
  await pool.query('DELETE FROM app.invitaciones WHERE empresa_id = $1 AND lower(email) = $2 AND aceptada_en IS NULL', [empresaId, d.email]);
  await verificarLimite(empresaId, 'usuarios');
  const token = tokenAleatorio();
  const { rows: [i] } = await pool.query(
    `INSERT INTO app.invitaciones (empresa_id, email, rol, token, invitado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [empresaId, d.email, d.rol, token, usuarioId]);
  // Local: no se envía correo; la UI muestra el enlace para copiarlo y compartirlo.
  res.status(201).json({ ok: true, invitacion: { ...i, enlace: `${ENV.WEB_URL}/invitacion/${token}` } });
}));

router.delete('/invitaciones/:id', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  await pool.query('DELETE FROM app.invitaciones WHERE invitacion_id = $1 AND empresa_id = $2', [idParam(req), empresaId]);
  res.json({ ok: true });
}));

router.patch('/:usuarioId', requireRol('admin'), ah(async (req, res) => {
  const { empresaId, usuarioId: yo, rol: miRol } = ctx(req);
  const objetivo = z.string().uuid().parse(req.params.usuarioId);
  const d = z.object({ rol: z.enum(['propietario', 'admin', 'supervisor', 'agente']).optional(), activo: z.boolean().optional() }).parse(req.body);
  const { rows: [m] } = await pool.query<{ rol: string }>('SELECT rol FROM app.miembros WHERE empresa_id = $1 AND usuario_id = $2', [empresaId, objetivo]);
  if (!m) throw noEncontrado('Miembro');
  if ((m.rol === 'propietario' || d.rol === 'propietario') && miRol !== 'propietario') throw prohibido('Solo un propietario puede cambiar a otro propietario');
  if (objetivo === yo && d.activo === false) throw invalido('No puedes desactivarte a ti mismo');
  if (m.rol === 'propietario' && (d.rol && d.rol !== 'propietario' || d.activo === false)) {
    const { rows: [{ n }] } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.miembros WHERE empresa_id = $1 AND rol = 'propietario' AND activo`, [empresaId]);
    if (n <= 1) throw conflicto('La empresa debe tener al menos un propietario activo');
  }
  if (d.activo === true) await verificarLimite(empresaId, 'usuarios');
  await pool.query(
    'UPDATE app.miembros SET rol = COALESCE($3, rol), activo = COALESCE($4, activo) WHERE empresa_id = $1 AND usuario_id = $2',
    [empresaId, objetivo, d.rol ?? null, d.activo ?? null]);
  if (d.activo === false) {
    // Sus conversaciones vuelven a la cola sin asignar
    await pool.query(`UPDATE crm.conversaciones SET asignado_a = NULL WHERE empresa_id = $1 AND asignado_a = $2 AND estado <> 'resuelta'`, [empresaId, objetivo]);
  }
  res.json({ ok: true });
}));

export default router;
