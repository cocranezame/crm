// Descarga de adjuntos entrantes a almacenamiento propio (las URLs de Meta/TikTok vencen).
import { pool } from '../../db/pool';
import { emitirEmpresa } from '../../lib/realtime';
import { guardar } from '../../lib/storage';
import { SELECT_MENSAJE, mensajeDTO, type MensajeFila } from '../conversaciones/dto';
import { graph } from './graph';
import { tokenDe } from './cuentas.service';
import { apiBase, credencialesApp, tokenTiktok } from './tiktok/auth.service';
import type { CuentaCanal, EventoMensaje } from './tipos';

const MAX_BYTES = 25 * 1024 * 1024;

async function bajar(url: string, headers: Record<string, string> = {}): Promise<{ buf: Buffer; mime: string | null }> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} al descargar adjunto`);
  const largo = Number(r.headers.get('content-length') ?? 0);
  if (largo > MAX_BYTES) throw new Error('Adjunto demasiado grande (> 25 MB)');
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') };
}

export async function descargarMediaEntrante(cuenta: CuentaCanal, mensajeId: number, ev: EventoMensaje): Promise<void> {
  const m = ev.media;
  if (!m) return;
  try {
    let archivo: { buf: Buffer; mime: string | null };
    if (m.kind === 'meta_media_id') {
      const info = (await graph(cuenta.canal_id, `/${m.media_id}`)) as { url?: string; mime_type?: string };
      if (!info.url) throw new Error('Meta no devolvió URL del adjunto');
      archivo = await bajar(info.url, { Authorization: `Bearer ${await tokenDe(cuenta.canal_id)}` });
      archivo.mime = info.mime_type ?? archivo.mime;
    } else if (m.kind === 'url') {
      archivo = await bajar(m.url);
    } else {
      const [token, cred] = await Promise.all([tokenTiktok(cuenta.canal_id), credencialesApp()]);
      const r = await fetch(`${apiBase(cred.apiVersion)}/business/message/media/download/`, {
        method: 'POST', headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: cuenta.externo_id, conversation_id: m.conversation_id, message_id: m.message_id, media_id: m.media_id, media_type: 'IMAGE' }),
        signal: AbortSignal.timeout(10_000),
      });
      const j = (await r.json()) as { data?: { download_url?: string } };
      if (!j.data?.download_url) throw new Error('TikTok no devolvió download_url');
      archivo = await bajar(j.data.download_url);
    }
    const mime = (ev.mediaMime ?? archivo.mime ?? 'application/octet-stream').split(';')[0];
    const key = await guardar(cuenta.empresa_id, archivo.buf, mime, ev.mediaFilename);
    await pool.query('UPDATE crm.mensajes SET media_url = $2, media_mime = $3 WHERE mensaje_id = $1', [mensajeId, key, mime]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[media] mensaje=${mensajeId}:`, msg);
    await pool.query(`UPDATE crm.mensajes SET error = $2 WHERE mensaje_id = $1`, [mensajeId, `No se pudo descargar el adjunto: ${msg}`]);
  }
  const { rows: [f] } = await pool.query<MensajeFila>(`${SELECT_MENSAJE} WHERE m.mensaje_id = $1`, [mensajeId]);
  if (f) emitirEmpresa(cuenta.empresa_id, 'mensaje:actualizado', { conversacion_id: f.conversacion_id, mensaje: mensajeDTO(f) });
}
