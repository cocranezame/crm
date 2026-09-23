// ─── Sender TikTok (Business Messaging — Send API) ───────────────────────────
// Portado de ReparaTego. Reglas de TikTok: ventana de 48 h, máximo 10 mensajes
// seguidos sin respuesta del cliente, texto ≤ 6 000 caracteres, sin adjuntos salientes.
import { pool } from '../../../db/pool';
import { apiBase, credencialesApp, tokenTiktok } from './auth.service';
import { CAPACIDADES } from '../tipos';
import type { CanalSender, EnviarTextoInput, ResultadoEnvio } from '../tipos';

const VENTANA_MS = (CAPACIDADES.tiktok.ventanaHoras ?? 48) * 3600_000;
const MAX_SEGUIDOS = CAPACIDADES.tiktok.maxMensajesConsecutivos ?? 10;
const MAX_CHARS = 6000;

export async function contarSalientesConsecutivos(conversacionId: number): Promise<number> {
  const { rows: [r] } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM crm.mensajes m
      WHERE m.conversacion_id = $1 AND m.direccion = 'saliente' AND m.estado_envio IN ('sent','delivered','read')
        AND m.enviado_en > COALESCE((SELECT ultimo_entrante_en FROM crm.conversaciones WHERE conversacion_id = $1), '-infinity'::timestamptz)`,
    [conversacionId]);
  return r.n;
}

export function resolverVentana(ultimo: Date | null, seguidos: number, ahora = new Date()):
  { bloqueado: false; restantes: number } | { bloqueado: true; motivo: 'ventana' | 'limite_mensajes' } {
  if (!ultimo || ahora.getTime() - ultimo.getTime() > VENTANA_MS) return { bloqueado: true, motivo: 'ventana' };
  if (seguidos >= MAX_SEGUIDOS) return { bloqueado: true, motivo: 'limite_mensajes' };
  return { bloqueado: false, restantes: MAX_SEGUIDOS - seguidos };
}

export function dividirTexto(texto: string, max = MAX_CHARS): string[] {
  const partes: string[] = [];
  let resto = texto;
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n', max);
    if (corte < max * 0.5) corte = resto.lastIndexOf(' ', max);
    if (corte < max * 0.5) corte = max;
    partes.push(resto.slice(0, corte).trimEnd());
    resto = resto.slice(corte).trimStart();
  }
  if (resto) partes.push(resto);
  return partes;
}

async function enviarBloque(canalId: number, businessId: string, conversationId: string, body: string): Promise<string> {
  const [token, cred] = await Promise.all([tokenTiktok(canalId), credencialesApp()]);
  const res = await fetch(`${apiBase(cred.apiVersion)}/business/message/send/`, {
    method: 'POST',
    headers: { 'Access-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ business_id: businessId, recipient_type: 'CONVERSATION', recipient: conversationId, message_type: 'TEXT', text: { body } }),
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json().catch(() => null)) as { code?: number; message?: string; data?: { message?: { message_id?: string } } } | null;
  if (!res.ok || !json) throw new Error(`TikTok HTTP ${res.status}`);
  if (json.code !== 0) throw new Error(`TikTok ${json.code}: ${json.message}`);
  const id = json.data?.message?.message_id;
  if (!id) throw new Error('TikTok no devolvió message_id');
  return id;
}

export const MSG_TIKTOK = {
  ventana: 'Fuera de la ventana de 48 h de TikTok: el cliente debe escribir primero.',
  limite_mensajes: `TikTok no permite más de ${MAX_SEGUIDOS} mensajes seguidos sin respuesta del cliente.`,
};

export const tiktokSender: CanalSender = {
  canal: 'tiktok',
  async enviarTexto(input: EnviarTextoInput): Promise<ResultadoEnvio> {
    if (!input.conversacionExternaId) return { ok: false, error: 'Conversación de TikTok sin conversation_id: el cliente debe escribir primero' };
    const v = resolverVentana(input.ultimoEntranteEn, await contarSalientesConsecutivos(input.conversacion_id));
    if (v.bloqueado) return { ok: false, bloqueado: true, motivoBloqueo: v.motivo, error: MSG_TIKTOK[v.motivo] };
    const bloques = dividirTexto(input.texto);
    if (bloques.length > v.restantes) return { ok: false, bloqueado: true, motivoBloqueo: 'limite_mensajes', error: MSG_TIKTOK.limite_mensajes };
    try {
      let id = '';
      for (const b of bloques) id = await enviarBloque(input.cuenta.canal_id, input.cuenta.externo_id, input.conversacionExternaId, b);
      return { ok: true, mensajeExternoId: id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
