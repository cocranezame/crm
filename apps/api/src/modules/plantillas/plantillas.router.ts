import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah, idParam, invalido, noEncontrado } from '../../lib/http';
import { emitirEmpresa } from '../../lib/realtime';
import { ctx, requireRol } from '../../middlewares/auth';
import { cuentaDeEmpresa } from '../canales/cuentas.service';
import { graph } from '../canales/graph';
import { renderPlantilla, validarVariables, type VariablePlantilla } from './plantillas.service';

const router = Router();

const sVariable = z.object({
  indice: z.number().int().min(1), origen: z.enum(['contacto', 'campo', 'empresa', 'manual']),
  valor: z.string().max(200).default(''), ejemplo: z.string().max(200).default(''),
});
const sBoton = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('QUICK_REPLY'), texto: z.string().trim().min(1).max(25) }),
  z.object({ tipo: z.literal('URL'), texto: z.string().trim().min(1).max(25), url: z.string().url().max(2000) }),
  z.object({ tipo: z.literal('PHONE_NUMBER'), texto: z.string().trim().min(1).max(25), telefono: z.string().regex(/^\+\d{8,15}$/) }),
]);
const sPlantilla = z.object({
  canal_id: z.number().int(),
  nombre: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,512}$/, 'solo minúsculas, números y _'),
  idioma: z.string().default('es'),
  categoria: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('MARKETING'),
  encabezado: z.string().trim().max(60).nullable().optional(),
  cuerpo: z.string().trim().min(1).max(1024),
  pie: z.string().trim().max(60).nullable().optional(),
  botones: z.array(sBoton).max(10).default([]),
  variables: z.array(sVariable).default([]),
});

router.get('/', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const canal = req.query.canal_id ? Number(req.query.canal_id) : null;
  const { rows } = await pool.query(
    `SELECT p.*, c.nombre AS canal_nombre, c.sandbox, u.nombre AS creado_por_nombre
       FROM crm.plantillas p JOIN crm.canales c USING (canal_id) LEFT JOIN app.usuarios u ON u.usuario_id = p.creado_por
      WHERE p.empresa_id = $1 AND ($2::bigint IS NULL OR p.canal_id = $2) ORDER BY p.actualizado_en DESC`, [empresaId, canal]);
  res.json({ ok: true, plantillas: rows });
}));

async function canalWa(empresaId: string, canalId: number) {
  const c = await cuentaDeEmpresa(empresaId, canalId);
  if (c.tipo !== 'whatsapp') throw invalido('Las plantillas solo aplican a cuentas de WhatsApp');
  return c;
}

router.post('/', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const d = sPlantilla.parse(req.body);
  await canalWa(empresaId, d.canal_id);
  const variables = validarVariables(d.cuerpo, d.variables as VariablePlantilla[]);
  const { rows: [p] } = await pool.query(
    `INSERT INTO crm.plantillas (empresa_id, canal_id, nombre, idioma, categoria, encabezado, cuerpo, pie, botones, variables, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [empresaId, d.canal_id, d.nombre, d.idioma, d.categoria, d.encabezado || null, d.cuerpo, d.pie || null,
     JSON.stringify(d.botones), JSON.stringify(variables), usuarioId]);
  res.status(201).json({ ok: true, plantilla: p });
}));

router.patch('/:id', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rows: [act] } = await pool.query('SELECT * FROM crm.plantillas WHERE plantilla_id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!act) throw noEncontrado('Plantilla');
  const d = sPlantilla.omit({ canal_id: true }).partial().parse(req.body);
  const soloVariables = Object.keys(d).every((k) => k === 'variables');
  if (!['borrador', 'rechazada'].includes(act.estado) && !soloVariables) {
    throw invalido('Una plantilla enviada a Meta no se puede editar: crea una nueva versión. (Sí puedes cambiar el origen de sus variables.)');
  }
  const cuerpo = d.cuerpo ?? act.cuerpo;
  const variables = validarVariables(cuerpo, (d.variables ?? act.variables) as VariablePlantilla[]);
  const { rows: [p] } = await pool.query(
    `UPDATE crm.plantillas SET nombre = COALESCE($3, nombre), idioma = COALESCE($4, idioma), categoria = COALESCE($5, categoria),
            encabezado = CASE WHEN $6::boolean THEN $7 ELSE encabezado END, cuerpo = $8,
            pie = CASE WHEN $9::boolean THEN $10 ELSE pie END, botones = COALESCE($11, botones), variables = $12,
            estado = CASE WHEN estado = 'rechazada' AND NOT $13 THEN 'borrador' ELSE estado END, actualizado_en = now()
      WHERE plantilla_id = $1 AND empresa_id = $2 RETURNING *`,
    [id, empresaId, d.nombre ?? null, d.idioma ?? null, d.categoria ?? null, 'encabezado' in req.body, d.encabezado || null, cuerpo,
     'pie' in req.body, d.pie || null, d.botones ? JSON.stringify(d.botones) : null, JSON.stringify(variables), soloVariables]);
  res.json({ ok: true, plantilla: p });
}));

router.delete('/:id', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rows: [p] } = await pool.query(
    `SELECT p.nombre, p.externo_id, c.waba_id, c.sandbox, c.canal_id FROM crm.plantillas p JOIN crm.canales c USING (canal_id)
      WHERE p.plantilla_id = $1 AND p.empresa_id = $2`, [id, empresaId]);
  if (!p) throw noEncontrado('Plantilla');
  if (p.externo_id && !p.sandbox && p.waba_id) {
    await graph(p.canal_id, `/${p.waba_id}/message_templates?name=${encodeURIComponent(p.nombre)}&hsm_id=${p.externo_id}`, { method: 'DELETE' })
      .catch((e) => console.warn('[plantillas] no se pudo borrar en Meta:', (e as Error).message));
  }
  await pool.query('DELETE FROM crm.plantillas WHERE plantilla_id = $1', [id]);
  res.json({ ok: true });
}));

/** Envía la plantilla a revisión de Meta. En canales de prueba se aprueba a los 3 s. */
router.post('/:id/enviar-revision', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rows: [p] } = await pool.query('SELECT * FROM crm.plantillas WHERE plantilla_id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!p) throw noEncontrado('Plantilla');
  if (!['borrador', 'rechazada'].includes(p.estado)) throw invalido('La plantilla ya fue enviada');
  const canal = await canalWa(empresaId, p.canal_id);

  if (canal.sandbox) {
    await pool.query(`UPDATE crm.plantillas SET estado = 'pendiente', externo_id = $2, actualizado_en = now() WHERE plantilla_id = $1`, [id, `sbx-${id}`]);
    setTimeout(async () => {
      await pool.query(`UPDATE crm.plantillas SET estado = 'aprobada', motivo_rechazo = NULL, actualizado_en = now() WHERE plantilla_id = $1 AND estado = 'pendiente'`, [id]);
      emitirEmpresa(empresaId, 'plantillas:cambio', { plantilla_id: id });
    }, 3000);
    res.json({ ok: true, estado: 'pendiente' });
    return;
  }

  const variables = p.variables as VariablePlantilla[];
  const components: unknown[] = [];
  if (p.encabezado) components.push({ type: 'HEADER', format: 'TEXT', text: p.encabezado });
  components.push({
    type: 'BODY', text: p.cuerpo,
    ...(variables.length ? { example: { body_text: [variables.sort((a, b) => a.indice - b.indice).map((v) => v.ejemplo)] } } : {}),
  });
  if (p.pie) components.push({ type: 'FOOTER', text: p.pie });
  const botones = p.botones as Array<{ tipo: string; texto: string; url?: string; telefono?: string }>;
  if (botones.length) {
    components.push({ type: 'BUTTONS', buttons: botones.map((b) => b.tipo === 'URL' ? { type: 'URL', text: b.texto, url: b.url }
      : b.tipo === 'PHONE_NUMBER' ? { type: 'PHONE_NUMBER', text: b.texto, phone_number: b.telefono } : { type: 'QUICK_REPLY', text: b.texto }) });
  }
  try {
    const r = (await graph(canal.canal_id, `/${canal.waba_id}/message_templates`, {
      method: 'POST', body: { name: p.nombre, language: p.idioma, category: p.categoria, components },
    })) as { id?: string; status?: string };
    const estado = r.status === 'APPROVED' ? 'aprobada' : r.status === 'REJECTED' ? 'rechazada' : 'pendiente';
    await pool.query(`UPDATE crm.plantillas SET estado = $2, externo_id = $3, motivo_rechazo = NULL, actualizado_en = now() WHERE plantilla_id = $1`, [id, estado, r.id ?? null]);
    res.json({ ok: true, estado });
  } catch (e) {
    throw invalido(`Meta rechazó la plantilla: ${(e as Error).message}`);
  }
}));

/** Trae estados (y plantillas creadas directo en Meta) desde el WABA. */
router.post('/sincronizar', requireRol('supervisor'), ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  const { canal_id } = z.object({ canal_id: z.number().int() }).parse(req.body);
  const canal = await canalWa(empresaId, canal_id);
  if (canal.sandbox) { res.json({ ok: true, actualizadas: 0, importadas: 0 }); return; }
  const r = (await graph(canal.canal_id, `/${canal.waba_id}/message_templates?fields=id,name,status,language,category,rejected_reason,components&limit=200`)) as {
    data: Array<{ id: string; name: string; status: string; language: string; category: string; rejected_reason?: string; components?: Array<{ type: string; text?: string; format?: string }> }>;
  };
  const MAPA: Record<string, string> = { APPROVED: 'aprobada', REJECTED: 'rechazada', PENDING: 'pendiente', PAUSED: 'pausada', DISABLED: 'pausada', IN_APPEAL: 'pendiente' };
  let actualizadas = 0, importadas = 0;
  for (const t of r.data ?? []) {
    const estado = MAPA[t.status] ?? 'pendiente';
    const motivo = t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null;
    const { rowCount } = await pool.query(
      `UPDATE crm.plantillas SET estado = $4, externo_id = $5, motivo_rechazo = $6, actualizado_en = now()
        WHERE canal_id = $1 AND nombre = $2 AND idioma = $3`, [canal_id, t.name, t.language, estado, t.id, motivo]);
    if (rowCount) { actualizadas++; continue; }
    const body = t.components?.find((c) => c.type === 'BODY')?.text;
    if (!body || !/^[a-z0-9_]+$/.test(t.name)) continue;
    const idx = [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))];
    await pool.query(
      `INSERT INTO crm.plantillas (empresa_id, canal_id, nombre, idioma, categoria, encabezado, cuerpo, pie, variables, estado, externo_id, motivo_rechazo, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
      [empresaId, canal_id, t.name, t.language, ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(t.category) ? t.category : 'MARKETING',
       t.components?.find((c) => c.type === 'HEADER' && c.format === 'TEXT')?.text ?? null, body,
       t.components?.find((c) => c.type === 'FOOTER')?.text ?? null,
       JSON.stringify(idx.map((i) => ({ indice: i, origen: 'manual', valor: '', ejemplo: '' }))), estado, t.id, motivo, usuarioId]);
    importadas++;
  }
  res.json({ ok: true, actualizadas, importadas });
}));

router.get('/:id/vista-previa', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rows: [p] } = await pool.query('SELECT * FROM crm.plantillas WHERE plantilla_id = $1 AND empresa_id = $2', [idParam(req), empresaId]);
  if (!p) throw noEncontrado('Plantilla');
  const contacto = req.query.contacto_id ? Number(req.query.contacto_id) : null;
  res.json({ ok: true, ...(await renderPlantilla(empresaId, p, contacto, {})) });
}));

export default router;
