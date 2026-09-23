// Portado sin cambios de ReparaTego (apps/api/src/modules/crm/canales).
// ─── Adaptador Messenger (Facebook Pages) → EventoCanal ──────────────────────
// Normaliza payloads con object = 'page':
//   entry[].id            → Page ID (cuenta externa)
//   entry[].messaging[]   → eventos (message, postback, delivery, read, referral)
//   entry[].standby[]     → eventos que llegan cuando la App NO es primary receiver
//                           (Handover Protocol). Se loguean como 'otro' y no se procesan.
// Identidad del cliente: PSID (sender.id), scoped a Página + App.
// Ecos (message.is_echo): mensajes que la Página mandó desde fuera del CRM
// (Business Suite, celular). Se normalizan como direccion 'saliente'.

import type {
  CanalAdapter, EventoCanal, EventoMensaje, EventoEstado, EventoOtro, TipoMensaje,
} from '../tipos';
import { mapsUrl, textoUbicacion } from '../whatsapp/adapter';

// ─── Tipos payload Meta (Messenger) ───────────────────────────────────────────

export interface MsAttachment {
  type: 'image' | 'audio' | 'video' | 'file' | 'location' | 'fallback' | 'template' | string;
  payload?: {
    url?:         string;
    sticker_id?:  number;
    title?:       string;
    coordinates?: { lat: number; long: number };
  };
  title?: string;
  url?:   string;
}

export interface MsMessage {
  mid:          string;
  text?:        string;
  is_echo?:     boolean;
  app_id?:      number;
  metadata?:    string;
  attachments?: MsAttachment[];
  quick_reply?: { payload: string };
  reply_to?:    { mid: string };
  is_deleted?:  boolean;
  is_unsupported?: boolean;
}

export interface MsMessagingEvent {
  sender:    { id: string; user_ref?: string };
  recipient: { id: string };
  timestamp: number;                       // ms
  message?:  MsMessage;
  postback?: { mid?: string; title?: string; payload?: string; referral?: unknown };
  delivery?: { mids?: string[]; watermark: number };
  read?:     { watermark: number };
  referral?: { ref?: string; source?: string; type?: string };
  optin?:    unknown;
  account_linking?: unknown;
}

export interface MsWebhookPayload {
  object: string;
  entry: Array<{
    id:         string;   // Page ID
    time?:      number;
    messaging?: MsMessagingEvent[];
    standby?:   MsMessagingEvent[];
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_ADJUNTO: Record<string, TipoMensaje> = {
  image: 'imagen', audio: 'audio', video: 'video', file: 'documento', location: 'ubicacion',
};

function nombreArchivoDeUrl(url: string): string | null {
  try {
    const p = new URL(url).pathname;
    const base = p.substring(p.lastIndexOf('/') + 1);
    return base || null;
  } catch {
    return null;
  }
}

function normalizarMensaje(pageId: string, ev: MsMessagingEvent): EventoMensaje | null {
  const msg = ev.message;
  if (!msg) return null;

  const esEco     = msg.is_echo === true;
  const identidad = esEco ? ev.recipient?.id : ev.sender?.id;
  if (!identidad) return null;

  let tipo: TipoMensaje = 'texto';
  let contenido: string | null = msg.text ?? null;
  let mediaUrl: string | null = null;
  let mediaUrlInicial: string | null = null;
  let mediaMime: string | null = null;
  let mediaFilename: string | null = null;

  const adj = msg.attachments?.[0];
  if (adj) {
    if (adj.type === 'location' && adj.payload?.coordinates) {
      const { lat, long } = adj.payload.coordinates;
      tipo = 'ubicacion';
      contenido = textoUbicacion(lat, long, adj.title ?? adj.payload?.title ?? null, null);
      mediaUrlInicial = mapsUrl(lat, long);
    } else if (TIPO_ADJUNTO[adj.type]) {
      tipo     = TIPO_ADJUNTO[adj.type];
      mediaUrl = adj.payload?.url ?? null;
      if (tipo === 'documento') {
        mediaFilename = adj.title ?? adj.payload?.title ?? (mediaUrl ? nombreArchivoDeUrl(mediaUrl) : null);
        contenido = contenido ?? mediaFilename;
      }
      if (adj.payload?.sticker_id) {
        // Stickers llegan como image con sticker_id: se guardan como imagen.
        contenido = contenido ?? null;
      }
    } else {
      // fallback (link compartido, post), template u otros no soportados
      tipo = 'sistema';
      const titulo = adj.title ?? adj.payload?.title ?? null;
      const url    = adj.url ?? adj.payload?.url ?? null;
      contenido = contenido ?? [titulo, url].filter(Boolean).join(' — ') ?? null;
      if (!contenido) contenido = `[Adjunto no soportado: ${adj.type}]`;
    }
  } else if (msg.quick_reply?.payload && !contenido) {
    contenido = msg.quick_reply.payload;
  }

  if (msg.is_unsupported) {
    tipo = 'sistema';
    contenido = contenido ?? '[Mensaje no soportado por Messenger]';
  }

  return {
    kind:             'mensaje',
    canal:            'messenger',
    cuentaExternaId:  pageId,
    identidad,
    identidades:      [identidad],
    nombre:           null,   // Messenger no manda el nombre en el webhook; se pide a Graph
    mensajeExternoId: msg.mid,
    timestamp:        new Date(ev.timestamp || Date.now()),
    direccion:        esEco ? 'saliente' : 'entrante',
    tipo,
    contenido,
    mediaUrlInicial,
    media:            mediaUrl ? { kind: 'url', url: mediaUrl } : null,
    mediaMime,
    mediaFilename,
    metadatos:        { ...ev, sender_id: ev.sender?.id, recipient_id: ev.recipient?.id } as Record<string, unknown>,
  };
}

// ─── Adaptador ────────────────────────────────────────────────────────────────

export const messengerAdapter: CanalAdapter = {
  canal:   'messenger',
  objetos: ['page'],

  cuentaExternaIdDe(payload: unknown): string | null {
    const p = payload as MsWebhookPayload;
    return p?.entry?.[0]?.id ?? null;
  },

  normalizar(payload: unknown): EventoCanal[] {
    const p = payload as MsWebhookPayload;
    const eventos: EventoCanal[] = [];

    for (const entry of p.entry ?? []) {
      const pageId = entry.id;
      if (!pageId) continue;

      // Handover Protocol: la App es secondary receiver → no puede responder.
      for (const ev of entry.standby ?? []) {
        eventos.push({
          kind: 'otro', canal: 'messenger', cuentaExternaId: pageId,
          subtipo: 'standby', payload: ev,
        } as EventoOtro);
      }

      for (const ev of entry.messaging ?? []) {
        if (ev.message) {
          const m = normalizarMensaje(pageId, ev);
          if (m) eventos.push(m);
          continue;
        }

        if (ev.postback) {
          // Un postback (botón "Empezar", menú persistente) equivale a un texto del cliente.
          const texto = ev.postback.title ?? ev.postback.payload ?? '';
          eventos.push({
            kind:             'mensaje',
            canal:            'messenger',
            cuentaExternaId:  pageId,
            identidad:        ev.sender.id,
            identidades:      [ev.sender.id],
            nombre:           null,
            mensajeExternoId: ev.postback.mid ?? `postback_${ev.sender.id}_${ev.timestamp}`,
            timestamp:        new Date(ev.timestamp || Date.now()),
            direccion:        'entrante',
            tipo:             'texto',
            contenido:        texto || null,
            mediaUrlInicial:  null,
            media:            null,
            mediaMime:        null,
            mediaFilename:    null,
            metadatos:        { ...ev, sender_id: ev.sender.id, es_postback: true } as Record<string, unknown>,
          } as EventoMensaje);
          continue;
        }

        if (ev.delivery) {
          eventos.push({
            kind: 'estado', canal: 'messenger', cuentaExternaId: pageId,
            mensajeExternoId: null, watermark: new Date(ev.delivery.watermark),
            identidad: ev.sender?.id ?? null, estado: 'delivered',
          } as EventoEstado);
          continue;
        }

        if (ev.read) {
          eventos.push({
            kind: 'estado', canal: 'messenger', cuentaExternaId: pageId,
            mensajeExternoId: null, watermark: new Date(ev.read.watermark),
            identidad: ev.sender?.id ?? null, estado: 'read',
          } as EventoEstado);
          continue;
        }

        if (ev.referral) {
          eventos.push({
            kind: 'otro', canal: 'messenger', cuentaExternaId: pageId,
            subtipo: 'referral', payload: ev,
          } as EventoOtro);
          continue;
        }

        eventos.push({
          kind: 'otro', canal: 'messenger', cuentaExternaId: pageId,
          subtipo: 'desconocido', payload: ev,
        } as EventoOtro);
      }
    }
    return eventos;
  },
};
