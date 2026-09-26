// Botón "Ticket" (ficha Kallpasoft §4.3): el CRM NO guarda tickets, los reenvía al central.
// Si la empresa no está vinculada a Kallpasoft o el central no responde, se informa sin bloquear nada.
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah, HttpError } from '../../lib/http';
import { crearTicket, kallpasoftConfigurado, listarTickets } from '../../lib/kallpasoft';
import { ctx } from '../../middlewares/auth';

const router = Router();
const MAX_BYTES = 2 * 1024 * 1024;

async function tenantActual(empresaId: string): Promise<string | null> {
  const { rows: [t] } = await pool.query<{ tenant_id: string }>('SELECT tenant_id FROM app.tenant_config WHERE empresa_id = $1', [empresaId]);
  return t?.tenant_id ?? null;
}

/** Qué puede hacer el botón en esta empresa (el frontend lo usa para explicar el estado). */
router.get('/estado', ah(async (req, res) => {
  const tenant = await tenantActual(ctx(req).empresaId);
  res.json({ ok: true, vinculada: !!tenant, configurado: kallpasoftConfigurado(), disponible: !!tenant && kallpasoftConfigurado() });
}));

async function exigirTenant(empresaId: string): Promise<string> {
  const tenant = await tenantActual(empresaId);
  if (!tenant) throw new HttpError(409, 'Esta empresa aún no está vinculada a Kallpasoft. Los tickets se habilitan al activarla desde el central.', 'sin_tenant');
  if (!kallpasoftConfigurado()) throw new HttpError(503, 'El soporte no está configurado en este servidor. Inténtalo más tarde.', 'soporte_no_configurado');
  return tenant;
}

const sTicket = z.object({
  titulo: z.string().trim().min(3).max(150),
  descripcion: z.string().trim().min(5).max(5000),
  ventana: z.string().trim().max(200).optional(),
  adjuntos: z.array(z.object({
    nombre: z.string().trim().min(1).max(150),
    content_type: z.string().regex(/^image\/(png|jpe?g|webp|gif)$/, 'solo imágenes'),
    data_base64: z.string().min(1),
  })).max(3, 'máximo 3 imágenes').default([]),
});

router.post('/tickets', ah(async (req, res) => {
  const c = ctx(req);
  const d = sTicket.parse(req.body);
  for (const a of d.adjuntos) {
    if (Buffer.byteLength(a.data_base64, 'base64') > MAX_BYTES) throw new HttpError(400, `La imagen ${a.nombre} supera los 2 MB`, 'adjunto');
  }
  const tenant = await exigirTenant(c.empresaId);
  const { rows: [u] } = await pool.query<{ email: string }>('SELECT email FROM app.usuarios WHERE usuario_id = $1', [c.usuarioId]);
  try {
    const t = await crearTicket({ tenant_id: tenant, titulo: d.titulo, descripcion: d.descripcion, usuario_email: u?.email, ventana: d.ventana, adjuntos: d.adjuntos });
    res.status(201).json({ ok: true, ticket: t });
  } catch (e) {
    console.warn('[soporte] ticket no enviado:', (e as Error).message);
    throw new HttpError(503, 'No pudimos enviar tu ticket ahora. Inténtalo más tarde.', 'central_no_disponible');
  }
}));

router.get('/tickets', ah(async (req, res) => {
  const tenant = await exigirTenant(ctx(req).empresaId);
  try {
    const r = await listarTickets(tenant);
    res.json({ ok: true, tickets: r.tickets ?? [] });
  } catch (e) {
    console.warn('[soporte] tickets no disponibles:', (e as Error).message);
    throw new HttpError(503, 'No pudimos cargar tus tickets ahora. Inténtalo más tarde.', 'central_no_disponible');
  }
}));

export default router;
