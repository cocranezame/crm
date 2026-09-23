// Plantillas de WhatsApp (HSM). Variables {{1}}..{{n}} del cuerpo con origen:
//   contacto (nombre|telefono|email|documento|empresa_nombre) · campo (clave de campo
//   personalizado) · empresa (nombre) · manual (texto fijo o escrito al enviar).
// El origen `servicio` de ReparaTego se eliminó (acoplamiento A6).
import { pool } from '../../db/pool';
import { invalido } from '../../lib/http';

export interface VariablePlantilla { indice: number; origen: 'contacto' | 'campo' | 'empresa' | 'manual'; valor: string; ejemplo: string }

export function indicesDe(cuerpo: string): number[] {
  const set = new Set<number>();
  for (const m of cuerpo.matchAll(/\{\{(\d+)\}\}/g)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

export function validarVariables(cuerpo: string, variables: VariablePlantilla[]) {
  const idx = indicesDe(cuerpo);
  idx.forEach((n, i) => { if (n !== i + 1) throw invalido('Las variables deben ser consecutivas: {{1}}, {{2}}, {{3}}…'); });
  for (const n of idx) {
    const v = variables.find((x) => x.indice === n);
    if (!v) throw invalido(`Falta configurar la variable {{${n}}}`);
    if (!v.ejemplo?.trim()) throw invalido(`La variable {{${n}}} necesita un ejemplo (Meta lo exige para aprobar)`);
  }
  return variables.filter((v) => idx.includes(v.indice)).sort((a, b) => a.indice - b.indice);
}

const CAMPOS_CONTACTO = ['nombre', 'telefono', 'email', 'documento', 'empresa_nombre'];

export async function renderPlantilla(
  empresaId: string,
  p: { cuerpo: string; variables: VariablePlantilla[] },
  contactoId: number | null,
  manuales: Record<string, string>,
): Promise<{ parametros: string[]; texto: string; faltantes: number[] }> {
  let contacto: Record<string, unknown> | null = null;
  if (contactoId) {
    ({ rows: [contacto] } = await pool.query('SELECT * FROM crm.contactos WHERE contacto_id = $1 AND empresa_id = $2', [contactoId, empresaId]));
  }
  const { rows: [emp] } = await pool.query('SELECT nombre FROM app.empresas WHERE empresa_id = $1', [empresaId]);
  const parametros: string[] = [];
  const faltantes: number[] = [];
  for (const n of indicesDe(p.cuerpo)) {
    const v = p.variables.find((x) => x.indice === n);
    let valor = '';
    if (v?.origen === 'contacto' && CAMPOS_CONTACTO.includes(v.valor)) valor = String(contacto?.[v.valor] ?? '');
    else if (v?.origen === 'campo') {
      const x = (contacto?.valores as Record<string, unknown> | undefined)?.[v.valor];
      valor = Array.isArray(x) ? x.join(', ') : x === undefined || x === null ? '' : String(x);
    } else if (v?.origen === 'empresa') valor = emp?.nombre ?? '';
    else if (v?.origen === 'manual') valor = manuales[String(n)] ?? v.valor ?? '';
    // Meta rechaza parámetros vacíos: se usa el ejemplo como respaldo y se informa
    if (!valor.trim()) { faltantes.push(n); valor = manuales[String(n)] || v?.ejemplo || '-'; }
    parametros.push(valor.slice(0, 1000));
  }
  const texto = p.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, i) => parametros[Number(i) - 1] ?? '');
  return { parametros, texto, faltantes };
}
