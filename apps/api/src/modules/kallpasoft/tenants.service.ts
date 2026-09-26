// Ciclo de vida del tenant gobernado por Kallpasoft (ficha §4.1–4.2).
// Traduce tenant_id (RUC) ↔ empresa_id (uuid) con app.tenant_config.
// Todas las operaciones son IDEMPOTENTES: Kallpasoft reintenta con backoff.
import bcrypt from 'bcryptjs';
import { pool, tx, type Db } from '../../db/pool';
import { sembrarEmpresa, slugDe } from '../empresas/defaults';

export class ErrorConector extends Error {
  constructor(public status: number, public detail: unknown) { super(typeof detail === 'string' ? detail : JSON.stringify(detail)); }
}

export interface TenantAlta {
  tenant_id: string; ruc: string; razon_social: string; slug: string;
  departamento?: string | null; provincia?: string | null; distrito?: string | null; direccion?: string | null;
  plan?: string | null; modulos_activos: string[]; ventanas_habilitadas?: string[] | null;
  max_usuarios: number; fecha_inicio?: string | null; fecha_fin?: string | null;
  moneda_default?: string | null; zona_horaria?: string | null;
}

export interface TenantConfig {
  tenant_id: string; empresa_id: string; ruc: string; razon_social: string; slug: string;
  estado: 'activo' | 'suspendido' | 'cancelado'; motivo_suspension: string | null; plan: string | null;
  modulos_activos: string[]; ventanas_habilitadas: string[] | null;
  fecha_inicio: string | null; fecha_fin: string | null; max_usuarios: number; datos_retenidos_hasta: string | null;
}

const COLS = `tenant_id, empresa_id, ruc, razon_social, slug, estado, motivo_suspension, plan, modulos_activos,
  ventanas_habilitadas, to_char(fecha_inicio,'YYYY-MM-DD') AS fecha_inicio, to_char(fecha_fin,'YYYY-MM-DD') AS fecha_fin,
  max_usuarios, to_char(datos_retenidos_hasta,'YYYY-MM-DD') AS datos_retenidos_hasta`;

export async function obtenerTenant(tenantId: string, db: Db = pool): Promise<TenantConfig> {
  const { rows: [t] } = await db.query<TenantConfig>(`SELECT ${COLS} FROM app.tenant_config WHERE tenant_id = $1`, [tenantId]);
  if (!t) throw new ErrorConector(404, 'Tenant no encontrado');
  return t;
}

/** Tenant de una empresa, o null si la empresa es local (no gestionada por Kallpasoft). */
export async function tenantDeEmpresa(empresaId: string): Promise<TenantConfig | null> {
  const { rows: [t] } = await pool.query<TenantConfig>(`SELECT ${COLS} FROM app.tenant_config WHERE empresa_id = $1`, [empresaId]);
  return t ?? null;
}

export async function crearTenant(d: TenantAlta): Promise<TenantConfig> {
  return tx(async (c) => {
    const { rows: [previo] } = await c.query(`SELECT 1 FROM app.tenant_config WHERE tenant_id = $1`, [d.tenant_id]);
    if (previo) throw new ErrorConector(409, { reason: 'ruc_taken' });
    const { rows: [slugUsado] } = await c.query(`SELECT 1 FROM app.tenant_config WHERE slug = $1`, [d.slug]);
    if (slugUsado) throw new ErrorConector(409, { reason: 'slug_taken' });

    // El slug de la empresa respeta el de Kallpasoft salvo que ya lo use una empresa local.
    const { rows: [empSlug] } = await c.query(`SELECT 1 FROM app.empresas WHERE slug = $1`, [d.slug]);
    const { rows: [e] } = await c.query<{ empresa_id: string }>(
      `INSERT INTO app.empresas (nombre, slug, plan, zona_horaria, trial_hasta) VALUES ($1, $2, 'pro', $3, NULL) RETURNING empresa_id`,
      [d.razon_social, empSlug ? slugDe(d.slug) : d.slug, d.zona_horaria || 'America/Lima']);
    await sembrarEmpresa(c, e.empresa_id, null);
    await c.query(
      `INSERT INTO app.tenant_config (tenant_id, empresa_id, ruc, razon_social, slug, plan, modulos_activos, ventanas_habilitadas,
         fecha_inicio, fecha_fin, max_usuarios, departamento, provincia, distrito, direccion, moneda_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [d.tenant_id, e.empresa_id, d.ruc, d.razon_social, d.slug, d.plan ?? null, JSON.stringify(d.modulos_activos),
       d.ventanas_habilitadas ? JSON.stringify(d.ventanas_habilitadas) : null, d.fecha_inicio ?? null, d.fecha_fin ?? null,
       d.max_usuarios, d.departamento ?? null, d.provincia ?? null, d.distrito ?? null, d.direccion ?? null, d.moneda_default || 'PEN']);
    return obtenerTenant(d.tenant_id, c);
  });
}

/** Reemplazo completo (no merge). ventanas_habilitadas null = todas las de los módulos. */
export async function actualizarModulos(tenantId: string, modulos: string[], ventanas: string[] | null): Promise<TenantConfig> {
  const { rowCount } = await pool.query(
    `UPDATE app.tenant_config SET modulos_activos = $2::jsonb, ventanas_habilitadas = $3::jsonb, actualizado_en = now() WHERE tenant_id = $1`,
    [tenantId, JSON.stringify(modulos), ventanas ? JSON.stringify(ventanas) : null]);
  if (!rowCount) throw new ErrorConector(404, 'Tenant no encontrado');
  return obtenerTenant(tenantId);
}

/** Estado del contrato. La empresa queda activa SOLO si el estado es 'activo' (bloquea login y API). */
export async function cambiarEstado(tenantId: string, estado: TenantConfig['estado'], motivo: string | null): Promise<TenantConfig> {
  return tx(async (c) => {
    const { rows: [t] } = await c.query<{ empresa_id: string }>(
      `UPDATE app.tenant_config SET estado = $2, motivo_suspension = $3,
              datos_retenidos_hasta = CASE WHEN $2 = 'cancelado' THEN COALESCE(datos_retenidos_hasta, current_date + 90) ELSE NULL END,
              actualizado_en = now()
        WHERE tenant_id = $1 RETURNING empresa_id`,
      [tenantId, estado, estado === 'activo' ? null : motivo]);
    if (!t) throw new ErrorConector(404, 'Tenant no encontrado');
    await c.query(`UPDATE app.empresas SET activo = $2 WHERE empresa_id = $1`, [t.empresa_id, estado === 'activo']);
    return obtenerTenant(tenantId, c);
  });
}

export async function renovar(tenantId: string, fechaFin: string, plan: string | null): Promise<TenantConfig> {
  const { rowCount } = await pool.query(
    `UPDATE app.tenant_config SET fecha_fin = $2, plan = COALESCE($3, plan), actualizado_en = now() WHERE tenant_id = $1`,
    [tenantId, fechaFin, plan]);
  if (!rowCount) throw new ErrorConector(404, 'Tenant no encontrado');
  return obtenerTenant(tenantId);
}

export async function estadisticas(empresaId: string) {
  const { rows: [s] } = await pool.query(
    `SELECT (SELECT count(*) FROM app.miembros WHERE empresa_id = $1 AND activo)::int AS total_usuarios,
            (SELECT count(*) FROM crm.contactos WHERE empresa_id = $1 AND eliminado_en IS NULL)::int AS total_contactos,
            (SELECT count(*) FROM crm.conversaciones WHERE empresa_id = $1)::int AS total_conversaciones,
            (SELECT count(*) FROM crm.mensajes WHERE empresa_id = $1 AND enviado_en >= date_trunc('month', now()))::int AS mensajes_mes,
            (SELECT count(*) FROM crm.canales WHERE empresa_id = $1 AND activo AND NOT sandbox)::int AS canales_conectados,
            (SELECT max(ultimo_acceso) FROM app.usuarios u JOIN app.miembros m USING (usuario_id) WHERE m.empresa_id = $1) AS ultimo_acceso`,
    [empresaId]);
  return s;
}

const COLORES = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

/**
 * Admin del tenant (ficha §4.2). Idempotente: si el email ya existe se actualiza su contraseña y
 * queda como propietario de la empresa (mismo comportamiento que tools/producto_demo.py).
 * En el CRM el cargo "admin" del contrato = rol 'propietario' (el más alto de la empresa).
 */
export async function crearAdmin(tenantId: string, d: { nombre: string; apellidos?: string | null; email: string; password: string }) {
  return tx(async (c) => {
    const t = await obtenerTenant(tenantId, c);
    const nombre = [d.nombre, d.apellidos].filter(Boolean).join(' ').trim();
    const hash = await bcrypt.hash(d.password, 10);
    const { rows: [u] } = await c.query<{ usuario_id: string }>(
      `INSERT INTO app.usuarios (email, password_hash, nombre, color) VALUES (lower($1), $2, $3, $4)
       ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, activo = true
       RETURNING usuario_id`,
      [d.email, hash, nombre, COLORES[Math.floor(Math.random() * COLORES.length)]]);
    await c.query(
      `INSERT INTO app.miembros (empresa_id, usuario_id, rol) VALUES ($1, $2, 'propietario')
       ON CONFLICT (empresa_id, usuario_id) DO UPDATE SET rol = 'propietario', activo = true`,
      [t.empresa_id, u.usuario_id]);
    return { usuario_id: u.usuario_id, tenant_id: tenantId, email: d.email.toLowerCase(), cargo: 'admin' as const };
  });
}

/** Regenerar acceso: solo sobre un usuario que pertenece al tenant. */
export async function resetPassword(tenantId: string, email: string, password: string) {
  const t = await obtenerTenant(tenantId);
  const { rows: [u] } = await pool.query<{ usuario_id: string }>(
    `UPDATE app.usuarios u SET password_hash = $3, activo = true
      WHERE lower(u.email) = lower($2)
        AND EXISTS (SELECT 1 FROM app.miembros m WHERE m.usuario_id = u.usuario_id AND m.empresa_id = $1)
      RETURNING usuario_id`,
    [t.empresa_id, email, await bcrypt.hash(password, 10)]);
  if (!u) throw new ErrorConector(404, 'Usuario no encontrado');
  return { usuario_id: u.usuario_id, email: email.toLowerCase() };
}
