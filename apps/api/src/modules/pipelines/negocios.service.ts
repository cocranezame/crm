// Dominio de negocios (tarjetas del kanban). Única puerta para crear y mover:
// la usan la UI, la bandeja (contacto nuevo por mensaje) y —a futuro— el agente IA.
import type { Db } from '../../db/pool';
import { conflicto, invalido, noEncontrado } from '../../lib/http';
import { emitirEmpresa } from '../../lib/realtime';

export type Actor = { tipo: 'humano' | 'ia' | 'sistema'; id: string | null };

interface EtapaInfo { etapa_id: number; pipeline_id: number; tipo: 'abierta' | 'ganado' | 'perdido' }

async function etapaDe(db: Db, empresaId: string, etapaId: number): Promise<EtapaInfo> {
  const { rows: [e] } = await db.query<EtapaInfo>(
    'SELECT etapa_id, pipeline_id, tipo FROM crm.etapas WHERE etapa_id = $1 AND empresa_id = $2', [etapaId, empresaId]);
  if (!e) throw noEncontrado('Etapa');
  return e;
}

async function posicionFinal(db: Db, etapaId: number): Promise<number> {
  const { rows: [r] } = await db.query<{ p: number | null }>('SELECT max(posicion) AS p FROM crm.negocios WHERE etapa_id = $1', [etapaId]);
  return (r.p ?? 0) + 1000;
}

export async function crearNegocio(db: Db, empresaId: string, d: {
  contacto_id: number; pipeline_id: number; etapa_id?: number | null; titulo?: string | null;
  monto?: number | null; asignado_a?: string | null; valores?: Record<string, unknown>;
}, actor: Actor) {
  let etapaId = d.etapa_id ?? null;
  if (etapaId) {
    const e = await etapaDe(db, empresaId, etapaId);
    if (e.pipeline_id !== d.pipeline_id) throw invalido('La etapa no pertenece a ese pipeline');
  } else {
    const { rows: [e] } = await db.query<{ etapa_id: number }>(
      `SELECT etapa_id FROM crm.etapas WHERE pipeline_id = $1 AND empresa_id = $2 ORDER BY (tipo <> 'abierta'), orden LIMIT 1`,
      [d.pipeline_id, empresaId]);
    if (!e) throw invalido('El tablero no tiene etapas');
    etapaId = e.etapa_id;
  }
  const etapa = await etapaDe(db, empresaId, etapaId);
  const { rows: [c] } = await db.query('SELECT 1 FROM crm.contactos WHERE contacto_id = $1 AND empresa_id = $2 AND eliminado_en IS NULL', [d.contacto_id, empresaId]);
  if (!c) throw noEncontrado('Contacto');

  const { rows: [n] } = await db.query(
    `INSERT INTO crm.negocios (empresa_id, contacto_id, pipeline_id, etapa_id, titulo, monto, asignado_a, posicion, valores, cerrado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10 <> 'abierta' THEN now() END) RETURNING *`,
    [empresaId, d.contacto_id, d.pipeline_id, etapaId, d.titulo ?? null, d.monto ?? null, d.asignado_a ?? null,
     await posicionFinal(db, etapaId), JSON.stringify(d.valores ?? {}), etapa.tipo]);
  await db.query(
    `INSERT INTO crm.negocio_historial (empresa_id, negocio_id, de_etapa, a_etapa, actor_tipo, actor_id) VALUES ($1,$2,NULL,$3,$4,$5)`,
    [empresaId, n.negocio_id, etapaId, actor.tipo, actor.id]);
  emitirEmpresa(empresaId, 'tablero:cambio', { pipeline_id: d.pipeline_id });
  return n;
}

/** Mueve un negocio a otra etapa (o reordena dentro de la misma). */
export async function moverNegocio(db: Db, empresaId: string, negocioId: number, etapaId: number, posicion: number | null, actor: Actor) {
  const { rows: [n] } = await db.query<{ negocio_id: number; etapa_id: number; pipeline_id: number; contacto_id: number }>(
    'SELECT negocio_id, etapa_id, pipeline_id, contacto_id FROM crm.negocios WHERE negocio_id = $1 AND empresa_id = $2 FOR UPDATE',
    [negocioId, empresaId]);
  if (!n) throw noEncontrado('Negocio');
  const destino = await etapaDe(db, empresaId, etapaId);
  if (destino.pipeline_id !== n.pipeline_id) throw invalido('Solo se puede mover a etapas del mismo pipeline');

  const pos = posicion ?? await posicionFinal(db, etapaId);
  const cambiaEtapa = n.etapa_id !== etapaId;

  if (cambiaEtapa && destino.tipo === 'abierta') {
    // Reabrir: no puede haber otro negocio abierto del mismo contacto en el pipeline
    const { rows: [otro] } = await db.query(
      `SELECT 1 FROM crm.negocios WHERE contacto_id = $1 AND pipeline_id = $2 AND cerrado_en IS NULL AND negocio_id <> $3`,
      [n.contacto_id, n.pipeline_id, negocioId]);
    if (otro) throw conflicto('El contacto ya tiene otro negocio abierto en este tablero');
  }

  const { rows: [act] } = await db.query(
    `UPDATE crm.negocios SET etapa_id = $3, posicion = $4, actualizado_en = now(),
            etapa_desde = CASE WHEN $5 THEN now() ELSE etapa_desde END,
            cerrado_en  = CASE WHEN $6 = 'abierta' THEN NULL ELSE COALESCE(cerrado_en, now()) END
      WHERE negocio_id = $1 AND empresa_id = $2 RETURNING *`,
    [negocioId, empresaId, etapaId, pos, cambiaEtapa, destino.tipo]);

  if (cambiaEtapa) {
    await db.query(
      `INSERT INTO crm.negocio_historial (empresa_id, negocio_id, de_etapa, a_etapa, actor_tipo, actor_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [empresaId, negocioId, n.etapa_id, etapaId, actor.tipo, actor.id]);
  }
  emitirEmpresa(empresaId, 'tablero:cambio', { pipeline_id: n.pipeline_id, negocio_id: negocioId, por: actor.id });
  return act;
}

/** Contacto nuevo por un canal → negocio en la primera etapa del pipeline de entrada. */
export async function crearNegocioEntrada(db: Db, empresaId: string, contactoId: number, titulo: string | null) {
  const { rows: [p] } = await db.query<{ pipeline_id: number }>(
    'SELECT pipeline_id FROM crm.pipelines WHERE empresa_id = $1 AND es_entrada AND activo', [empresaId]);
  if (!p) return null;
  const { rows: [ya] } = await db.query(
    'SELECT 1 FROM crm.negocios WHERE contacto_id = $1 AND pipeline_id = $2 AND cerrado_en IS NULL', [contactoId, p.pipeline_id]);
  if (ya) return null;
  return crearNegocio(db, empresaId, { contacto_id: contactoId, pipeline_id: p.pipeline_id, titulo }, { tipo: 'sistema', id: null });
}
