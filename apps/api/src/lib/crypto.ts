// Cifrado simétrico AES-256-GCM para tokens de canales y secretos de plataforma.
// Formato: base64(iv[12] | tag[16] | ciphertext)
import crypto from 'crypto';
import { ENV } from '../config/env';

const KEY = Buffer.from(ENV.ENCRYPTION_KEY, 'hex');
if (KEY.length !== 32) throw new Error('CRM_ENCRYPTION_KEY debe tener 64 caracteres hex (32 bytes)');

export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function descifrar(b64: string | null | undefined): string | null {
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

export function tokenAleatorio(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Firma HMAC corta para URLs de media privadas. */
export function firmar(valor: string): string {
  return crypto.createHmac('sha256', KEY).update(valor).digest('base64url').slice(0, 32);
}
