// Valida y normaliza los valores de campos personalizados (contacto / negocio).
// Reemplaza el `UPDATE crm.leads SET ${campo}` de ReparaTego: aquí todo vive en `valores jsonb`.
import type { Db } from '../../db/pool';
import { invalido } from '../../lib/http';

export interface CampoDef {
  campo_id: number; clave: string; nombre: string;
  tipo: 'texto' | 'numero' | 'fecha' | 'opcion' | 'multi' | 'telefono' | 'email' | 'booleano';
  opciones: string[] | null; obligatorio: boolean;
}

export async function camposDe(db: Db, empresaId: string, entidad: 'contacto' | 'negocio'): Promise<CampoDef[]> {
  const { rows } = await db.query<CampoDef>(
    `SELECT campo_id, clave, nombre, tipo, opciones, obligatorio FROM crm.campos
      WHERE empresa_id = $1 AND entidad = $2 ORDER BY orden, campo_id`, [empresaId, entidad]);
  return rows;
}

/** Devuelve solo claves conocidas, con el tipo correcto. `parcial` = no exige obligatorios. */
export async function validarValores(
  db: Db, empresaId: string, entidad: 'contacto' | 'negocio',
  valores: Record<string, unknown> | undefined, opts: { parcial?: boolean } = {},
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (!valores) valores = {};
  const defs = await camposDe(db, empresaId, entidad);
  const porClave = new Map(defs.map((d) => [d.clave, d]));

  for (const [clave, crudo] of Object.entries(valores)) {
    const def = porClave.get(clave);
    if (!def) throw invalido(`El campo "${clave}" no existe`);
    if (crudo === null || crudo === '' || (Array.isArray(crudo) && crudo.length === 0)) { out[clave] = null; continue; }
    out[clave] = convertir(def, crudo);
  }
  if (!opts.parcial) {
    for (const d of defs) {
      if (d.obligatorio && (out[d.clave] === undefined || out[d.clave] === null)) throw invalido(`El campo "${d.nombre}" es obligatorio`);
    }
  }
  return out;
}

function convertir(def: CampoDef, v: unknown): unknown {
  const err = () => invalido(`Valor inválido para "${def.nombre}"`);
  switch (def.tipo) {
    case 'numero': { const n = Number(v); if (!Number.isFinite(n)) throw err(); return n; }
    case 'booleano': return v === true || v === 'true' || v === 1 || v === 'si' || v === 'sí';
    case 'fecha': { const s = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw err(); return s; }
    case 'email': { const s = String(v).trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw err(); return s.toLowerCase(); }
    case 'opcion': { const s = String(v); if (def.opciones && !def.opciones.includes(s)) throw err(); return s; }
    case 'multi': {
      const arr = Array.isArray(v) ? v.map(String) : String(v).split(',').map((x) => x.trim()).filter(Boolean);
      if (def.opciones && arr.some((x) => !def.opciones!.includes(x))) throw err();
      return arr;
    }
    default: return String(v).slice(0, 2000);
  }
}
