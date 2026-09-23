// Administración de canales de la empresa: conexión (WhatsApp, Messenger, TikTok),
// canales de prueba y simulador de mensajes entrantes.
import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ENV } from '../../config/env';
import { cifrar, descifrar } from '../../lib/crypto';
import { ah, conflicto, HttpError, idParam, invalido, noEncontrado } from '../../lib/http';
import { verificarLimite } from '../../lib/planes';
import { guardar } from '../../lib/storage';
import { emitirEmpresa } from '../../lib/realtime';
import { ctx, requireRol } from '../../middlewares/auth';
import { getConfig, metaApp } from '../admin/config.service';
import { cuentaDeEmpresa } from './cuentas.service';
import { graph, graphPublico } from './graph';
import { suscribirPagina } from './messenger/sender';
import { adapterPorCanal } from './registry';
import { procesarEventos } from './ingesta.service';
import { datosCuenta, firmarState, intercambiarCodigo, urlAutorizacion, verificarState } from './tiktok/auth.service';
import type { Canal } from './tipos';

const router = Router();

// ── Listado ────────────────────────────────────────────────────────────────

router.get('/', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { rows } = await pool.query(
    `SELECT c.canal_id, c.tipo, c.externo_id, c.waba_id, c.nombre, c.datos, c.sandbox, c.estado_conexion, c.activo,
            c.token_expira_en, c.refresh_expira_en, c.creado_en,
            (SELECT count(*) FROM crm.conversaciones cv WHERE cv.canal_id = c.canal_id)::int AS conversaciones
       FROM crm.canales c WHERE c.empresa_id = $1 ORDER BY c.activo DESC, c.sandbox, c.creado_en`, [empresaId]);
  const meta = await metaApp();
  res.json({
    ok: true, canales: rows,
    plataforma: {
      meta_configurada: Boolean(meta.appId && meta.appSecret),
      meta_app_id: meta.appId, meta_config_id: meta.configId, meta_api_version: meta.apiVersion,
      tiktok_configurada: Boolean((await getConfig('tiktok_app_id')) && (await getConfig('tiktok_app_secret'))),
      webhook_meta: `${ENV.PUBLIC_API_URL}/webhooks/meta`,
      webhook_tiktok: `${ENV.PUBLIC_API_URL}/webhooks/tiktok`,
      verify_token: await getConfig('meta_verify_token'),
    },
  });
}));

// ── Canal de prueba (local, sin Meta/TikTok) ────────────────────────────────

router.post('/sandbox', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = z.object({ tipo: z.enum(['whatsapp', 'messenger', 'tiktok']), nombre: z.string().trim().min(1).max(60) }).parse(req.body);
  const externo = `sbx-${d.tipo}-${crypto.randomBytes(5).toString('hex')}`;
  const datos = d.tipo === 'whatsapp' ? { numero_display: '+51 900 000 000', verified_name: d.nombre } : { username: d.nombre.toLowerCase().replace(/\s+/g, '') };
  const { rows: [c] } = await pool.query(
    `INSERT INTO crm.canales (empresa_id, tipo, externo_id, waba_id, nombre, sandbox, datos) VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING canal_id`,
    [empresaId, d.tipo, externo, d.tipo === 'whatsapp' ? `sbx-waba-${crypto.randomBytes(4).toString('hex')}` : null, d.nombre, JSON.stringify(datos)]);
  res.status(201).json({ ok: true, canal_id: c.canal_id });
}));

// ── WhatsApp: conexión manual (phone_number_id + token de sistema) ─────────

router.post('/whatsapp/manual', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = z.object({
    nombre: z.string().trim().min(1).max(60), phone_number_id: z.string().trim().regex(/^\d+$/),
    waba_id: z.string().trim().regex(/^\d+$/), access_token: z.string().trim().min(20),
  }).parse(req.body);
  await verificarLimite(empresaId, 'canales');
  let info: { display_phone_number?: string; verified_name?: string; quality_rating?: string };
  try {
    info = (await graph(0, `/${d.phone_number_id}?fields=display_phone_number,verified_name,quality_rating`, { token: d.access_token })) as typeof info;
  } catch (e) {
    throw invalido(`Meta rechazó los datos: ${(e as Error).message}`);
  }
  // Suscribe la App al WABA para recibir el webhook (idempotente)
  await graph(0, `/${d.waba_id}/subscribed_apps`, { method: 'POST', token: d.access_token }).catch((e) => console.warn('[wa] subscribed_apps:', (e as Error).message));
  const { rows: [c] } = await pool.query(
    `INSERT INTO crm.canales (empresa_id, tipo, externo_id, waba_id, nombre, token_enc, datos) VALUES ($1,'whatsapp',$2,$3,$4,$5,$6) RETURNING canal_id`,
    [empresaId, d.phone_number_id, d.waba_id, d.nombre, cifrar(d.access_token), JSON.stringify({ numero_display: info.display_phone_number, verified_name: info.verified_name, calidad: info.quality_rating })]);
  res.status(201).json({ ok: true, canal_id: c.canal_id });
}));

// ── WhatsApp: Embedded Signup (portado de ReparaTego) ──────────────────────

async function intercambiarCodeMeta(code: string) {
  const { appId, appSecret, apiVersion } = await metaApp();
  if (!appId || !appSecret) throw invalido('La App de Meta no está configurada en la plataforma (/admin → Plataforma)');
  const base = `https://graph.facebook.com/${apiVersion}`;
  const { access_token: corto } = await graphPublico<{ access_token: string }>(`${base}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`);
  const largo = await graphPublico<{ access_token: string; expires_in?: number }>(
    `${base}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${corto}`);
  const debug = await graphPublico<{ data: { granular_scopes: Array<{ scope: string; target_ids?: string[] }> } }>(
    `${base}/debug_token?input_token=${largo.access_token}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`);
  const wabas = debug.data.granular_scopes.filter((s) => s.scope === 'whatsapp_business_management').flatMap((s) => s.target_ids ?? []);
  const numeros: Array<{ waba_id: string; id: string; display_phone_number: string; verified_name: string; quality_rating: string }> = [];
  for (const waba_id of wabas) {
    const { data } = await graphPublico<{ data: Array<{ id: string; display_phone_number: string; verified_name: string; quality_rating: string }> }>(
      `${base}/${waba_id}/phone_numbers?access_token=${largo.access_token}`);
    numeros.push(...data.map((n) => ({ waba_id, ...n })));
  }
  return { token: largo.access_token, expira: largo.expires_in ? new Date(Date.now() + largo.expires_in * 1000) : null, numeros };
}

async function crearCanalWa(empresaId: string, token: string, expira: Date | null, n: { waba_id: string; id: string; display_phone_number: string; verified_name: string; quality_rating?: string }) {
  await verificarLimite(empresaId, 'canales');
  await graph(0, `/${n.waba_id}/subscribed_apps`, { method: 'POST', token }).catch(() => undefined);
  const { rows: [c] } = await pool.query(
    `INSERT INTO crm.canales (empresa_id, tipo, externo_id, waba_id, nombre, token_enc, token_expira_en, datos)
     VALUES ($1,'whatsapp',$2,$3,$4,$5,$6,$7) RETURNING canal_id`,
    [empresaId, n.id, n.waba_id, n.verified_name, cifrar(token), expira,
     JSON.stringify({ numero_display: n.display_phone_number, verified_name: n.verified_name, calidad: n.quality_rating })]);
  return c.canal_id as number;
}

router.post('/whatsapp/embedded', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const { code } = z.object({ code: z.string().min(10) }).parse(req.body);
  const r = await intercambiarCodeMeta(code).catch((e) => { throw invalido(`Meta: ${(e as Error).message}`); });
  if (!r.numeros.length) throw invalido('No se encontraron números en la cuenta autorizada');
  if (r.numeros.length === 1) {
    res.status(201).json({ ok: true, canal_id: await crearCanalWa(empresaId, r.token, r.expira, r.numeros[0]) });
    return;
  }
  // Varios números: el code ya se consumió, así que el token viaja cifrado y firmado (10 min)
  const seleccion = jwt.sign({ t: cifrar(r.token), x: r.expira?.toISOString() ?? null, e: empresaId, n: r.numeros }, ENV.JWT_SECRET, { expiresIn: '10m' });
  res.json({ ok: true, opciones: r.numeros, seleccion });
}));

router.post('/whatsapp/embedded/seleccionar', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = z.object({ seleccion: z.string(), phone_number_id: z.string() }).parse(req.body);
  let s: { t: string; x: string | null; e: string; n: Array<{ waba_id: string; id: string; display_phone_number: string; verified_name: string }> };
  try { s = jwt.verify(d.seleccion, ENV.JWT_SECRET) as typeof s; } catch { throw invalido('La selección venció, vuelve a conectar'); }
  if (s.e !== empresaId) throw invalido('Selección de otra empresa');
  const n = s.n.find((x) => x.id === d.phone_number_id);
  if (!n) throw invalido('Número no válido');
  res.status(201).json({ ok: true, canal_id: await crearCanalWa(empresaId, descifrar(s.t)!, s.x ? new Date(s.x) : null, n) });
}));

// ── Messenger: Página + Page Access Token ──────────────────────────────────

router.post('/messenger/manual', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = z.object({ page_id: z.string().trim().regex(/^\d+$/), page_token: z.string().trim().min(20), nombre: z.string().trim().max(60).optional() }).parse(req.body);
  await verificarLimite(empresaId, 'canales');
  let pagina: { name?: string };
  try { pagina = (await graph(0, `/${d.page_id}?fields=name`, { token: d.page_token })) as { name?: string }; }
  catch (e) { throw invalido(`Meta rechazó la Página: ${(e as Error).message}`); }
  const { rows: [c] } = await pool.query(
    `INSERT INTO crm.canales (empresa_id, tipo, externo_id, nombre, token_enc, datos) VALUES ($1,'messenger',$2,$3,$4,$5) RETURNING canal_id`,
    [empresaId, d.page_id, d.nombre || pagina.name || 'Página de Facebook', cifrar(d.page_token), JSON.stringify({ pagina: pagina.name })]);
  await suscribirPagina(c.canal_id, d.page_id).catch((e) => console.warn('[messenger] suscripción:', (e as Error).message));
  res.status(201).json({ ok: true, canal_id: c.canal_id });
}));

// ── TikTok: OAuth ──────────────────────────────────────────────────────────

router.get('/tiktok/autorizar', requireRol('admin'), ah(async (req, res) => {
  const { empresaId, usuarioId } = ctx(req);
  try { res.json({ ok: true, url: await urlAutorizacion(firmarState(usuarioId, empresaId)) }); }
  catch (e) { throw invalido((e as Error).message); }
}));

router.post('/tiktok/callback', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = z.object({ code: z.string().min(5), state: z.string() }).parse(req.body);
  let st;
  try { st = verificarState(d.state); } catch { throw invalido('La autorización venció, inténtalo de nuevo'); }
  if (st.empresa_id !== empresaId) throw invalido('La autorización pertenece a otra empresa');
  await verificarLimite(empresaId, 'canales');
  const t = await intercambiarCodigo(d.code).catch((e) => { throw invalido((e as Error).message); });
  const info = await datosCuenta(t.business_id, t.access_token);
  const { rows: [c] } = await pool.query(
    `INSERT INTO crm.canales (empresa_id, tipo, externo_id, nombre, token_enc, refresh_token_enc, token_expira_en, refresh_expira_en, datos)
     VALUES ($1,'tiktok',$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tipo, externo_id) DO UPDATE SET token_enc = EXCLUDED.token_enc, refresh_token_enc = EXCLUDED.refresh_token_enc,
        token_expira_en = EXCLUDED.token_expira_en, refresh_expira_en = EXCLUDED.refresh_expira_en, estado_conexion = 'conectado', activo = true
      WHERE crm.canales.empresa_id = EXCLUDED.empresa_id
     RETURNING canal_id`,
    [empresaId, t.business_id, info.display_name || info.username || 'TikTok', cifrar(t.access_token), cifrar(t.refresh_token),
     t.token_expira_en, t.refresh_expira_en, JSON.stringify({ username: info.username, foto: info.profile_image, scopes: t.scopes })]);
  if (!c) throw conflicto('Esa cuenta de TikTok ya está conectada en otra empresa');
  res.status(201).json({ ok: true, canal_id: c.canal_id });
}));

// ── Gestión ────────────────────────────────────────────────────────────────

router.patch('/:id', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const d = z.object({ nombre: z.string().trim().min(1).max(60).optional(), activo: z.boolean().optional() }).parse(req.body);
  if (d.activo === true) {
    const { rows: [c] } = await pool.query('SELECT sandbox, activo FROM crm.canales WHERE canal_id = $1 AND empresa_id = $2', [idParam(req), empresaId]);
    if (c && !c.sandbox && !c.activo) await verificarLimite(empresaId, 'canales');
  }
  const { rowCount } = await pool.query(
    'UPDATE crm.canales SET nombre = COALESCE($3, nombre), activo = COALESCE($4, activo) WHERE canal_id = $1 AND empresa_id = $2',
    [idParam(req), empresaId, d.nombre ?? null, d.activo ?? null]);
  if (!rowCount) throw noEncontrado('Canal');
  res.json({ ok: true });
}));

router.delete('/:id', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const id = idParam(req);
  const { rows: [c] } = await pool.query(
    `SELECT (SELECT count(*) FROM crm.conversaciones WHERE canal_id = $1)::int AS convs FROM crm.canales WHERE canal_id = $1 AND empresa_id = $2`, [id, empresaId]);
  if (!c) throw noEncontrado('Canal');
  if (c.convs > 0 && req.query.forzar !== '1') {
    throw new HttpError(409, `El canal tiene ${c.convs} conversación(es). Desactívalo para conservar el historial, o elimínalo junto con ellas.`, 'tiene_conversaciones');
  }
  await pool.query('DELETE FROM crm.canales WHERE canal_id = $1 AND empresa_id = $2', [id, empresaId]);
  emitirEmpresa(empresaId, 'conversacion:actualizada', {});
  res.json({ ok: true });
}));

router.post('/:id/probar', requireRol('admin'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const c = await cuentaDeEmpresa(empresaId, idParam(req));
  if (c.sandbox) { res.json({ ok: true, mensaje: 'Canal de prueba: siempre conectado' }); return; }
  try {
    if (c.tipo === 'tiktok') {
      const { tokenTiktok } = await import('./tiktok/auth.service');
      await tokenTiktok(c.canal_id);
    } else {
      await graph(c.canal_id, `/${c.externo_id}?fields=id`);
    }
    await pool.query(`UPDATE crm.canales SET estado_conexion = 'conectado' WHERE canal_id = $1`, [c.canal_id]);
    res.json({ ok: true, mensaje: 'Conexión correcta' });
  } catch (e) {
    await pool.query(`UPDATE crm.canales SET estado_conexion = 'error' WHERE canal_id = $1`, [c.canal_id]);
    throw invalido(`La conexión falló: ${(e as Error).message}`);
  }
}));

// ── Simulador de mensajes entrantes (solo canales de prueba) ───────────────
// Construye el payload NATIVO de cada plataforma y lo pasa por el mismo adaptador
// y la misma ingesta que usa el webhook real.

function svgImagen(texto: string): Buffer {
  const hue = Math.floor(Math.random() * 360);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,45%)"/></linearGradient></defs>
  <rect width="640" height="420" fill="url(#g)"/><circle cx="520" cy="90" r="46" fill="#fff" opacity=".35"/>
  <path d="M0 330 L170 200 L300 300 L420 220 L640 360 L640 420 L0 420Z" fill="#fff" opacity=".28"/>
  <text x="40" y="380" font-family="Arial,sans-serif" font-size="28" fill="#fff" font-weight="bold">${texto.replace(/[<&>]/g, '').slice(0, 40)}</text></svg>`);
}

router.post('/:id/simular', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const cuenta = await cuentaDeEmpresa(empresaId, idParam(req));
  if (!cuenta.sandbox) throw invalido('El simulador solo funciona con canales de prueba');
  const d = z.object({
    nombre: z.string().trim().min(1).max(60),
    identidad: z.string().trim().min(3).max(60),
    tipo: z.enum(['texto', 'imagen', 'ubicacion']).default('texto'),
    texto: z.string().trim().max(4000).optional(),
  }).parse(req.body);
  if (d.tipo === 'texto' && !d.texto) throw invalido('Escribe el mensaje');

  const mid = crypto.randomUUID().replace(/-/g, '');
  const ahora = Date.now();
  const tipo = cuenta.tipo as Canal;
  let payload: unknown;

  if (tipo === 'whatsapp') {
    const tel = d.identidad.replace(/\D/g, '');
    if (tel.length < 8) throw invalido('Para WhatsApp la identidad es el teléfono (ej. 51987654321)');
    const msg: Record<string, unknown> = { from: tel, id: `wamid.sbx.${mid}`, timestamp: String(Math.floor(ahora / 1000)) };
    if (d.tipo === 'texto') Object.assign(msg, { type: 'text', text: { body: d.texto } });
    if (d.tipo === 'imagen') Object.assign(msg, { type: 'image', image: { id: `sbx${mid}`, mime_type: 'image/svg+xml', caption: d.texto || undefined } });
    if (d.tipo === 'ubicacion') Object.assign(msg, { type: 'location', location: { latitude: -11.9498, longitude: -77.0622, name: 'Plaza Norte', address: 'Independencia, Lima' } });
    payload = { object: 'whatsapp_business_account', entry: [{ id: cuenta.waba_id ?? 'sbx', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '', phone_number_id: cuenta.externo_id },
      contacts: [{ wa_id: tel, profile: { name: d.nombre } }], messages: [msg] } }] }] };
  } else if (tipo === 'messenger') {
    const message: Record<string, unknown> = { mid: `m_sbx_${mid}` };
    if (d.tipo === 'texto') message.text = d.texto;
    if (d.tipo === 'imagen') message.attachments = [{ type: 'image', payload: { url: 'sbx://imagen' } }];
    if (d.tipo === 'ubicacion') message.attachments = [{ type: 'location', title: 'Plaza Norte', payload: { coordinates: { lat: -11.9498, long: -77.0622 } } }];
    payload = { object: 'page', entry: [{ id: cuenta.externo_id, time: ahora, messaging: [{ sender: { id: d.identidad }, recipient: { id: cuenta.externo_id }, timestamp: ahora, message }] }] };
  } else if (tipo === 'tiktok') {
    if (d.tipo !== 'texto' && d.tipo !== 'imagen') throw invalido('TikTok solo admite texto e imagen');
    payload = { event: 'im_receive_msg', user_openid: cuenta.externo_id, create_time: Math.floor(ahora / 1000), content: JSON.stringify({
      conversation_id: `sbxconv-${d.identidad}`, message_id: `sbx-${mid}`, type: d.tipo === 'texto' ? 'text' : 'image', timestamp: ahora,
      from: d.nombre.toLowerCase().replace(/\s+/g, '_'), from_user: { id: d.identidad }, to: cuenta.nombre, to_user: { id: cuenta.externo_id },
      ...(d.tipo === 'texto' ? { text: { body: d.texto } } : { image: { media_id: `sbx${mid}` } }) }) };
  } else {
    throw invalido('Canal no soportado por el simulador');
  }

  const eventos = adapterPorCanal(tipo).normalizar(payload);
  for (const ev of eventos) {
    if (ev.kind !== 'mensaje') continue;
    // Messenger/TikTok no traen el nombre real en el webhook; el real se pide a Graph. Aquí se simula.
    ev.nombre = d.nombre;
    if (ev.tipo === 'imagen') {
      ev.media = null;
      ev.mediaMime = 'image/svg+xml';
      ev.mediaUrlInicial = await guardar(empresaId, svgImagen(d.texto || 'Foto de prueba'), 'image/svg+xml', 'foto.svg');
    }
  }
  const r = await procesarEventos(eventos, { cuenta });
  res.json({ ok: true, ...r });
}));

export default router;
