// Conector Kallpa — /internal/v1 (ficha técnica de integración v2.1, Nivel 2).
// Autenticación: header X-Internal-API-Key. Errores SIEMPRE como {"detail": ...} (ficha §9),
// distinto del formato {ok, error} del resto del CRM: este router tiene su propio manejador.
// Referencia de comportamiento: kallpasoft-systems/tools/producto_demo.py
import crypto from 'crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { ENV } from '../../config/env';
import { autodescripcion } from '../../lib/catalogo';
import {
  ErrorConector, actualizarModulos, cambiarEstado, crearAdmin, crearTenant, estadisticas, obtenerTenant, renovar, resetPassword,
} from './tenants.service';

const router = Router();

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// §3 — sin distinguir "falta" de "no coincide"
router.use((req, res, next) => {
  const key = req.header('x-internal-api-key') ?? '';
  if (!ENV.INTERNAL_API_KEY || !key || !iguales(key, ENV.INTERNAL_API_KEY)) {
    res.status(403).json({ detail: 'API key inválida' });
    return;
  }
  next();
});

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

const tid = (req: Request) => z.string().trim().min(1).max(20).parse(req.params.id);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD');
const lista = z.array(z.string().trim().min(1)).max(200);

// §4.4 — autodescripción
router.get('/catalog', (_req, res) => { res.json(autodescripcion()); });

// §4.1 — alta
const sAlta = z.object({
  tenant_id: z.string().trim().min(1).max(20), ruc: z.string().trim().min(1).max(20), razon_social: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(80),
  departamento: z.string().nullish(), provincia: z.string().nullish(), distrito: z.string().nullish(), direccion: z.string().nullish(),
  plan: z.string().nullish(), modulos_activos: lista.default([]), ventanas_habilitadas: lista.nullish(),
  max_usuarios: z.coerce.number().int().min(1).max(100_000).default(5),
  fecha_inicio: fecha.nullish(), fecha_fin: fecha.nullish(), moneda_default: z.string().nullish(), zona_horaria: z.string().nullish(),
});
router.post('/tenants', h(async (req, res) => {
  res.status(201).json(await crearTenant(sAlta.parse(req.body)));
}));

router.patch('/tenants/:id/modulos', h(async (req, res) => {
  const d = z.object({ modulos_activos: lista, ventanas_habilitadas: lista.nullish() }).parse(req.body);
  res.json(await actualizarModulos(tid(req), d.modulos_activos, d.ventanas_habilitadas ?? null));
}));

router.patch('/tenants/:id/estado', h(async (req, res) => {
  const d = z.object({ estado: z.enum(['activo', 'suspendido', 'cancelado']), motivo_suspension: z.string().max(500).nullish() }).parse(req.body);
  res.json(await cambiarEstado(tid(req), d.estado, d.motivo_suspension ?? null));
}));

router.patch('/tenants/:id/renovar', h(async (req, res) => {
  const d = z.object({ fecha_fin: fecha, plan: z.string().nullish() }).parse(req.body);
  res.json(await renovar(tid(req), d.fecha_fin, d.plan ?? null));
}));

router.get('/tenants/:id/status', h(async (req, res) => {
  const t = await obtenerTenant(tid(req));
  res.json({
    tenant_id: t.tenant_id, estado: t.estado, activo: t.estado === 'activo', motivo_suspension: t.motivo_suspension,
    plan: t.plan, fecha_inicio: t.fecha_inicio, fecha_fin: t.fecha_fin, max_usuarios: t.max_usuarios,
    modulos_activos: t.modulos_activos, ventanas_habilitadas: t.ventanas_habilitadas,
    stats: await estadisticas(t.empresa_id),
  });
}));

// Soft-delete: cancelado + retención de datos ≥ 90 días
router.delete('/tenants/:id', h(async (req, res) => {
  const t = await cambiarEstado(tid(req), 'cancelado', 'Servicio cancelado');
  res.json({ detail: 'Tenant eliminado (soft delete)', datos_retenidos_hasta: t.datos_retenidos_hasta });
}));

// §4.2 — usuario administrador
const sEmail = z.string().trim().email().max(120);
router.post('/tenants/:id/admin', h(async (req, res) => {
  const d = z.object({ nombre: z.string().trim().min(1).max(80), apellidos: z.string().trim().max(80).nullish(), email: sEmail, password: z.string().min(6).max(100) }).parse(req.body);
  res.status(201).json(await crearAdmin(tid(req), d));
}));

router.post('/tenants/:id/admin/reset-password', h(async (req, res) => {
  const d = z.object({ email: sEmail, password: z.string().min(6).max(100) }).parse(req.body);
  res.json(await resetPassword(tid(req), d.email, d.password));
}));

router.use((_req, res) => { res.status(404).json({ detail: 'Ruta no encontrada' }); });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ErrorConector) { res.status(err.status).json({ detail: err.detail }); return; }
  if (err instanceof ZodError) {
    const p = err.issues[0];
    res.status(422).json({ detail: `${p.path.join('.') || 'dato'}: ${p.message}` });
    return;
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.parse.failed') { res.status(400).json({ detail: 'JSON inválido' }); return; }
  console.error('[internal/v1]', err);
  res.status(500).json({ detail: 'Error interno del producto' });
});

export default router;
