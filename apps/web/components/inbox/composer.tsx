'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Send, Smile, StickyNote, X, FileText, Zap, LayoutTemplate, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Archivo } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ConversacionFila, Mensaje, Plantilla, RespuestaRapida } from '@/lib/types';
import { useMe, useRespuestas } from '@/hooks/datos';
import { emitir } from '@/hooks/realtime';
import { Button, Modal, Popover, Spinner } from '@/components/ui';
import { CANAL_INFO, estadoVentana } from '@/components/crm/canal';

const EMOJIS = ['😀', '😁', '😂', '🙂', '😉', '😊', '😍', '🤩', '😎', '🤔', '😅', '🙏', '👍', '👌', '👏', '💪', '🙌', '🤝', '👋', '✌️', '❤️', '🔥', '✅', '⭐', '🎉', '💯', '📦', '🚚', '🛠️', '🔧', '🔨', '💡', '📍', '📞', '💬', '🕒', '💳', '💵', '🧾', '📷'];

function reemplazarVariables(texto: string, ctx: { nombre?: string | null; empresa?: string | null; telefono?: string | null; valores?: Record<string, unknown> }) {
  return texto
    .replace(/\{nombre\}/g, ctx.nombre?.split(' ')[0] ?? '')
    .replace(/\{nombre_completo\}/g, ctx.nombre ?? '')
    .replace(/\{empresa\}/g, ctx.empresa ?? '')
    .replace(/\{telefono\}/g, ctx.telefono ?? '')
    .replace(/\{campo\.([a-z0-9_]+)\}/g, (_, k) => { const v = ctx.valores?.[k]; return v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v); });
}

export function Composer({ conv }: { conv: ConversacionFila }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: respuestas } = useRespuestas();
  const contacto = useQuery({ queryKey: ['contacto', conv.contacto_id], queryFn: () => api.get<{ contacto: { valores: Record<string, unknown>; nombre: string | null; telefono: string | null } }>(`/contactos/${conv.contacto_id}`) });

  const [modo, setModo] = useState<'responder' | 'nota'>('responder');
  const [texto, setTexto] = useState('');
  const [adjunto, setAdjunto] = useState<Archivo | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [sel, setSel] = useState(0);
  const [plantillas, setPlantillas] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const ultimoTyping = useRef(0);

  useEffect(() => { setTexto(''); setAdjunto(null); setModo('responder'); ta.current?.focus(); }, [conv.conversacion_id]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [texto]);

  // "/atajo" al final del texto abre las respuestas rápidas
  const token = texto.match(/(?:^|\s)\/([a-z0-9_-]*)$/)?.[1];
  const sugerencias = useMemo(() => {
    if (token === undefined || !respuestas) return [];
    return respuestas.filter((r) => r.atajo.startsWith(token) || r.titulo.toLowerCase().includes(token)).slice(0, 7);
  }, [token, respuestas]);
  useEffect(() => setSel(0), [token]);

  const ventana = estadoVentana(conv.canal, conv.ultimo_entrante_en);
  const puedeAdjuntar = conv.capacidades?.soportaAdjuntosSalientes ?? conv.canal !== 'tiktok';

  function usarRespuesta(r: RespuestaRapida) {
    const c = contacto.data?.contacto;
    const cuerpo = reemplazarVariables(r.contenido, { nombre: c?.nombre ?? conv.contacto_nombre, empresa: me?.empresa?.nombre, telefono: c?.telefono, valores: c?.valores });
    setTexto((t) => t.replace(/(^|\s)\/[a-z0-9_-]*$/, `$1${cuerpo}`));
    ta.current?.focus();
  }

  const enviar = useMutation({
    mutationFn: async () => {
      const t = texto.trim();
      if (modo === 'nota') return api.post<{ mensaje: Mensaje }>(`/conversaciones/${conv.conversacion_id}/notas`, { texto: t });
      return api.post<{ mensaje: Mensaje }>(`/conversaciones/${conv.conversacion_id}/mensajes`, {
        texto: t || undefined,
        adjunto: adjunto ? { key: adjunto.key, mime: adjunto.mime, nombre: adjunto.nombre, tipo: adjunto.tipo } : undefined,
      });
    },
    onSuccess: (r) => {
      setTexto(''); setAdjunto(null);
      if (r.mensaje.estado_envio === 'bloqueado' || r.mensaje.estado_envio === 'error') toast.error(r.mensaje.error ?? 'No se pudo enviar');
      qc.invalidateQueries({ queryKey: ['conversacion', conv.conversacion_id] });
      qc.invalidateQueries({ queryKey: ['conversaciones'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function subir(f: File) {
    if (f.size > 16 * 1024 * 1024) { toast.error('El archivo supera los 16 MB'); return; }
    setSubiendo(true);
    try { setAdjunto((await api.subir(f)).archivo); } catch (e) { toast.error((e as Error).message); } finally { setSubiendo(false); }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (sugerencias.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % sugerencias.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + sugerencias.length) % sugerencias.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); usarRespuesta(sugerencias[sel]); return; }
      if (e.key === 'Escape') { setTexto((t) => t.replace(/\/[a-z0-9_-]*$/, '')); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if ((texto.trim() || adjunto) && !enviar.isPending) enviar.mutate();
    }
  }

  function onChange(v: string) {
    setTexto(v);
    const ahora = Date.now();
    if (modo === 'responder' && ahora - ultimoTyping.current > 2500) { ultimoTyping.current = ahora; emitir('conversacion:escribiendo', { conversacion_id: conv.conversacion_id }); }
  }

  const bloqueadoWa = modo === 'responder' && conv.canal === 'whatsapp' && !ventana.abierta;
  const nota = modo === 'nota';

  return (
    <div className="border-t border-ink-200/70 bg-white px-4 pb-4 pt-2">
      {/* Aviso de ventana */}
      {modo === 'responder' && (
        !ventana.abierta ? (
          <div className={cn('mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs', ventana.humanAgent ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700')}>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              {conv.canal === 'whatsapp' ? 'Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite enviar una plantilla aprobada.'
                : ventana.humanAgent ? 'Ventana de 24 h vencida: se enviará con la etiqueta HUMAN_AGENT (solo respuestas humanas, hasta 7 días).'
                : `Fuera de la ventana de ${ventana.ventana} h de ${CANAL_INFO[conv.canal].label}: el cliente debe escribir primero.`}
            </span>
            {conv.canal === 'whatsapp' && <Button tamano="xs" variante="secundario" icono={<LayoutTemplate className="h-3.5 w-3.5" />} onClick={() => setPlantillas(true)}>Enviar plantilla</Button>}
          </div>
        ) : (
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-ink-400">
            <Clock className="h-3 w-3" />
            Ventana de {CANAL_INFO[conv.canal].label} abierta · {Math.floor(Math.floor(ventana.horasRestantes * 60) / 60)} h {Math.floor(ventana.horasRestantes * 60) % 60} min restantes
            {conv.canal === 'tiktok' && ' · máx. 10 mensajes seguidos sin respuesta'}
          </div>
        )
      )}

      <div className={cn('relative rounded-xl border shadow-xs transition-colors focus-within:ring-4',
        nota ? 'border-amber-300 bg-amber-50/50 focus-within:ring-amber-500/10' : 'border-ink-200 focus-within:border-brand-400 focus-within:ring-brand-500/10')}>
        {/* Pestañas */}
        <div className="flex items-center gap-1 px-2 pt-1.5">
          <button onClick={() => setModo('responder')} className={cn('rounded-md px-2 py-1 text-xs font-medium', !nota ? 'bg-ink-100 text-ink-900' : 'text-ink-500 hover:text-ink-800')}>Responder</button>
          <button onClick={() => setModo('nota')} className={cn('flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium', nota ? 'bg-amber-100 text-amber-800' : 'text-ink-500 hover:text-ink-800')}><StickyNote className="h-3 w-3" />Nota interna</button>
          <span className="ml-auto hidden whitespace-nowrap pr-1 text-[11px] text-ink-400 2xl:block"><span className="kbd">/</span> respuestas rápidas · <span className="kbd">Enter</span> enviar · <span className="kbd">Shift+Enter</span> salto</span>
        </div>

        {/* Sugerencias de respuestas rápidas */}
        {sugerencias.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop animate-pop-in">
            <p className="flex items-center gap-1.5 border-b border-ink-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400"><Zap className="h-3 w-3" />Respuestas rápidas</p>
            {sugerencias.map((r, i) => (
              <button key={r.respuesta_id} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); usarRespuesta(r); }}
                className={cn('flex w-full items-start gap-3 px-3 py-2 text-left', i === sel ? 'bg-brand-50' : 'hover:bg-ink-50')}>
                <span className="mt-0.5 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-600">/{r.atajo}</span>
                <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-ink-800">{r.titulo}</span><span className="block truncate text-xs text-ink-500">{r.contenido}</span></span>
              </button>
            ))}
          </div>
        )}

        {adjunto && (
          <div className="mx-3 mt-2 flex items-center gap-2.5 rounded-lg border border-ink-200 bg-ink-50 p-2">
            {adjunto.tipo === 'imagen'
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={adjunto.url} alt="" className="h-10 w-10 rounded object-cover" />
              : <span className="flex h-10 w-10 items-center justify-center rounded bg-white text-brand-600"><FileText className="h-5 w-5" /></span>}
            <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{adjunto.nombre}</p><p className="text-[11px] text-ink-500">{(adjunto.tamano / 1024).toFixed(0)} KB · {adjunto.tipo}</p></div>
            <button onClick={() => setAdjunto(null)} className="rounded p-1 text-ink-400 hover:bg-ink-200 hover:text-ink-700"><X className="h-4 w-4" /></button>
          </div>
        )}

        <textarea ref={ta} rows={1} value={texto} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} disabled={bloqueadoWa}
          placeholder={bloqueadoWa ? 'Envía una plantilla para reabrir la conversación' : nota ? 'Escribe una nota que solo verá tu equipo…' : adjunto ? 'Agrega un comentario (opcional)…' : 'Escribe un mensaje o / para respuestas rápidas'}
          className="block max-h-[180px] min-h-[44px] w-full resize-none bg-transparent px-3 py-2.5 text-[14px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-400 disabled:cursor-not-allowed" />

        <div className="flex items-center gap-1 px-2 pb-2">
          <Popover side="top" trigger={<button disabled={bloqueadoWa} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-40" title="Emojis"><Smile className="h-[18px] w-[18px]" /></button>} className="w-[272px] p-2">
            <div className="grid grid-cols-8 gap-0.5">
              {EMOJIS.map((e) => <button key={e} onClick={() => { setTexto((t) => t + e); ta.current?.focus(); }} className="rounded-md p-1 text-lg hover:bg-ink-100">{e}</button>)}
            </div>
          </Popover>
          {!nota && puedeAdjuntar && (
            <button disabled={subiendo || bloqueadoWa} onClick={() => archivo.current?.click()} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-40" title="Adjuntar archivo">
              {subiendo ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Paperclip className="h-[18px] w-[18px]" />}
            </button>
          )}
          <input ref={archivo} type="file" className="hidden" accept="image/*,video/mp4,audio/*,application/pdf,.doc,.docx,.xls,.xlsx"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); e.target.value = ''; }} />
          {!nota && respuestas && respuestas.length > 0 && (
            <button disabled={bloqueadoWa} onClick={() => { setTexto((t) => (t && !t.endsWith(' ') ? t + ' /' : t + '/')); ta.current?.focus(); }}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-40" title="Respuestas rápidas"><Zap className="h-[18px] w-[18px]" /></button>
          )}
          {conv.canal === 'whatsapp' && !nota && (
            <button onClick={() => setPlantillas(true)} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="Enviar plantilla"><LayoutTemplate className="h-[18px] w-[18px]" /></button>
          )}
          <Button className={cn('ml-auto', nota && 'bg-amber-500 hover:bg-amber-600')} tamano="sm" disabled={(!texto.trim() && !adjunto) || bloqueadoWa}
            cargando={enviar.isPending} icono={nota ? <StickyNote className="h-4 w-4" /> : <Send className="h-4 w-4" />} onClick={() => enviar.mutate()}>
            {nota ? 'Guardar nota' : 'Enviar'}
          </Button>
        </div>
      </div>
      {plantillas && <EnviarPlantilla conv={conv} onClose={() => setPlantillas(false)} />}
    </div>
  );
}

function EnviarPlantilla({ conv, onClose }: { conv: ConversacionFila; onClose: () => void }) {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['plantillas', conv.canal_id], queryFn: () => api.get<{ plantillas: Plantilla[] }>(`/plantillas?canal_id=${conv.canal_id}`) });
  const aprobadas = lista.data?.plantillas.filter((p) => p.estado === 'aprobada') ?? [];
  const [id, setId] = useState<number | null>(null);
  const [manuales, setManuales] = useState<Record<string, string>>({});
  const p = aprobadas.find((x) => x.plantilla_id === id);
  const previa = useQuery({ queryKey: ['plantilla-previa', id, conv.contacto_id], enabled: !!id, queryFn: () => api.get<{ texto: string; parametros: string[]; faltantes: number[] }>(`/plantillas/${id}/vista-previa?contacto_id=${conv.contacto_id}`) });
  const manualesVars = p?.variables.filter((v) => v.origen === 'manual') ?? [];
  const texto = previa.data ? p!.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, i) => manuales[i] || previa.data!.parametros[Number(i) - 1] || '') : '';
  const enviar = useMutation({
    mutationFn: () => api.post<{ mensaje: Mensaje }>(`/conversaciones/${conv.conversacion_id}/plantilla`, { plantilla_id: id, manuales }),
    onSuccess: (r) => {
      if (r.mensaje.estado_envio === 'error') toast.error(r.mensaje.error ?? 'Error'); else toast.success('Plantilla enviada');
      qc.invalidateQueries({ queryKey: ['conversacion', conv.conversacion_id] }); onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Modal abierto onClose={onClose} titulo="Enviar plantilla de WhatsApp" descripcion="Las plantillas aprobadas por Meta se pueden enviar aunque la ventana de 24 h esté cerrada." ancho="lg"
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button disabled={!id} cargando={enviar.isPending} icono={<Send className="h-4 w-4" />} onClick={() => enviar.mutate()}>Enviar</Button></>}>
      {lista.isLoading ? <div className="flex justify-center py-8"><Spinner /></div> : !aprobadas.length ? (
        <p className="py-6 text-center text-sm text-ink-500">No hay plantillas aprobadas para esta cuenta. Créalas en <a href="/plantillas" className="text-brand-600 underline">Plantillas</a>.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div className="space-y-1">
            {aprobadas.map((x) => (
              <button key={x.plantilla_id} onClick={() => { setId(x.plantilla_id); setManuales({}); }}
                className={cn('w-full rounded-lg border px-3 py-2 text-left transition-colors', id === x.plantilla_id ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:bg-ink-50')}>
                <p className="truncate font-mono text-[12px] font-medium text-ink-800">{x.nombre}</p>
                <p className="text-[11px] text-ink-500">{x.categoria.toLowerCase()} · {x.idioma}</p>
              </button>
            ))}
          </div>
          <div className="rounded-xl bg-[#efeae2] p-4">
            {!p ? <p className="py-10 text-center text-sm text-ink-500">Elige una plantilla</p> : (
              <>
                <div className="max-w-[340px] rounded-xl rounded-tl-sm bg-white p-3 text-[13.5px] shadow-xs">
                  {p.encabezado && <p className="mb-1 font-semibold">{p.encabezado}</p>}
                  <p className="whitespace-pre-wrap">{texto || p.cuerpo}</p>
                  {p.pie && <p className="mt-1.5 text-xs text-ink-400">{p.pie}</p>}
                </div>
                {manualesVars.length > 0 && (
                  <div className="mt-4 space-y-2 rounded-lg bg-white/80 p-3">
                    {manualesVars.map((v) => (
                      <label key={v.indice} className="flex items-center gap-2 text-xs">
                        <span className="w-10 font-mono text-ink-500">{`{{${v.indice}}}`}</span>
                        <input className="input h-8 py-1 text-[13px]" placeholder={v.ejemplo} value={manuales[v.indice] ?? ''} onChange={(e) => setManuales({ ...manuales, [v.indice]: e.target.value })} />
                      </label>
                    ))}
                  </div>
                )}
                {previa.data?.faltantes.length ? <p className="mt-2 text-[11px] text-amber-700">Algunas variables no tienen dato en el contacto; se usará el ejemplo.</p> : null}
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
