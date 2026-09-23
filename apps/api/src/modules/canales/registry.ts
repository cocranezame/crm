import type { Canal, CanalAdapter, CanalSender, CuentaCanal } from './tipos';
import { whatsappAdapter } from './whatsapp/adapter';
import { whatsappSender } from './whatsapp/sender';
import { messengerAdapter } from './messenger/adapter';
import { messengerSender } from './messenger/sender';
import { tiktokAdapter } from './tiktok/adapter';
import { tiktokSender } from './tiktok/sender';
import { sandboxSender } from './sandbox/sender';

const ADAPTERS: CanalAdapter[] = [whatsappAdapter, messengerAdapter, tiktokAdapter];
const SENDERS: Partial<Record<Canal, CanalSender>> = { whatsapp: whatsappSender, messenger: messengerSender, tiktok: tiktokSender };

/** Adaptador según `payload.object` del webhook de Meta. */
export function adapterPorObjeto(objeto: string | undefined): CanalAdapter | null {
  if (!objeto) return null;
  return ADAPTERS.find((a) => a.objetos.includes(objeto)) ?? null;
}

export function adapterPorCanal(canal: Canal): CanalAdapter {
  const a = ADAPTERS.find((x) => x.canal === canal);
  if (!a) throw new Error(`Canal '${canal}' sin adaptador`);
  return a;
}

export function senderPara(cuenta: CuentaCanal): CanalSender {
  if (cuenta.sandbox) return sandboxSender;
  const s = SENDERS[cuenta.tipo];
  if (!s) throw new Error(`Canal '${cuenta.tipo}' sin sender implementado`);
  return s;
}
