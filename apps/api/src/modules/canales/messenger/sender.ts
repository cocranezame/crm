// ─── Sender Messenger (Send API de Páginas) ──────────────────────────────────
// Portado de ReparaTego. Ventana de 24 h (política de Meta):
//   · ≤ 24 h → RESPONSE · > 24 h y ≤ 7 días escrito por PERSONA → MESSAGE_TAG HUMAN_AGENT
//   · > 7 días (o bot fuera de ventana) → bloqueado.
import { graph } from '../graph';
import type { CanalSender, EnviarMediaInput, EnviarTextoInput, ResultadoEnvio } from '../tipos';

const H24 = 24 * 3600_000;
export const MSG_BLOQUEADO_VENTANA = 'Fuera de la ventana de 24 h de Messenger: el cliente debe escribir primero.';

export function resolverMessagingType(ultimo: Date | null, esHumano: boolean, ahora = new Date()) {
  if (!ultimo) return null;
  const delta = ahora.getTime() - ultimo.getTime();
  if (delta <= H24) return { messaging_type: 'RESPONSE' as const };
  if (esHumano && delta <= 7 * H24) return { messaging_type: 'MESSAGE_TAG' as const, tag: 'HUMAN_AGENT' as const };
  return null;
}

async function post(input: EnviarTextoInput | EnviarMediaInput, message: unknown, timeoutMs = 8_000): Promise<ResultadoEnvio> {
  const tipo = resolverMessagingType(input.ultimoEntranteEn, input.esHumano);
  if (!tipo) return { ok: false, bloqueado: true, motivoBloqueo: 'ventana', error: MSG_BLOQUEADO_VENTANA };
  try {
    const r = (await graph(input.cuenta.canal_id, `/${input.cuenta.externo_id}/messages`, {
      method: 'POST', timeoutMs, body: { recipient: { id: input.identidad }, ...tipo, message },
    })) as { message_id?: string };
    return { ok: true, mensajeExternoId: r.message_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const messengerSender: CanalSender = {
  canal: 'messenger',
  enviarTexto: (input) => post(input, { text: input.texto }),
  // Messenger NO admite caption con el archivo: envio.service manda el texto aparte.
  enviarMedia: (input) => post(input, {
    attachment: {
      type: input.tipoMedia === 'imagen' ? 'image' : input.tipoMedia === 'video' ? 'video' : input.tipoMedia === 'audio' ? 'audio' : 'file',
      payload: { url: input.url, is_reusable: true },
    },
  }, 15_000),
};

/** Nombre del contacto vía Graph (Messenger no lo manda en el webhook). Nunca lanza. */
export async function obtenerPerfilMessenger(canalId: number, psid: string): Promise<string | null> {
  try {
    const r = (await graph(canalId, `/${psid}?fields=first_name,last_name`, { timeoutMs: 4_000 })) as { first_name?: string; last_name?: string };
    return [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || null;
  } catch {
    return null;
  }
}

/** Suscribe la App a los campos de webhook de la Página (requiere pages_manage_metadata). */
export async function suscribirPagina(canalId: number, pageId: string): Promise<unknown> {
  return graph(canalId, `/${pageId}/subscribed_apps`, {
    method: 'POST',
    body: { subscribed_fields: ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads', 'message_echoes', 'messaging_referrals'] },
  });
}
