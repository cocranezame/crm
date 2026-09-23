import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah, idParam, noEncontrado } from '../../lib/http';
import { ctx, requireRol } from '../../middlewares/auth';

const router = Router();
const sEtiqueta = z.object({
  nombre: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  grupo_exclusivo: z.string().trim().max(40).nullable().optional().transform((v) => (v ? v.toLowerCase() : null)),
});

router.get('/', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rows } = await pool.query(
    `SELECT e.*, (SELECT count(*) FROM crm.contacto_etiquetas ce JOIN crm.contactos c USING (contacto_id)
                   WHERE ce.etiqueta_id = e.etiqueta_id AND c.eliminado_en IS NULL)::int AS contactos
       FROM crm.etiquetas e WHERE e.empresa_id = $1 ORDER BY e.grupo_exclusivo NULLS LAST, e.nombre`, [empresaId]);
  res.json({ ok: true, etiquetas: rows });
}));

router.post('/', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = sEtiqueta.parse(req.body);
  const { rows: [e] } = await pool.query(
    `INSERT INTO crm.etiquetas (empresa_id, nombre, color, grupo_exclusivo) VALUES ($1,$2,$3,$4) RETURNING *`,
    [empresaId, d.nombre, d.color, d.grupo_exclusivo ?? null]);
  res.status(201).json({ ok: true, etiqueta: { ...e, contactos: 0 } });
}));

router.patch('/:id', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = sEtiqueta.partial().parse(req.body);
  const { rows: [e] } = await pool.query(
    `UPDATE crm.etiquetas SET nombre = COALESCE($3, nombre), color = COALESCE($4, color),
            grupo_exclusivo = CASE WHEN $5::boolean THEN $6 ELSE grupo_exclusivo END
      WHERE etiqueta_id = $1 AND empresa_id = $2 RETURNING *`,
    [idParam(req), empresaId, d.nombre ?? null, d.color ?? null, 'grupo_exclusivo' in req.body, d.grupo_exclusivo ?? null]);
  if (!e) throw noEncontrado('Etiqueta');
  res.json({ ok: true, etiqueta: e });
}));

router.delete('/:id', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rowCount } = await pool.query('DELETE FROM crm.etiquetas WHERE etiqueta_id = $1 AND empresa_id = $2', [idParam(req), empresaId]);
  if (!rowCount) throw noEncontrado('Etiqueta');
  res.json({ ok: true });
}));

export default router;
