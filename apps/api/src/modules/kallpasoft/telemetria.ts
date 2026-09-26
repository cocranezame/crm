// Telemetría diaria hacia Kallpasoft (ficha §7, `tenant.stats`): alimenta las alertas de churn
// del central. Solo métricas, jamás autorización. Sin KALLPASOFT_API_URL no hace nada.
import { pool } from '../../db/pool';
import { enviarEvento, kallpasoftConfigurado } from '../../lib/kallpasoft';
import { estadisticas } from './tenants.service';

const DIA = 24 * 60 * 60 * 1000;

export async function enviarStatsDiarias(): Promise<number> {
  if (!kallpasoftConfigurado()) return 0;
  const { rows } = await pool.query<{ tenant_id: string; empresa_id: string }>(
    `SELECT tenant_id, empresa_id FROM app.tenant_config WHERE estado <> 'cancelado'`);
  for (const t of rows) enviarEvento('tenant.stats', t.tenant_id, await estadisticas(t.empresa_id));
  return rows.length;
}

export function programarTelemetria(): void {
  if (!kallpasoftConfigurado()) return;
  const correr = () => enviarStatsDiarias().catch((e) => console.warn('[kallpasoft] stats diarias:', (e as Error).message));
  setTimeout(correr, 60_000).unref();          // primera pasada al minuto de arrancar
  setInterval(correr, DIA).unref();
}
