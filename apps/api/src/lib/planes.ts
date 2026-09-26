import { pool } from '../db/pool';
import { HttpError } from './http';
import { enviarEvento } from './kallpasoft';

export type Plan = 'trial' | 'basico' | 'pro' | 'enterprise';

export interface LimitesPlan { nombre: string; usuarios: number; contactos: number; canales: number; difusionesMes: number; precio: number }

export const PLANES: Record<Plan, LimitesPlan> = {
  trial:      { nombre: 'Prueba',     usuarios: 3,    contactos: 500,     canales: 2,   difusionesMes: 2,    precio: 0 },
  basico:     { nombre: 'Básico',     usuarios: 5,    contactos: 5_000,   canales: 3,   difusionesMes: 10,   precio: 29 },
  pro:        { nombre: 'Pro',        usuarios: 20,   contactos: 50_000,  canales: 10,  difusionesMes: 100,  precio: 79 },
  enterprise: { nombre: 'Enterprise', usuarios: 1000, contactos: 1_000_000, canales: 100, difusionesMes: 10_000, precio: 0 },
};

export type Recurso = 'usuarios' | 'contactos' | 'canales' | 'difusionesMes';

const CONTEO: Record<Recurso, string> = {
  usuarios:  `SELECT (SELECT count(*) FROM app.miembros WHERE empresa_id = $1 AND activo)
                   + (SELECT count(*) FROM app.invitaciones WHERE empresa_id = $1 AND aceptada_en IS NULL AND expira_en > now()) AS n`,
  contactos: `SELECT count(*) AS n FROM crm.contactos WHERE empresa_id = $1 AND eliminado_en IS NULL`,
  canales:   `SELECT count(*) AS n FROM crm.canales WHERE empresa_id = $1 AND activo AND NOT sandbox`,
  difusionesMes: `SELECT count(*) AS n FROM crm.difusiones WHERE empresa_id = $1 AND iniciada_en >= date_trunc('month', now())`,
};

const ETIQUETA: Record<Recurso, string> = {
  usuarios: 'usuarios', contactos: 'contactos', canales: 'canales conectados', difusionesMes: 'difusiones este mes',
};

export async function usoEmpresa(empresaId: string): Promise<Record<Recurso, number>> {
  const out = {} as Record<Recurso, number>;
  for (const r of Object.keys(CONTEO) as Recurso[]) {
    const { rows } = await pool.query<{ n: number }>(CONTEO[r], [empresaId]);
    out[r] = Number(rows[0].n);
  }
  return out;
}

/**
 * Límites efectivos de la empresa. Si Kallpasoft la gestiona, `usuarios` = su `max_usuarios`
 * (ficha §6.5); el resto sale del plan interno de la empresa.
 */
export async function limitesEmpresa(empresaId: string): Promise<LimitesPlan & { tenantId: string | null }> {
  const { rows: [r] } = await pool.query<{ plan: Plan; tenant_id: string | null; max_usuarios: number | null }>(
    `SELECT e.plan, tc.tenant_id, tc.max_usuarios FROM app.empresas e LEFT JOIN app.tenant_config tc USING (empresa_id) WHERE e.empresa_id = $1`,
    [empresaId]);
  const base = PLANES[r?.plan ?? 'trial'];
  return { ...base, usuarios: r?.tenant_id ? Number(r.max_usuarios) : base.usuarios, tenantId: r?.tenant_id ?? null };
}

/** Lanza 402 si agregar `cantidad` supera el límite del plan. */
export async function verificarLimite(empresaId: string, recurso: Recurso, cantidad = 1): Promise<void> {
  const limites = await limitesEmpresa(empresaId);
  const lim = limites[recurso];
  const { rows: c } = await pool.query<{ n: number }>(CONTEO[recurso], [empresaId]);
  if (Number(c[0].n) + cantidad > lim) {
    // Señal de upsell para Kallpasoft (ficha §7). Fire-and-forget.
    if (recurso === 'usuarios' && limites.tenantId) enviarEvento('tenant.limite_usuarios', limites.tenantId, { limite: lim, actuales: Number(c[0].n) });
    throw new HttpError(402, `Tu plan permite hasta ${lim.toLocaleString('es-PE')} ${ETIQUETA[recurso]}. Mejora el plan para agregar más.`, 'limite_plan');
  }
}
