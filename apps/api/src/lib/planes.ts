import { pool } from '../db/pool';
import { HttpError } from './http';

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

/** Lanza 402 si agregar `cantidad` supera el límite del plan. */
export async function verificarLimite(empresaId: string, recurso: Recurso, cantidad = 1): Promise<void> {
  const { rows } = await pool.query<{ plan: Plan }>('SELECT plan FROM app.empresas WHERE empresa_id = $1', [empresaId]);
  const lim = PLANES[rows[0]?.plan ?? 'trial'][recurso];
  const { rows: c } = await pool.query<{ n: number }>(CONTEO[recurso], [empresaId]);
  if (Number(c[0].n) + cantidad > lim) {
    throw new HttpError(402, `Tu plan permite hasta ${lim.toLocaleString('es-PE')} ${ETIQUETA[recurso]}. Mejora el plan para agregar más.`, 'limite_plan');
  }
}
