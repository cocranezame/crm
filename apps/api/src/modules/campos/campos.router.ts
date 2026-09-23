import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../../db/pool';
import { ah, idParam, invalido, noEncontrado } from '../../lib/http';
import { ctx, requireRol } from '../../middlewares/auth';

const router = Router();

const TIPOS = ['texto', 'numero', 'fecha', 'opcion', 'multi', 'telefono', 'email', 'booleano'] as const;
const sCampo = z.object({
  entidad: z.enum(['contacto', 'negocio']),
  clave: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, 'solo minúsculas, números y _ (empieza con letra)'),
  nombre: z.string().trim().min(1).max(60),
  tipo: z.enum(TIPOS),
  opciones: z.array(z.string().trim().min(1)).max(100).nullable().optional(),
  obligatorio: z.boolean().optional(),
});

router.get('/', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rows } = await pool.query(
    `SELECT * FROM crm.campos WHERE empresa_id = $1 ORDER BY entidad, orden, campo_id`, [empresaId]);
  res.json({ ok: true, campos: rows });
}));

router.post('/', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = sCampo.parse(req.body);
  if ((d.tipo === 'opcion' || d.tipo === 'multi') && !d.opciones?.length) throw invalido('Agrega al menos una opción');
  const { rows: [c] } = await pool.query(
    `INSERT INTO crm.campos (empresa_id, entidad, clave, nombre, tipo, opciones, obligatorio, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE((SELECT max(orden)+1 FROM crm.campos WHERE empresa_id=$1 AND entidad=$2),0))
     RETURNING *`,
    [empresaId, d.entidad, d.clave, d.nombre, d.tipo, d.opciones ? JSON.stringify(d.opciones) : null, d.obligatorio ?? false]);
  res.status(201).json({ ok: true, campo: c });
}));

router.patch('/:id', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  // La clave y el tipo no se cambian: los valores ya guardados dependen de ellos.
  const d = sCampo.pick({ nombre: true, opciones: true, obligatorio: true }).partial().parse(req.body);
  const { rows: [c] } = await pool.query(
    `UPDATE crm.campos SET nombre = COALESCE($3, nombre),
            opciones = CASE WHEN $4::boolean THEN $5::jsonb ELSE opciones END,
            obligatorio = COALESCE($6, obligatorio)
      WHERE campo_id = $1 AND empresa_id = $2 RETURNING *`,
    [idParam(req), empresaId, d.nombre ?? null, d.opciones !== undefined, d.opciones ? JSON.stringify(d.opciones) : null, d.obligatorio ?? null]);
  if (!c) throw noEncontrado('Campo');
  res.json({ ok: true, campo: c });
}));

router.delete('/:id', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  await tx(async (c) => {
    const { rows: [f] } = await c.query<{ clave: string; entidad: string }>(
      'DELETE FROM crm.campos WHERE campo_id = $1 AND empresa_id = $2 RETURNING clave, entidad', [idParam(req), empresaId]);
    if (!f) throw noEncontrado('Campo');
    const tabla = f.entidad === 'contacto' ? 'crm.contactos' : 'crm.negocios';
    await c.query(`UPDATE ${tabla} SET valores = valores - $2 WHERE empresa_id = $1 AND valores ? $2`, [empresaId, f.clave]);
  });
  res.json({ ok: true });
}));

router.put('/orden', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { campo_ids } = z.object({ campo_ids: z.array(z.number().int()).min(1) }).parse(req.body);
  await tx(async (c) => {
    for (const [i, id] of campo_ids.entries()) {
      await c.query('UPDATE crm.campos SET orden = $3 WHERE campo_id = $1 AND empresa_id = $2', [id, empresaId, i]);
    }
  });
  res.json({ ok: true });
}));

export default router;
