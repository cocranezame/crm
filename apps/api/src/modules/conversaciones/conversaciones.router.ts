import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah, idParam, invalido, noEncontrado } from '../../lib/http';
import { emitirEmpresa } from '../../lib/realtime';
import { ctx } from '../../middlewares/auth';
import { CAPACIDADES } from '../canales/tipos';
import { enviarMedia, enviarPlantilla, enviarTexto } from '../canales/envio.service';
import { renderPlantilla } from '../plantillas/plantillas.service';
import { asegurarConversacion } from './conversaciones.service';
import { SELECT_MENSAJE, mensajeDTO, type MensajeFila } from './dto';

const router = Router();

const SELECT_CONV = `
  SELECT cv.conversacion_id, cv.contacto_id, cv.canal_id, cv.estado, cv.modo, cv.no_leidos, cv.ultimo_mensaje,
         cv.ultimo_entrante_en, cv.ultima_actividad, cv.asignado_a, cv.creado_en,
         ct.nombre AS contacto_nombre, ct.telefono AS contacto_telefono,
         i.externo_id AS identidad, i.nombre_canal, i.username,
         ca.tipo AS canal, ca.nombre AS canal_nombre, ca.sandbox,
         u.nombre AS asignado_nombre, u.color AS asignado_color,
         COALESCE((SELECT json_agg(json_build_object('etiqueta_id', e.etiqueta_id, 'nombre', e.nombre, 'color', e.color) ORDER BY e.nombre)
                     FROM crm.contacto_etiquetas ce JOIN crm.etiquetas e USING (etiqueta_id) WHERE ce.contacto_id = ct.contacto_id), '[]') AS etiquetas
    FROM crm.conversaciones cv
    JOIN crm.contactos ct ON ct.contacto_id = cv.contacto_id
    JOIN crm.identidades i ON i.identidad_id = cv.identidad_id
    JOIN crm.canales ca ON ca.canal_id = cv.canal_id
    LEFT JOIN app.usuarios u ON u.usuario_id = cv.asignado_a`;

// ── Bandeja ────────────────────────────────────────────────────────────────

router.get('/', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const s = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]) : null);
  const estado = s('estado') ?? 'abiertas';
  const bandeja = s('bandeja') ?? 'todas'; // mias | sin_asignar | todas
  const q = s('q');
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const antes = s('antes'); // cursor: ultima_actividad ISO

  const { rows } = await pool.query(
    `${SELECT_CONV}
      WHERE cv.empresa_id = $1 AND ct.eliminado_en IS NULL
        AND ($2 = 'todas' OR ($2 = 'abiertas' AND cv.estado IN ('abierta','pendiente')) OR cv.estado = $2)
        AND ($3 = 'todas' OR ($3 = 'mias' AND cv.asignado_a = $4) OR ($3 = 'sin_asignar' AND cv.asignado_a IS NULL))
        AND ($5::text IS NULL OR ca.tipo = $5)
        AND ($6::bigint IS NULL OR cv.canal_id = $6)
        AND ($7::bigint IS NULL OR EXISTS (SELECT 1 FROM crm.contacto_etiquetas ce WHERE ce.contacto_id = ct.contacto_id AND ce.etiqueta_id = $7))
        AND ($8::text IS NULL OR ct.nombre ILIKE '%'||$8||'%' OR ct.telefono ILIKE '%'||$8||'%' OR i.nombre_canal ILIKE '%'||$8||'%' OR cv.ultimo_mensaje ILIKE '%'||$8||'%')
        AND ($9::timestamptz IS NULL OR cv.ultima_actividad < $9)
        AND ($10::uuid IS NULL OR cv.asignado_a = $10)
      ORDER BY cv.ultima_actividad DESC LIMIT ${limit}`,
    [empresaId, estado, bandeja, usuarioId, s('canal'), s('canal_id') ? Number(s('canal_id')) : null,
     s('etiqueta_id') ? Number(s('etiqueta_id')) : null, q, antes, s('asignado')]);
  res.json({ ok: true, items: rows, siguiente: rows.length === limit ? rows[rows.length - 1].ultima_actividad : null });
}));

router.get('/contadores', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const { rows: [r] } = await pool.query(
    `SELECT count(*) FILTER (WHERE cv.asignado_a = $2)::int AS mias,
            count(*) FILTER (WHERE cv.asignado_a IS NULL)::int AS sin_asignar,
            count(*)::int AS todas,
            count(*) FILTER (WHERE cv.no_leidos > 0)::int AS no_leidas,
            count(*) FILTER (WHERE cv.no_leidos > 0 AND (cv.asignado_a = $2 OR cv.asignado_a IS NULL))::int AS no_leidas_mias
       FROM crm.conversaciones cv JOIN crm.contactos ct USING (contacto_id)
      WHERE cv.empresa_id = $1 AND cv.estado IN ('abierta','pendiente') AND ct.eliminado_en IS NULL`, [empresaId, usuarioId]);
  res.json({ ok: true, ...r });
}));

/** Iniciar conversación saliente (WhatsApp) con un contacto que aún no escribió. */
router.post('/nueva', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = z.object({ contacto_id: z.number().int(), canal_id: z.number().int() }).parse(req.body);
  const id = await asegurarConversacion(empresaId, d.contacto_id, d.canal_id);
  emitirEmpresa(empresaId, 'conversacion:actualizada', { conversacion_id: id });
  res.status(201).json({ ok: true, conversacion_id: id });
}));

router.get('/:id', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rows: [c] } = await pool.query(`${SELECT_CONV} WHERE cv.conversacion_id = $1 AND cv.empresa_id = $2`, [idParam(req), empresaId]);
  if (!c) throw noEncontrado('Conversación');
  res.json({ ok: true, conversacion: { ...c, capacidades: CAPACIDADES[c.canal as keyof typeof CAPACIDADES] } });
}));

router.get('/:id/mensajes', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const antes = req.query.antes ? Number(req.query.antes) : null;
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const { rows: [c] } = await pool.query('SELECT 1 FROM crm.conversaciones WHERE conversacion_id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!c) throw noEncontrado('Conversación');
  const { rows } = await pool.query<MensajeFila>(
    `${SELECT_MENSAJE} WHERE m.conversacion_id = $1 AND ($2::bigint IS NULL OR m.mensaje_id < $2)
      ORDER BY m.enviado_en DESC, m.mensaje_id DESC LIMIT ${limit}`, [id, antes]);
  res.json({ ok: true, items: rows.reverse().map(mensajeDTO), hay_mas: rows.length === limit });
}));

// ── Acciones ───────────────────────────────────────────────────────────────

const sEnvio = z.object({
  texto: z.string().max(4096).optional(),
  adjunto: z.object({
    key: z.string().startsWith('local:'), mime: z.string(), nombre: z.string().max(200),
    tipo: z.enum(['imagen', 'video', 'documento', 'audio']),
  }).optional(),
});

router.post('/:id/mensajes', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const id = idParam(req);
  const d = sEnvio.parse(req.body);
  const texto = d.texto?.trim() ?? '';
  if (d.adjunto && !d.adjunto.key.startsWith(`local:${empresaId}/`)) throw invalido('Adjunto inválido');
  const autor = { tipo: 'humano' as const, id: usuarioId };
  const mensaje = d.adjunto
    ? await enviarMedia(empresaId, id, { key: d.adjunto.key, mime: d.adjunto.mime, nombre: d.adjunto.nombre, tipoMedia: d.adjunto.tipo, caption: texto || null }, autor)
    : texto ? await enviarTexto(empresaId, id, texto, autor) : (() => { throw invalido('Escribe un mensaje'); })();
  res.status(201).json({ ok: true, mensaje });
}));

router.post('/:id/notas', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const id = idParam(req);
  const { texto } = z.object({ texto: z.string().trim().min(1).max(4000) }).parse(req.body);
  const { rows: [c] } = await pool.query('SELECT 1 FROM crm.conversaciones WHERE conversacion_id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!c) throw noEncontrado('Conversación');
  const { rows: [m] } = await pool.query<{ mensaje_id: number }>(
    `INSERT INTO crm.mensajes (empresa_id, conversacion_id, direccion, autor_tipo, autor_id, tipo, contenido)
     VALUES ($1,$2,'nota','humano',$3,'texto',$4) RETURNING mensaje_id`, [empresaId, id, usuarioId, texto]);
  const { rows: [f] } = await pool.query<MensajeFila>(`${SELECT_MENSAJE} WHERE m.mensaje_id = $1`, [m.mensaje_id]);
  emitirEmpresa(empresaId, 'mensaje:nuevo', { conversacion_id: id, mensaje: mensajeDTO(f) });
  res.status(201).json({ ok: true, mensaje: mensajeDTO(f) });
}));

router.post('/:id/plantilla', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const id = idParam(req);
  const d = z.object({ plantilla_id: z.number().int(), manuales: z.record(z.string()).optional() }).parse(req.body);
  const { rows: [conv] } = await pool.query('SELECT contacto_id, canal_id FROM crm.conversaciones WHERE conversacion_id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!conv) throw noEncontrado('Conversación');
  const { rows: [p] } = await pool.query(`SELECT * FROM crm.plantillas WHERE plantilla_id = $1 AND empresa_id = $2`, [d.plantilla_id, empresaId]);
  if (!p) throw noEncontrado('Plantilla');
  if (p.estado !== 'aprobada') throw invalido('Solo se pueden enviar plantillas aprobadas por Meta');
  if (p.canal_id !== conv.canal_id) throw invalido('La plantilla pertenece a otra cuenta de WhatsApp');
  const r = await renderPlantilla(empresaId, p, conv.contacto_id, d.manuales ?? {});
  const out = await enviarPlantilla(empresaId, id, { plantilla_id: p.plantilla_id, nombre: p.nombre, idioma: p.idioma, parametros: r.parametros, texto: r.texto },
    { tipo: 'humano', id: usuarioId });
  res.status(201).json({ ok: true, mensaje: out.mensaje });
}));

router.post('/:id/leer', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  await pool.query('UPDATE crm.conversaciones SET no_leidos = 0 WHERE conversacion_id = $1 AND empresa_id = $2 AND no_leidos > 0', [id, empresaId]);
  emitirEmpresa(empresaId, 'conversacion:actualizada', { conversacion_id: id });
  res.json({ ok: true });
}));

/** Tomar la conversación: queda asignada a mí y en modo humano. */
router.post('/:id/tomar', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const id = idParam(req);
  const { rowCount } = await pool.query(
    `UPDATE crm.conversaciones SET asignado_a = $3, modo = 'humano', estado = CASE WHEN estado = 'resuelta' THEN 'abierta' ELSE estado END
      WHERE conversacion_id = $1 AND empresa_id = $2`, [id, empresaId, usuarioId]);
  if (!rowCount) throw noEncontrado('Conversación');
  await registrarSistema(empresaId, id, `${ctx(req).nombre} tomó la conversación`);
  res.json({ ok: true });
}));

router.patch('/:id', ah(async (req, res) => {
  const { empresaId, nombre } = ctx(req);
  const id = idParam(req);
  const d = z.object({
    estado: z.enum(['abierta', 'pendiente', 'resuelta']).optional(),
    asignado_a: z.string().uuid().nullable().optional(),
    modo: z.enum(['ia', 'humano']).optional(),
  }).parse(req.body);
  if (d.asignado_a) {
    const { rows: [m] } = await pool.query('SELECT 1 FROM app.miembros WHERE empresa_id = $1 AND usuario_id = $2 AND activo', [empresaId, d.asignado_a]);
    if (!m) throw invalido('Ese usuario no es parte del equipo');
  }
  const { rows: [antes] } = await pool.query('SELECT estado, asignado_a FROM crm.conversaciones WHERE conversacion_id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!antes) throw noEncontrado('Conversación');
  await pool.query(
    `UPDATE crm.conversaciones SET estado = COALESCE($3, estado),
            asignado_a = CASE WHEN $4::boolean THEN $5::uuid ELSE asignado_a END, modo = COALESCE($6, modo),
            no_leidos = CASE WHEN $3 = 'resuelta' THEN 0 ELSE no_leidos END
      WHERE conversacion_id = $1 AND empresa_id = $2`,
    [id, empresaId, d.estado ?? null, 'asignado_a' in req.body, d.asignado_a ?? null, d.modo ?? null]);
  if (d.estado && d.estado !== antes.estado) {
    const t = { abierta: 'reabrió', pendiente: 'marcó como pendiente', resuelta: 'resolvió' }[d.estado];
    await registrarSistema(empresaId, id, `${nombre} ${t} la conversación`);
  }
  if ('asignado_a' in req.body && d.asignado_a !== antes.asignado_a) {
    const { rows: [u] } = d.asignado_a ? await pool.query('SELECT nombre FROM app.usuarios WHERE usuario_id = $1', [d.asignado_a]) : { rows: [null] };
    await registrarSistema(empresaId, id, u ? `${nombre} asignó la conversación a ${u.nombre}` : `${nombre} quitó la asignación`);
  }
  emitirEmpresa(empresaId, 'conversacion:actualizada', { conversacion_id: id });
  res.json({ ok: true });
}));

async function registrarSistema(empresaId: string, conversacionId: number, texto: string) {
  const { rows: [m] } = await pool.query<MensajeFila>(
    `INSERT INTO crm.mensajes (empresa_id, conversacion_id, direccion, autor_tipo, tipo, contenido)
     VALUES ($1,$2,'nota','sistema','sistema',$3) RETURNING *`, [empresaId, conversacionId, texto]);
  emitirEmpresa(empresaId, 'mensaje:nuevo', { conversacion_id: conversacionId, mensaje: mensajeDTO(m) });
  emitirEmpresa(empresaId, 'conversacion:actualizada', { conversacion_id: conversacionId });
}

export default router;
