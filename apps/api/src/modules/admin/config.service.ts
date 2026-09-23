// Credenciales a nivel plataforma (una App de Meta / TikTok para todos los tenants).
// Orden de resolución: app.config_plataforma (editable en /admin) → variable de entorno.
import { pool } from '../../db/pool';
import { cifrar, descifrar } from '../../lib/crypto';

export const CLAVES_PLATAFORMA = {
  meta_app_id:        { env: 'META_APP_ID',        secreto: false, etiqueta: 'Meta · App ID' },
  meta_app_secret:    { env: 'META_APP_SECRET',    secreto: true,  etiqueta: 'Meta · App Secret' },
  meta_config_id:     { env: 'META_CONFIG_ID',     secreto: false, etiqueta: 'Meta · Configuration ID (Embedded Signup)' },
  meta_verify_token:  { env: 'META_VERIFY_TOKEN',  secreto: false, etiqueta: 'Meta · Verify token del webhook' },
  meta_api_version:   { env: 'META_API_VERSION',   secreto: false, etiqueta: 'Meta · Versión de Graph API' },
  tiktok_app_id:      { env: 'TIKTOK_APP_ID',      secreto: false, etiqueta: 'TikTok · App ID' },
  tiktok_app_secret:  { env: 'TIKTOK_APP_SECRET',  secreto: true,  etiqueta: 'TikTok · App Secret' },
  tiktok_api_version: { env: 'TIKTOK_API_VERSION', secreto: false, etiqueta: 'TikTok · Versión de API' },
} as const;

export type ClavePlataforma = keyof typeof CLAVES_PLATAFORMA;

const DEFAULTS: Partial<Record<ClavePlataforma, string>> = { meta_api_version: 'v22.0', tiktok_api_version: 'v1.3', meta_verify_token: 'crm-verify-token' };

let cache: { t: number; valores: Map<string, string | null> } | null = null;

async function cargar(): Promise<Map<string, string | null>> {
  if (cache && Date.now() - cache.t < 30_000) return cache.valores;
  const { rows } = await pool.query<{ clave: string; valor: string | null; secreto: boolean }>('SELECT clave, valor, secreto FROM app.config_plataforma');
  const valores = new Map(rows.map((r) => [r.clave, r.secreto ? descifrar(r.valor) : r.valor]));
  cache = { t: Date.now(), valores };
  return valores;
}

export async function getConfig(clave: ClavePlataforma): Promise<string | null> {
  const v = (await cargar()).get(clave);
  if (v) return v;
  return process.env[CLAVES_PLATAFORMA[clave].env] || DEFAULTS[clave] || null;
}

export async function setConfig(clave: ClavePlataforma, valor: string | null): Promise<void> {
  const def = CLAVES_PLATAFORMA[clave];
  await pool.query(
    `INSERT INTO app.config_plataforma (clave, valor, secreto, actualizado_en) VALUES ($1,$2,$3,now())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, secreto = EXCLUDED.secreto, actualizado_en = now()`,
    [clave, valor ? (def.secreto ? cifrar(valor) : valor) : null, def.secreto]);
  cache = null;
}

/** Estado para la UI de /admin: nunca devuelve secretos, solo si están configurados. */
export async function estadoConfig() {
  const valores = await cargar();
  return (Object.keys(CLAVES_PLATAFORMA) as ClavePlataforma[]).map((clave) => {
    const def = CLAVES_PLATAFORMA[clave];
    const bd = valores.get(clave);
    const env = process.env[def.env];
    const efectivo = bd || env || DEFAULTS[clave] || null;
    return {
      clave, etiqueta: def.etiqueta, secreto: def.secreto,
      origen: bd ? 'panel' : env ? 'entorno' : DEFAULTS[clave] ? 'defecto' : null,
      valor: def.secreto ? (efectivo ? '••••••••' : null) : efectivo,
    };
  });
}

export async function metaApp() {
  return {
    appId: await getConfig('meta_app_id'),
    appSecret: await getConfig('meta_app_secret'),
    apiVersion: (await getConfig('meta_api_version')) ?? 'v22.0',
    configId: await getConfig('meta_config_id'),
  };
}
