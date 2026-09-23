// ─── Envío saliente unificado ─────────────────────────────────────────────────
// Único punto por el que sale algo hacia un cliente (persona del equipo, sistema,
// difusión y —a futuro— el agente IA). Portado de ReparaTego con estos cambios:
//   · el mensaje se inserta ANTES de llamar al canal (estado 'pendiente') para que la
//     bandeja lo pinte al instante; luego se actualiza a sent / error / bloqueado
//   · lleva autor_tipo + autor_id
//   · regla "el humano manda siempre": un envío humano pone modo='humano' y, si la
//     conversación no tiene dueño, se la asigna a quien respondió
import { pool, tx } from '../../db/pool';
import { conflicto, invalido, noEncontrado } from '../../lib/http';
import { emitirEmpresa } from '../../lib/realtime';
import { urlPublica } from '../../lib/storage';
import { SELECT_MENSAJE, mensajeDTO, vistaPrevia, type MensajeFila } from '../conversaciones/dto';
import { obtenerCuenta } from './cuentas.service';
import { senderPara } from './registry';
import { registrarAcuses } from './sandbox/sender';
import { procesarEventos } from './ingesta.service';
import { CAPACIDADES, NOMBRE_CANAL, type CuentaCanal, type ResultadoEnvio } from './tipos';

export type Autor = { tipo: 'humano' | 'ia' | 'sistema'; id: string | null };

// Canal de prueba: acuses simulados de entregado y leído
registrarAcuses((canalId, externoId) => {
  const acuse = async (estado: 'delivered' | 'read') => {
    const cuenta = await obtenerCuenta(canalId);
    if (!cuenta) return;
    await procesarEventos([{ kind: 'estado', canal: cuenta.tipo, cuentaExternaId: cuenta.externo_id, mensajeExternoId: externoId, watermark: null, identidad: null, estado }], { cuenta });
  };
  setTimeout(() => void acuse('delivered'), 1200);
  setTimeout(() => void acuse('read'), 3500);
});

interface ConvEnvio {
  conversacion_id: number; empresa_id: string; canal_id: number; destino: string;
  conversacion_externa_id: string | null; ultimo_entrante_en: Date | null; cuenta: CuentaCanal;
}

export async function conversacionParaEnvio(empresaId: string, conversacionId: number): Promise<ConvEnvio> {
  const { rows: [c] } = await pool.query(
    `SELECT c.conversacion_id, c.empresa_id, c.canal_id, c.conversacion_externa_id, c.ultimo_entrante_en, i.externo_id AS destino
       FROM crm.conversaciones c JOIN crm.identidades i USING (identidad_id)
      WHERE c.conversacion_id = $1 AND c.empresa_id = $2`, [conversacionId, empresaId]);
  if (!c) throw noEncontrado('Conversación');
  const cuenta = await obtenerCuenta(c.canal_id);
  if (!cuenta) throw noEncontrado('Canal');
  if (!cuenta.activo) throw conflicto(`La cuenta de ${NOMBRE_CANAL[cuenta.tipo]} "${cuenta.nombre}" está desconectada`);
  return { ...c, cuenta };
}

async function insertarPendiente(conv: ConvEnvio, autor: Autor, d: {
  tipo: string; contenido: string | null; media_url?: string | null; media_mime?: string | null; media_nombre?: string | null; metadatos?: Record<string, unknown>;
}): Promise<MensajeFila> {
  return tx(async (db) => {
    const { rows: [m] } = await db.query<MensajeFila>(
      `INSERT INTO crm.mensajes (empresa_id, conversacion_id, direccion, autor_tipo, autor_id, tipo, contenido, media_url, media_mime, media_nombre, estado_envio, metadatos)
       VALUES ($1,$2,'saliente',$3,$4,$5,$6,$7,$8,$9,'pendiente',$10) RETURNING *`,
      [conv.empresa_id, conv.conversacion_id, autor.tipo, autor.id, d.tipo, d.contenido, d.media_url ?? null, d.media_mime ?? null,
       d.media_nombre ?? null, JSON.stringify(d.metadatos ?? {})]);
    await db.query(
      `UPDATE crm.conversaciones SET ultima_actividad = now(), ultimo_mensaje = $2,
              modo = CASE WHEN $3 THEN 'humano' ELSE modo END,
              asignado_a = CASE WHEN $3 THEN COALESCE(asignado_a, $4::uuid) ELSE asignado_a END,
              no_leidos = CASE WHEN $3 THEN 0 ELSE no_leidos END,
              estado = CASE WHEN estado = 'resuelta' THEN 'abierta' ELSE estado END
        WHERE conversacion_id = $1`,
      [conv.conversacion_id, vistaPrevia(d.tipo, d.contenido), autor.tipo === 'humano', autor.id]);
    return m;
  });
}

async function publicar(empresaId: string, mensajeId: number, evento: 'mensaje:nuevo' | 'mensaje:actualizado') {
  const { rows: [m] } = await pool.query<MensajeFila>(`${SELECT_MENSAJE} WHERE m.mensaje_id = $1`, [mensajeId]);
  const dto = mensajeDTO(m);
  emitirEmpresa(empresaId, evento, { conversacion_id: m.conversacion_id, mensaje: dto });
  emitirEmpresa(empresaId, 'conversacion:actualizada', { conversacion_id: m.conversacion_id });
  return dto;
}

async function cerrar(empresaId: string, mensajeId: number, r: ResultadoEnvio) {
  const estado = r.ok ? 'sent' : r.bloqueado ? 'bloqueado' : 'error';
  await pool.query(
    `UPDATE crm.mensajes SET estado_envio = $2, externo_id = COALESCE($3, externo_id), error = $4 WHERE mensaje_id = $1`,
    [mensajeId, estado, r.ok ? r.mensajeExternoId ?? null : null, r.ok ? null : r.error ?? 'Error desconocido']);
  return publicar(empresaId, mensajeId, 'mensaje:actualizado');
}

function baseInput(conv: ConvEnvio, autor: Autor) {
  return {
    cuenta: conv.cuenta, conversacion_id: conv.conversacion_id, identidad: conv.destino,
    conversacionExternaId: conv.conversacion_externa_id, ultimoEntranteEn: conv.ultimo_entrante_en, esHumano: autor.tipo === 'humano',
  };
}

export async function enviarTexto(empresaId: string, conversacionId: number, texto: string, autor: Autor) {
  const conv = await conversacionParaEnvio(empresaId, conversacionId);
  const m = await insertarPendiente(conv, autor, { tipo: 'texto', contenido: texto });
  await publicar(empresaId, m.mensaje_id, 'mensaje:nuevo');
  let r: ResultadoEnvio;
  try { r = await senderPara(conv.cuenta).enviarTexto({ ...baseInput(conv, autor), texto }); }
  catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  return cerrar(empresaId, m.mensaje_id, r);
}

export async function enviarMedia(empresaId: string, conversacionId: number, d: {
  key: string; mime: string; nombre: string; tipoMedia: 'imagen' | 'video' | 'documento' | 'audio'; caption: string | null;
}, autor: Autor) {
  const conv = await conversacionParaEnvio(empresaId, conversacionId);
  const cap = CAPACIDADES[conv.cuenta.tipo];
  const sender = senderPara(conv.cuenta);
  if (!cap.soportaAdjuntosSalientes || !sender.enviarMedia) throw invalido(`${NOMBRE_CANAL[conv.cuenta.tipo]} no permite enviar archivos`);
  const caption = d.caption?.trim() || null;
  const m = await insertarPendiente(conv, autor, {
    tipo: d.tipoMedia, contenido: cap.soportaCaptionEnAdjunto ? caption ?? (d.tipoMedia === 'documento' ? d.nombre : null) : (d.tipoMedia === 'documento' ? d.nombre : null),
    media_url: d.key, media_mime: d.mime, media_nombre: d.nombre,
  });
  await publicar(empresaId, m.mensaje_id, 'mensaje:nuevo');
  let r: ResultadoEnvio;
  try {
    r = await sender.enviarMedia({ ...baseInput(conv, autor), url: urlPublica(d.key)!, tipoMedia: d.tipoMedia, filename: d.nombre,
      caption: cap.soportaCaptionEnAdjunto ? caption : null });
  } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const dto = await cerrar(empresaId, m.mensaje_id, r);
  // Messenger no admite texto junto al archivo: va como mensaje aparte
  if (r.ok && caption && !cap.soportaCaptionEnAdjunto) await enviarTexto(empresaId, conversacionId, caption, autor);
  return dto;
}

export async function enviarPlantilla(empresaId: string, conversacionId: number, d: {
  plantilla_id: number; nombre: string; idioma: string; parametros: string[]; texto: string;
}, autor: Autor) {
  const conv = await conversacionParaEnvio(empresaId, conversacionId);
  const sender = senderPara(conv.cuenta);
  if (!sender.enviarPlantilla) throw invalido(`${NOMBRE_CANAL[conv.cuenta.tipo]} no usa plantillas`);
  const m = await insertarPendiente(conv, autor, { tipo: 'plantilla', contenido: d.texto, metadatos: { plantilla_id: d.plantilla_id, plantilla: d.nombre } });
  await publicar(empresaId, m.mensaje_id, 'mensaje:nuevo');
  let r: ResultadoEnvio;
  try { r = await sender.enviarPlantilla({ ...baseInput(conv, autor), nombre: d.nombre, idioma: d.idioma, parametros: d.parametros }); }
  catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const dto = await cerrar(empresaId, m.mensaje_id, r);
  return { mensaje: dto, resultado: r };
}
