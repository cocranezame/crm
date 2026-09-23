// Webhooks públicos (una sola URL para todas las empresas: la empresa se resuelve
// por crm.canales(tipo, externo_id), nunca por parámetros de la URL).
//   GET  /webhooks/meta    verificación (hub.challenge)
//   POST /webhooks/meta    WhatsApp + Messenger (+ Instagram)
//   POST /webhooks/tiktok  TikTok Business Messaging
import { Router } from 'express';
import { pool } from '../../db/pool';
import { getConfig } from '../admin/config.service';
import { verificarFirmaMeta, verificarFirmaTiktok } from './firma';
import { adapterPorCanal, adapterPorObjeto } from './registry';
import { procesarEventos } from './ingesta.service';

const router = Router();

async function log(canal: string, payload: unknown, resultado: string) {
  await pool.query('INSERT INTO crm.webhook_log (canal, payload, resultado) VALUES ($1,$2,$3)', [canal, JSON.stringify(payload), resultado]).catch(() => undefined);
}

router.get('/meta', async (req, res) => {
  const token = await getConfig('meta_verify_token');
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) {
    res.status(200).send(String(req.query['hub.challenge'] ?? ''));
    return;
  }
  res.sendStatus(403);
});

router.post('/meta', verificarFirmaMeta, async (req, res) => {
  const adapter = adapterPorObjeto(req.body?.object);
  if (!adapter) { await log('desconocido', req.body, 'objeto no soportado'); res.sendStatus(200); return; }
  try {
    const r = await procesarEventos(adapter.normalizar(req.body));
    await log(adapter.canal, req.body, JSON.stringify(r));
  } catch (e) {
    console.error('[webhook-meta]', e);
    await log(adapter.canal, req.body, `error: ${(e as Error).message}`);
  }
  // Siempre 200: un 5xx hace que Meta reintente y duplique (la idempotencia igual lo cubre).
  res.sendStatus(200);
});

router.post('/tiktok', verificarFirmaTiktok, async (req, res) => {
  try {
    const r = await procesarEventos(adapterPorCanal('tiktok').normalizar(req.body));
    await log('tiktok', req.body, JSON.stringify(r));
  } catch (e) {
    console.error('[webhook-tiktok]', e);
    await log('tiktok', req.body, `error: ${(e as Error).message}`);
  }
  res.status(200).json({ ok: true });
});

export default router;
