import { tx } from '../../db/pool';
import { conflicto, invalido, noEncontrado } from '../../lib/http';

/**
 * Devuelve (o crea) la conversación de WhatsApp con un contacto que quizá nunca escribió.
 * Solo WhatsApp permite iniciar conversación (con plantilla); los demás canales exigen
 * que el cliente escriba primero.
 */
export async function asegurarConversacion(empresaId: string, contactoId: number, canalId: number): Promise<number> {
  return tx(async (db) => {
    const { rows: [c] } = await db.query('SELECT contacto_id, telefono FROM crm.contactos WHERE contacto_id = $1 AND empresa_id = $2 AND eliminado_en IS NULL', [contactoId, empresaId]);
    if (!c) throw noEncontrado('Contacto');
    const { rows: [ca] } = await db.query('SELECT tipo FROM crm.canales WHERE canal_id = $1 AND empresa_id = $2 AND activo', [canalId, empresaId]);
    if (!ca) throw noEncontrado('Canal');
    const { rows: [ya] } = await db.query('SELECT conversacion_id FROM crm.conversaciones WHERE contacto_id = $1 AND canal_id = $2 ORDER BY ultima_actividad DESC LIMIT 1', [contactoId, canalId]);
    if (ya) return ya.conversacion_id as number;
    if (ca.tipo !== 'whatsapp') throw invalido('Solo WhatsApp permite iniciar conversaciones; en los demás canales el cliente escribe primero');
    if (!c.telefono) throw invalido('El contacto no tiene teléfono');
    const externo = String(c.telefono).replace(/^\+/, '');
    const { rows: [i] } = await db.query(
      `INSERT INTO crm.identidades (empresa_id, contacto_id, canal, externo_id) VALUES ($1,$2,'whatsapp',$3)
       ON CONFLICT (empresa_id, canal, externo_id) DO UPDATE SET externo_id = EXCLUDED.externo_id RETURNING identidad_id, contacto_id`,
      [empresaId, contactoId, externo]);
    if (i.contacto_id !== contactoId) throw conflicto('Ese número de WhatsApp ya pertenece a otro contacto');
    const { rows: [cv] } = await db.query(
      `INSERT INTO crm.conversaciones (empresa_id, contacto_id, canal_id, identidad_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (canal_id, identidad_id) DO UPDATE SET canal_id = EXCLUDED.canal_id RETURNING conversacion_id`,
      [empresaId, contactoId, canalId, i.identidad_id]);
    return cv.conversacion_id as number;
  });
}
