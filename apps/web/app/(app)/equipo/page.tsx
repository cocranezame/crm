'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Hash, MessageSquarePlus, MessagesSquare, Search, SendHorizontal, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, horaLista, separadorDia } from '@/lib/utils';
import { useMe, useMiembros } from '@/hooks/datos';
import { useEvento } from '@/hooks/realtime';
import { Avatar, Button, Cargando, Field, Input, Modal, Spinner, Tabs, Vacio } from '@/components/ui';
import { format } from 'date-fns';

interface Participante { usuario_id: string; nombre: string; color: string }
interface ConvChat {
  conv_id: number; tipo: 'directo' | 'grupo'; nombre: string | null; ultima_actividad: string;
  participantes: Participante[]; ultimo: { contenido: string; autor_id: string; creado_en: string } | null; no_leidos: number;
}
interface MensajeChat { id: number; conv_id: number; autor_id: string; autor_nombre: string | null; autor_color: string | null; contenido: string; creado_en: string }

export default function EquipoPage() {
  return <Suspense fallback={<Cargando />}><ChatEquipo /></Suspense>;
}

function tituloConv(c: ConvChat, yo?: string) {
  if (c.tipo === 'grupo') return c.nombre ?? 'Grupo';
  return c.participantes.find((p) => p.usuario_id !== yo)?.nombre ?? 'Conversación';
}

function ChatEquipo() {
  const router = useRouter();
  const params = useSearchParams();
  const sel = params.get('c') ? Number(params.get('c')) : null;
  const { data: me } = useMe();
  const yo = me?.usuario.usuario_id;
  const [q, setQ] = useState('');
  const [nuevo, setNuevo] = useState(false);

  const convs = useQuery({
    queryKey: ['chat', 'conversaciones'],
    queryFn: () => api.get<{ conversaciones: ConvChat[] }>('/chat/conversaciones'),
    select: (d) => d.conversaciones,
  });
  const lista = (convs.data ?? []).filter((c) => !q.trim() || tituloConv(c, yo).toLowerCase().includes(q.trim().toLowerCase())
    || c.participantes.some((p) => p.nombre.toLowerCase().includes(q.trim().toLowerCase())));
  const actual = convs.data?.find((c) => c.conv_id === sel) ?? null;

  const abrir = (id: number) => router.replace(`/equipo?c=${id}`, { scroll: false });

  return (
    <div className="flex h-full min-h-0">
      {/* Lista */}
      <div className="flex w-[320px] shrink-0 flex-col border-r border-ink-200/70 bg-white">
        <div className="space-y-3 border-b border-ink-100 px-4 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">Chat del equipo</h1>
            <Button tamano="sm" variante="suave" icono={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setNuevo(true)}>Nuevo</Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar chats o personas" className="input h-9 pl-9 text-[13px]" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {convs.isLoading ? <Cargando /> : !convs.data?.length ? (
            <Vacio icono={<MessagesSquare className="h-5 w-5" />} titulo="Sin conversaciones" texto="Escribe a un compañero o crea un grupo para coordinar al equipo."
              accion={<Button tamano="sm" icono={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setNuevo(true)}>Nuevo chat</Button>} />
          ) : !lista.length ? (
            <p className="px-4 py-10 text-center text-[13px] text-ink-500">Sin resultados para “{q}”</p>
          ) : (
            <ul>
              {lista.map((c) => {
                const titulo = tituloConv(c, yo);
                const otro = c.participantes.find((p) => p.usuario_id !== yo);
                const activo = c.conv_id === sel;
                const autorUltimo = c.ultimo ? (c.ultimo.autor_id === yo ? 'Tú' : c.tipo === 'grupo' ? c.participantes.find((p) => p.usuario_id === c.ultimo!.autor_id)?.nombre.split(' ')[0] : null) : null;
                return (
                  <li key={c.conv_id}>
                    <button onClick={() => abrir(c.conv_id)}
                      className={cn('relative flex w-full items-center gap-3 border-b border-ink-100 px-4 py-3 text-left transition-colors', activo ? 'bg-brand-50/70' : 'hover:bg-ink-50')}>
                      {activo && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand-600" />}
                      {c.tipo === 'grupo' ? <AvatarGrupo p={c.participantes} /> : <Avatar nombre={otro?.nombre} color={otro?.color} size={40} />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={cn('truncate text-[13.5px]', c.no_leidos ? 'font-semibold text-ink-900' : 'font-medium text-ink-800')}>{titulo}</p>
                          <span className={cn('shrink-0 text-[11px]', c.no_leidos ? 'font-semibold text-brand-600' : 'text-ink-400')}>{horaLista(c.ultimo?.creado_en ?? c.ultima_actividad)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <p className={cn('flex-1 truncate text-[13px]', c.no_leidos ? 'text-ink-700' : 'text-ink-500')}>
                            {c.ultimo ? <>{autorUltimo && <span className="text-ink-400">{autorUltimo}: </span>}{c.ultimo.contenido}</> : <span className="italic text-ink-400">Sin mensajes todavía</span>}
                          </p>
                          {c.no_leidos > 0 && <span className="min-w-[20px] shrink-0 rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{c.no_leidos}</span>}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Conversación */}
      {sel && actual ? (
        <Conversacion key={sel} c={actual} yo={yo} />
      ) : sel && convs.isLoading ? (
        <div className="flex flex-1 items-center justify-center bg-canvas"><Spinner /></div>
      ) : (
        <div className="flex flex-1 items-center justify-center bg-canvas">
          <Vacio icono={<MessagesSquare className="h-5 w-5" />} titulo="Chat interno del equipo"
            texto="Coordina ventas y atención sin salir del CRM. Los mensajes llegan en tiempo real."
            accion={<Button icono={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setNuevo(true)}>Nuevo chat</Button>} />
        </div>
      )}
      {nuevo && <NuevoChat yo={yo} onClose={() => setNuevo(false)} onCreado={(id) => { setNuevo(false); abrir(id); }} />}
    </div>
  );
}

function AvatarGrupo({ p, size = 40 }: { p: Participante[]; size?: number }) {
  const [a, b] = p;
  if (!b) return <span className="flex shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700" style={{ width: size, height: size }}><Hash className="h-4 w-4" /></span>;
  const s = Math.round(size * 0.68);
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <Avatar nombre={a.nombre} color={a.color} size={s} className="absolute left-0 top-0" />
      <Avatar nombre={b.nombre} color={b.color} size={s} className="absolute bottom-0 right-0 ring-2 ring-white" />
    </span>
  );
}

// ── Conversación abierta ────────────────────────────────────────────────────

function Conversacion({ c, yo }: { c: ConvChat; yo?: string }) {
  const qc = useQueryClient();
  const key = ['chat', 'mensajes', c.conv_id];
  const msgs = useQuery({ queryKey: key, queryFn: () => api.get<{ items: MensajeChat[] }>(`/chat/conversaciones/${c.conv_id}/mensajes`) });
  const [texto, setTexto] = useState('');
  const fondo = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const leer = useMutation({
    mutationFn: () => api.post(`/chat/conversaciones/${c.conv_id}/leer`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['chat', 'no-leidos'] }); qc.invalidateQueries({ queryKey: ['chat', 'conversaciones'] }); },
  });
  useEffect(() => { if (c.no_leidos > 0 && document.visibilityState === 'visible') leer.mutate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [c.no_leidos, c.conv_id]);

  useEvento<{ conv_id: number; mensaje: MensajeChat }>('chat:mensaje', (d) => {
    if (d.conv_id !== c.conv_id) return;
    qc.setQueryData<{ items: MensajeChat[] }>(key, (old) => (old && !old.items.some((m) => m.id === d.mensaje.id) ? { ...old, items: [...old.items, d.mensaje] } : old));
    if (d.mensaje.autor_id !== yo && document.visibilityState === 'visible') leer.mutate();
  });

  const items = useMemo(() => msgs.data?.items ?? [], [msgs.data]);
  useEffect(() => { fondo.current?.scrollIntoView({ block: 'end' }); }, [items.length]);
  useEffect(() => { ta.current?.focus(); }, [c.conv_id]);

  const enviar = useMutation({
    mutationFn: (contenido: string) => api.post<{ mensaje: MensajeChat }>(`/chat/conversaciones/${c.conv_id}/mensajes`, { contenido }),
    onSuccess: (r) => {
      qc.setQueryData<{ items: MensajeChat[] }>(key, (old) => (old && !old.items.some((m) => m.id === r.mensaje.id) ? { ...old, items: [...old.items, r.mensaje] } : old));
      qc.invalidateQueries({ queryKey: ['chat', 'conversaciones'] });
    },
    onError: (e, contenido) => { toast.error((e as Error).message); setTexto(contenido); },
  });

  function mandar() {
    const t = texto.trim();
    if (!t || enviar.isPending) return;
    setTexto('');
    enviar.mutate(t);
  }

  // Autoajuste del alto del textarea
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [texto]);

  const titulo = tituloConv(c, yo);
  const otro = c.participantes.find((p) => p.usuario_id !== yo);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-canvas">
      <div className="flex items-center gap-3 border-b border-ink-200/70 bg-white px-5 py-3">
        {c.tipo === 'grupo' ? <AvatarGrupo p={c.participantes} size={38} /> : <Avatar nombre={otro?.nombre} color={otro?.color} size={38} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink-900">{titulo}</p>
          <p className="truncate text-xs text-ink-500">
            {c.tipo === 'grupo' ? <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.participantes.length} miembros · {c.participantes.map((p) => (p.usuario_id === yo ? 'Tú' : p.nombre.split(' ')[0])).join(', ')}</span> : 'Mensaje directo'}
          </p>
        </div>
        {c.tipo === 'grupo' && (
          <div className="flex -space-x-2">
            {c.participantes.slice(0, 5).map((p) => <Avatar key={p.usuario_id} nombre={p.nombre} color={p.color} size={26} className="ring-2 ring-white" />)}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {msgs.isLoading ? <Cargando /> : !items.length ? (
          <div className="flex h-full items-center justify-center">
            <Vacio icono={<MessagesSquare className="h-5 w-5" />} titulo="Empieza la conversación" texto={c.tipo === 'grupo' ? `Saluda al grupo ${titulo}.` : `Envía el primer mensaje a ${titulo}.`} />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-0.5">
            {items.map((m, i) => {
              const prev = items[i - 1];
              const nuevoDia = !prev || new Date(prev.creado_en).toDateString() !== new Date(m.creado_en).toDateString();
              const agrupado = !nuevoDia && prev && prev.autor_id === m.autor_id && new Date(m.creado_en).getTime() - new Date(prev.creado_en).getTime() < 5 * 60_000;
              const mio = m.autor_id === yo;
              return (
                <div key={m.id}>
                  {nuevoDia && (
                    <div className="my-4 flex items-center justify-center">
                      <span className="rounded-full border border-ink-200/80 bg-white px-3 py-0.5 text-[11px] font-medium text-ink-500 shadow-xs first-letter:uppercase">{separadorDia(m.creado_en)}</span>
                    </div>
                  )}
                  <div className={cn('flex items-end gap-2', mio ? 'justify-end' : 'justify-start', !agrupado && 'mt-3')}>
                    {!mio && (agrupado ? <span className="w-7 shrink-0" /> : <Avatar nombre={m.autor_nombre} color={m.autor_color} size={28} className="mb-0.5" />)}
                    <div className={cn('max-w-[72%]', mio && 'items-end')}>
                      {!mio && !agrupado && c.tipo === 'grupo' && <p className="mb-0.5 ml-1 text-[11px] font-semibold" style={{ color: m.autor_color ?? undefined }}>{m.autor_nombre}</p>}
                      <div className={cn('group relative whitespace-pre-wrap break-words px-3 py-1.5 text-[13.5px] leading-relaxed shadow-xs animate-pop-in',
                        mio ? 'rounded-2xl rounded-br-md bg-brand-600 text-white' : 'rounded-2xl rounded-bl-md border border-ink-200/70 bg-white text-ink-800')}>
                        {m.contenido}
                        <span className={cn('ml-2 inline-block translate-y-0.5 text-[10px]', mio ? 'text-brand-200' : 'text-ink-400')}>{format(new Date(m.creado_en), 'HH:mm')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={fondo} />
          </div>
        )}
      </div>

      <div className="border-t border-ink-200/70 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 shadow-xs transition-colors focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
          <textarea ref={ta} value={texto} rows={1} maxLength={4000} onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); mandar(); } }}
            placeholder={`Escribe a ${titulo}…`} className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none" />
          <Button tamano="icono-sm" className="mb-0.5 h-8 w-8" onClick={mandar} disabled={!texto.trim()} cargando={enviar.isPending} aria-label="Enviar">
            {!enviar.isPending && <SendHorizontal className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-ink-400"><span className="kbd">Enter</span> para enviar · <span className="kbd">Shift + Enter</span> nueva línea</p>
      </div>
    </div>
  );
}

// ── Nuevo chat ──────────────────────────────────────────────────────────────

function NuevoChat({ yo, onClose, onCreado }: { yo?: string; onClose: () => void; onCreado: (id: number) => void }) {
  const qc = useQueryClient();
  const { data } = useMiembros();
  const miembros = (data?.miembros ?? []).filter((m) => m.activo && m.usuario_id !== yo);
  const [tipo, setTipo] = useState<'directo' | 'grupo'>('directo');
  const [q, setQ] = useState('');
  const [nombre, setNombre] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [creando, setCreando] = useState<string | null>(null);
  const filtrados = miembros.filter((m) => !q.trim() || m.nombre.toLowerCase().includes(q.trim().toLowerCase()) || m.email.includes(q.trim().toLowerCase()));

  async function crear(body: Record<string, unknown>, marca: string) {
    setCreando(marca);
    try {
      const r = await api.post<{ conv_id: number }>('/chat/conversaciones', body);
      qc.invalidateQueries({ queryKey: ['chat', 'conversaciones'] });
      if (body.tipo === 'grupo') toast.success('Grupo creado');
      onCreado(r.conv_id);
    } catch (e) { toast.error((e as Error).message); } finally { setCreando(null); }
  }

  return (
    <Modal abierto onClose={onClose} titulo="Nuevo chat" ancho="md"
      pie={tipo === 'grupo' ? <>
        <Button variante="secundario" onClick={onClose}>Cancelar</Button>
        <Button disabled={!nombre.trim() || !sel.length} cargando={creando === 'grupo'} onClick={() => crear({ tipo: 'grupo', nombre: nombre.trim(), usuario_ids: sel }, 'grupo')}>
          Crear grupo{sel.length ? ` (${sel.length + 1})` : ''}
        </Button>
      </> : undefined}>
      <Tabs<'directo' | 'grupo'> valor={tipo} onChange={setTipo} className="mb-4 w-full [&>button]:flex-1 [&>button]:justify-center"
        opciones={[{ valor: 'directo', label: 'Mensaje directo' }, { valor: 'grupo', label: 'Grupo' }]} />
      {tipo === 'grupo' && (
        <Field label="Nombre del grupo" required className="mb-4">
          <Input autoFocus value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Equipo de ventas" />
        </Field>
      )}
      <Input icono={<Search className="h-4 w-4" />} placeholder="Buscar compañero" value={q} onChange={(e) => setQ(e.target.value)} className="h-9" autoFocus={tipo === 'directo'} />
      <ul className="mt-3 max-h-[320px] space-y-0.5 overflow-y-auto">
        {!miembros.length ? <p className="py-8 text-center text-[13px] text-ink-500">Aún no hay otros miembros en el equipo.</p>
          : !filtrados.length ? <p className="py-8 text-center text-[13px] text-ink-500">Sin resultados</p>
            : filtrados.map((m) => {
              const on = sel.includes(m.usuario_id);
              return (
                <li key={m.usuario_id}>
                  <button type="button" disabled={!!creando}
                    onClick={() => (tipo === 'directo' ? crear({ tipo: 'directo', usuario_id: m.usuario_id }, m.usuario_id) : setSel((s) => (on ? s.filter((x) => x !== m.usuario_id) : [...s, m.usuario_id])))}
                    className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors', on ? 'bg-brand-50' : 'hover:bg-ink-50')}>
                    <Avatar nombre={m.nombre} color={m.color} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink-900">{m.nombre}</span>
                      <span className="block truncate text-[12px] text-ink-500">{m.email}</span>
                    </span>
                    <span className="text-[11px] capitalize text-ink-400">{m.rol}</span>
                    {tipo === 'grupo' ? (
                      <span className={cn('flex h-5 w-5 items-center justify-center rounded-md border transition-colors', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300')}>{on && <Check className="h-3.5 w-3.5" />}</span>
                    ) : creando === m.usuario_id ? <Spinner className="h-4 w-4" /> : null}
                  </button>
                </li>
              );
            })}
      </ul>
    </Modal>
  );
}
