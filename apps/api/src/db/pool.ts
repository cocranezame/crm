import { Pool, PoolClient, types } from 'pg';
import { ENV } from '../config/env';

// numeric → number (montos) y bigint → number (ids bigserial caben en 2^53)
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// bigint[] → number[] (p. ej. difusiones.etiqueta_ids)
(types.setTypeParser as (oid: number, fn: (v: string) => unknown) => void)(1016, (v) => (v.replace(/^\{|\}$/g, '').split(',').filter(Boolean).map(Number)));

export const pool = new Pool({ connectionString: ENV.DATABASE_URL, max: 15 });

pool.on('error', (err) => console.error('[db] error en cliente inactivo:', err.message));

/** Ejecuta fn dentro de una transacción. Hace ROLLBACK si lanza. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export type Db = Pick<PoolClient, 'query'>;
