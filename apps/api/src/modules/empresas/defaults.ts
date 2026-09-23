// Configuración inicial de una empresa nueva: el CRM queda usable al primer ingreso.
import type { Db } from '../../db/pool';

export async function sembrarEmpresa(db: Db, empresaId: string, usuarioId: string | null): Promise<void> {
  const { rows: [p] } = await db.query<{ pipeline_id: number }>(
    `INSERT INTO crm.pipelines (empresa_id, nombre, color, orden, es_entrada)
     VALUES ($1, 'Ventas', '#6366f1', 0, true) RETURNING pipeline_id`, [empresaId]);

  const etapas: Array<[string, string, string]> = [
    ['Nuevo', '#94a3b8', 'abierta'],
    ['Contactado', '#3b82f6', 'abierta'],
    ['Propuesta enviada', '#f59e0b', 'abierta'],
    ['Negociación', '#8b5cf6', 'abierta'],
    ['Ganado', '#10b981', 'ganado'],
    ['Perdido', '#ef4444', 'perdido'],
  ];
  for (const [i, [nombre, color, tipo]] of etapas.entries()) {
    await db.query(
      `INSERT INTO crm.etapas (empresa_id, pipeline_id, nombre, color, orden, tipo) VALUES ($1,$2,$3,$4,$5,$6)`,
      [empresaId, p.pipeline_id, nombre, color, i, tipo]);
  }

  const etiquetas: Array<[string, string, string | null]> = [
    ['Frío', '#60a5fa', 'temperatura'],
    ['Tibio', '#f59e0b', 'temperatura'],
    ['Caliente', '#ef4444', 'temperatura'],
    ['VIP', '#a855f7', null],
    ['Recompra', '#10b981', null],
  ];
  for (const [nombre, color, grupo] of etiquetas) {
    await db.query(
      `INSERT INTO crm.etiquetas (empresa_id, nombre, color, grupo_exclusivo) VALUES ($1,$2,$3,$4)`,
      [empresaId, nombre, color, grupo]);
  }

  await db.query(
    `INSERT INTO crm.campos (empresa_id, entidad, clave, nombre, tipo, orden) VALUES
       ($1, 'contacto', 'ciudad', 'Ciudad', 'texto', 0),
       ($1, 'negocio', 'producto', 'Producto de interés', 'texto', 0)`, [empresaId]);

  await db.query(
    `INSERT INTO crm.respuestas_rapidas (empresa_id, atajo, titulo, contenido, carpeta, creado_por) VALUES
       ($1, 'saludo', 'Saludo inicial', 'Hola {nombre} 👋, gracias por escribir a {empresa}. ¿En qué podemos ayudarte?', 'General', $2),
       ($1, 'horario', 'Horario de atención', 'Nuestro horario de atención es de lunes a sábado de 9:00 a. m. a 7:00 p. m.', 'General', $2),
       ($1, 'gracias', 'Despedida', '¡Gracias por tu preferencia, {nombre}! Cualquier consulta adicional, aquí estamos.', 'General', $2)`,
    [empresaId, usuarioId]);
}

export function slugDe(nombre: string): string {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'empresa';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
