'use client';
// Portado y adaptado de ReparaTego (components/crm/BurbujaMensaje.tsx)
import { useState } from 'react';
import { Check, CheckCheck, Clock, AlertCircle, FileText, Download, MapPin, ExternalLink, ZoomIn, Mic, Ban, StickyNote, Smartphone, Megaphone, LayoutTemplate } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Mensaje } from '@/lib/types';
import { Avatar, Tooltip } from '@/components/ui';

function Imagen({ url, caption }: { url: string; caption?: string | null }) {
  const [zoom, setZoom] = useState(false);
  return (
    <>
      <button className="group relative block overflow-hidden rounded-lg" onClick={() => setZoom(true)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={caption ?? 'Imagen'} className="max-h-72 w-full max-w-[300px] object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
          <ZoomIn className="h-6 w-6 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100" />
        </span>
      </button>
      {caption && <p className="mt-1.5 whitespace-pre-wrap break-words">{caption}</p>}
      {zoom && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6 animate-fade-in" onClick={() => setZoom(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  );
}

function Documento({ url, nombre, saliente }: { url: string; nombre: string; saliente: boolean }) {
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className={cn('flex min-w-[220px] items-center gap-3 rounded-lg px-3 py-2.5 transition-colors', saliente ? 'bg-white/15 hover:bg-white/25' : 'bg-ink-50 hover:bg-ink-100')}>
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', saliente ? 'bg-white/20' : 'bg-white text-brand-600 shadow-xs')}><FileText className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{nombre}</span>
      <Download className="h-4 w-4 shrink-0 opacity-60" />
    </a>
  );
}

function Contenido({ m, saliente }: { m: Mensaje; saliente: boolean }) {
  if (m.tipo === 'ubicacion') {
    const texto = (m.contenido ?? '').replace(/^📍\s*Ubicación compartida:\s*/, '');
    return (
      <div className="min-w-[220px]">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium opacity-75"><MapPin className="h-3.5 w-3.5" />Ubicación</div>
        <p className="break-words">{texto || 'Ubicación compartida'}</p>
        {m.media_url && <a href={m.media_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2">Ver en Google Maps <ExternalLink className="h-3 w-3" /></a>}
      </div>
    );
  }
  if (['imagen', 'video', 'audio', 'documento'].includes(m.tipo)) {
    if (!m.media_url) {
      return m.error
        ? <div className="flex items-center gap-1.5 text-xs italic opacity-80"><AlertCircle className="h-3.5 w-3.5" />{m.error}</div>
        : <div className="flex items-center gap-2 text-xs italic opacity-70"><Clock className="h-3.5 w-3.5 animate-pulse" />Descargando {m.tipo}…</div>;
    }
    if (m.tipo === 'imagen') return <Imagen url={m.media_url} caption={m.contenido} />;
    if (m.tipo === 'video') return <div><video controls src={m.media_url} className="max-h-72 max-w-[300px] rounded-lg" />{m.contenido && <p className="mt-1.5">{m.contenido}</p>}</div>;
    if (m.tipo === 'audio') return <div className="min-w-[240px]"><div className="mb-1 flex items-center gap-1.5 text-xs opacity-75"><Mic className="h-3.5 w-3.5" />Nota de voz</div><audio controls src={m.media_url} className="h-9 w-full" /></div>;
    return <Documento url={m.media_url} nombre={m.media_nombre ?? m.contenido ?? 'Documento'} saliente={saliente} />;
  }
  if (m.tipo === 'sistema' && m.media_url) {
    return <div><p className="whitespace-pre-wrap break-words">{m.contenido}</p><a href={m.media_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline"><ExternalLink className="h-3 w-3" />Abrir enlace</a></div>;
  }
  return <p className="whitespace-pre-wrap break-words">{m.contenido}</p>;
}

function Estado({ m }: { m: Mensaje }) {
  const e = m.estado_envio;
  if (e === 'pendiente') return <Clock className="h-3.5 w-3.5 opacity-70" />;
  if (e === 'sent') return <Check className="h-3.5 w-3.5 opacity-80" />;
  if (e === 'delivered') return <CheckCheck className="h-3.5 w-3.5 opacity-80" />;
  if (e === 'read') return <CheckCheck className="h-3.5 w-3.5 text-sky-300" />;
  if (e === 'bloqueado') return <Ban className="h-3.5 w-3.5 text-amber-200" />;
  if (e === 'error' || e === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-red-200" />;
  return null;
}

export function Burbuja({ m, agrupado }: { m: Mensaje; agrupado?: boolean }) {
  const hora = format(new Date(m.enviado_en), 'HH:mm');

  // Eventos de sistema (asignaciones, cambios de estado)
  if (m.autor_tipo === 'sistema' && m.direccion === 'nota') {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-ink-200/60 px-3 py-1 text-[11px] font-medium text-ink-500">{m.contenido} · {hora}</span>
      </div>
    );
  }

  // Nota interna: solo la ve el equipo
  if (m.direccion === 'nota') {
    return (
      <div className={cn('flex justify-end', agrupado ? 'mt-1' : 'mt-3')}>
        <div className="max-w-[72%] rounded-2xl rounded-tr-md border border-amber-200 bg-amber-50 px-3.5 py-2 text-[13.5px] leading-relaxed text-amber-950 shadow-xs">
          <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700"><StickyNote className="h-3 w-3" />Nota interna · {m.autor_nombre}</div>
          <p className="whitespace-pre-wrap break-words">{m.contenido}</p>
          <p className="mt-1 text-right text-[10px] text-amber-600/80">{hora}</p>
        </div>
      </div>
    );
  }

  const saliente = m.direccion === 'saliente';
  const fallido = m.estado_envio === 'error' || m.estado_envio === 'failed' || m.estado_envio === 'bloqueado';
  const desdeApp = saliente && (m.metadatos as { desde_app?: boolean })?.desde_app;
  const esDifusion = saliente && m.autor_tipo === 'sistema';

  return (
    <div className={cn('flex items-end gap-2', saliente ? 'justify-end' : 'justify-start', agrupado ? 'mt-1' : 'mt-3')}>
      <div className={cn('max-w-[72%]', saliente && 'flex flex-col items-end')}>
        {!agrupado && saliente && (
          <p className="mb-1 flex items-center gap-1 px-1 text-[11px] font-medium text-ink-400">
            {desdeApp ? <><Smartphone className="h-3 w-3" />Desde la app del canal</> : esDifusion ? <><Megaphone className="h-3 w-3" />Difusión</> : m.autor_nombre}
            {m.tipo === 'plantilla' && <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-ink-100 px-1 text-[10px] text-ink-500"><LayoutTemplate className="h-2.5 w-2.5" />plantilla</span>}
          </p>
        )}
        <div className={cn('relative px-3.5 py-2 text-[13.5px] leading-relaxed shadow-xs',
          saliente
            ? cn('rounded-2xl rounded-br-md text-white', fallido ? 'bg-red-500/90' : 'bg-brand-600')
            : 'rounded-2xl rounded-bl-md border border-ink-200/70 bg-white text-ink-800')}>
          <Contenido m={m} saliente={saliente} />
          <div className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', saliente ? 'text-white/70' : 'text-ink-400')}>
            {hora}{saliente && <Estado m={m} />}
          </div>
        </div>
        {fallido && m.error && (
          <Tooltip texto={m.error}>
            <p className="mt-1 flex max-w-full items-center gap-1 px-1 text-[11px] text-red-600"><AlertCircle className="h-3 w-3 shrink-0" /><span className="truncate">{m.estado_envio === 'bloqueado' ? 'No enviado: ' : 'Error: '}{m.error}</span></p>
          </Tooltip>
        )}
      </div>
      {saliente && !agrupado && m.autor_tipo === 'humano' && !desdeApp && <Avatar nombre={m.autor_nombre} color={m.autor_color} size={24} className="mb-5" />}
      {saliente && (agrupado || m.autor_tipo !== 'humano' || desdeApp) && <span className="w-6" />}
    </div>
  );
}
