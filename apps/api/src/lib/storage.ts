// Almacenamiento local de archivos (volumen Docker crm_media). Reemplaza al S3
// compartido de ReparaTego; en producción se cambia por Supabase Storage/S3
// sin tocar a quien lo usa (guardar / urlPublica).
//   · El valor que se guarda en BD es "local:<empresa>/<yyyy-mm>/<uuid>.<ext>"
//   · La URL que ve el navegador (o Meta, para adjuntos salientes) va firmada y vence.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ENV } from '../config/env';
import { firmar } from './crypto';

const RAIZ = path.resolve(ENV.MEDIA_DIR);

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/webm': 'webm', 'application/pdf': 'pdf',
};

export function extensionDe(mime: string | null | undefined, nombre?: string | null): string {
  const porNombre = nombre?.includes('.') ? nombre.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : null;
  return (mime && EXT[mime.split(';')[0]]) || porNombre || 'bin';
}

export async function guardar(empresaId: string, buffer: Buffer, mime: string | null, nombre?: string | null): Promise<string> {
  const mes = new Date().toISOString().slice(0, 7);
  const rel = `${empresaId}/${mes}/${crypto.randomUUID()}.${extensionDe(mime, nombre)}`;
  const abs = path.join(RAIZ, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return `local:${rel}`;
}

/** Ruta absoluta de un archivo local validando que no se salga de la raíz. */
export function rutaLocal(rel: string): string | null {
  const abs = path.resolve(RAIZ, rel);
  return abs.startsWith(RAIZ + path.sep) ? abs : null;
}

/** URL firmada (por defecto 7 días: sirve también para que Meta descargue el adjunto). */
export function urlPublica(valor: string | null | undefined, segundos = 7 * 24 * 3600): string | null {
  if (!valor) return null;
  if (!valor.startsWith('local:')) return valor;
  const rel = valor.slice(6);
  const exp = Math.floor(Date.now() / 1000) + segundos;
  // Se redondea la expiración a la hora para que la URL sea estable (caché del navegador)
  const expR = Math.ceil(exp / 3600) * 3600;
  return `${ENV.PUBLIC_API_URL}/media/${rel}?e=${expR}&s=${firmar(`${rel}:${expR}`)}`;
}

export function firmaValida(rel: string, e: string, s: string): boolean {
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const esperada = firmar(`${rel}:${exp}`);
  return esperada.length === s.length && crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(s));
}
