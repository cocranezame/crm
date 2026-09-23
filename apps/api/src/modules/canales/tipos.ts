// ─── Capa de canales del CRM ──────────────────────────────────────────────────
// Portado de ReparaTego (canales/tipos.ts). Cambio principal: la cuenta del
// negocio vive en crm.canales y pertenece a una empresa (empresa_id).

export type Canal = 'whatsapp' | 'messenger' | 'instagram' | 'tiktok';
export const CANALES: Canal[] = ['whatsapp', 'messenger', 'instagram', 'tiktok'];
export function esCanal(v: unknown): v is Canal {
  return typeof v === 'string' && (CANALES as string[]).includes(v);
}

export type TipoMensaje = 'texto' | 'imagen' | 'audio' | 'video' | 'documento' | 'ubicacion' | 'sistema';

/** Cuenta del negocio en un canal (fila de crm.canales). */
export interface CuentaCanal {
  canal_id:   number;
  empresa_id: string;
  tipo:       Canal;
  externo_id: string;          // phone_number_id | page_id | business_id
  waba_id:    string | null;
  nombre:     string;
  sandbox:    boolean;
  activo:     boolean;
}

export type MediaOrigen =
  | { kind: 'meta_media_id'; media_id: string }
  | { kind: 'url'; url: string }
  | { kind: 'tiktok_media'; conversation_id: string; message_id: string; media_id: string };

export interface EventoMensaje {
  kind:            'mensaje';
  canal:           Canal;
  cuentaExternaId: string;
  identidad:       string;
  identidades:     string[];
  wa?:             { telefono: string | null; bsuid: string | null; username: string | null };
  nombre:          string | null;
  conversacionExternaId?: string | null;
  mensajeExternoId: string;
  timestamp:       Date;
  direccion:       'entrante' | 'saliente';
  tipo:            TipoMensaje;
  contenido:       string | null;
  mediaUrlInicial: string | null;
  media:           MediaOrigen | null;
  mediaMime:       string | null;
  mediaFilename:   string | null;
  metadatos:       Record<string, unknown>;
}

export interface EventoEstado {
  kind:             'estado';
  canal:            Canal;
  cuentaExternaId:  string;
  mensajeExternoId: string | null;
  watermark:        Date | null;
  identidad:        string | null;
  estado:           'sent' | 'delivered' | 'read' | 'failed';
}

export interface EventoOtro {
  kind:            'otro';
  canal:           Canal;
  cuentaExternaId: string | null;
  subtipo:         string;
  payload:         unknown;
}

export type EventoCanal = EventoMensaje | EventoEstado | EventoOtro;

export interface ResultadoEnvio {
  ok:                boolean;
  mensajeExternoId?: string;
  error?:            string;
  bloqueado?:        boolean;
  motivoBloqueo?:    'ventana' | 'limite_mensajes';
}

export interface CapacidadesCanal {
  plantillasFueraDeVentana: boolean;
  ventanaHoras:             number | null;
  identidadIncluyeTelefono: boolean;
  soportaUbicacion:         boolean;
  soportaAudio:             boolean;
  recibeEcos:               boolean;
  maxMensajesConsecutivos:  number | null;
  soportaAdjuntosSalientes: boolean;
  soportaCaptionEnAdjunto:  boolean;
}

export const CAPACIDADES: Record<Canal, CapacidadesCanal> = {
  whatsapp:  { soportaAdjuntosSalientes: true,  soportaCaptionEnAdjunto: true,  maxMensajesConsecutivos: null, plantillasFueraDeVentana: true,  ventanaHoras: 24, identidadIncluyeTelefono: true,  soportaUbicacion: true,  soportaAudio: true,  recibeEcos: false },
  messenger: { soportaAdjuntosSalientes: true,  soportaCaptionEnAdjunto: false, maxMensajesConsecutivos: null, plantillasFueraDeVentana: false, ventanaHoras: 24, identidadIncluyeTelefono: false, soportaUbicacion: true,  soportaAudio: true,  recibeEcos: true },
  instagram: { soportaAdjuntosSalientes: true,  soportaCaptionEnAdjunto: false, maxMensajesConsecutivos: null, plantillasFueraDeVentana: false, ventanaHoras: 24, identidadIncluyeTelefono: false, soportaUbicacion: false, soportaAudio: true,  recibeEcos: true },
  tiktok:    { soportaAdjuntosSalientes: false, soportaCaptionEnAdjunto: false, maxMensajesConsecutivos: 10,   plantillasFueraDeVentana: false, ventanaHoras: 48, identidadIncluyeTelefono: false, soportaUbicacion: false, soportaAudio: false, recibeEcos: true },
};

export const NOMBRE_CANAL: Record<Canal, string> = {
  whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram', tiktok: 'TikTok',
};

export interface EnviarTextoInput {
  cuenta:                CuentaCanal;
  conversacion_id:       number;
  identidad:             string;
  conversacionExternaId: string | null;
  texto:                 string;
  ultimoEntranteEn:      Date | null;
  esHumano:              boolean;
}

export interface EnviarMediaInput extends Omit<EnviarTextoInput, 'texto'> {
  url:       string;
  tipoMedia: 'imagen' | 'video' | 'documento' | 'audio';
  filename:  string;
  caption:   string | null;
}

export interface EnviarPlantillaInput extends Omit<EnviarTextoInput, 'texto'> {
  nombre:     string;
  idioma:     string;
  parametros: string[];
}

export interface CanalSender {
  canal: Canal;
  enviarTexto(input: EnviarTextoInput): Promise<ResultadoEnvio>;
  enviarMedia?(input: EnviarMediaInput): Promise<ResultadoEnvio>;
  enviarPlantilla?(input: EnviarPlantillaInput): Promise<ResultadoEnvio>;
}

export interface CanalAdapter {
  canal:   Canal;
  objetos: string[];
  normalizar(payload: unknown): EventoCanal[];
  cuentaExternaIdDe(payload: unknown): string | null;
}
