import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../../db/pool';
import { ah, conflicto, idParam, invalido, noEncontrado } from '../../lib/http';
import { ctx, requireRol } from '../../middlewares/auth';
import { emitirEmpresa } from '../../lib/realtime';
import { validarValores } from '../campos/valores';
import { crearNegocio, moverNegocio } from './negocios.service';

const router = Router();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const TIPO_ETAPA = z.enum(['abierta', 'ganado', 'perdido']);

// ═══ Pipelines ═══════════════════════════════════════════════════════════════

router.get('/pipelines', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rows } = await pool.query(
    `SELECT p.*,
            COALESCE((SELECT json_agg(e ORDER BY e.orden) FROM (
               SELECT et.*, (SELECT count(*) FROM crm.negocios n WHERE n.etapa_id = et.etapa_id AND n.cerrado_en IS NULL)::int AS abiertos
                 FROM crm.etapas et WHERE et.pipeline_id = p.pipeline_id) e), '[]') AS etapas,
            (SELECT count(*) FROM crm.negocios n WHERE n.pipeline_id = p.pipeline_id AND n.cerrado_en IS NULL)::int AS abiertos
       FROM crm.pipelines p WHERE p.empresa_id = $1 ORDER BY p.orden, p.pipeline_id`, [empresaId]);
  res.json({ ok: true, pipelines: rows });
}));

const sPipeline = z.object({
  nombre: z.string().trim().min(1).max(60),
  color: color.optional(),
  es_entrada: z.boolean().optional(),
  activo: z.boolean().optional(),
  etapas: z.array(z.object({ nombre: z.string().trim().min(1).max(40), color: color.optional(), tipo: TIPO_ETAPA.optional() })).max(30).optional(),
});

router.post('/pipelines', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = sPipeline.parse(req.body);
  const etapas = d.etapas?.length ? d.etapas : [
    { nombre: 'Nuevo', color: '#94a3b8' }, { nombre: 'En proceso', color: '#3b82f6' },
    { nombre: 'Ganado', color: '#10b981', tipo: 'ganado' as const }, { nombre: 'Perdido', color: '#ef4444', tipo: 'perdido' as const },
  ];
  const p = await tx(async (c) => {
    if (d.es_entrada) await c.query('UPDATE crm.pipelines SET es_entrada = false WHERE empresa_id = $1', [empresaId]);
    const { rows: [p] } = await c.query(
      `INSERT INTO crm.pipelines (empresa_id, nombre, color, es_entrada, orden)
       VALUES ($1,$2,$3,$4, COALESCE((SELECT max(orden)+1 FROM crm.pipelines WHERE empresa_id = $1), 0)) RETURNING *`,
      [empresaId, d.nombre, d.color ?? '#6366f1', d.es_entrada ?? false]);
    for (const [i, e] of etapas.entries()) {
      await c.query(`INSERT INTO crm.etapas (empresa_id, pipeline_id, nombre, color, orden, tipo) VALUES ($1,$2,$3,$4,$5,$6)`,
        [empresaId, p.pipeline_id, e.nombre, e.color ?? '#94a3b8', i, e.tipo ?? 'abierta']);
    }
    return p;
  });
  emitirEmpresa(empresaId, 'pipelines:cambio', {});
  res.status(201).json({ ok: true, pipeline: p });
}));

router.patch('/pipelines/:id', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const d = sPipeline.omit({ etapas: true }).partial().parse(req.body);
  const p = await tx(async (c) => {
    if (d.es_entrada === true) await c.query('UPDATE crm.pipelines SET es_entrada = false WHERE empresa_id = $1 AND pipeline_id <> $2', [empresaId, id]);
    if (d.es_entrada === false) {
      const { rows: [act] } = await c.query('SELECT es_entrada FROM crm.pipelines WHERE pipeline_id = $1', [id]);
      if (act?.es_entrada) throw invalido('Marca otro pipeline como entrada antes de desmarcar este');
    }
    const { rows: [p] } = await c.query(
      `UPDATE crm.pipelines SET nombre = COALESCE($3, nombre), color = COALESCE($4, color),
              es_entrada = COALESCE($5, es_entrada), activo = COALESCE($6, activo)
        WHERE pipeline_id = $1 AND empresa_id = $2 RETURNING *`,
      [id, empresaId, d.nombre ?? null, d.color ?? null, d.es_entrada ?? null, d.activo ?? null]);
    if (!p) throw noEncontrado('Pipeline');
    return p;
  });
  emitirEmpresa(empresaId, 'pipelines:cambio', {});
  res.json({ ok: true, pipeline: p });
}));

router.delete('/pipelines/:id', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rows: [p] } = await pool.query(
    `SELECT es_entrada, (SELECT count(*) FROM crm.negocios WHERE pipeline_id = $1)::int AS negocios
       FROM crm.pipelines WHERE pipeline_id = $1 AND empresa_id = $2`, [id, empresaId]);
  if (!p) throw noEncontrado('Pipeline');
  if (p.es_entrada) throw conflicto('No puedes eliminar el pipeline de entrada. Marca otro como entrada primero.');
  if (p.negocios > 0) throw conflicto(`El pipeline tiene ${p.negocios} negocio(s). Muévelos o elimínalos antes, o desactívalo.`);
  await pool.query('DELETE FROM crm.pipelines WHERE pipeline_id = $1 AND empresa_id = $2', [id, empresaId]);
  emitirEmpresa(empresaId, 'pipelines:cambio', {});
  res.json({ ok: true });
}));

router.put('/pipelines/orden', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { pipeline_ids } = z.object({ pipeline_ids: z.array(z.number().int()).min(1) }).parse(req.body);
  await tx(async (c) => {
    for (const [i, id] of pipeline_ids.entries()) {
      await c.query('UPDATE crm.pipelines SET orden = $3 WHERE pipeline_id = $1 AND empresa_id = $2', [id, empresaId, i]);
    }
  });
  emitirEmpresa(empresaId, 'pipelines:cambio', {});
  res.json({ ok: true });
}));

// ═══ Etapas ══════════════════════════════════════════════════════════════════

const sEtapa = z.object({
  nombre: z.string().trim().min(1).max(40),
  color: color.optional(),
  tipo: TIPO_ETAPA.optional(),
  sla_horas: z.number().int().positive().max(24 * 365).nullable().optional(),
});

router.post('/pipelines/:id/etapas', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const pipelineId = idParam(req);
  const d = sEtapa.parse(req.body);
  const { rows: [p] } = await pool.query('SELECT 1 FROM crm.pipelines WHERE pipeline_id = $1 AND empresa_id = $2', [pipelineId, empresaId]);
  if (!p) throw noEncontrado('Pipeline');
  // El orden se calcula DENTRO del pipeline (en ReparaTego era global: bug corregido).
  const { rows: [e] } = await pool.query(
    `INSERT INTO crm.etapas (empresa_id, pipeline_id, nombre, color, tipo, sla_horas, orden)
     VALUES ($1,$2,$3,$4,$5,$6, COALESCE((SELECT max(orden)+1 FROM crm.etapas WHERE pipeline_id = $2), 0)) RETURNING *`,
    [empresaId, pipelineId, d.nombre, d.color ?? '#94a3b8', d.tipo ?? 'abierta', d.sla_horas ?? null]);
  emitirEmpresa(empresaId, 'pipelines:cambio', {});
  res.status(201).json({ ok: true, etapa: e });
}));

router.patch('/etapas/:id', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = sEtapa.partial().parse(req.body);
  const { rows: [e] } = await pool.query(
    `UPDATE crm.etapas SET nombre = COALESCE($3, nombre), color = COALESCE($4, color), tipo = COALESCE($5, tipo),
            sla_horas = CASE WHEN $6::boolean THEN $7 ELSE sla_horas END
      WHERE etapa_id = $1 AND empresa_id = $2 RETURNING *`,
    [idParam(req), empresaId, d.nombre ?? null, d.color ?? null, d.tipo ?? null, 'sla_horas' in req.body, d.sla_horas ?? null]);
  if (!e) throw noEncontrado('Etapa');
  emitirEmpresa(empresaId, 'pipelines:cambio', {});
  res.json({ ok: true, etapa: e });
}));

/** Borrar una etapa con negocios exige destino_etapa_id: nunca queda un negocio huérfano. */
router.delete('/etapas/:id', requireRol('admin'), ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const id = idParam(req);
  const destino = req.query.destino_etapa_id ? Number(req.query.destino_etapa_id) : null;
  await tx(async (c) => {
    const { rows: [e] } = await c.query<{ pipeline_id: number }>(
      'SELECT pipeline_id FROM crm.etapas WHERE etapa_id = $1 AND empresa_id = $2', [id, empresaId]);
    if (!e) throw noEncontrado('Etapa');
    const { rows: [{ total }] } = await c.query<{ total: number }>('SELECT count(*)::int AS total FROM crm.etapas WHERE pipeline_id = $1', [e.pipeline_id]);
    if (total <= 1) throw conflicto('Un pipeline necesita al menos una etapa');
    const { rows: negocios } = await c.query<{ negocio_id: number }>('SELECT negocio_id FROM crm.negocios WHERE etapa_id = $1', [id]);
    if (negocios.length) {
      if (!destino || destino === id) throw invalido(`La etapa tiene ${negocios.length} negocio(s): indica a qué etapa moverlos`);
      for (const n of negocios) await moverNegocio(c, empresaId, n.negocio_id, destino, null, { tipo: 'humano', id: usuarioId });
    }
    await c.query('DELETE FROM crm.etapas WHERE etapa_id = $1', [id]);
    // Compactar el orden
    await c.query(
      `UPDATE crm.etapas e SET orden = s.rn - 1 FROM (
         SELECT etapa_id, row_number() OVER (ORDER BY orden) AS rn FROM crm.etapas WHERE pipeline_id = $1) s
        WHERE e.etapa_id = s.etapa_id`, [e.pipeline_id]);
  });
  emitirEmpresa(empresaId, 'pipelines:cambio', {});
  res.json({ ok: true });
}));

/** Reorden atómico: una transacción, el UNIQUE(pipeline_id, orden) es DEFERRABLE. */
router.put('/pipelines/:id/etapas/orden', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const pipelineId = idParam(req);
  const { etapa_ids } = z.object({ etapa_ids: z.array(z.number().int()).min(1) }).parse(req.body);
  await tx(async (c) => {
    const { rows } = await c.query<{ etapa_id: number }>(
      'SELECT etapa_id FROM crm.etapas WHERE pipeline_id = $1 AND empresa_id = $2', [pipelineId, empresaId]);
    const actuales = new Set(rows.map((r) => r.etapa_id));
    if (rows.length !== etapa_ids.length || etapa_ids.some((x) => !actuales.has(x))) {
      throw invalido('La lista debe contener exactamente las etapas del pipeline');
    }
    for (const [i, id] of etapa_ids.entries()) {
      await c.query('UPDATE crm.etapas SET orden = $2 WHERE etapa_id = $1', [id, i]);
    }
  });
  emitirEmpresa(empresaId, 'pipelines:cambio', {});
  res.json({ ok: true });
}));

// ═══ Tablero y negocios ══════════════════════════════════════════════════════

router.get('/pipelines/:id/tablero', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const pipelineId = idParam(req);
  const { rows: [p] } = await pool.query('SELECT * FROM crm.pipelines WHERE pipeline_id = $1 AND empresa_id = $2', [pipelineId, empresaId]);
  if (!p) throw noEncontrado('Pipeline');
  const { rows: etapas } = await pool.query('SELECT * FROM crm.etapas WHERE pipeline_id = $1 ORDER BY orden', [pipelineId]);

  const q = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;
  const asignado = typeof req.query.asignado === 'string' && req.query.asignado ? req.query.asignado : null;
  const etiqueta = req.query.etiqueta_id ? Number(req.query.etiqueta_id) : null;

  const { rows: negocios } = await pool.query(
    `SELECT n.negocio_id, n.etapa_id, n.titulo, n.monto, n.posicion, n.asignado_a, n.cerrado_en, n.etapa_desde, n.creado_en, n.valores,
            c.contacto_id, c.nombre AS contacto_nombre, c.telefono AS contacto_telefono,
            u.nombre AS asignado_nombre, u.color AS asignado_color,
            COALESCE((SELECT json_agg(json_build_object('etiqueta_id', e.etiqueta_id, 'nombre', e.nombre, 'color', e.color) ORDER BY e.nombre)
                        FROM crm.contacto_etiquetas ce JOIN crm.etiquetas e USING (etiqueta_id) WHERE ce.contacto_id = c.contacto_id), '[]') AS etiquetas,
            COALESCE((SELECT json_agg(DISTINCT i.canal) FROM crm.identidades i WHERE i.contacto_id = c.contacto_id), '[]') AS canales,
            (SELECT cv.conversacion_id FROM crm.conversaciones cv WHERE cv.contacto_id = c.contacto_id ORDER BY cv.ultima_actividad DESC LIMIT 1) AS conversacion_id
       FROM crm.negocios n
       JOIN crm.contactos c ON c.contacto_id = n.contacto_id AND c.eliminado_en IS NULL
       LEFT JOIN app.usuarios u ON u.usuario_id = n.asignado_a
      WHERE n.pipeline_id = $1 AND n.empresa_id = $2
        AND (n.cerrado_en IS NULL OR n.cerrado_en > now() - interval '30 days')
        AND ($3::text IS NULL OR c.nombre ILIKE $3 OR c.telefono ILIKE $3 OR n.titulo ILIKE $3)
        AND ($4::uuid IS NULL OR n.asignado_a = $4)
        AND ($5::bigint IS NULL OR EXISTS (SELECT 1 FROM crm.contacto_etiquetas ce WHERE ce.contacto_id = c.contacto_id AND ce.etiqueta_id = $5))
      ORDER BY n.posicion`, [pipelineId, empresaId, q, asignado, etiqueta]);
  res.json({ ok: true, pipeline: p, etapas, negocios });
}));

const sNegocio = z.object({
  contacto_id: z.number().int(),
  pipeline_id: z.number().int(),
  etapa_id: z.number().int().nullable().optional(),
  titulo: z.string().trim().max(120).nullable().optional(),
  monto: z.number().nonnegative().max(1e10).nullable().optional(),
  asignado_a: z.string().uuid().nullable().optional(),
  valores: z.record(z.unknown()).optional(),
});

router.post('/negocios', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const d = sNegocio.parse(req.body);
  const n = await tx(async (c) => {
    const valores = await validarValores(c, empresaId, 'negocio', d.valores);
    return crearNegocio(c, empresaId, { ...d, valores }, { tipo: 'humano', id: usuarioId });
  });
  res.status(201).json({ ok: true, negocio: n });
}));

router.get('/negocios/:id', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rows: [n] } = await pool.query(
    `SELECT n.*, c.nombre AS contacto_nombre, c.telefono AS contacto_telefono, c.email AS contacto_email,
            p.nombre AS pipeline_nombre, e.nombre AS etapa_nombre, e.color AS etapa_color, e.tipo AS etapa_tipo
       FROM crm.negocios n JOIN crm.contactos c USING (contacto_id)
       JOIN crm.pipelines p ON p.pipeline_id = n.pipeline_id JOIN crm.etapas e ON e.etapa_id = n.etapa_id
      WHERE n.negocio_id = $1 AND n.empresa_id = $2`, [id, empresaId]);
  if (!n) throw noEncontrado('Negocio');
  const { rows: historial } = await pool.query(
    `SELECT h.*, de.nombre AS de_nombre, a.nombre AS a_nombre, u.nombre AS actor_nombre
       FROM crm.negocio_historial h
       LEFT JOIN crm.etapas de ON de.etapa_id = h.de_etapa LEFT JOIN crm.etapas a ON a.etapa_id = h.a_etapa
       LEFT JOIN app.usuarios u ON u.usuario_id = h.actor_id
      WHERE h.negocio_id = $1 ORDER BY h.creado_en DESC LIMIT 50`, [id]);
  res.json({ ok: true, negocio: n, historial });
}));

router.patch('/negocios/:id', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const d = sNegocio.pick({ titulo: true, monto: true, asignado_a: true, valores: true }).partial().parse(req.body);
  const n = await tx(async (c) => {
    const valores = d.valores ? await validarValores(c, empresaId, 'negocio', d.valores, { parcial: true }) : null;
    const { rows: [n] } = await c.query(
      `UPDATE crm.negocios SET
          titulo = CASE WHEN $3::boolean THEN $4 ELSE titulo END,
          monto = CASE WHEN $5::boolean THEN $6::numeric ELSE monto END,
          asignado_a = CASE WHEN $7::boolean THEN $8::uuid ELSE asignado_a END,
          valores = CASE WHEN $9::jsonb IS NULL THEN valores ELSE jsonb_strip_nulls(valores || $9::jsonb) END,
          actualizado_en = now()
        WHERE negocio_id = $1 AND empresa_id = $2 RETURNING *`,
      [id, empresaId, 'titulo' in req.body, d.titulo ?? null, 'monto' in req.body, d.monto ?? null,
       'asignado_a' in req.body, d.asignado_a ?? null, valores ? JSON.stringify(valores) : null]);
    if (!n) throw noEncontrado('Negocio');
    return n;
  });
  emitirEmpresa(empresaId, 'tablero:cambio', { pipeline_id: n.pipeline_id, negocio_id: id });
  res.json({ ok: true, negocio: n });
}));

router.patch('/negocios/:id/mover', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const d = z.object({ etapa_id: z.number().int(), posicion: z.number().finite().nullable().optional() }).parse(req.body);
  const n = await tx((c) => moverNegocio(c, empresaId, idParam(req), d.etapa_id, d.posicion ?? null, { tipo: 'humano', id: usuarioId }));
  res.json({ ok: true, negocio: n });
}));

router.delete('/negocios/:id', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rows: [n] } = await pool.query('DELETE FROM crm.negocios WHERE negocio_id = $1 AND empresa_id = $2 RETURNING pipeline_id', [idParam(req), empresaId]);
  if (!n) throw noEncontrado('Negocio');
  emitirEmpresa(empresaId, 'tablero:cambio', { pipeline_id: n.pipeline_id });
  res.json({ ok: true });
}));

export default router;
