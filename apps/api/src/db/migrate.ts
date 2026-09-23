// Aplica en orden los .sql de /migrations que aún no están registrados.
import fs from 'fs';
import path from 'path';
import { pool } from './pool';

async function main() {
  const dir = path.resolve(__dirname, '../../migrations');
  await pool.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await pool.query<{ nombre: string }>('SELECT nombre FROM public.schema_migrations');
  const hechas = new Set(rows.map((r) => r.nombre));
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  let n = 0;
  for (const f of archivos) {
    if (hechas.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO public.schema_migrations (nombre) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log(`[migrate] ✔ ${f}`);
      n++;
    } catch (e) {
      await c.query('ROLLBACK');
      console.error(`[migrate] ✘ ${f}:`, (e as Error).message);
      process.exit(1);
    } finally {
      c.release();
    }
  }
  console.log(n ? `[migrate] ${n} migración(es) aplicada(s)` : '[migrate] base al día');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
