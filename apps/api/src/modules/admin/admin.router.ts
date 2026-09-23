// Panel de plataforma (solo superadmin): empresas, planes, límites y credenciales.
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah, noEncontrado } from '../../lib/http';
import { PLANES } from '../../lib/planes';
import { CLAVES_PLATAFORMA, estadoConfig, setConfig, type ClavePlataforma } from './config.service';

const router = Router();

router.get('/resumen', ah(async (_req, res) => {
  const { rows: [r] } = await pool.query(
    `SELECT (SELECT count(*) FROM app.empresas)::int AS empresas,
            (SELECT count(*) FROM app.empresas WHERE activo)::int AS empresas_activas,
            (SELECT count(*) FROM app.usuarios)::int AS usuarios,
            (SELECT count(*) FROM crm.contactos WHERE eliminado_en IS NULL)::int AS contactos,
            (SELECT count(*) FROM crm.canales WHERE activo AND NOT sandbox)::int AS canales,
            (SELECT count(*) FROM crm.mensajes WHERE enviado_en > now() - interval '30 days')::int AS mensajes_30d`);
  res.json({ ok: true, resumen: r, planes: PLANES });
}));

router.get('/empresas', ah(async (req, res) => {
  const q = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;
  const { rows } = await pool.query(
    `SELECT e.*,
            (SELECT count(*) FROM app.miembros m WHERE m.empresa_id = e.empresa_id AND m.activo)::int AS usuarios,
            (SELECT count(*) FROM crm.contactos c WHERE c.empresa_id = e.empresa_id AND c.eliminado_en IS NULL)::int AS contactos,
            (SELECT count(*) FROM crm.canales c WHERE c.empresa_id = e.empresa_id AND c.activo AND NOT c.sandbox)::int AS canales,
            (SELECT count(*) FROM crm.mensajes m WHERE m.empresa_id = e.empresa_id AND m.enviado_en > now() - interval '30 days')::int AS mensajes_30d,
            (SELECT u.email FROM app.miembros m JOIN app.usuarios u USING (usuario_id) WHERE m.empresa_id = e.empresa_id AND m.rol = 'propietario' ORDER BY m.creado_en LIMIT 1) AS propietario
       FROM app.empresas e WHERE ($1::text IS NULL OR e.nombre ILIKE $1 OR e.slug ILIKE $1) ORDER BY e.creado_en DESC`, [q]);
  res.json({ ok: true, empresas: rows });
}));

router.patch('/empresas/:id', ah(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const d = z.object({
    plan: z.enum(['trial', 'basico', 'pro', 'enterprise']).optional(), activo: z.boolean().optional(),
    trial_hasta: z.string().datetime().nullable().optional(), nombre: z.string().trim().min(2).max(80).optional(),
  }).parse(req.body);
  const { rowCount } = await pool.query(
    `UPDATE app.empresas SET plan = COALESCE($2, plan), activo = COALESCE($3, activo), nombre = COALESCE($4, nombre),
            trial_hasta = CASE WHEN $5::boolean THEN $6::timestamptz ELSE trial_hasta END WHERE empresa_id = $1`,
    [id, d.plan ?? null, d.activo ?? null, d.nombre ?? null, 'trial_hasta' in req.body, d.trial_hasta ?? null]);
  if (!rowCount) throw noEncontrado('Empresa');
  res.json({ ok: true });
}));

router.get('/config', ah(async (_req, res) => {
  res.json({ ok: true, config: await estadoConfig() });
}));

router.put('/config', ah(async (req, res) => {
  const d = z.object({
    clave: z.enum(Object.keys(CLAVES_PLATAFORMA) as [ClavePlataforma, ...ClavePlataforma[]]),
    valor: z.string().trim().max(500).nullable(),
  }).parse(req.body);
  await setConfig(d.clave, d.valor || null);
  res.json({ ok: true, config: await estadoConfig() });
}));

export default router;
