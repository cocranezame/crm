import type { Db } from '../../db/pool';
import { invalido, noEncontrado } from '../../lib/http';

/**
 * Aplica una etiqueta al contacto. Si la etiqueta tiene grupo_exclusivo, quita
 * antes las otras etiquetas del mismo grupo (reemplaza GRUPOS_EXCLUSIVOS hardcodeado).
 */
export async function aplicarEtiqueta(db: Db, empresaId: string, contactoId: number, etiquetaId: number, por: 'humano' | 'ia' | 'sistema' = 'humano') {
  const { rows: [e] } = await db.query<{ grupo_exclusivo: string | null }>(
    'SELECT grupo_exclusivo FROM crm.etiquetas WHERE etiqueta_id = $1 AND empresa_id = $2', [etiquetaId, empresaId]);
  if (!e) throw noEncontrado('Etiqueta');
  if (e.grupo_exclusivo) {
    await db.query(
      `DELETE FROM crm.contacto_etiquetas ce USING crm.etiquetas et
        WHERE ce.etiqueta_id = et.etiqueta_id AND ce.contacto_id = $1
          AND et.empresa_id = $2 AND et.grupo_exclusivo = $3 AND et.etiqueta_id <> $4`,
      [contactoId, empresaId, e.grupo_exclusivo, etiquetaId]);
  }
  await db.query(
    `INSERT INTO crm.contacto_etiquetas (contacto_id, etiqueta_id, aplicada_por) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [contactoId, etiquetaId, por]);
}

export async function quitarEtiqueta(db: Db, contactoId: number, etiquetaId: number) {
  await db.query('DELETE FROM crm.contacto_etiquetas WHERE contacto_id = $1 AND etiqueta_id = $2', [contactoId, etiquetaId]);
}

/** Reemplaza el conjunto completo; rechaza dos etiquetas del mismo grupo exclusivo. */
export async function reemplazarEtiquetas(db: Db, empresaId: string, contactoId: number, ids: number[]) {
  const unicos = [...new Set(ids)];
  if (unicos.length) {
    const { rows } = await db.query<{ etiqueta_id: number; grupo_exclusivo: string | null; nombre: string }>(
      'SELECT etiqueta_id, grupo_exclusivo, nombre FROM crm.etiquetas WHERE empresa_id = $1 AND etiqueta_id = ANY($2)', [empresaId, unicos]);
    if (rows.length !== unicos.length) throw invalido('Alguna etiqueta no existe');
    const grupos = new Map<string, string>();
    for (const r of rows) {
      if (!r.grupo_exclusivo) continue;
      if (grupos.has(r.grupo_exclusivo)) throw invalido(`"${grupos.get(r.grupo_exclusivo)}" y "${r.nombre}" son excluyentes (grupo ${r.grupo_exclusivo})`);
      grupos.set(r.grupo_exclusivo, r.nombre);
    }
  }
  await db.query('DELETE FROM crm.contacto_etiquetas WHERE contacto_id = $1 AND NOT (etiqueta_id = ANY($2))', [contactoId, unicos]);
  for (const id of unicos) {
    await db.query('INSERT INTO crm.contacto_etiquetas (contacto_id, etiqueta_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [contactoId, id]);
  }
}
