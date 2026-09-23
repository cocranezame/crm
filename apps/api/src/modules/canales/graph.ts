// Cliente mínimo de Graph API (WhatsApp Cloud y Páginas de Facebook).
import { metaApp } from '../admin/config.service';
import { tokenDe } from './cuentas.service';

interface MetaError { error?: { message?: string; code?: number; error_subcode?: number } }

export async function graph(
  canalId: number,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; timeoutMs?: number; token?: string } = {},
): Promise<unknown> {
  const token = opts.token ?? (await tokenDe(canalId));
  if (!token) throw new Error(`canal ${canalId} sin access token`);
  const { apiVersion } = await metaApp();
  const res = await fetch(`https://graph.facebook.com/${apiVersion}${path}`, {
    method: opts.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const e = (json as MetaError).error;
    throw new Error(e?.message ? `${e.message} (code ${e.code ?? '?'}${e.error_subcode ? '/' + e.error_subcode : ''})` : `Meta HTTP ${res.status}`);
  }
  return json;
}

/** GET sin token de canal (p. ej. oauth/access_token o debug_token con app token). */
export async function graphPublico<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const json = (await res.json().catch(() => ({}))) as T & MetaError;
  if (!res.ok) throw new Error(json.error?.message ?? `Meta HTTP ${res.status}`);
  return json;
}
