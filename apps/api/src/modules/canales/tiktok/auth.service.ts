// ─── TikTok Business Messaging — OAuth y tokens ───────────────────────────────
// Portado de ReparaTego (canales/tiktok/auth.service.ts). Cambios:
//   · la cuenta vive en crm.canales (externo_id = business_id / open_id) con empresa_id
//   · tokens cifrados con AES-256-GCM en la API (antes pgp_sym_encrypt)
//   · credenciales de App a nivel plataforma (app.config_plataforma / env)
// Tokens: access ≈ 24 h (se refresca solo) · refresh ≈ 30 d (si vence → reautorizar).
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../../../db/pool';
import { ENV } from '../../../config/env';
import { cifrar, descifrar } from '../../../lib/crypto';
import { getConfig } from '../../admin/config.service';

export const TIKTOK_SCOPES = [
  'user.info.basic', 'user.info.username', 'user.info.stats', 'user.info.profile',
  'user.account.type', 'user.insights',
  'message.list.read', 'message.list.send', 'message.list.manage',
];
const MARGEN_REFRESH_MS = 5 * 60 * 1000;

export interface TiktokAppCred { appId: string; appSecret: string; apiVersion: string }

export async function credencialesApp(): Promise<TiktokAppCred> {
  const appId = await getConfig('tiktok_app_id');
  const appSecret = await getConfig('tiktok_app_secret');
  const apiVersion = (await getConfig('tiktok_api_version')) ?? 'v1.3';
  if (!appId || !appSecret) throw new Error('TikTok: configura tiktok_app_id y tiktok_app_secret en /admin → Plataforma');
  return { appId, appSecret, apiVersion };
}

export const apiBase = (v: string) => `https://business-api.tiktok.com/open_api/${v}`;
export const redirectUri = () => process.env.TIKTOK_REDIRECT_URI || `${ENV.WEB_URL}/config/canales/tiktok-callback`;

interface TiktokResp<T> { code: number; message: string; data?: T }

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as TiktokResp<T> | null;
  if (!res.ok || !json) throw new Error(`TikTok HTTP ${res.status}${json?.message ? `: ${json.message}` : ''}`);
  if (json.code !== 0) throw new Error(`TikTok ${json.code}: ${json.message}`);
  return json.data as T;
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(10_000) });
  const json = (await res.json().catch(() => null)) as TiktokResp<T> | null;
  if (!res.ok || !json) throw new Error(`TikTok HTTP ${res.status}`);
  if (json.code !== 0) throw new Error(`TikTok ${json.code}: ${json.message}`);
  return json.data as T;
}

// ── OAuth ──────────────────────────────────────────────────────────────────

interface StatePayload { usuario_id: string; empresa_id: string; nonce: string }

export function firmarState(usuario_id: string, empresa_id: string): string {
  return jwt.sign({ usuario_id, empresa_id, nonce: crypto.randomBytes(8).toString('hex'), scope: 'tiktok_oauth' }, ENV.JWT_SECRET, { expiresIn: '15m' });
}

export function verificarState(state: string): StatePayload {
  const d = jwt.verify(state, ENV.JWT_SECRET) as StatePayload & { scope?: string };
  if (d.scope !== 'tiktok_oauth') throw new Error('state inválido');
  return d;
}

export async function urlAutorizacion(state: string): Promise<string> {
  const cred = await credencialesApp();
  const q = new URLSearchParams({ client_key: cred.appId, response_type: 'code', scope: TIKTOK_SCOPES.join(','), redirect_uri: redirectUri(), state });
  return `https://www.tiktok.com/v2/auth/authorize?${q.toString()}`;
}

export interface TokensTiktok {
  business_id: string; access_token: string; refresh_token: string;
  token_expira_en: Date; refresh_expira_en: Date; scopes: string[];
}
interface TokenData { open_id: string; access_token: string; refresh_token: string; expires_in: number; refresh_token_expires_in: number; scope?: string }

function aTokens(d: TokenData, fallback?: string): TokensTiktok {
  const ahora = Date.now();
  return {
    business_id: d.open_id || fallback || '', access_token: d.access_token, refresh_token: d.refresh_token,
    token_expira_en: new Date(ahora + Number(d.expires_in) * 1000),
    refresh_expira_en: new Date(ahora + Number(d.refresh_token_expires_in) * 1000),
    scopes: (d.scope ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export async function intercambiarCodigo(code: string): Promise<TokensTiktok> {
  const cred = await credencialesApp();
  const d = await postJson<TokenData>(`${apiBase(cred.apiVersion)}/tt_user/oauth2/token/`, {
    client_id: cred.appId, client_secret: cred.appSecret, grant_type: 'authorization_code', auth_code: code, redirect_uri: redirectUri(),
  });
  const t = aTokens(d);
  const faltan = TIKTOK_SCOPES.filter((s) => !t.scopes.includes(s));
  if (faltan.length) throw new Error(`TikTok: no se otorgaron todos los permisos (faltan: ${faltan.join(', ')})`);
  return t;
}

export async function datosCuenta(businessId: string, accessToken: string) {
  try {
    const cred = await credencialesApp();
    const q = new URLSearchParams({ business_id: businessId, fields: JSON.stringify(['username', 'display_name', 'profile_image']) });
    return await getJson<{ username?: string; display_name?: string; profile_image?: string }>(
      `${apiBase(cred.apiVersion)}/business/get/?${q.toString()}`, { 'Access-Token': accessToken });
  } catch {
    return {};
  }
}

/**
 * Único punto para obtener el access token vigente. Refresco perezoso con lock
 * de fila (FOR UPDATE) para que dos procesos no refresquen a la vez.
 */
export async function tokenTiktok(canalId: number): Promise<string> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [f] } = await c.query(
      `SELECT externo_id, token_enc, refresh_token_enc, token_expira_en, refresh_expira_en
         FROM crm.canales WHERE canal_id = $1 AND tipo = 'tiktok' FOR UPDATE`, [canalId]);
    if (!f) throw new Error(`canal ${canalId} no es TikTok`);
    const ahora = Date.now();
    const token = descifrar(f.token_enc);
    if (token && f.token_expira_en && new Date(f.token_expira_en).getTime() - ahora > MARGEN_REFRESH_MS) {
      await c.query('COMMIT');
      return token;
    }
    const refresh = descifrar(f.refresh_token_enc);
    if (!refresh || !f.refresh_expira_en || new Date(f.refresh_expira_en).getTime() < ahora) {
      await c.query(`UPDATE crm.canales SET estado_conexion = 'reautorizar' WHERE canal_id = $1`, [canalId]);
      await c.query('COMMIT');
      throw new Error('TikTok: el refresh token venció; reautoriza la cuenta en Configuración → Canales');
    }
    const cred = await credencialesApp();
    const d = await postJson<TokenData>(`${apiBase(cred.apiVersion)}/tt_user/oauth2/refresh_token/`, {
      client_id: cred.appId, client_secret: cred.appSecret, grant_type: 'refresh_token', refresh_token: refresh,
    });
    const t = aTokens(d, f.externo_id);
    await c.query(
      `UPDATE crm.canales SET token_enc = $2, refresh_token_enc = $3, token_expira_en = $4, refresh_expira_en = $5, estado_conexion = 'conectado'
        WHERE canal_id = $1`,
      [canalId, cifrar(t.access_token), cifrar(t.refresh_token), t.token_expira_en, t.refresh_expira_en]);
    await c.query('COMMIT');
    return t.access_token;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
