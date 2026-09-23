// Portado sin cambios de ReparaTego (apps/api/src/modules/crm/canales).
// ─── Adaptador WhatsApp Cloud API → EventoCanal ──────────────────────────────
// Normaliza `entry[].changes[].value` (object = whatsapp_business_account).
// No toca la BD: solo traduce el payload. La lógica de identidades múltiples
// (teléfono / BSUID / parent BSUID / username) se conserva tal cual estaba en
// webhook.router.ts.

import type {
  CanalAdapter, EventoCanal, EventoMensaje, EventoEstado, EventoOtro, TipoMensaje,
} from '../tipos';

// ─── Tipos payload Meta (WhatsApp) ────────────────────────────────────────────

export interface WaContact {
  wa_id?:          string;
  user_id?:        string;
  parent_user_id?: string;
  profile:  { name: string; username?: string };
}

export interface WaLocation {
  latitude:  number;
  longitude: number;
  name?:     string;
  address?:  string;
  url?:      string;
}

export interface WaSystem {
  type:            string;
  body?:           string;
  wa_id?:          string;
  user_id?:        string;
  parent_user_id?: string;
}

export interface WaMessage {
  from?:                string;
  from_user_id?:        string;
  from_parent_user_id?: string;
  id:        string;
  timestamp: string;
  type:      'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'interactive' | 'button' | 'system' | 'sticker' | 'reaction' | 'contacts';
  text?:     { body: string };
  image?:    { id: string; mime_type: string; caption?: string };
  audio?:    { id: string; mime_type: string };
  video?:    { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  location?: WaLocation;
  system?:   WaSystem;
}

export interface WaStatus {
  id:           string;
  status:       'sent' | 'delivered' | 'read' | 'failed';
  timestamp:    string;
  recipient_id: string;
}

export interface WaUserIdUpdate {
  wa_id?:          string;
  detail?:         string;
  timestamp?:      string;
  user_id?:        { previous?: string; current?: string };
  parent_user_id?: { previous?: string; current?: string };
}

export interface WaChangeValue {
  messaging_product: 'whatsapp';
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?:       WaContact[];
  messages?:       WaMessage[];
  statuses?:       WaStatus[];
  user_id_update?: WaUserIdUpdate[];
}

export interface WaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{ field: string; value: unknown }>;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_MAP: Partial<Record<WaMessage['type'], TipoMensaje>> = {
  text: 'texto', image: 'imagen', audio: 'audio', video: 'video',
  document: 'documento', location: 'ubicacion', sticker: 'imagen',
};

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function textoUbicacion(lat: number, lng: number, name?: string | null, address?: string | null): string {
  const coords = `${lat}, ${lng}`;
  const etiqueta = [name, address].filter(Boolean).join(' — ');
  return etiqueta
    ? `📍 Ubicación compartida: ${etiqueta} (${coords})`
    : `📍 Ubicación compartida: ${coords}`;
}

function extraerContenido(msg: WaMessage): string | null {
  if (msg.text) return msg.text.body;
  if (msg.location) return textoUbicacion(msg.location.latitude, msg.location.longitude, msg.location.name, msg.location.address);
  if (msg.image || msg.audio || msg.video) {
    return msg.image?.caption || msg.video?.caption || null;
  }
  if (msg.document) {
    return msg.document.caption || msg.document.filename || null;
  }
  return null;
}

function normalizarMensaje(value: WaChangeValue, msg: WaMessage): EventoMensaje | null {
  const contacto = value.contacts?.find(
    c => c.wa_id === msg.from || c.user_id === msg.from_user_id
  ) ?? value.contacts?.[0];

  // Meta solo incluye el teléfono (from/wa_id) si hubo interacción en 30 días o el
  // cliente está en el contact book; si no, llega solo el BSUID (from_user_id).
  const telefono   = msg.from ?? contacto?.wa_id ?? null;
  const bsuid      = msg.from_user_id ?? contacto?.user_id ?? null;
  const bsuidPadre = msg.from_parent_user_id ?? contacto?.parent_user_id ?? null;
  const username   = contacto?.profile?.username ?? null;
  const identidades = [...new Set([telefono, bsuid, bsuidPadre].filter((v): v is string => !!v))];
  const identidad  = telefono ?? bsuid ?? bsuidPadre ?? null;
  if (!identidad) return null;

  let tipo: TipoMensaje = TIPO_MAP[msg.type] ?? 'sistema';
  if (tipo === 'documento' && msg.document?.mime_type?.startsWith('image/')) tipo = 'imagen';

  const mediaId = msg.image?.id ?? msg.audio?.id ?? msg.video?.id ?? msg.document?.id ?? null;

  return {
    kind:             'mensaje',
    canal:            'whatsapp',
    cuentaExternaId:  value.metadata.phone_number_id,
    identidad,
    identidades,
    wa:               { telefono, bsuid: bsuid ?? bsuidPadre, username },
    nombre:           contacto?.profile?.name ?? null,
    mensajeExternoId: msg.id,
    timestamp:        new Date(Number(msg.timestamp) * 1000 || Date.now()),
    direccion:        'entrante',
    tipo,
    contenido:        extraerContenido(msg),
    mediaUrlInicial:  msg.location ? mapsUrl(msg.location.latitude, msg.location.longitude) : null,
    media:            mediaId ? { kind: 'meta_media_id', media_id: mediaId } : null,
    mediaMime:        msg.image?.mime_type ?? msg.audio?.mime_type ?? msg.video?.mime_type ?? msg.document?.mime_type ?? null,
    mediaFilename:    msg.document?.filename ?? null,
    metadatos:        msg as unknown as Record<string, unknown>,
  };
}

// ─── Adaptador ────────────────────────────────────────────────────────────────

export const whatsappAdapter: CanalAdapter = {
  canal:   'whatsapp',
  objetos: ['whatsapp_business_account'],

  cuentaExternaIdDe(payload: unknown): string | null {
    const p = payload as WaWebhookPayload;
    const v = p?.entry?.[0]?.changes?.[0]?.value as WaChangeValue | undefined;
    return v?.metadata?.phone_number_id ?? null;
  },

  normalizar(payload: unknown): EventoCanal[] {
    const p = payload as WaWebhookPayload;
    const eventos: EventoCanal[] = [];

    for (const entry of p.entry ?? []) {
      for (const change of entry.changes ?? []) {
        // Username del negocio: evento a nivel WABA, sin metadata.phone_number_id
        if (change.field === 'business_username_updates') {
          eventos.push({
            kind: 'otro', canal: 'whatsapp', cuentaExternaId: null,
            subtipo: 'business_username_updates',
            payload: { waba_id: entry.id, value: change.value },
          } as EventoOtro);
          continue;
        }

        if (change.field !== 'messages' && change.field !== 'user_id_update') continue;

        const value = change.value as WaChangeValue;
        const phoneNumId = value?.metadata?.phone_number_id;
        if (!phoneNumId) continue;

        if (change.field === 'user_id_update') {
          eventos.push({
            kind: 'otro', canal: 'whatsapp', cuentaExternaId: phoneNumId,
            subtipo: 'user_id_update', payload: value,
          } as EventoOtro);
          continue;
        }

        for (const msg of value.messages ?? []) {
          if (msg.type === 'system') {
            eventos.push({
              kind: 'otro', canal: 'whatsapp', cuentaExternaId: phoneNumId,
              subtipo: 'system', payload: msg,
            } as EventoOtro);
            continue;
          }
          const ev = normalizarMensaje(value, msg);
          if (ev) eventos.push(ev);
          else console.error(`[wa-adapter] mensaje sin identidad (from/from_user_id) wa_id=${msg.id}`);
        }

        for (const st of value.statuses ?? []) {
          eventos.push({
            kind: 'estado', canal: 'whatsapp', cuentaExternaId: phoneNumId,
            mensajeExternoId: st.id, watermark: null, identidad: st.recipient_id ?? null,
            estado: st.status,
          } as EventoEstado);
        }
      }
    }
    return eventos;
  },
};
