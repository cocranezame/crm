// ─── Ingesta de eventos entrantes (webhook y simulador) ──────────────────────
// Flujo del informe §7, sin IA:
//   1. resuelve la empresa por crm.canales(tipo, externo_id)
//   2. upsert contacto + identidad + conversación
//   3. INSERT mensaje idempotente (ux_mensaje_externo)
//   4. contacto nuevo → negocio en la etapa inicial del pipeline de entrada
//   5. emite por tiempo real a la bandeja
// La descarga de adjuntos corre después, fuera de la respuesta al webhook.
import { pool, tx, type Db } from '../../db/pool';
import { emitirEmpresa } from '../../lib/realtime';
import { normalizarTelefono } from '../../lib/telefono';
import { crearNegocioEntrada } from '../pipelines/negocios.service';
import { SELECT_MENSAJE, mensajeDTO, vistaPrevia, type MensajeFila } from '../conversaciones/dto';
import { cuentaPorExterno } from './cuentas.service';
import { descargarMediaEntrante } from './media-entrante';
import { obtenerPerfilMessenger } from './messenger/sender';
import type { CuentaCanal, EventoCanal, EventoEstado, EventoMensaje } from './tipos';

export interface ResultadoIngesta { procesados: number; duplicados: number; ignorados: number }

export async function procesarEventos(eventos: EventoCanal[], opts: { cuenta?: CuentaCanal } = {}): Promise<ResultadoIngesta> {
  const r: ResultadoIngesta = { procesados: 0, duplicados: 0, ignorados: 0 };
  for (const ev of eventos) {
    try {
      if (ev.kind === 'otro') { r.ignorados++; continue; }
      const cuenta = opts.cuenta ?? (await cuentaPorExterno(ev.canal, ev.cuentaExternaId));
      if (!cuenta) {
        console.warn(`[ingesta] cuenta no registrada canal=${ev.canal} externo=${ev.cuentaExternaId}`);
        r.ignorados++;
        continue;
      }
      if (ev.kind === 'estado') { await procesarEstado(cuenta, ev); r.procesados++; continue; }
      const nuevo = await procesarMensaje(cuenta, ev);
      if (nuevo) r.procesados++; else r.duplicados++;
    } catch (e) {
      console.error('[ingesta] error procesando evento:', e);
      r.ignorados++;
    }
  }
  return r;
}

async function contactoPorIdentidad(db: Db, empresaId: string, ev: EventoMensaje) {
  const { rows: [i] } = await db.query<{ identidad_id: number; contacto_id: number }>(
    `SELECT i.identidad_id, i.contacto_id FROM crm.identidades i JOIN crm.contactos c USING (contacto_id)
      WHERE i.empresa_id = $1 AND i.canal = $2 AND i.externo_id = ANY($3) AND c.eliminado_en IS NULL
      ORDER BY (i.externo_id = $4) DESC LIMIT 1`,
    [empresaId, ev.canal, ev.identidades, ev.identidad]);
  return i ?? null;
}

async function procesarMensaje(cuenta: CuentaCanal, ev: EventoMensaje): Promise<boolean> {
  const empresaId = cuenta.empresa_id;
  let contactoNuevo = false;

  const res = await tx(async (db) => {
    // ── Identidad y contacto ──
    let ident = await contactoPorIdentidad(db, empresaId, ev);
    let contactoId: number;
    if (ident) {
      contactoId = ident.contacto_id;
      if (ev.nombre || ev.wa?.username) {
        await db.query('UPDATE crm.identidades SET nombre_canal = COALESCE($2, nombre_canal), username = COALESCE($3, username) WHERE identidad_id = $1',
          [ident.identidad_id, ev.nombre, ev.wa?.username ?? null]);
      }
    } else {
      // WhatsApp entrega el teléfono: si ya existe un contacto con ese número (alta manual/importación) se enlaza.
      const telefono = ev.canal === 'whatsapp' ? normalizarTelefono(ev.wa?.telefono ? `+${ev.wa.telefono}` : null) : null;
      let existente: { contacto_id: number } | undefined;
      if (telefono) {
        ({ rows: [existente] } = await db.query<{ contacto_id: number }>(
          'SELECT contacto_id FROM crm.contactos WHERE empresa_id = $1 AND telefono = $2 AND eliminado_en IS NULL', [empresaId, telefono]));
      }
      if (existente) {
        contactoId = existente.contacto_id;
        await db.query(`UPDATE crm.contactos SET nombre = COALESCE(nombre, $2) WHERE contacto_id = $1`, [contactoId, ev.nombre]);
      } else {
        const { rows: [c] } = await db.query<{ contacto_id: number }>(
          `INSERT INTO crm.contactos (empresa_id, nombre, telefono, origen) VALUES ($1,$2,$3,$4) RETURNING contacto_id`,
          [empresaId, ev.nombre, telefono, ev.canal]);
        contactoId = c.contacto_id;
        contactoNuevo = true;
      }
      const { rows: [ni] } = await db.query<{ identidad_id: number }>(
        `INSERT INTO crm.identidades (empresa_id, contacto_id, canal, externo_id, nombre_canal, username)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (empresa_id, canal, externo_id) DO UPDATE SET nombre_canal = COALESCE(EXCLUDED.nombre_canal, crm.identidades.nombre_canal)
         RETURNING identidad_id`,
        [empresaId, contactoId, ev.canal, ev.identidad, ev.nombre, ev.wa?.username ?? null]);
      ident = { identidad_id: ni.identidad_id, contacto_id: contactoId };
    }

    // ── Conversación (una por cuenta del negocio + identidad del cliente) ──
    const { rows: [conv] } = await db.query<{ conversacion_id: number; asignado_a: string | null }>(
      `INSERT INTO crm.conversaciones (empresa_id, contacto_id, canal_id, identidad_id, conversacion_externa_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (canal_id, identidad_id) DO UPDATE
         SET conversacion_externa_id = COALESCE(EXCLUDED.conversacion_externa_id, crm.conversaciones.conversacion_externa_id)
       RETURNING conversacion_id, asignado_a`,
      [empresaId, contactoId, cuenta.canal_id, ident.identidad_id, ev.conversacionExternaId ?? null]);

    // ── Mensaje (idempotente por externo_id) ──
    const esEco = ev.direccion === 'saliente';
    if (esEco) {
      // Eco de algo que el CRM ya envió (TikTok puede mandar el eco antes que la Send API responda)
      const { rows: [pend] } = await db.query<{ mensaje_id: number }>(
        `SELECT mensaje_id FROM crm.mensajes
          WHERE conversacion_id = $1 AND direccion = 'saliente' AND externo_id IS NULL AND estado_envio = 'pendiente'
            AND contenido IS NOT DISTINCT FROM $2 AND enviado_en > now() - interval '2 minutes' ORDER BY mensaje_id DESC LIMIT 1`,
        [conv.conversacion_id, ev.contenido]);
      if (pend) {
        await db.query(`UPDATE crm.mensajes SET externo_id = $2, estado_envio = 'sent' WHERE mensaje_id = $1`, [pend.mensaje_id, ev.mensajeExternoId]);
        return null;
      }
    }
    const { rows: [m] } = await db.query<MensajeFila>(
      `INSERT INTO crm.mensajes (empresa_id, conversacion_id, direccion, autor_tipo, tipo, contenido, media_url, media_mime, media_nombre,
                                 externo_id, estado_envio, metadatos, enviado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (empresa_id, externo_id) WHERE externo_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [empresaId, conv.conversacion_id, esEco ? 'saliente' : 'entrante', esEco ? 'humano' : 'contacto', ev.tipo, ev.contenido,
       ev.mediaUrlInicial, ev.mediaMime, ev.mediaFilename, ev.mensajeExternoId, esEco ? 'sent' : null,
       JSON.stringify({ ...(esEco ? { desde_app: true } : {}), raw: ev.metadatos }), ev.timestamp]);
    if (!m) return null; // duplicado: Meta reintentó

    await db.query(
      `UPDATE crm.conversaciones SET
         ultima_actividad = GREATEST(ultima_actividad, $2),
         ultimo_mensaje = $3,
         ultimo_entrante_en = CASE WHEN $4 THEN GREATEST(COALESCE(ultimo_entrante_en, $2), $2) ELSE ultimo_entrante_en END,
         no_leidos = CASE WHEN $4 THEN no_leidos + 1 ELSE no_leidos END,
         estado = CASE WHEN $4 AND estado = 'resuelta' THEN 'abierta' ELSE estado END
       WHERE conversacion_id = $1`,
      [conv.conversacion_id, ev.timestamp, vistaPrevia(ev.tipo, ev.contenido), !esEco]);

    if (contactoNuevo) await crearNegocioEntrada(db, empresaId, contactoId, ev.nombre ?? null);
    return { conversacionId: conv.conversacion_id, mensajeId: m.mensaje_id, contactoId };
  });

  if (!res) return false;

  const { rows: [m] } = await pool.query<MensajeFila>(`${SELECT_MENSAJE} WHERE m.mensaje_id = $1`, [res.mensajeId]);
  emitirEmpresa(empresaId, 'mensaje:nuevo', { conversacion_id: res.conversacionId, mensaje: mensajeDTO(m) });
  emitirEmpresa(empresaId, 'conversacion:actualizada', { conversacion_id: res.conversacionId });
  if (contactoNuevo) emitirEmpresa(empresaId, 'contactos:cambio', { contacto_id: res.contactoId });

  // Trabajo lento fuera del camino crítico
  if (ev.media && !cuenta.sandbox) {
    setImmediate(() => { void descargarMediaEntrante(cuenta, res.mensajeId, ev); });
  }
  if (contactoNuevo && ev.canal === 'messenger' && !ev.nombre && !cuenta.sandbox) {
    setImmediate(async () => {
      const nombre = await obtenerPerfilMessenger(cuenta.canal_id, ev.identidad);
      if (nombre) {
        await pool.query('UPDATE crm.contactos SET nombre = COALESCE(nombre, $2) WHERE contacto_id = $1', [res.contactoId, nombre]);
        await pool.query('UPDATE crm.identidades SET nombre_canal = $3 WHERE contacto_id = $1 AND externo_id = $2', [res.contactoId, ev.identidad, nombre]);
        emitirEmpresa(empresaId, 'conversacion:actualizada', { conversacion_id: res.conversacionId });
      }
    });
  }
  return true;
}

const ORDEN_ESTADO: Record<string, number> = { pendiente: 0, sent: 1, delivered: 2, read: 3 };

async function procesarEstado(cuenta: CuentaCanal, ev: EventoEstado): Promise<void> {
  let filas: Array<{ mensaje_id: number; conversacion_id: number }> = [];
  if (ev.mensajeExternoId) {
    ({ rows: filas } = await pool.query(
      `UPDATE crm.mensajes SET estado_envio = $3,
              error = CASE WHEN $3 = 'failed' THEN COALESCE(error, 'Meta reportó falla de entrega') ELSE error END
        WHERE empresa_id = $1 AND externo_id = $2
          AND (estado_envio IS NULL OR $3 = 'failed' OR COALESCE(($4::jsonb ->> estado_envio)::int, 0) < ($4::jsonb ->> $3)::int)
        RETURNING mensaje_id, conversacion_id`,
      [cuenta.empresa_id, ev.mensajeExternoId, ev.estado, JSON.stringify(ORDEN_ESTADO)]));
  } else if (ev.watermark && ev.identidad) {
    // Messenger / TikTok: marca todo lo enviado antes del watermark
    ({ rows: filas } = await pool.query(
      `UPDATE crm.mensajes m SET estado_envio = $4
         FROM crm.conversaciones c JOIN crm.identidades i ON i.identidad_id = c.identidad_id
        WHERE m.conversacion_id = c.conversacion_id AND c.canal_id = $1 AND i.externo_id = $2
          AND m.direccion = 'saliente' AND m.enviado_en <= $3 AND m.estado_envio IN ('sent','delivered')
          AND COALESCE(($5::jsonb ->> m.estado_envio)::int, 0) < ($5::jsonb ->> $4)::int
        RETURNING m.mensaje_id, m.conversacion_id`,
      [cuenta.canal_id, ev.identidad, ev.watermark, ev.estado, JSON.stringify(ORDEN_ESTADO)]));
  }
  if (filas.length) {
    emitirEmpresa(cuenta.empresa_id, 'mensaje:estado', {
      conversacion_id: filas[0].conversacion_id, mensaje_ids: filas.map((f) => f.mensaje_id), estado: ev.estado,
    });
  }
}
