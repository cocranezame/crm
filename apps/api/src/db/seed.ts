// Datos de demostración (idempotente: si ya hay usuarios, no hace nada).
//   · superadmin + propietario: admin@demo.com / admin123
//   · 2 agentes: ana@demo.com, luis@demo.com (misma contraseña)
//   · Empresa "Demo Kallpa" (plan pro) con canales de prueba WA / Messenger / TikTok,
//     contactos, negocios repartidos en el tablero y conversaciones con mensajes.
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool, tx } from './pool';
import { sembrarEmpresa } from '../modules/empresas/defaults';
import { adapterPorCanal } from '../modules/canales/registry';
import { procesarEventos } from '../modules/canales/ingesta.service';
import type { CuentaCanal } from '../modules/canales/tipos';

const EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@demo.com';
const PASS = process.env.SEED_ADMIN_PASSWORD || 'admin123';

async function main() {
  const { rows: [{ n }] } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM app.usuarios');
  if (n > 0) { console.log('[seed] ya hay datos, se omite'); await pool.end(); return; }

  const hash = await bcrypt.hash(PASS, 10);
  const { empresaId, adminId, agentes } = await tx(async (c) => {
    const { rows: [u] } = await c.query<{ usuario_id: string }>(
      `INSERT INTO app.usuarios (email, password_hash, nombre, color, es_superadmin) VALUES ($1,$2,'Kallpa Admin','#6366f1',true) RETURNING usuario_id`, [EMAIL, hash]);
    const { rows: [e] } = await c.query<{ empresa_id: string }>(
      `INSERT INTO app.empresas (nombre, slug, plan) VALUES ('Demo Kallpa', 'demo-kallpa', 'pro') RETURNING empresa_id`);
    await c.query(`INSERT INTO app.miembros (empresa_id, usuario_id, rol) VALUES ($1,$2,'propietario')`, [e.empresa_id, u.usuario_id]);
    const agentes: string[] = [];
    for (const [nombre, email, color, rol] of [['Ana Torres', 'ana@demo.com', '#ec4899', 'supervisor'], ['Luis Quispe', 'luis@demo.com', '#10b981', 'agente']]) {
      const { rows: [a] } = await c.query<{ usuario_id: string }>(
        `INSERT INTO app.usuarios (email, password_hash, nombre, color) VALUES ($1,$2,$3,$4) RETURNING usuario_id`, [email, hash, nombre, color]);
      await c.query(`INSERT INTO app.miembros (empresa_id, usuario_id, rol) VALUES ($1,$2,$3)`, [e.empresa_id, a.usuario_id, rol]);
      agentes.push(a.usuario_id);
    }
    await sembrarEmpresa(c, e.empresa_id, u.usuario_id);
    return { empresaId: e.empresa_id, adminId: u.usuario_id, agentes };
  });

  // ── Canales de prueba ──
  const canales: Record<string, CuentaCanal> = {};
  for (const [tipo, nombre] of [['whatsapp', 'WhatsApp Ventas'], ['messenger', 'Página Demo Kallpa'], ['tiktok', 'TikTok @demokallpa']] as const) {
    const externo = `sbx-${tipo}-${crypto.randomBytes(5).toString('hex')}`;
    const { rows: [c] } = await pool.query<CuentaCanal>(
      `INSERT INTO crm.canales (empresa_id, tipo, externo_id, waba_id, nombre, sandbox, datos) VALUES ($1,$2,$3,$4,$5,true,$6)
       RETURNING canal_id, empresa_id, tipo, externo_id, waba_id, nombre, sandbox, activo`,
      [empresaId, tipo, externo, tipo === 'whatsapp' ? 'sbx-waba-demo' : null, nombre,
       JSON.stringify(tipo === 'whatsapp' ? { numero_display: '+51 900 000 000', verified_name: nombre } : { username: 'demokallpa' })]);
    canales[tipo] = c;
  }

  // ── Conversaciones entrantes (pasan por el adaptador real + ingesta) ──
  const hace = (min: number) => Date.now() - min * 60_000;
  const wa = (tel: string, nombre: string, texto: string, min: number) => ({
    object: 'whatsapp_business_account', entry: [{ id: 'sbx-waba-demo', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '', phone_number_id: canales.whatsapp.externo_id },
      contacts: [{ wa_id: tel, profile: { name: nombre } }],
      messages: [{ from: tel, id: `wamid.seed.${crypto.randomUUID()}`, timestamp: String(Math.floor(hace(min) / 1000)), type: 'text', text: { body: texto } }] } }] }],
  });
  const ms = (psid: string, texto: string, min: number) => ({
    object: 'page', entry: [{ id: canales.messenger.externo_id, time: hace(min), messaging: [{ sender: { id: psid }, recipient: { id: canales.messenger.externo_id }, timestamp: hace(min), message: { mid: `m_seed_${crypto.randomUUID()}`, text: texto } }] }],
  });
  const tt = (openId: string, user: string, texto: string, min: number) => ({
    event: 'im_receive_msg', user_openid: canales.tiktok.externo_id, create_time: Math.floor(hace(min) / 1000),
    content: JSON.stringify({ conversation_id: `seedconv-${openId}`, message_id: `seed-${crypto.randomUUID()}`, type: 'text', timestamp: hace(min),
      from: user, from_user: { id: openId }, to: 'demokallpa', to_user: { id: canales.tiktok.externo_id }, text: { body: texto } }),
  });

  const entrantes: Array<[keyof typeof canales, unknown, string | null]> = [
    ['whatsapp', wa('51987654321', 'María Fernández', 'Hola, ¿tienen el taladro percutor de 750W en stock?', 190), null],
    ['whatsapp', wa('51987654321', 'María Fernández', '¿Hacen envío a Los Olivos?', 188), null],
    ['whatsapp', wa('51912345678', 'Carlos Rojas', 'Buenas tardes, quisiera una cotización para 20 bolsas de cemento', 95), null],
    ['whatsapp', wa('51955501234', 'Rosa Huamán', 'Gracias por la atención, ya recibí mi pedido 👍', 40), null],
    ['whatsapp', wa('51944433322', 'Jorge Salazar', '¿Cuál es el precio de la escalera de aluminio de 6 pasos?', 12), null],
    ['messenger', ms('7200000000001', 'Hola! Vi su publicación de las ofertas de pintura, ¿siguen vigentes?', 75), 'Lucía Paredes'],
    ['messenger', ms('7200000000002', '¿Atienden los domingos?', 30), 'Pedro Castillo'],
    ['tiktok', tt('tt-open-001', 'valeria_diy', 'Vi tu video del kit de herramientas 😍 ¿cuánto cuesta?', 55), 'valeria_diy'],
    ['tiktok', tt('tt-open-002', 'renzo.maker', '¿Hacen delivery a Comas?', 8), 'renzo.maker'],
  ];
  for (const [tipo, payload, nombre] of entrantes) {
    const eventos = adapterPorCanal(canales[tipo].tipo).normalizar(payload);
    for (const ev of eventos) if (ev.kind === 'mensaje' && nombre) ev.nombre = nombre;
    await procesarEventos(eventos, { cuenta: canales[tipo] });
  }

  // Respuestas del equipo en algunas conversaciones (histórico)
  const { rows: convs } = await pool.query<{ conversacion_id: number; contacto_nombre: string }>(
    `SELECT cv.conversacion_id, ct.nombre AS contacto_nombre FROM crm.conversaciones cv JOIN crm.contactos ct USING (contacto_id) WHERE cv.empresa_id = $1`, [empresaId]);
  const conv = (nombre: string) => convs.find((c) => c.contacto_nombre === nombre)?.conversacion_id;
  const respuestas: Array<[string, string, string, number]> = [
    ['María Fernández', adminId, '¡Hola María! Sí, tenemos el taladro percutor de 750W a S/ 189. Y sí, hacemos envíos a Los Olivos 🚚', 185],
    ['Carlos Rojas', agentes[0], 'Hola Carlos, con gusto. ¿Es cemento tipo I? Te preparo la cotización en unos minutos.', 90],
    ['Rosa Huamán', agentes[1], '¡Gracias a ti, Rosa! Cualquier cosa aquí estamos.', 38],
  ];
  for (const [nombre, autor, texto, min] of respuestas) {
    const id = conv(nombre);
    if (!id) continue;
    await pool.query(
      `INSERT INTO crm.mensajes (empresa_id, conversacion_id, direccion, autor_tipo, autor_id, tipo, contenido, estado_envio, externo_id, enviado_en)
       VALUES ($1,$2,'saliente','humano',$3,'texto',$4,'read',$5, now() - make_interval(mins => $6))`,
      [empresaId, id, autor, texto, `seed-out-${crypto.randomUUID()}`, min]);
    await pool.query(`UPDATE crm.conversaciones SET asignado_a = $2, no_leidos = 0, ultimo_mensaje = $3 WHERE conversacion_id = $1 AND ultima_actividad < now() - make_interval(mins => $4)`,
      [id, autor, texto, min]);
    await pool.query(`UPDATE crm.conversaciones SET asignado_a = $2 WHERE conversacion_id = $1`, [id, autor]);
  }
  const rosa = conv('Rosa Huamán');
  if (rosa) await pool.query(`UPDATE crm.conversaciones SET estado = 'resuelta', no_leidos = 0 WHERE conversacion_id = $1`, [rosa]);

  // ── Contactos manuales + negocios repartidos en el tablero ──
  const { rows: [pipe] } = await pool.query<{ pipeline_id: number }>('SELECT pipeline_id FROM crm.pipelines WHERE empresa_id = $1 AND es_entrada', [empresaId]);
  const { rows: etapas } = await pool.query<{ etapa_id: number; nombre: string }>('SELECT etapa_id, nombre FROM crm.etapas WHERE pipeline_id = $1 ORDER BY orden', [pipe.pipeline_id]);
  const etapa = (n: string) => etapas.find((e) => e.nombre === n)!.etapa_id;
  const { rows: etqs } = await pool.query<{ etiqueta_id: number; nombre: string }>('SELECT etiqueta_id, nombre FROM crm.etiquetas WHERE empresa_id = $1', [empresaId]);
  const etq = (n: string) => etqs.find((e) => e.nombre === n)!.etiqueta_id;

  const manuales: Array<[string, string, string | null, string, string, number | null, string, string[]]> = [
    ['Constructora Andina SAC', '+51999111222', 'compras@andina.pe', 'Negociación', 'Pedido fierro corrugado obra Surco', 18500, 'Lima', ['Caliente', 'VIP']],
    ['Inversiones Lucero', '+51999333444', 'logistica@lucero.pe', 'Propuesta enviada', 'Pinturas para 3 locales', 4200, 'Callao', ['Tibio']],
    ['Hotel Miraflores Park', '+51999555666', 'mantenimiento@hmp.pe', 'Contactado', 'Mantenimiento anual — ferretería', 7800, 'Lima', ['Tibio']],
    ['Colegio San Martín', '+51999777888', 'admin@csm.edu.pe', 'Ganado', 'Kit de herramientas taller', 3150, 'Los Olivos', ['Recompra']],
    ['Taller Mecánico Díaz', '+51998887776', null, 'Perdido', 'Compresora 50L', 1290, 'Comas', ['Frío']],
    ['Restaurante El Fogón', '+51997776665', 'fogon@gmail.com', 'Nuevo', 'Extractores de cocina', 2600, 'San Isidro', []],
  ];
  for (const [i, [nombre, tel, email, et, titulo, monto, ciudad, tags]] of manuales.entries()) {
    const { rows: [c] } = await pool.query<{ contacto_id: number }>(
      `INSERT INTO crm.contactos (empresa_id, nombre, telefono, email, empresa_nombre, valores, origen, creado_por, asignado_a, creado_en)
       VALUES ($1,$2,$3,$4,$2,$5,'manual',$6,$7, now() - make_interval(days => $8)) RETURNING contacto_id`,
      [empresaId, nombre, tel, email, JSON.stringify({ ciudad }), adminId, [adminId, ...agentes][i % 3], 20 - i * 3]);
    for (const t of tags) await pool.query('INSERT INTO crm.contacto_etiquetas (contacto_id, etiqueta_id) VALUES ($1,$2)', [c.contacto_id, etq(t)]);
    const cerrado = et === 'Ganado' || et === 'Perdido';
    const { rows: [n] } = await pool.query<{ negocio_id: number }>(
      `INSERT INTO crm.negocios (empresa_id, contacto_id, pipeline_id, etapa_id, titulo, monto, asignado_a, posicion, cerrado_en, valores, etapa_desde)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $9 THEN now() - interval '2 days' END, $10, now() - make_interval(days => $11)) RETURNING negocio_id`,
      [empresaId, c.contacto_id, pipe.pipeline_id, etapa(et), titulo, monto, [adminId, ...agentes][i % 3], (i + 1) * 1000, cerrado,
       JSON.stringify({ producto: titulo.split(' ')[0] }), i + 1]);
    await pool.query(
      `INSERT INTO crm.negocio_historial (empresa_id, negocio_id, de_etapa, a_etapa, actor_tipo, actor_id, creado_en)
       VALUES ($1,$2,NULL,$3,'humano',$4, now() - make_interval(days => $5))`, [empresaId, n.negocio_id, etapa(et), adminId, i + 1]);
  }

  // Etiquetas y montos para los contactos que llegaron por mensaje
  await pool.query(`UPDATE crm.negocios n SET monto = 189, titulo = 'Taladro percutor 750W', etapa_id = $2
                     FROM crm.contactos c WHERE c.contacto_id = n.contacto_id AND n.empresa_id = $1 AND c.nombre = 'María Fernández'`, [empresaId, etapa('Propuesta enviada')]);
  await pool.query(`UPDATE crm.negocios n SET monto = 620, titulo = 'Cemento x20', etapa_id = $2
                     FROM crm.contactos c WHERE c.contacto_id = n.contacto_id AND n.empresa_id = $1 AND c.nombre = 'Carlos Rojas'`, [empresaId, etapa('Contactado')]);
  for (const [nombre, tag] of [['María Fernández', 'Caliente'], ['Carlos Rojas', 'Tibio'], ['Rosa Huamán', 'Recompra'], ['valeria_diy', 'Tibio']]) {
    await pool.query(`INSERT INTO crm.contacto_etiquetas (contacto_id, etiqueta_id) SELECT contacto_id, $3 FROM crm.contactos WHERE empresa_id = $1 AND nombre = $2 ON CONFLICT DO NOTHING`,
      [empresaId, nombre, etq(tag)]);
  }

  // Segundo pipeline de ejemplo
  const { rows: [p2] } = await pool.query<{ pipeline_id: number }>(
    `INSERT INTO crm.pipelines (empresa_id, nombre, color, orden) VALUES ($1, 'Postventa', '#0ea5e9', 1) RETURNING pipeline_id`, [empresaId]);
  for (const [i, [nombre, color, tipo]] of [['Entregado', '#94a3b8', 'abierta'], ['Seguimiento', '#0ea5e9', 'abierta'], ['Reclamo', '#f97316', 'abierta'], ['Cerrado OK', '#10b981', 'ganado']].entries()) {
    await pool.query(`INSERT INTO crm.etapas (empresa_id, pipeline_id, nombre, color, orden, tipo) VALUES ($1,$2,$3,$4,$5,$6)`, [empresaId, p2.pipeline_id, nombre, color, i, tipo]);
  }

  // Plantilla aprobada en el canal de prueba
  await pool.query(
    `INSERT INTO crm.plantillas (empresa_id, canal_id, nombre, idioma, categoria, encabezado, cuerpo, pie, variables, estado, externo_id, creado_por)
     VALUES ($1,$2,'oferta_semana','es','MARKETING','Ofertas de la semana 🔨',
             'Hola {{1}}, esta semana en {{2}} tenemos 15% de descuento en herramientas eléctricas. ¿Te separo alguna?',
             'Responde STOP para no recibir más mensajes', $3, 'aprobada', 'sbx-seed', $4)`,
    [empresaId, canales.whatsapp.canal_id, JSON.stringify([
      { indice: 1, origen: 'contacto', valor: 'nombre', ejemplo: 'María' },
      { indice: 2, origen: 'empresa', valor: 'nombre', ejemplo: 'Demo Kallpa' },
    ]), adminId]);

  // Chat interno de ejemplo
  const { rows: [g] } = await pool.query<{ conv_id: number }>(
    `INSERT INTO crm.equipo_conversaciones (empresa_id, tipo, nombre, creado_por) VALUES ($1,'grupo','Equipo de ventas',$2) RETURNING conv_id`, [empresaId, adminId]);
  for (const u of [adminId, ...agentes]) await pool.query('INSERT INTO crm.equipo_participantes (conv_id, usuario_id) VALUES ($1,$2)', [g.conv_id, u]);
  await pool.query(
    `INSERT INTO crm.equipo_mensajes (conv_id, empresa_id, autor_id, contenido, creado_en) VALUES
       ($1,$2,$3,'Buen día equipo 👋 Hoy priorizamos las cotizaciones de obra.', now() - interval '3 hours'),
       ($1,$2,$4,'Entendido, yo tomo la de Constructora Andina.', now() - interval '2 hours 50 minutes')`,
    [g.conv_id, empresaId, adminId, agentes[0]]);

  console.log(`[seed] ✔ listo — ingresa con ${EMAIL} / ${PASS}`);
  await pool.end();
}

main().catch((e) => { console.error('[seed] error:', e); process.exit(1); });
