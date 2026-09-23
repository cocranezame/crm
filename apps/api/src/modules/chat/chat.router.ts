// Chat interno del equipo (portado de mensajeria/ de ReparaTego; usuarios de app.miembros).
import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../../db/pool';
import { ah, idParam, invalido, noEncontrado } from '../../lib/http';
import { emitirUsuarios } from '../../lib/realtime';
import { ctx } from '../../middlewares/auth';

const router = Router();

async function participantes(convId: number): Promise<string[]> {
  const { rows } = await pool.query<{ usuario_id: string }>('SELECT usuario_id FROM crm.equipo_participantes WHERE conv_id = $1', [convId]);
  return rows.map((r) => r.usuario_id);
}

async function verificarParticipante(empresaId: string, convId: number, usuarioId: string) {
  const { rows: [r] } = await pool.query(
    `SELECT 1 FROM crm.equipo_conversaciones c JOIN crm.equipo_participantes p USING (conv_id)
      WHERE c.conv_id = $1 AND c.empresa_id = $2 AND p.usuario_id = $3`, [convId, empresaId, usuarioId]);
  if (!r) throw noEncontrado('Conversación');
}

router.get('/conversaciones', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const { rows } = await pool.query(
    `SELECT c.conv_id, c.tipo, c.nombre, c.ultima_actividad,
            (SELECT json_agg(json_build_object('usuario_id', u.usuario_id, 'nombre', u.nombre, 'color', u.color) ORDER BY u.nombre)
               FROM crm.equipo_participantes pp JOIN app.usuarios u USING (usuario_id) WHERE pp.conv_id = c.conv_id) AS participantes,
            (SELECT json_build_object('contenido', m.contenido, 'autor_id', m.autor_id, 'creado_en', m.creado_en)
               FROM crm.equipo_mensajes m WHERE m.conv_id = c.conv_id ORDER BY m.id DESC LIMIT 1) AS ultimo,
            (SELECT count(*) FROM crm.equipo_mensajes m WHERE m.conv_id = c.conv_id AND m.creado_en > p.ultimo_leido_en AND m.autor_id <> $2)::int AS no_leidos
       FROM crm.equipo_conversaciones c JOIN crm.equipo_participantes p ON p.conv_id = c.conv_id AND p.usuario_id = $2
      WHERE c.empresa_id = $1 ORDER BY c.ultima_actividad DESC`, [empresaId, usuarioId]);
  res.json({ ok: true, conversaciones: rows });
}));

router.get('/no-leidos', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const { rows: [r] } = await pool.query(
    `SELECT count(*)::int AS total FROM crm.equipo_mensajes m
       JOIN crm.equipo_participantes p ON p.conv_id = m.conv_id AND p.usuario_id = $2
      WHERE m.empresa_id = $1 AND m.creado_en > p.ultimo_leido_en AND m.autor_id <> $2`, [empresaId, usuarioId]);
  res.json({ ok: true, total: r.total });
}));

router.post('/conversaciones', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const d = z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('directo'), usuario_id: z.string().uuid() }),
    z.object({ tipo: z.literal('grupo'), nombre: z.string().trim().min(1).max(60), usuario_ids: z.array(z.string().uuid()).min(1) }),
  ]).parse(req.body);
  const ids = d.tipo === 'directo' ? [usuarioId, d.usuario_id] : [...new Set([usuarioId, ...d.usuario_ids])];
  if (d.tipo === 'directo' && d.usuario_id === usuarioId) throw invalido('Elige a otra persona');
  const { rows: validos } = await pool.query('SELECT usuario_id FROM app.miembros WHERE empresa_id = $1 AND usuario_id = ANY($2) AND activo', [empresaId, ids]);
  if (validos.length !== ids.length) throw invalido('Algún participante no es parte del equipo');

  if (d.tipo === 'directo') {
    const { rows: [ya] } = await pool.query(
      `SELECT c.conv_id FROM crm.equipo_conversaciones c
        WHERE c.empresa_id = $1 AND c.tipo = 'directo'
          AND (SELECT array_agg(usuario_id ORDER BY usuario_id) FROM crm.equipo_participantes WHERE conv_id = c.conv_id) = (SELECT array_agg(x ORDER BY x) FROM unnest($2::uuid[]) x)`,
      [empresaId, ids]);
    if (ya) { res.json({ ok: true, conv_id: ya.conv_id }); return; }
  }
  const convId = await tx(async (c) => {
    const { rows: [conv] } = await c.query<{ conv_id: number }>(
      `INSERT INTO crm.equipo_conversaciones (empresa_id, tipo, nombre, creado_por) VALUES ($1,$2,$3,$4) RETURNING conv_id`,
      [empresaId, d.tipo, d.tipo === 'grupo' ? d.nombre : null, usuarioId]);
    for (const u of ids) await c.query('INSERT INTO crm.equipo_participantes (conv_id, usuario_id) VALUES ($1,$2)', [conv.conv_id, u]);
    return conv.conv_id;
  });
  emitirUsuarios(ids, 'chat:conversaciones', {});
  res.status(201).json({ ok: true, conv_id: convId });
}));

router.get('/conversaciones/:id/mensajes', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const id = idParam(req);
  await verificarParticipante(empresaId, id, usuarioId);
  const { rows } = await pool.query(
    `SELECT m.*, u.nombre AS autor_nombre, u.color AS autor_color FROM crm.equipo_mensajes m
       LEFT JOIN app.usuarios u ON u.usuario_id = m.autor_id WHERE m.conv_id = $1 ORDER BY m.id DESC LIMIT 200`, [id]);
  res.json({ ok: true, items: rows.reverse() });
}));

router.post('/conversaciones/:id/mensajes', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const id = idParam(req);
  const { contenido } = z.object({ contenido: z.string().trim().min(1).max(4000) }).parse(req.body);
  await verificarParticipante(empresaId, id, usuarioId);
  const { rows: [m] } = await pool.query(
    `WITH ins AS (INSERT INTO crm.equipo_mensajes (conv_id, empresa_id, autor_id, contenido) VALUES ($1,$2,$3,$4) RETURNING *)
     SELECT ins.*, u.nombre AS autor_nombre, u.color AS autor_color FROM ins LEFT JOIN app.usuarios u ON u.usuario_id = ins.autor_id`,
    [id, empresaId, usuarioId, contenido]);
  await pool.query('UPDATE crm.equipo_conversaciones SET ultima_actividad = now() WHERE conv_id = $1', [id]);
  await pool.query('UPDATE crm.equipo_participantes SET ultimo_leido_en = now() WHERE conv_id = $1 AND usuario_id = $2', [id, usuarioId]);
  emitirUsuarios(await participantes(id), 'chat:mensaje', { conv_id: id, mensaje: m });
  res.status(201).json({ ok: true, mensaje: m });
}));

router.post('/conversaciones/:id/leer', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const id = idParam(req);
  await verificarParticipante(empresaId, id, usuarioId);
  await pool.query('UPDATE crm.equipo_participantes SET ultimo_leido_en = now() WHERE conv_id = $1 AND usuario_id = $2', [id, usuarioId]);
  emitirUsuarios([usuarioId], 'chat:leido', { conv_id: id });
  res.json({ ok: true });
}));

export default router;
