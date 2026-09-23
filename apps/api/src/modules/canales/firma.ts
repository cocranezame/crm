// Verificación de firmas de webhooks (portado de ReparaTego).
//   Meta:   X-Hub-Signature-256: sha256=HMAC(app_secret, rawBody)
//   TikTok: Tiktok-Signature: t=<unix>,s=HMAC(app_secret, `${t}.${rawBody}`)
import crypto from 'crypto';
import type { RequestHandler } from 'express';
import { getConfig } from '../admin/config.service';
import { credencialesApp } from './tiktok/auth.service';

export const verificarFirmaMeta: RequestHandler = async (req, res, next) => {
  const secret = await getConfig('meta_app_secret');
  if (!secret) { console.error('[firma-meta] meta_app_secret no configurado'); res.status(500).json({ ok: false }); return; }
  const sig = req.headers['x-hub-signature-256'];
  if (typeof sig !== 'string' || !sig.startsWith('sha256=') || !req.rawBody) { res.status(401).json({ ok: false, error: 'firma_invalida' }); return; }
  const esperada = crypto.createHmac('sha256', secret).update(req.rawBody).digest();
  const recibida = Buffer.from(sig.slice(7), 'hex');
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) {
    console.warn('[firma-meta] HMAC no coincide');
    res.status(401).json({ ok: false, error: 'firma_invalida' });
    return;
  }
  next();
};

const TOLERANCIA_SEG = Number(process.env.TIKTOK_SIGNATURE_TOLERANCE_SEC ?? 300);

export function parsearFirmaTiktok(h: string | undefined): { t: number; s: string } | null {
  if (!h) return null;
  const p: Record<string, string> = {};
  for (const kv of h.split(',')) { const i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
  const t = Number(p.t);
  return Number.isFinite(t) && p.s ? { t, s: p.s } : null;
}

export const verificarFirmaTiktok: RequestHandler = async (req, res, next) => {
  const f = parsearFirmaTiktok(req.headers['tiktok-signature'] as string | undefined);
  if (!f || !req.rawBody) { res.status(401).json({ ok: false, error: 'firma_invalida' }); return; }
  let secret: string;
  try { secret = (await credencialesApp()).appSecret; } catch { res.status(500).json({ ok: false }); return; }
  const esperada = Buffer.from(crypto.createHmac('sha256', secret).update(`${f.t}.`).update(req.rawBody).digest('hex'), 'hex');
  const recibida = Buffer.from(f.s, 'hex');
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) { res.status(401).json({ ok: false, error: 'firma_invalida' }); return; }
  if (Math.abs(Math.floor(Date.now() / 1000) - f.t) > TOLERANCIA_SEG) { res.status(401).json({ ok: false, error: 'firma_expirada' }); return; }
  next();
};
