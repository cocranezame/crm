import { pool, type Db } from '../../db/pool';
import { cifrar, descifrar } from '../../lib/crypto';
import { noEncontrado } from '../../lib/http';
import type { Canal, CuentaCanal } from './tipos';

const COLS = 'canal_id, empresa_id, tipo, externo_id, waba_id, nombre, sandbox, activo';

export async function obtenerCuenta(canalId: number, db: Db = pool): Promise<CuentaCanal | null> {
  const { rows: [c] } = await db.query<CuentaCanal>(`SELECT ${COLS} FROM crm.canales WHERE canal_id = $1`, [canalId]);
  return c ?? null;
}

export async function cuentaDeEmpresa(empresaId: string, canalId: number): Promise<CuentaCanal> {
  const { rows: [c] } = await pool.query<CuentaCanal>(`SELECT ${COLS} FROM crm.canales WHERE canal_id = $1 AND empresa_id = $2`, [canalId, empresaId]);
  if (!c) throw noEncontrado('Canal');
  return c;
}

/** El webhook resuelve la empresa desde aquí: UNIQUE(tipo, externo_id). Nunca se confía en la URL. */
export async function cuentaPorExterno(tipo: Canal, externoId: string): Promise<CuentaCanal | null> {
  const { rows: [c] } = await pool.query<CuentaCanal>(
    `SELECT ${COLS} FROM crm.canales WHERE tipo = $1 AND externo_id = $2 AND activo`, [tipo, externoId]);
  return c ?? null;
}

export async function tokenDe(canalId: number): Promise<string | null> {
  const { rows: [c] } = await pool.query<{ token_enc: string | null }>('SELECT token_enc FROM crm.canales WHERE canal_id = $1', [canalId]);
  return descifrar(c?.token_enc);
}

export async function guardarToken(canalId: number, token: string, expiraEn: Date | null = null): Promise<void> {
  await pool.query('UPDATE crm.canales SET token_enc = $2, token_expira_en = $3, estado_conexion = $4 WHERE canal_id = $1',
    [canalId, cifrar(token), expiraEn, 'conectado']);
}

export async function marcarEstado(canalId: number, estado: string): Promise<void> {
  await pool.query('UPDATE crm.canales SET estado_conexion = $2 WHERE canal_id = $1', [canalId, estado]);
}
