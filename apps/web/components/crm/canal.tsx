'use client';
// Portado y adaptado de ReparaTego (components/crm/CanalBadge.tsx)
import { cn } from '@/lib/utils';
import type { Canal } from '@/lib/types';

export const CANAL_INFO: Record<Canal, { label: string; color: string; bg: string; texto: string }> = {
  whatsapp: { label: 'WhatsApp', color: '#25D366', bg: 'bg-emerald-50', texto: 'text-emerald-700' },
  messenger: { label: 'Messenger', color: '#0866FF', bg: 'bg-blue-50', texto: 'text-blue-700' },
  instagram: { label: 'Instagram', color: '#E1306C', bg: 'bg-pink-50', texto: 'text-pink-700' },
  tiktok: { label: 'TikTok', color: '#111111', bg: 'bg-ink-100', texto: 'text-ink-800' },
};

/** Logos simplificados (SVG propios, no marcas oficiales). */
export function IconoCanal({ canal, size = 14, className }: { canal: Canal; size?: number; className?: string }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', className, 'aria-hidden': true } as const;
  if (canal === 'whatsapp') return (
    <svg {...p} fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3 1 2.6 1.1 2.7.1.2 1.9 2.9 4.6 4 1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z" /></svg>
  );
  if (canal === 'messenger') return (
    <svg {...p} fill="currentColor"><path d="M12 2C6.4 2 2 6.1 2 11.6c0 2.9 1.2 5.4 3.2 7.1v3.3l3-1.7c.9.3 1.8.4 2.8.4 5.6 0 10-4.1 10-9.6S17.6 2 12 2Zm1 12.9-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.4 5.8Z" /></svg>
  );
  if (canal === 'tiktok') return (
    <svg {...p} fill="currentColor"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9a7.3 7.3 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5Z" /></svg>
  );
  return (
    <svg {...p} fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" /></svg>
  );
}

export function CanalChip({ canal, className, conTexto = true }: { canal: Canal; className?: string; conTexto?: boolean }) {
  const i = CANAL_INFO[canal];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', i.bg, i.texto, className)}>
      <IconoCanal canal={canal} size={12} className="shrink-0" />
      {conTexto && i.label}
    </span>
  );
}

/** Punto con logo sobre el avatar del contacto. */
export function CanalPunto({ canal, size = 16 }: { canal: Canal; size?: number }) {
  return (
    <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full ring-2 ring-white"
      style={{ width: size, height: size, backgroundColor: CANAL_INFO[canal].color }}>
      <IconoCanal canal={canal} size={size * 0.62} className="text-white" />
    </span>
  );
}

// ── Ventana de respuesta por canal (portado de ReparaTego) ───────────────────

export const VENTANA_HORAS: Record<Canal, number> = { whatsapp: 24, messenger: 24, instagram: 24, tiktok: 48 };

export function estadoVentana(canal: Canal, ultimoEntrante: string | null, ahora = new Date()) {
  const ventana = VENTANA_HORAS[canal];
  if (!ultimoEntrante) return { abierta: false, horasRestantes: 0, humanAgent: false, ventana };
  const horas = (ahora.getTime() - new Date(ultimoEntrante).getTime()) / 3_600_000;
  if (horas <= ventana) return { abierta: true, horasRestantes: ventana - horas, humanAgent: false, ventana };
  return { abierta: false, horasRestantes: 0, humanAgent: (canal === 'messenger' || canal === 'instagram') && horas <= 24 * 7, ventana };
}
