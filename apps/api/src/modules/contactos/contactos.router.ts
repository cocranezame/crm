import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../../db/pool';
import { ah, conflicto, idParam, invalido, noEncontrado } from '../../lib/http';
import { ctx, requireRol } from '../../middlewares/auth';
import { normalizarTelefono } from '../../lib/telefono';
import { verificarLimite } from '../../lib/planes';
import { emitirEmpresa } from '../../lib/realtime';
import { validarValores } from '../campos/valores';
import { aplicarEtiqueta, quitarEtiqueta, reemplazarEtiquetas } from '../etiquetas/etiquetas.service';
import { crearNegocio } from '../pipelines/negocios.service';

const router = Router();

const sContacto = z.object({
  nombre: z.string().trim().max(120).nullable().optional(),
  telefono: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(120).nullable().optional().or(z.literal('').transform(() => null)),
  documento: z.string().trim().max(30).nullable().optional(),
  empresa_nombre: z.string().trim().max(120).nullable().optional(),
  asignado_a: z.string().uuid().nullable().optional(),
  valores: z.record(z.unknown()).optional(),
});

function telefonoValido(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const t = normalizarTelefono(v);
  if (!t) throw invalido('Teléfono inválido: usa formato internacional (+51 987 654 321) o 9 dígitos');
  return t;
}

// ── Listado ────────────────────────────────────────────────────────────────

router.get('/', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null;
  const etiqueta = req.query.etiqueta_id ? Number(req.query.etiqueta_id) : null;
  const asignado = typeof req.query.asignado === 'string' && req.query.asignado ? req.query.asignado : null;
  const origen = typeof req.query.origen === 'string' && req.query.origen ? req.query.origen : null;
  const limit = Math.min(Number(req.query.limit) || 25, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const ordenes: Record<string, string> = {
    recientes: 'c.creado_en DESC', nombre: 'c.nombre ASC NULLS LAST', actividad: 'ultima_actividad DESC NULLS LAST',
  };
  const orden = ordenes[String(req.query.orden)] ?? ordenes.recientes;

  const where = `c.empresa_id = $1 AND c.eliminado_en IS NULL
    AND ($2::text IS NULL OR c.nombre ILIKE '%'||$2||'%' OR c.telefono ILIKE '%'||$2||'%' OR c.email ILIKE '%'||$2||'%' OR c.documento ILIKE '%'||$2||'%' OR c.empresa_nombre ILIKE '%'||$2||'%')
    AND ($3::bigint IS NULL OR EXISTS (SELECT 1 FROM crm.contacto_etiquetas ce WHERE ce.contacto_id = c.contacto_id AND ce.etiqueta_id = $3))
    AND ($4::uuid IS NULL OR c.asignado_a = $4)
    AND ($5::text IS NULL OR c.origen = $5)`;
  const params = [empresaId, q, etiqueta, asignado, origen];

  const [{ rows: items }, { rows: [{ total }] }] = await Promise.all([
    pool.query(
      `SELECT c.contacto_id, c.nombre, c.telefono, c.email, c.documento, c.empresa_nombre, c.origen, c.creado_en, c.asignado_a,
              u.nombre AS asignado_nombre, u.color AS asignado_color,
              (SELECT max(cv.ultima_actividad) FROM crm.conversaciones cv WHERE cv.contacto_id = c.contacto_id) AS ultima_actividad,
              COALESCE((SELECT json_agg(json_build_object('etiqueta_id', e.etiqueta_id, 'nombre', e.nombre, 'color', e.color) ORDER BY e.nombre)
                          FROM crm.contacto_etiquetas ce JOIN crm.etiquetas e USING (etiqueta_id) WHERE ce.contacto_id = c.contacto_id), '[]') AS etiquetas,
              COALESCE((SELECT json_agg(DISTINCT i.canal) FROM crm.identidades i WHERE i.contacto_id = c.contacto_id), '[]') AS canales
         FROM crm.contactos c LEFT JOIN app.usuarios u ON u.usuario_id = c.asignado_a
        WHERE ${where} ORDER BY ${orden}, c.contacto_id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params),
    pool.query(`SELECT count(*)::int AS total FROM crm.contactos c WHERE ${where}`, params),
  ]);
  res.json({ ok: true, items, total, page, limit });
}));

// ── Exportar CSV ───────────────────────────────────────────────────────────

router.get('/exportar', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rows: campos } = await pool.query<{ clave: string; nombre: string }>(
    `SELECT clave, nombre FROM crm.campos WHERE empresa_id = $1 AND entidad = 'contacto' ORDER BY orden`, [empresaId]);
  const { rows } = await pool.query(
    `SELECT c.*, (SELECT string_agg(e.nombre, '|' ORDER BY e.nombre) FROM crm.contacto_etiquetas ce
                   JOIN crm.etiquetas e USING (etiqueta_id) WHERE ce.contacto_id = c.contacto_id) AS etiquetas
       FROM crm.contactos c WHERE c.empresa_id = $1 AND c.eliminado_en IS NULL ORDER BY c.contacto_id`, [empresaId]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('|') : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cab = ['id', 'nombre', 'telefono', 'email', 'documento', 'empresa', 'origen', 'etiquetas', 'creado_en', ...campos.map((c) => c.clave)];
  const lineas = rows.map((r) => [r.contacto_id, r.nombre, r.telefono, r.email, r.documento, r.empresa_nombre, r.origen, r.etiquetas,
    new Date(r.creado_en).toISOString(), ...campos.map((c) => r.valores?.[c.clave])].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="contactos-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + [cab.join(','), ...lineas].join('\n'));
}));

// ── Crear ──────────────────────────────────────────────────────────────────

router.post('/', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const d = sContacto.extend({
    etiqueta_ids: z.array(z.number().int()).optional(),
    pipeline_id: z.number().int().nullable().optional(),
  }).parse(req.body);
  if (!d.nombre && !d.telefono && !d.email) throw invalido('Ingresa al menos nombre, teléfono o email');
  await verificarLimite(empresaId, 'contactos');
  const c = await tx(async (db) => {
    const valores = await validarValores(db, empresaId, 'contacto', d.valores);
    const { rows: [c] } = await db.query(
      `INSERT INTO crm.contactos (empresa_id, nombre, telefono, email, documento, empresa_nombre, asignado_a, valores, origen, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9) RETURNING *`,
      [empresaId, d.nombre || null, telefonoValido(d.telefono), d.email || null, d.documento || null, d.empresa_nombre || null,
       d.asignado_a ?? null, JSON.stringify(valores), usuarioId]);
    if (d.etiqueta_ids?.length) await reemplazarEtiquetas(db, empresaId, c.contacto_id, d.etiqueta_ids);
    if (d.pipeline_id) {
      await crearNegocio(db, empresaId, { contacto_id: c.contacto_id, pipeline_id: d.pipeline_id, titulo: d.nombre ?? null, asignado_a: d.asignado_a ?? null },
        { tipo: 'humano', id: usuarioId });
    }
    return c;
  });
  emitirEmpresa(empresaId, 'contactos:cambio', { contacto_id: c.contacto_id });
  res.status(201).json({ ok: true, contacto: c });
}));

// ── Importar CSV (el navegador parsea y manda filas ya mapeadas) ────────────

const sFila = z.object({
  nombre: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  documento: z.string().optional().nullable(),
  empresa_nombre: z.string().optional().nullable(),
  valores: z.record(z.unknown()).optional(),
});

router.post('/importar', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const d = z.object({
    filas: z.array(sFila).min(1).max(5000),
    etiqueta_ids: z.array(z.number().int()).optional(),
    duplicados: z.enum(['omitir', 'actualizar']).default('omitir'),
  }).parse(req.body);

  const resultado = { creados: 0, actualizados: 0, omitidos: 0, errores: [] as Array<{ fila: number; error: string }> };
  const { rows: [{ n: actuales }] } = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM crm.contactos WHERE empresa_id = $1 AND eliminado_en IS NULL', [empresaId]);
  const { rows: [{ plan }] } = await pool.query<{ plan: string }>('SELECT plan FROM app.empresas WHERE empresa_id = $1', [empresaId]);
  const { PLANES } = await import('../../lib/planes');
  let cupo = PLANES[plan as keyof typeof PLANES].contactos - actuales;

  for (const [i, f] of d.filas.entries()) {
    const numFila = i + 2; // +1 por cabecera, +1 base 1
    try {
      const telefono = f.telefono ? normalizarTelefono(f.telefono) : null;
      if (f.telefono && !telefono) throw new Error(`teléfono inválido "${f.telefono}"`);
      const email = f.email?.trim().toLowerCase() || null;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`email inválido "${f.email}"`);
      if (!f.nombre?.trim() && !telefono && !email) throw new Error('fila vacía (sin nombre, teléfono ni email)');

      await tx(async (db) => {
        const valores = await validarValores(db, empresaId, 'contacto', f.valores ?? {}, { parcial: true });
        const { rows: [ex] } = await db.query<{ contacto_id: number }>(
          `SELECT contacto_id FROM crm.contactos WHERE empresa_id = $1 AND eliminado_en IS NULL
             AND ((telefono IS NOT NULL AND telefono = $2) OR ($3::text IS NOT NULL AND lower(email) = $3)) LIMIT 1`,
          [empresaId, telefono, email]);
        let id: number;
        if (ex) {
          if (d.duplicados === 'omitir') { resultado.omitidos++; return; }
          await db.query(
            `UPDATE crm.contactos SET nombre = COALESCE($3, nombre), email = COALESCE($4, email), documento = COALESCE($5, documento),
                    empresa_nombre = COALESCE($6, empresa_nombre), valores = valores || $7::jsonb, actualizado_en = now()
              WHERE contacto_id = $1 AND empresa_id = $2`,
            [ex.contacto_id, empresaId, f.nombre?.trim() || null, email, f.documento?.trim() || null, f.empresa_nombre?.trim() || null, JSON.stringify(valores)]);
          id = ex.contacto_id;
          resultado.actualizados++;
        } else {
          if (cupo <= 0) throw new Error('límite de contactos del plan alcanzado');
          const { rows: [c] } = await db.query<{ contacto_id: number }>(
            `INSERT INTO crm.contactos (empresa_id, nombre, telefono, email, documento, empresa_nombre, valores, origen, creado_por)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'importacion',$8) RETURNING contacto_id`,
            [empresaId, f.nombre?.trim() || null, telefono, email, f.documento?.trim() || null, f.empresa_nombre?.trim() || null, JSON.stringify(valores), usuarioId]);
          id = c.contacto_id;
          cupo--;
          resultado.creados++;
        }
        for (const et of d.etiqueta_ids ?? []) await aplicarEtiqueta(db, empresaId, id, et, 'sistema');
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resultado.errores.push({ fila: numFila, error: msg });
    }
  }
  emitirEmpresa(empresaId, 'contactos:cambio', {});
  res.json({ ok: true, ...resultado });
}));

// ── Ficha ──────────────────────────────────────────────────────────────────

router.get('/:id', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rows: [c] } = await pool.query(
    `SELECT c.*, u.nombre AS asignado_nombre, cr.nombre AS creado_por_nombre
       FROM crm.contactos c LEFT JOIN app.usuarios u ON u.usuario_id = c.asignado_a
       LEFT JOIN app.usuarios cr ON cr.usuario_id = c.creado_por
      WHERE c.contacto_id = $1 AND c.empresa_id = $2 AND c.eliminado_en IS NULL`, [id, empresaId]);
  if (!c) throw noEncontrado('Contacto');
  const [etiquetas, identidades, negocios, conversaciones, notas] = await Promise.all([
    pool.query(`SELECT e.*, ce.aplicada_por, ce.aplicada_en FROM crm.contacto_etiquetas ce JOIN crm.etiquetas e USING (etiqueta_id)
                 WHERE ce.contacto_id = $1 ORDER BY e.nombre`, [id]),
    pool.query('SELECT * FROM crm.identidades WHERE contacto_id = $1 ORDER BY creado_en', [id]),
    pool.query(`SELECT n.*, p.nombre AS pipeline_nombre, p.color AS pipeline_color, e.nombre AS etapa_nombre, e.color AS etapa_color, e.tipo AS etapa_tipo,
                       u.nombre AS asignado_nombre
                  FROM crm.negocios n JOIN crm.pipelines p USING (pipeline_id) JOIN crm.etapas e ON e.etapa_id = n.etapa_id
                  LEFT JOIN app.usuarios u ON u.usuario_id = n.asignado_a
                 WHERE n.contacto_id = $1 ORDER BY n.cerrado_en NULLS FIRST, n.creado_en DESC`, [id]),
    pool.query(`SELECT cv.conversacion_id, cv.estado, cv.ultima_actividad, cv.ultimo_mensaje, cv.no_leidos, ca.tipo AS canal, ca.nombre AS canal_nombre
                  FROM crm.conversaciones cv JOIN crm.canales ca USING (canal_id)
                 WHERE cv.contacto_id = $1 ORDER BY cv.ultima_actividad DESC`, [id]),
    pool.query(`SELECT n.*, u.nombre AS autor_nombre, u.color AS autor_color FROM crm.contacto_notas n
                  LEFT JOIN app.usuarios u ON u.usuario_id = n.autor_id WHERE n.contacto_id = $1 ORDER BY n.creado_en DESC`, [id]),
  ]);
  res.json({
    ok: true, contacto: c, etiquetas: etiquetas.rows, identidades: identidades.rows,
    negocios: negocios.rows, conversaciones: conversaciones.rows, notas: notas.rows,
  });
}));

router.patch('/:id', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const d = sContacto.parse(req.body);
  const c = await tx(async (db) => {
    const valores = d.valores ? await validarValores(db, empresaId, 'contacto', d.valores, { parcial: true }) : null;
    const has = (k: string) => k in req.body;
    const { rows: [c] } = await db.query(
      `UPDATE crm.contactos SET
         nombre = CASE WHEN $3 THEN $4 ELSE nombre END,
         telefono = CASE WHEN $5 THEN $6 ELSE telefono END,
         email = CASE WHEN $7 THEN $8 ELSE email END,
         documento = CASE WHEN $9 THEN $10 ELSE documento END,
         empresa_nombre = CASE WHEN $11 THEN $12 ELSE empresa_nombre END,
         asignado_a = CASE WHEN $13 THEN $14::uuid ELSE asignado_a END,
         valores = CASE WHEN $15::jsonb IS NULL THEN valores ELSE jsonb_strip_nulls(valores || $15::jsonb) END,
         actualizado_en = now()
       WHERE contacto_id = $1 AND empresa_id = $2 AND eliminado_en IS NULL RETURNING *`,
      [id, empresaId, has('nombre'), d.nombre || null, has('telefono'), has('telefono') ? telefonoValido(d.telefono) : null,
       has('email'), d.email || null, has('documento'), d.documento || null, has('empresa_nombre'), d.empresa_nombre || null,
       has('asignado_a'), d.asignado_a ?? null, valores ? JSON.stringify(valores) : null]);
    if (!c) throw noEncontrado('Contacto');
    return c;
  });
  emitirEmpresa(empresaId, 'contactos:cambio', { contacto_id: id });
  res.json({ ok: true, contacto: c });
}));

router.delete('/:id', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rowCount } = await pool.query(
    `UPDATE crm.contactos SET eliminado_en = now() WHERE contacto_id = $1 AND empresa_id = $2 AND eliminado_en IS NULL`, [id, empresaId]);
  if (!rowCount) throw noEncontrado('Contacto');
  emitirEmpresa(empresaId, 'contactos:cambio', { contacto_id: id });
  res.json({ ok: true });
}));

// ── Fusionar: el contacto `origen_id` se integra en :id y se elimina ────────

router.post('/:id/fusionar', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const destino = idParam(req);
  const { origen_id } = z.object({ origen_id: z.number().int() }).parse(req.body);
  if (origen_id === destino) throw invalido('Elige dos contactos distintos');
  await tx(async (db) => {
    const { rows } = await db.query(
      `SELECT * FROM crm.contactos WHERE contacto_id = ANY($1) AND empresa_id = $2 AND eliminado_en IS NULL FOR UPDATE`,
      [[destino, origen_id], empresaId]);
    const d = rows.find((r) => r.contacto_id === destino);
    const o = rows.find((r) => r.contacto_id === origen_id);
    if (!d || !o) throw noEncontrado('Contacto');

    // Primero se libera el teléfono/email del origen (índices únicos) y se marca eliminado.
    await db.query('UPDATE crm.contactos SET eliminado_en = now(), telefono = NULL, email = NULL WHERE contacto_id = $1', [origen_id]);
    await db.query(
      `UPDATE crm.contactos SET nombre = COALESCE(nombre, $2), telefono = COALESCE(telefono, $3), email = COALESCE(email, $4),
              documento = COALESCE(documento, $5), empresa_nombre = COALESCE(empresa_nombre, $6),
              valores = $7::jsonb || valores, actualizado_en = now()
        WHERE contacto_id = $1`,
      [destino, o.nombre, o.telefono, o.email, o.documento, o.empresa_nombre, JSON.stringify(o.valores ?? {})]);

    await db.query('UPDATE crm.identidades SET contacto_id = $1 WHERE contacto_id = $2', [destino, origen_id]);
    await db.query('UPDATE crm.conversaciones SET contacto_id = $1 WHERE contacto_id = $2', [destino, origen_id]);
    await db.query('UPDATE crm.contacto_notas SET contacto_id = $1 WHERE contacto_id = $2', [destino, origen_id]);
    await db.query(
      `INSERT INTO crm.contacto_etiquetas (contacto_id, etiqueta_id, aplicada_por)
       SELECT $1, etiqueta_id, aplicada_por FROM crm.contacto_etiquetas WHERE contacto_id = $2 ON CONFLICT DO NOTHING`, [destino, origen_id]);
    // Negocios: si ambos tienen uno abierto en el mismo pipeline, el del origen se cierra.
    await db.query(
      `UPDATE crm.negocios o SET cerrado_en = now()
        WHERE o.contacto_id = $2 AND o.cerrado_en IS NULL
          AND EXISTS (SELECT 1 FROM crm.negocios d WHERE d.contacto_id = $1 AND d.pipeline_id = o.pipeline_id AND d.cerrado_en IS NULL)`,
      [destino, origen_id]);
    await db.query('UPDATE crm.negocios SET contacto_id = $1 WHERE contacto_id = $2', [destino, origen_id]);
    await db.query('UPDATE crm.difusion_destinatarios SET contacto_id = $1 WHERE contacto_id = $2 AND NOT EXISTS (SELECT 1 FROM crm.difusion_destinatarios x WHERE x.contacto_id = $1 AND x.difusion_id = crm.difusion_destinatarios.difusion_id)', [destino, origen_id]);
  }).catch((e) => {
    if ((e as { code?: string }).code === '23505') throw conflicto('No se pudo fusionar: ambos contactos tienen conversación en el mismo canal y cuenta');
    throw e;
  });
  emitirEmpresa(empresaId, 'contactos:cambio', { contacto_id: destino });
  res.json({ ok: true });
}));

// ── Etiquetas del contacto ─────────────────────────────────────────────────

router.put('/:id/etiquetas', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { etiqueta_ids } = z.object({ etiqueta_ids: z.array(z.number().int()) }).parse(req.body);
  await tx(async (db) => {
    const { rows: [c] } = await db.query('SELECT 1 FROM crm.contactos WHERE contacto_id = $1 AND empresa_id = $2', [id, empresaId]);
    if (!c) throw noEncontrado('Contacto');
    await reemplazarEtiquetas(db, empresaId, id, etiqueta_ids);
  });
  emitirEmpresa(empresaId, 'contactos:cambio', { contacto_id: id });
  res.json({ ok: true });
}));

router.post('/:id/etiquetas/:etiquetaId', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  await tx(async (db) => {
    const { rows: [c] } = await db.query('SELECT 1 FROM crm.contactos WHERE contacto_id = $1 AND empresa_id = $2', [id, empresaId]);
    if (!c) throw noEncontrado('Contacto');
    await aplicarEtiqueta(db, empresaId, id, idParam(req, 'etiquetaId'), 'humano');
  });
  emitirEmpresa(empresaId, 'contactos:cambio', { contacto_id: id });
  res.json({ ok: true });
}));

router.delete('/:id/etiquetas/:etiquetaId', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rows: [c] } = await pool.query('SELECT 1 FROM crm.contactos WHERE contacto_id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!c) throw noEncontrado('Contacto');
  await quitarEtiqueta(pool, id, idParam(req, 'etiquetaId'));
  emitirEmpresa(empresaId, 'contactos:cambio', { contacto_id: id });
  res.json({ ok: true });
}));

// ── Notas ──────────────────────────────────────────────────────────────────

router.post('/:id/notas', ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const id = idParam(req);
  const { contenido } = z.object({ contenido: z.string().trim().min(1).max(5000) }).parse(req.body);
  const { rows: [c] } = await pool.query('SELECT 1 FROM crm.contactos WHERE contacto_id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!c) throw noEncontrado('Contacto');
  const { rows: [n] } = await pool.query(
    `INSERT INTO crm.contacto_notas (empresa_id, contacto_id, autor_id, contenido) VALUES ($1,$2,$3,$4) RETURNING *`,
    [empresaId, id, usuarioId, contenido]);
  res.status(201).json({ ok: true, nota: n });
}));

router.delete('/notas/:notaId', ah(async (req, res) => {
  const { empresaId, usuarioId, rol } = ctx(req);
  const { rows: [n] } = await pool.query('SELECT autor_id FROM crm.contacto_notas WHERE nota_id = $1 AND empresa_id = $2', [idParam(req, 'notaId'), empresaId]);
  if (!n) throw noEncontrado('Nota');
  if (n.autor_id !== usuarioId && rol === 'agente') throw invalido('Solo puedes borrar tus notas');
  await pool.query('DELETE FROM crm.contacto_notas WHERE nota_id = $1', [idParam(req, 'notaId')]);
  res.json({ ok: true });
}));

export default router;
