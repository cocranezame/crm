// Portado sin cambios de ReparaTego (apps/api/src/modules/crm/canales).
// ─── Adaptador TikTok (Business Messaging API) → EventoCanal ──────────────────
// Payload del webhook (uno por request):
//   { event: 'im_receive_msg' | 'im_send_msg' | 'im_mark_read_msg',
//     user_openid: <business_id de la cuenta del negocio>,
//     create_time, content: "<JSON como STRING>" }
// content (parseado):
//   { conversation_id, message_id, type: 'text'|'image'|'share_post'|'sticker',
//     timestamp (ms), from (username), from_user:{id}, to, to_user:{id},
//     text:{body}, image:{media_id}, share_post:{embed_url},
//     referenced_message_info:{referenced_message_id}, read:{last_read_timestamp} }
// Dirección: entrante si to_user.id === business_id; eco (saliente) si from_user.id === business_id.
// Identidad del contacto = open_id del usuario (from_user.id); el conversation_id
// se guarda aparte en conversaciones.conversacion_externa_id (lo exige la Send API).

import type {
  CanalAdapter, EventoCanal, EventoMensaje, EventoEstado, EventoOtro, TipoMensaje,
} from '../tipos';

export interface TtContent {
  conversation_id: string;
  message_id:      string;
  type?:           string;
  timestamp?:      number;
  from?:           string;
  from_user?:      { id?: string };
  to?:             string;
  to_user?:        { id?: string };
  text?:           { body?: string };
  image?:          { media_id?: string };
  share_post?:     { embed_url?: string; title?: string };
  sticker?:        unknown;
  referenced_message_info?: { referenced_message_id?: string };
  read?:           { last_read_timestamp?: number };
}

export interface TtWebhookPayload {
  event?:       string;
  user_openid?: string;
  create_time?: number;
  content?:     string | TtContent;
}

export const TEXTO_VIDEO_COMPARTIDO = '[Video de TikTok compartido]';
export const TEXTO_STICKER          = '[Sticker]';

export function parsearContent(raw: string | TtContent | undefined): TtContent | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) as TtContent; } catch { return null; }
}

function normalizarMensaje(businessId: string, c: TtContent): EventoMensaje | null {
  const fromId = c.from_user?.id ?? null;
  const toId   = c.to_user?.id ?? null;
  if (!c.message_id || !c.conversation_id) return null;

  const esEco     = fromId === businessId;
  const identidad = esEco ? toId : fromId;
  if (!identidad) return null;

  let tipo: TipoMensaje = 'texto';
  let contenido: string | null = null;
  let mediaUrlInicial: string | null = null;
  let media: EventoMensaje['media'] = null;
  let mediaMime: string | null = null;

  switch (c.type) {
    case 'text':
      contenido = c.text?.body ?? null;
      break;
    case 'image':
      tipo = 'imagen';
      mediaMime = 'image/jpeg';
      media = c.image?.media_id
        ? { kind: 'tiktok_media', conversation_id: c.conversation_id, message_id: c.message_id, media_id: c.image.media_id }
        : null;
      break;
    case 'share_post':
      // Video compartido: no hay archivo, solo un enlace embebible → sistema + media_url
      tipo = 'sistema';
      contenido = c.share_post?.title ? `${TEXTO_VIDEO_COMPARTIDO} ${c.share_post.title}` : TEXTO_VIDEO_COMPARTIDO;
      mediaUrlInicial = c.share_post?.embed_url ?? null;
      break;
    case 'sticker':
      tipo = 'sistema';
      contenido = TEXTO_STICKER;
      break;
    default:
      tipo = 'sistema';
      contenido = `[Mensaje no soportado: ${c.type ?? '?'}]`;
  }

  return {
    kind:             'mensaje',
    canal:            'tiktok',
    cuentaExternaId:  businessId,
    identidad,
    identidades:      [identidad],
    nombre:           esEco ? (c.to ?? null) : (c.from ?? null),   // username del cliente
    conversacionExternaId: c.conversation_id,
    mensajeExternoId: c.message_id,
    timestamp:        new Date(c.timestamp ? Number(c.timestamp) : Date.now()),
    direccion:        esEco ? 'saliente' : 'entrante',
    tipo,
    contenido,
    mediaUrlInicial,
    media,
    mediaMime,
    mediaFilename:    null,
    metadatos: {
      ...c,
      sender_id:     fromId,
      recipient_id:  toId,
      username:      esEco ? c.to ?? null : c.from ?? null,
      ...(c.referenced_message_info?.referenced_message_id
        ? { responde_a: c.referenced_message_info.referenced_message_id } : {}),
    } as Record<string, unknown>,
  };
}

export const tiktokAdapter: CanalAdapter = {
  canal:   'tiktok',
  objetos: [],   // TikTok entra por /api/crm/tiktok/webhook, no por payload.object de Meta

  cuentaExternaIdDe(payload: unknown): string | null {
    const p = payload as TtWebhookPayload;
    return p?.user_openid ?? null;
  },

  normalizar(payload: unknown): EventoCanal[] {
    const p = payload as TtWebhookPayload;
    const businessId = p?.user_openid;
    const evento = p?.event;
    if (!businessId || !evento) return [];

    const c = parsearContent(p.content);
    if (!c) {
      return [{ kind: 'otro', canal: 'tiktok', cuentaExternaId: businessId, subtipo: `${evento}_sin_content`, payload: p } as EventoOtro];
    }

    if (evento === 'im_receive_msg' || evento === 'im_send_msg') {
      const m = normalizarMensaje(businessId, c);
      return m ? [m] : [{ kind: 'otro', canal: 'tiktok', cuentaExternaId: businessId, subtipo: `${evento}_incompleto`, payload: c } as EventoOtro];
    }

    if (evento === 'im_mark_read_msg') {
      // Solo cuenta cuando lo marca el CLIENTE (from_user ≠ negocio)
      if (c.from_user?.id && c.from_user.id !== businessId && c.read?.last_read_timestamp) {
        return [{
          kind: 'estado', canal: 'tiktok', cuentaExternaId: businessId,
          mensajeExternoId: null, watermark: new Date(Number(c.read.last_read_timestamp)),
          identidad: c.from_user.id, estado: 'read',
        } as EventoEstado];
      }
      return [{ kind: 'otro', canal: 'tiktok', cuentaExternaId: businessId, subtipo: 'read_propio', payload: c } as EventoOtro];
    }

    return [{ kind: 'otro', canal: 'tiktok', cuentaExternaId: businessId, subtipo: evento, payload: c } as EventoOtro];
  },
};
