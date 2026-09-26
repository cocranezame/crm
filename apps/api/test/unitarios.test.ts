// Pruebas unitarias sin base de datos: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTelefono } from '../src/lib/telefono';
import { dividirTexto, resolverVentana } from '../src/modules/canales/tiktok/sender';
import { resolverMessagingType } from '../src/modules/canales/messenger/sender';
import { parsearFirmaTiktok } from '../src/modules/canales/firma';
import { whatsappAdapter } from '../src/modules/canales/whatsapp/adapter';
import { messengerAdapter } from '../src/modules/canales/messenger/adapter';
import { tiktokAdapter } from '../src/modules/canales/tiktok/adapter';
import { indicesDe, validarVariables } from '../src/modules/plantillas/plantillas.service';
import { MODULOS_TECNICOS, VENTANAS, autodescripcion, tieneModulo, ventanasDelPlan } from '../src/lib/catalogo';

test('normalizarTelefono', () => {
  assert.equal(normalizarTelefono('987 654 321'), '+51987654321');
  assert.equal(normalizarTelefono('+51 987-654-321'), '+51987654321');
  assert.equal(normalizarTelefono('0051987654321'), '+51987654321');
  assert.equal(normalizarTelefono('+1 (415) 555 0100'), '+14155550100');
  assert.equal(normalizarTelefono('abc'), null);
  assert.equal(normalizarTelefono(''), null);
});

test('ventanas por canal', () => {
  const hace = (h: number) => new Date(Date.now() - h * 3600_000);
  assert.deepEqual(resolverMessagingType(hace(1), false), { messaging_type: 'RESPONSE' });
  assert.deepEqual(resolverMessagingType(hace(30), true), { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
  assert.equal(resolverMessagingType(hace(30), false), null);
  assert.equal(resolverMessagingType(null, true), null);
  assert.deepEqual(resolverVentana(hace(47), 3), { bloqueado: false, restantes: 7 });
  assert.deepEqual(resolverVentana(hace(49), 0), { bloqueado: true, motivo: 'ventana' });
  assert.deepEqual(resolverVentana(hace(1), 10), { bloqueado: true, motivo: 'limite_mensajes' });
});

test('dividirTexto respeta el máximo', () => {
  const partes = dividirTexto('palabra '.repeat(2000), 6000);
  assert.ok(partes.length >= 2);
  assert.ok(partes.every((p) => p.length <= 6000));
});

test('firma TikTok', () => {
  assert.deepEqual(parsearFirmaTiktok('t=1700000000,s=abc123'), { t: 1700000000, s: 'abc123' });
  assert.equal(parsearFirmaTiktok('basura'), null);
});

test('adaptador WhatsApp: texto y estado', () => {
  const ev = whatsappAdapter.normalizar({ object: 'whatsapp_business_account', entry: [{ id: 'w', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '', phone_number_id: 'PN1' },
    contacts: [{ wa_id: '51987654321', profile: { name: 'Ana' } }],
    messages: [{ from: '51987654321', id: 'wamid.1', timestamp: '1700000000', type: 'text', text: { body: 'hola' } }],
    statuses: [{ id: 'wamid.0', status: 'read', timestamp: '1700000001', recipient_id: '51987654321' }],
  } }] }] });
  assert.equal(ev.length, 2);
  assert.equal(ev[0].kind, 'mensaje');
  if (ev[0].kind === 'mensaje') { assert.equal(ev[0].identidad, '51987654321'); assert.equal(ev[0].contenido, 'hola'); assert.equal(ev[0].nombre, 'Ana'); }
  assert.equal(ev[1].kind, 'estado');
});

test('adaptador Messenger: eco = saliente', () => {
  const ev = messengerAdapter.normalizar({ object: 'page', entry: [{ id: 'P1', messaging: [
    { sender: { id: 'P1' }, recipient: { id: 'U1' }, timestamp: 1700000000000, message: { mid: 'm1', text: 'desde la app', is_echo: true } },
  ] }] });
  assert.equal(ev[0].kind, 'mensaje');
  if (ev[0].kind === 'mensaje') { assert.equal(ev[0].direccion, 'saliente'); assert.equal(ev[0].identidad, 'U1'); }
});

test('adaptador TikTok: content como string JSON', () => {
  const ev = tiktokAdapter.normalizar({ event: 'im_receive_msg', user_openid: 'B1', content: JSON.stringify({
    conversation_id: 'C1', message_id: 'M1', type: 'text', timestamp: 1700000000000, from: 'cli', from_user: { id: 'U9' }, to_user: { id: 'B1' }, text: { body: 'hola' } }) });
  assert.equal(ev[0].kind, 'mensaje');
  if (ev[0].kind === 'mensaje') { assert.equal(ev[0].conversacionExternaId, 'C1'); assert.equal(ev[0].direccion, 'entrante'); }
});

test('variables de plantilla', () => {
  assert.deepEqual(indicesDe('Hola {{1}}, tu pedido {{2}} {{1}}'), [1, 2]);
  assert.throws(() => validarVariables('Hola {{2}}', []));
  assert.throws(() => validarVariables('Hola {{1}}', [{ indice: 1, origen: 'manual', valor: '', ejemplo: '' }]));
  assert.equal(validarVariables('Hola {{1}}', [{ indice: 1, origen: 'contacto', valor: 'nombre', ejemplo: 'Ana' }]).length, 1);
});

test('catálogo Kallpasoft: módulos y ventanas por plan', () => {
  // empresa local (no gestionada): todo
  assert.equal(ventanasDelPlan(null, null).length, VENTANAS.length);
  assert.ok(tieneModulo(null, 'difusiones'));
  // comodín del contrato
  assert.equal(ventanasDelPlan(['todos'], null).length, VENTANAS.length);
  // solo crm: sin difusiones ni chat del equipo
  const soloCrm = ventanasDelPlan(['crm'], null);
  assert.ok(soloCrm.includes('/inbox') && !soloCrm.includes('/difusiones') && !soloCrm.includes('/equipo'));
  assert.equal(tieneModulo(['crm'], 'difusiones'), false);
  // lista explícita del central: solo recorta, nunca amplía
  assert.deepEqual(ventanasDelPlan(['crm'], ['/inbox', '/difusiones']), ['/inbox']);
  // gestionada sin módulos: nada
  assert.deepEqual(ventanasDelPlan([], null), []);
  // toda ventana apunta a un módulo declarado y los href no se repiten
  assert.ok(VENTANAS.every((v) => (MODULOS_TECNICOS as readonly string[]).includes(v.modulo_tecnico)));
  assert.equal(new Set(VENTANAS.map((v) => v.href)).size, VENTANAS.length);
  assert.equal(autodescripcion().producto, 'crm');
});
