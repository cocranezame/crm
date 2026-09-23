import { urlPublica } from '../../lib/storage';

export interface MensajeFila {
  mensaje_id: number; conversacion_id: number; direccion: string; autor_tipo: string; autor_id: string | null;
  tipo: string; contenido: string | null; media_url: string | null; media_mime: string | null; media_nombre: string | null;
  externo_id: string | null; estado_envio: string | null; error: string | null; metadatos: Record<string, unknown>;
  enviado_en: Date; autor_nombre?: string | null; autor_color?: string | null;
}

/** Forma pública del mensaje: la media local sale con URL firmada. */
export function mensajeDTO(m: MensajeFila) {
  return { ...m, media_url: urlPublica(m.media_url) };
}

export const SELECT_MENSAJE = `
  SELECT m.*, u.nombre AS autor_nombre, u.color AS autor_color
    FROM crm.mensajes m LEFT JOIN app.usuarios u ON u.usuario_id = m.autor_id`;

/** Texto corto para la lista de la bandeja. */
export function vistaPrevia(tipo: string, contenido: string | null): string {
  const t: Record<string, string> = { imagen: '📷 Imagen', audio: '🎤 Nota de voz', video: '🎬 Video', documento: '📄 Documento', ubicacion: '📍 Ubicación', plantilla: '📋 Plantilla' };
  const base = contenido?.trim() ? contenido.trim() : t[tipo] ?? '';
  return (tipo !== 'texto' && tipo !== 'sistema' && contenido?.trim() && t[tipo] ? `${t[tipo].split(' ')[0]} ${base}` : base).slice(0, 160);
}
