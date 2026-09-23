// ─── Canal de prueba local ────────────────────────────────────────────────────
// Un canal con sandbox=true no llama a Meta/TikTok: el envío siempre "sale" y a
// los pocos segundos se simulan los acuses de entregado y leído. Sirve para
// probar la bandeja de punta a punta en local, sin cuentas reales.
// Respeta las mismas reglas de ventana que el canal real para que el
// comportamiento en pantalla sea idéntico.
import crypto from 'crypto';
import { resolverMessagingType } from '../messenger/sender';
import { contarSalientesConsecutivos, resolverVentana, MSG_TIKTOK } from '../tiktok/sender';
import type { CanalSender, EnviarMediaInput, EnviarTextoInput, ResultadoEnvio } from '../tipos';

type ProgramarAcuse = (canalId: number, externoId: string) => void;
let programarAcuse: ProgramarAcuse = () => undefined;
export function registrarAcuses(fn: ProgramarAcuse) { programarAcuse = fn; }

async function verificarVentana(input: EnviarTextoInput | EnviarMediaInput): Promise<ResultadoEnvio | null> {
  const tipo = input.cuenta.tipo;
  if (tipo === 'whatsapp') {
    if (!input.ultimoEntranteEn || Date.now() - input.ultimoEntranteEn.getTime() > 24 * 3600_000) {
      return { ok: false, bloqueado: true, motivoBloqueo: 'ventana', error: 'Fuera de la ventana de 24 h de WhatsApp: usa una plantilla aprobada.' };
    }
  } else if (tipo === 'tiktok') {
    const v = resolverVentana(input.ultimoEntranteEn, await contarSalientesConsecutivos(input.conversacion_id));
    if (v.bloqueado) return { ok: false, bloqueado: true, motivoBloqueo: v.motivo, error: MSG_TIKTOK[v.motivo] };
  } else if (!resolverMessagingType(input.ultimoEntranteEn, input.esHumano)) {
    return { ok: false, bloqueado: true, motivoBloqueo: 'ventana', error: 'Fuera de la ventana de 24 h de Messenger: el cliente debe escribir primero.' };
  }
  return null;
}

function ok(canalId: number): ResultadoEnvio {
  const id = `sbx.${crypto.randomUUID()}`;
  programarAcuse(canalId, id);
  return { ok: true, mensajeExternoId: id };
}

export const sandboxSender: CanalSender = {
  canal: 'whatsapp',
  async enviarTexto(input) { return (await verificarVentana(input)) ?? ok(input.cuenta.canal_id); },
  async enviarMedia(input) { return (await verificarVentana(input)) ?? ok(input.cuenta.canal_id); },
  async enviarPlantilla(input) { return ok(input.cuenta.canal_id); },
};
