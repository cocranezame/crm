// Difusiones: envío masivo de una plantilla aprobada de WhatsApp a los contactos de
// una o varias etiquetas. El envío corre en segundo plano dentro del API y se
// reanuda solo si el proceso se reinicia (estado 'enviando' en BD).
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah, idParam, invalido, noEncontrado } from '../../lib/http';
import { verificarLimite } from '../../lib/planes';
import { emitirEmpresa } from '../../lib/realtime';
import { ctx, requireRol } from '../../middlewares/auth';
import { enviarPlantilla } from '../canales/envio.service';
import { asegurarConversacion } from '../conversaciones/conversaciones.service';
import { renderPlantilla, type VariablePlantilla } from '../plantillas/plantillas.service';

const router = Router();

const AUDIENCIA = `
  FROM crm.contactos c
 WHERE c.empresa_id = $1 AND c.eliminado_en IS NULL AND c.telefono IS NOT NULL
   AND (cardinality($2::bigint[]) = 0 OR EXISTS (
         SELECT 1 FROM crm.contacto_etiquetas ce WHERE ce.contacto_id = c.contacto_id AND ce.etiqueta_id = ANY($2)))`;

router.get('/', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rows } = await pool.query(
    `SELECT d.*, c.nombre AS canal_nombre, p.nombre AS plantilla_nombre, u.nombre AS creado_por_nombre,
            COALESCE((SELECT json_agg(json_build_object('etiqueta_id', e.etiqueta_id, 'nombre', e.nombre, 'color', e.color))
                        FROM crm.etiquetas e WHERE e.etiqueta_id = ANY(d.etiqueta_ids)), '[]') AS etiquetas
       FROM crm.difusiones d JOIN crm.canales c USING (canal_id) JOIN crm.plantillas p USING (plantilla_id)
       LEFT JOIN app.usuarios u ON u.usuario_id = d.creado_por
      WHERE d.empresa_id = $1 ORDER BY d.creado_en DESC`, [empresaId]);
  res.json({ ok: true, difusiones: rows });
}));

router.get('/audiencia', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const ids = String(req.query.etiqueta_ids ?? '').split(',').filter(Boolean).map(Number).filter(Number.isInteger);
  const { rows: [r] } = await pool.query(`SELECT count(*)::int AS total ${AUDIENCIA}`, [empresaId, ids]);
  res.json({ ok: true, total: r.total });
}));

router.post('/', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const d = z.object({
    nombre: z.string().trim().min(1).max(80), canal_id: z.number().int(), plantilla_id: z.number().int(),
    etiqueta_ids: z.array(z.number().int()).default([]),
  }).parse(req.body);
  const { rows: [p] } = await pool.query('SELECT estado, canal_id FROM crm.plantillas WHERE plantilla_id = $1 AND empresa_id = $2', [d.plantilla_id, empresaId]);
  if (!p) throw noEncontrado('Plantilla');
  if (p.canal_id !== d.canal_id) throw invalido('La plantilla es de otra cuenta de WhatsApp');
  if (p.estado !== 'aprobada') throw invalido('La plantilla debe estar aprobada por Meta');
  const { rows: [x] } = await pool.query(
    `INSERT INTO crm.difusiones (empresa_id, nombre, canal_id, plantilla_id, etiqueta_ids, creado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [empresaId, d.nombre, d.canal_id, d.plantilla_id, d.etiqueta_ids, usuarioId]);
  res.status(201).json({ ok: true, difusion: x });
}));

router.get('/:id', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rows: [d] } = await pool.query(
    `SELECT d.*, c.nombre AS canal_nombre, p.nombre AS plantilla_nombre, p.cuerpo AS plantilla_cuerpo
       FROM crm.difusiones d JOIN crm.canales c USING (canal_id) JOIN crm.plantillas p USING (plantilla_id)
      WHERE d.difusion_id = $1 AND d.empresa_id = $2`, [id, empresaId]);
  if (!d) throw noEncontrado('Difusión');
  const estado = typeof req.query.estado === 'string' && req.query.estado ? req.query.estado : null;
  const { rows: destinatarios } = await pool.query(
    `SELECT x.*, c.nombre AS contacto_nombre FROM crm.difusion_destinatarios x JOIN crm.contactos c USING (contacto_id)
      WHERE x.difusion_id = $1 AND ($2::text IS NULL OR x.estado = $2) ORDER BY x.id LIMIT 500`, [id, estado]);
  res.json({ ok: true, difusion: d, destinatarios });
}));

router.post('/:id/iniciar', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rows: [d] } = await pool.query('SELECT * FROM crm.difusiones WHERE difusion_id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!d) throw noEncontrado('Difusión');
  if (d.estado !== 'borrador') throw invalido('La difusión ya fue iniciada');
  await verificarLimite(empresaId, 'difusionesMes');
  const { rowCount } = await pool.query(
    `INSERT INTO crm.difusion_destinatarios (difusion_id, empresa_id, contacto_id, destino)
     SELECT $3, $1, c.contacto_id, c.telefono ${AUDIENCIA} ON CONFLICT DO NOTHING`, [empresaId, d.etiqueta_ids, id]);
  if (!rowCount) throw invalido('La audiencia está vacía: ningún contacto con teléfono tiene esas etiquetas');
  await pool.query(`UPDATE crm.difusiones SET estado = 'enviando', total = $2, iniciada_en = now() WHERE difusion_id = $1`, [id, rowCount]);
  void ejecutarDifusion(id);
  res.json({ ok: true, total: rowCount });
}));

router.post('/:id/cancelar', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rowCount } = await pool.query(
    `UPDATE crm.difusiones SET estado = 'cancelada', finalizada_en = now() WHERE difusion_id = $1 AND empresa_id = $2 AND estado IN ('borrador','enviando')`,
    [idParam(req), empresaId]);
  if (!rowCount) throw invalido('La difusión no se puede cancelar');
  emitirEmpresa(empresaId, 'difusion:progreso', { difusion_id: idParam(req) });
  res.json({ ok: true });
}));

router.delete('/:id', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rowCount } = await pool.query(
    `DELETE FROM crm.difusiones WHERE difusion_id = $1 AND empresa_id = $2 AND estado IN ('borrador','cancelada','completada')`, [idParam(req), empresaId]);
  if (!rowCount) throw invalido('No se puede eliminar una difusión en curso');
  res.json({ ok: true });
}));

// ── Ejecutor ───────────────────────────────────────────────────────────────

const enCurso = new Set<number>();
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ejecutarDifusion(id: number): Promise<void> {
  if (enCurso.has(id)) return;
  enCurso.add(id);
  try {
    const { rows: [d] } = await pool.query(
      `SELECT d.*, p.nombre AS p_nombre, p.idioma, p.cuerpo, p.variables FROM crm.difusiones d JOIN crm.plantillas p USING (plantilla_id) WHERE d.difusion_id = $1`, [id]);
    if (!d) return;
    for (;;) {
      const { rows: [estado] } = await pool.query('SELECT estado FROM crm.difusiones WHERE difusion_id = $1', [id]);
      if (estado?.estado !== 'enviando') return;
      const { rows: lote } = await pool.query(
        `SELECT id, contacto_id FROM crm.difusion_destinatarios WHERE difusion_id = $1 AND estado = 'pendiente' ORDER BY id LIMIT 20`, [id]);
      if (!lote.length) break;
      for (const x of lote) {
        let ok = false, error: string | null = null, externo: string | null = null;
        try {
          const convId = await asegurarConversacion(d.empresa_id, x.contacto_id, d.canal_id);
          const r = await renderPlantilla(d.empresa_id, { cuerpo: d.cuerpo, variables: d.variables as VariablePlantilla[] }, x.contacto_id, {});
          const out = await enviarPlantilla(d.empresa_id, convId,
            { plantilla_id: d.plantilla_id, nombre: d.p_nombre, idioma: d.idioma, parametros: r.parametros, texto: r.texto },
            { tipo: 'sistema', id: d.creado_por });
          ok = out.resultado.ok;
          error = out.resultado.error ?? null;
          externo = out.resultado.mensajeExternoId ?? null;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        await pool.query(
          `UPDATE crm.difusion_destinatarios SET estado = $2, error = $3, externo_id = $4, enviado_en = now() WHERE id = $1`,
          [x.id, ok ? 'enviado' : 'error', error, externo]);
        await pool.query(
          `UPDATE crm.difusiones SET enviados = enviados + $2, fallidos = fallidos + $3 WHERE difusion_id = $1`, [id, ok ? 1 : 0, ok ? 0 : 1]);
        emitirEmpresa(d.empresa_id, 'difusion:progreso', { difusion_id: id });
        await pausa(250);
      }
    }
    await pool.query(`UPDATE crm.difusiones SET estado = 'completada', finalizada_en = now() WHERE difusion_id = $1 AND estado = 'enviando'`, [id]);
    emitirEmpresa(d.empresa_id, 'difusion:progreso', { difusion_id: id });
  } catch (e) {
    console.error(`[difusion ${id}]`, e);
  } finally {
    enCurso.delete(id);
  }
}

/** Al arrancar el API se reanudan las difusiones que quedaron a medias. */
export async function reanudarDifusiones(): Promise<void> {
  const { rows } = await pool.query<{ difusion_id: number }>(`SELECT difusion_id FROM crm.difusiones WHERE estado = 'enviando'`);
  for (const r of rows) void ejecutarDifusion(r.difusion_id);
}

export default router;
