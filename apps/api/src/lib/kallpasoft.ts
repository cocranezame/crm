// Cliente saliente hacia Kallpasoft (producto → central).
// Regla de oro (ficha §1 y §6.6): NADA de aquí se usa para autorizar a un usuario.
// Telemetría = fire-and-forget; tickets = el usuario espera la respuesta pero nunca bloquea el CRM.
import { ENV } from '../config/env';

export const kallpasoftConfigurado = () => !!(ENV.KALLPASOFT_API_URL && ENV.INTERNAL_API_KEY);

async function llamar(metodo: 'GET' | 'POST', ruta: string, body?: unknown, timeoutMs = 10_000): Promise<Response> {
  return fetch(`${ENV.KALLPASOFT_API_URL}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': ENV.INTERNAL_API_KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Telemetría §7. Nunca lanza ni espera: si el central no responde, se pierde el evento y listo. */
export function enviarEvento(tipo: string, tenantId: string, datos: Record<string, unknown> = {}): void {
  if (!kallpasoftConfigurado()) return;
  llamar('POST', '/api/v1/webhooks/eventos', { tipo, tenant_id: tenantId, datos, timestamp: new Date().toISOString() }, 3_000)
    .then((r) => { if (!r.ok) console.warn(`[kallpasoft] evento ${tipo} → HTTP ${r.status}`); })
    .catch((e) => console.warn(`[kallpasoft] evento ${tipo} no enviado:`, (e as Error).message));
}

export interface TicketEntrada {
  tenant_id: string; titulo: string; descripcion: string; usuario_email?: string; ventana?: string;
  adjuntos?: Array<{ nombre: string; content_type: string; data_base64: string }>;
}

/** Ficha §4.3 — devuelve la respuesta del central o lanza con un mensaje para el usuario. */
export async function crearTicket(t: TicketEntrada): Promise<{ id: string; numero: string; estado: string }> {
  const r = await llamar('POST', '/api/v1/webhooks/tickets', t);
  if (!r.ok) throw new Error(`Kallpasoft respondió HTTP ${r.status}`);
  return r.json() as Promise<{ id: string; numero: string; estado: string }>;
}

export async function listarTickets(tenantId: string): Promise<{ tickets: unknown[] }> {
  const r = await llamar('GET', `/api/v1/webhooks/tickets?tenant_id=${encodeURIComponent(tenantId)}`);
  if (!r.ok) throw new Error(`Kallpasoft respondió HTTP ${r.status}`);
  return r.json() as Promise<{ tickets: unknown[] }>;
}
