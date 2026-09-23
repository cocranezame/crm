import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah, idParam, noEncontrado, prohibido } from '../../lib/http';
import { ctx, tieneRol } from '../../middlewares/auth';

const router = Router();
const sResp = z.object({
  atajo: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/, 'solo minúsculas, números, - y _'),
  titulo: z.string().trim().min(1).max(80),
  contenido: z.string().trim().min(1).max(4000),
  carpeta: z.string().trim().max(40).nullable().optional(),
  media_url: z.string().max(1000).nullable().optional(),
  visible_para: z.enum(['todos', 'solo_yo']).optional(),
});

router.get('/', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const { rows } = await pool.query(
    `SELECT r.*, u.nombre AS creado_por_nombre FROM crm.respuestas_rapidas r
       LEFT JOIN app.usuarios u ON u.usuario_id = r.creado_por
      WHERE r.empresa_id = $1 AND (r.visible_para = 'todos' OR r.creado_por = $2)
      ORDER BY r.carpeta NULLS LAST, r.atajo`, [empresaId, usuarioId]);
  res.json({ ok: true, respuestas: rows });
}));

router.post('/', ah(async (req, res) => {
  const { empresaId, usuarioId, rol } = ctx(req);
  const d = sResp.parse(req.body);
  // Un agente solo puede crear respuestas personales
  const visible = tieneRol(rol, 'supervisor') ? (d.visible_para ?? 'todos') : 'solo_yo';
  const { rows: [r] } = await pool.query(
    `INSERT INTO crm.respuestas_rapidas (empresa_id, atajo, titulo, contenido, carpeta, media_url, visible_para, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [empresaId, d.atajo, d.titulo, d.contenido, d.carpeta ?? null, d.media_url ?? null, visible, usuarioId]);
  res.status(201).json({ ok: true, respuesta: r });
}));

async function puedeEditar(req: Parameters<typeof ctx>[0], id: number) {
  const { empresaId, usuarioId, rol } = ctx(req);
  const { rows: [r] } = await pool.query('SELECT creado_por FROM crm.respuestas_rapidas WHERE respuesta_id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!r) throw noEncontrado('Respuesta rápida');
  if (r.creado_por !== usuarioId && !tieneRol(rol, 'supervisor')) throw prohibido();
}

router.patch('/:id', ah(async (req, res) => {
  const { empresaId, rol } = ctx(req);
  const id = idParam(req);
  await puedeEditar(req, id);
  const d = sResp.partial().parse(req.body);
  if (d.visible_para === 'todos' && !tieneRol(rol, 'supervisor')) throw prohibido('Solo supervisores pueden compartir respuestas con todo el equipo');
  const { rows: [r] } = await pool.query(
    `UPDATE crm.respuestas_rapidas SET atajo = COALESCE($3, atajo), titulo = COALESCE($4, titulo),
            contenido = COALESCE($5, contenido), carpeta = CASE WHEN $6::boolean THEN $7 ELSE carpeta END,
            media_url = CASE WHEN $8::boolean THEN $9 ELSE media_url END, visible_para = COALESCE($10, visible_para)
      WHERE respuesta_id = $1 AND empresa_id = $2 RETURNING *`,
    [id, empresaId, d.atajo ?? null, d.titulo ?? null, d.contenido ?? null, 'carpeta' in req.body, d.carpeta ?? null,
     'media_url' in req.body, d.media_url ?? null, d.visible_para ?? null]);
  res.json({ ok: true, respuesta: r });
}));

router.delete('/:id', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  await puedeEditar(req, id);
  await pool.query('DELETE FROM crm.respuestas_rapidas WHERE respuesta_id = $1 AND empresa_id = $2', [id, empresaId]);
  res.json({ ok: true });
}));

export default router;
