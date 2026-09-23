// ─── Sender WhatsApp Cloud API ────────────────────────────────────────────────
// Portado de ReparaTego (whatsapp/sender.service.ts + canales/whatsapp/sender.ts).
// Un teléfono es solo dígitos; un BSUID trae prefijo de país y punto
// (ej. "PE.2040578456559018"): Meta exige `recipient` para BSUID y `to` para teléfono.
import { graph } from '../graph';
import type { CanalSender, EnviarMediaInput, EnviarPlantillaInput, EnviarTextoInput, ResultadoEnvio } from '../tipos';

interface SendResp { messages?: Array<{ id: string }> }

const destino = (id: string) => (/^\+?\d{6,}$/.test(id) ? { to: id.replace(/^\+/, '') } : { recipient: id });
const TIPO_WA = { imagen: 'image', video: 'video', documento: 'document', audio: 'audio' } as const;

async function enviar(input: { cuenta: EnviarTextoInput['cuenta']; identidad: string }, cuerpo: Record<string, unknown>): Promise<ResultadoEnvio> {
  try {
    const r = (await graph(input.cuenta.canal_id, `/${input.cuenta.externo_id}/messages`, {
      method: 'POST', timeoutMs: 15_000,
      body: { messaging_product: 'whatsapp', ...destino(input.identidad), ...cuerpo },
    })) as SendResp;
    return { ok: true, mensajeExternoId: r.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const whatsappSender: CanalSender = {
  canal: 'whatsapp',

  async enviarTexto(input: EnviarTextoInput) {
    // Fuera de las 24 h Meta rechaza el texto libre (131047); se informa como bloqueo.
    if (!input.ultimoEntranteEn || Date.now() - input.ultimoEntranteEn.getTime() > 24 * 3600_000) {
      return { ok: false, bloqueado: true, motivoBloqueo: 'ventana', error: 'Fuera de la ventana de 24 h de WhatsApp: usa una plantilla aprobada.' };
    }
    return enviar(input, { type: 'text', text: { body: input.texto, preview_url: true } });
  },

  async enviarMedia(input: EnviarMediaInput) {
    if (!input.ultimoEntranteEn || Date.now() - input.ultimoEntranteEn.getTime() > 24 * 3600_000) {
      return { ok: false, bloqueado: true, motivoBloqueo: 'ventana', error: 'Fuera de la ventana de 24 h de WhatsApp: usa una plantilla aprobada.' };
    }
    const type = TIPO_WA[input.tipoMedia];
    const media: Record<string, string> = { link: input.url };
    if (input.caption?.trim() && type !== 'audio') media.caption = input.caption.trim();
    if (type === 'document') media.filename = input.filename;
    return enviar(input, { type, [type]: media });
  },

  async enviarPlantilla(input: EnviarPlantillaInput) {
    const components = input.parametros.length
      ? [{ type: 'body', parameters: input.parametros.map((text) => ({ type: 'text', text })) }]
      : [];
    return enviar(input, { type: 'template', template: { name: input.nombre, language: { code: input.idioma }, components } });
  },
};
