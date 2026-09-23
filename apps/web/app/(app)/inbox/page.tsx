'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Inbox as InboxIcon, CheckCircle2, RotateCcw, Clock3, UserPlus, PanelRightClose, PanelRightOpen, MessageSquareDashed, ChevronDown, FlaskConical, Hand } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { cn, horaLista, separadorDia, telefonoBonito } from '@/lib/utils';
import type { Canal, ConversacionFila, Mensaje } from '@/lib/types';
import { useCanales, useEtiquetas, useMe, useMiembros } from '@/hooks/datos';
import { useEvento } from '@/hooks/realtime';
import { Avatar, Button, Cargando, EtiquetaChip, Menu, Select, Spinner, Tabs, Tooltip, Vacio } from '@/components/ui';
import { CANAL_INFO, CanalPunto, IconoCanal } from '@/components/crm/canal';
import { Burbuja } from '@/components/inbox/burbuja';
import { Composer } from '@/components/inbox/composer';
import { PanelContacto } from '@/components/inbox/panel-contacto';

type Bandeja = 'mias' | 'sin_asignar' | 'todas';

export default function InboxPage() {
  return <Suspense fallback={<Cargando />}><Inbox /></Suspense>;
}

function nombreConv(c: Pick<ConversacionFila, 'contacto_nombre' | 'nombre_canal' | 'username' | 'contacto_telefono' | 'identidad'>) {
  return c.contacto_nombre || c.nombre_canal || (c.username ? `@${c.username}` : null) || telefonoBonito(c.contacto_telefono) || c.identidad;
}

function Inbox() {
  const router = useRouter();
  const params = useSearchParams();
  const seleccion = params.get('c') ? Number(params.get('c')) : null;
  const [bandeja, setBandeja] = useState<Bandeja>('todas');
  const [estado, setEstado] = useState('abiertas');
  const [canal, setCanal] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [panel, setPanel] = useState(true);
  useEffect(() => { const t = setTimeout(() => setBusqueda(q), 250); return () => clearTimeout(t); }, [q]);

  const { data: etiquetas } = useEtiquetas();
  const contadores = useQuery({ queryKey: ['contadores'], queryFn: () => api.get<{ mias: number; sin_asignar: number; todas: number }>('/conversaciones/contadores') });
  const lista = useInfiniteQuery({
    queryKey: ['conversaciones', bandeja, estado, canal, etiqueta, busqueda],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<{ items: ConversacionFila[]; siguiente: string | null }>(`/conversaciones${qs({ bandeja, estado, canal, etiqueta_id: etiqueta, q: busqueda, antes: pageParam })}`),
    getNextPageParam: (p) => p.siguiente,
  });
  const items = lista.data?.pages.flatMap((p) => p.items) ?? [];

  const abrir = (id: number) => router.replace(`/inbox?c=${id}`, { scroll: false });

  return (
    <div className="flex h-full min-h-0">
      {/* ── Lista ── */}
      <div className="flex w-[360px] shrink-0 flex-col border-r border-ink-200/70 bg-white">
        <div className="space-y-3 border-b border-ink-100 px-4 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">Bandeja</h1>
            <Select value={estado} onChange={(e) => setEstado(e.target.value)} className="h-8 w-[132px] py-1 text-[13px]">
              <option value="abiertas">Abiertas</option>
              <option value="pendiente">Pendientes</option>
              <option value="resuelta">Resueltas</option>
              <option value="todas">Todas</option>
            </Select>
          </div>
          <Tabs<Bandeja> valor={bandeja} onChange={setBandeja} className="w-full [&>button]:flex-1 [&>button]:justify-center" opciones={[
            { valor: 'mias', label: 'Mías', contador: contadores.data?.mias },
            { valor: 'sin_asignar', label: 'Sin asignar', contador: contadores.data?.sin_asignar },
            { valor: 'todas', label: 'Todas', contador: contadores.data?.todas },
          ]} />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono o mensaje" className="input h-9 pl-9 text-[13px]" />
          </div>
          <div className="flex gap-2">
            <Select value={canal} onChange={(e) => setCanal(e.target.value)} className="h-8 py-1 text-xs">
              <option value="">Todos los canales</option>
              {(['whatsapp', 'messenger', 'tiktok'] as Canal[]).map((c) => <option key={c} value={c}>{CANAL_INFO[c].label}</option>)}
            </Select>
            <Select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} className="h-8 py-1 text-xs">
              <option value="">Todas las etiquetas</option>
              {etiquetas?.map((t) => <option key={t.etiqueta_id} value={t.etiqueta_id}>{t.nombre}</option>)}
            </Select>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {lista.isLoading ? <Cargando /> : !items.length ? (
            <Vacio icono={<InboxIcon className="h-5 w-5" />} titulo="Sin conversaciones" texto={bandeja === 'mias' ? 'No tienes conversaciones asignadas con estos filtros.' : 'Cuando un cliente escriba por un canal conectado, aparecerá aquí.'} />
          ) : (
            <ul>
              {items.map((c) => <ItemConversacion key={c.conversacion_id} c={c} activo={c.conversacion_id === seleccion} onClick={() => abrir(c.conversacion_id)} />)}
              {lista.hasNextPage && (
                <li className="p-3"><Button variante="fantasma" tamano="sm" className="w-full" cargando={lista.isFetchingNextPage} onClick={() => lista.fetchNextPage()}>Cargar más</Button></li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* ── Chat ── */}
      {seleccion ? (
        <Chat key={seleccion} id={seleccion} panel={panel} onPanel={() => setPanel(!panel)} />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-canvas">
          <SinSeleccion />
        </div>
      )}
    </div>
  );
}

function ItemConversacion({ c, activo, onClick }: { c: ConversacionFila; activo: boolean; onClick: () => void }) {
  const nombre = nombreConv(c);
  return (
    <li>
      <button onClick={onClick}
        className={cn('relative flex w-full gap-3 border-b border-ink-100 px-4 py-3 text-left transition-colors',
          activo ? 'bg-brand-50/70' : 'hover:bg-ink-50')}>
        {activo && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand-600" />}
        <span className="relative mt-0.5 shrink-0"><Avatar nombre={nombre} size={40} /><CanalPunto canal={c.canal} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn('truncate text-[13.5px]', c.no_leidos ? 'font-semibold text-ink-900' : 'font-medium text-ink-800')}>{nombre}</p>
            <span className={cn('shrink-0 text-[11px]', c.no_leidos ? 'font-semibold text-brand-600' : 'text-ink-400')}>{horaLista(c.ultima_actividad)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p className={cn('flex-1 truncate text-[13px]', c.no_leidos ? 'text-ink-700' : 'text-ink-500')}>{c.ultimo_mensaje ?? 'Sin mensajes'}</p>
            {c.no_leidos > 0 && <span className="min-w-[20px] shrink-0 rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{c.no_leidos}</span>}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            {c.estado === 'pendiente' && <span className="chip bg-amber-100 text-amber-700"><Clock3 className="h-2.5 w-2.5" />Pendiente</span>}
            {c.estado === 'resuelta' && <span className="chip bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-2.5 w-2.5" />Resuelta</span>}
            {c.etiquetas.slice(0, 2).map((t) => <EtiquetaChip key={t.etiqueta_id} nombre={t.nombre} color={t.color} size="xs" />)}
            <span className="ml-auto">
              {c.asignado_nombre ? <Tooltip texto={`Asignada a ${c.asignado_nombre}`}><span><Avatar nombre={c.asignado_nombre} color={c.asignado_color} size={18} /></span></Tooltip>
                : <span className="text-[10px] font-medium text-ink-400">Sin asignar</span>}
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}

function SinSeleccion() {
  const { data } = useCanales();
  const sandbox = data?.canales.find((c) => c.sandbox && c.activo);
  return (
    <Vacio icono={<MessageSquareDashed className="h-5 w-5" />} titulo="Elige una conversación"
      texto={<>Responde a tus clientes de WhatsApp, Messenger y TikTok desde aquí. Los mensajes nuevos llegan en tiempo real.
        {sandbox && <span className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-400"><FlaskConical className="h-3.5 w-3.5" />Prueba el flujo con el simulador en Configuración → Canales.</span>}</>} />
  );
}

// ── Conversación abierta ────────────────────────────────────────────────────

function Chat({ id, panel, onPanel }: { id: number; panel: boolean; onPanel: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: equipo } = useMiembros();
  const conv = useQuery({ queryKey: ['conversacion', id, 'info'], queryFn: () => api.get<{ conversacion: ConversacionFila }>(`/conversaciones/${id}`) });
  const mensajes = useQuery({ queryKey: ['conversacion', id, 'mensajes'], queryFn: () => api.get<{ items: Mensaje[]; hay_mas: boolean }>(`/conversaciones/${id}/mensajes`) });
  const [antiguos, setAntiguos] = useState<Mensaje[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [escribiendo, setEscribiendo] = useState<string | null>(null);
  const fondo = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pegadoAbajo = useRef(true);

  useEffect(() => { if (mensajes.data && !antiguos.length) setHayMas(mensajes.data.hay_mas); }, [mensajes.data, antiguos.length]);

  // Marcar como leída al abrir y con cada mensaje nuevo mientras está abierta
  const leer = useMutation({ mutationFn: () => api.post(`/conversaciones/${id}/leer`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['contadores'] }); } });
  const noLeidos = conv.data?.conversacion.no_leidos ?? 0;
  useEffect(() => { if (noLeidos > 0 && document.visibilityState === 'visible') leer.mutate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [noLeidos, id]);

  useEvento<{ conversacion_id: number; mensaje: Mensaje }>('mensaje:nuevo', (d) => {
    if (d.conversacion_id !== id) return;
    qc.setQueryData<{ items: Mensaje[]; hay_mas: boolean }>(['conversacion', id, 'mensajes'], (old) =>
      old && !old.items.some((m) => m.mensaje_id === d.mensaje.mensaje_id) ? { ...old, items: [...old.items, d.mensaje] } : old);
    if (d.mensaje.direccion === 'entrante') setEscribiendo(null);
  });
  useEvento<{ conversacion_id: number; mensaje: Mensaje }>('mensaje:actualizado', (d) => {
    if (d.conversacion_id !== id) return;
    qc.setQueryData<{ items: Mensaje[]; hay_mas: boolean }>(['conversacion', id, 'mensajes'], (old) =>
      old ? { ...old, items: old.items.map((m) => (m.mensaje_id === d.mensaje.mensaje_id ? d.mensaje : m)) } : old);
  });
  useEvento<{ conversacion_id: number; mensaje_ids: number[]; estado: string }>('mensaje:estado', (d) => {
    if (d.conversacion_id !== id) return;
    const ids = new Set(d.mensaje_ids);
    qc.setQueryData<{ items: Mensaje[]; hay_mas: boolean }>(['conversacion', id, 'mensajes'], (old) =>
      old ? { ...old, items: old.items.map((m) => (ids.has(m.mensaje_id) ? { ...m, estado_envio: d.estado } : m)) } : old);
  });
  useEvento<{ conversacion_id: number; usuario_id: string }>('conversacion:escribiendo', (d) => {
    if (d.conversacion_id !== id || d.usuario_id === me?.usuario.usuario_id) return;
    const n = equipo?.miembros.find((m) => m.usuario_id === d.usuario_id)?.nombre ?? 'Alguien del equipo';
    setEscribiendo(n);
    setTimeout(() => setEscribiendo(null), 4000);
  });

  const todos = useMemo(() => [...antiguos, ...(mensajes.data?.items ?? [])], [antiguos, mensajes.data]);

  useEffect(() => {
    if (pegadoAbajo.current) fondo.current?.scrollIntoView({ block: 'end' });
  }, [todos.length]);

  async function cargarAntiguos() {
    const primero = todos[0];
    if (!primero) return;
    const el = scroller.current;
    const alto = el?.scrollHeight ?? 0;
    const r = await api.get<{ items: Mensaje[]; hay_mas: boolean }>(`/conversaciones/${id}/mensajes?antes=${primero.mensaje_id}`);
    pegadoAbajo.current = false;
    setAntiguos((a) => [...r.items, ...a]);
    setHayMas(r.hay_mas);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - alto; });
  }

  const accion = useMutation({
    mutationFn: (b: Record<string, unknown>) => api.patch(`/conversaciones/${id}`, b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conversacion', id] }); qc.invalidateQueries({ queryKey: ['conversaciones'] }); qc.invalidateQueries({ queryKey: ['contadores'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const tomar = useMutation({
    mutationFn: () => api.post(`/conversaciones/${id}/tomar`),
    onSuccess: () => { toast.success('Conversación asignada a ti'); qc.invalidateQueries({ queryKey: ['conversacion', id] }); qc.invalidateQueries({ queryKey: ['conversaciones'] }); qc.invalidateQueries({ queryKey: ['contadores'] }); },
  });

  if (conv.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (!conv.data) return <div className="flex flex-1 items-center justify-center"><Vacio titulo="Conversación no encontrada" /></div>;
  const c = conv.data.conversacion;
  const nombre = nombreConv(c);
  const esMia = c.asignado_a === me?.usuario.usuario_id;

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        {/* Cabecera */}
        <div className="flex items-center gap-3 border-b border-ink-200/70 bg-white px-5 py-3">
          <span className="relative"><Avatar nombre={nombre} size={38} /><CanalPunto canal={c.canal} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-ink-900">{nombre}</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-ink-500">
              <IconoCanal canal={c.canal} size={11} />{c.canal_nombre}
              {c.sandbox && <span className="chip bg-violet-100 text-violet-700"><FlaskConical className="h-2.5 w-2.5" />prueba</span>}
              <span className="text-ink-300">·</span>{c.canal === 'whatsapp' ? `+${c.identidad}` : c.username ? `@${c.username}` : c.identidad}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!esMia && <Button tamano="sm" variante="suave" icono={<Hand className="h-4 w-4" />} cargando={tomar.isPending} onClick={() => tomar.mutate()}>Tomar</Button>}
            <Menu trigger={
              <button className="flex h-8 items-center gap-2 rounded-lg border border-ink-200 bg-white px-2.5 text-[13px] text-ink-700 shadow-xs hover:bg-ink-50">
                {c.asignado_nombre ? <><Avatar nombre={c.asignado_nombre} color={c.asignado_color} size={20} />{c.asignado_nombre.split(' ')[0]}</> : <><UserPlus className="h-4 w-4 text-ink-400" />Asignar</>}
                <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
              </button>
            } items={[
              ...(equipo?.miembros.filter((m) => m.activo).map((m) => ({
                label: <span className="flex items-center gap-2"><Avatar nombre={m.nombre} color={m.color} size={20} />{m.nombre}{m.usuario_id === c.asignado_a && ' ✓'}</span>,
                onClick: () => accion.mutate({ asignado_a: m.usuario_id }),
              })) ?? []),
              { separador: true, label: '' },
              { label: 'Quitar asignación', onClick: () => accion.mutate({ asignado_a: null }), disabled: !c.asignado_a },
            ]} />
            {c.estado !== 'resuelta' ? (
              <>
                {c.estado !== 'pendiente' && <Tooltip texto="Marcar como pendiente"><Button tamano="icono" variante="secundario" className="h-8 w-8" onClick={() => accion.mutate({ estado: 'pendiente' })}><Clock3 className="h-4 w-4" /></Button></Tooltip>}
                <Button tamano="sm" variante="secundario" className="text-emerald-700" icono={<CheckCircle2 className="h-4 w-4" />} onClick={() => accion.mutate({ estado: 'resuelta' })}>Resolver</Button>
              </>
            ) : (
              <Button tamano="sm" variante="secundario" icono={<RotateCcw className="h-4 w-4" />} onClick={() => accion.mutate({ estado: 'abierta' })}>Reabrir</Button>
            )}
            <Tooltip texto={panel ? 'Ocultar panel del contacto' : 'Mostrar panel del contacto'}>
              <Button tamano="icono" variante="fantasma" className="h-8 w-8" onClick={onPanel}>{panel ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}</Button>
            </Tooltip>
          </div>
        </div>

        {/* Mensajes */}
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
          onScroll={(e) => { const el = e.currentTarget; pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}
          style={{ backgroundImage: 'radial-gradient(#e2e8f0 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
          {mensajes.isLoading ? <Cargando /> : (
            <div className="mx-auto max-w-3xl">
              {hayMas && <div className="mb-3 flex justify-center"><Button tamano="xs" variante="secundario" onClick={cargarAntiguos}>Cargar mensajes anteriores</Button></div>}
              {todos.map((m, i) => {
                const prev = todos[i - 1];
                const nuevoDia = !prev || new Date(prev.enviado_en).toDateString() !== new Date(m.enviado_en).toDateString();
                const agrupado = !nuevoDia && !!prev && prev.direccion === m.direccion && prev.autor_id === m.autor_id && prev.autor_tipo === m.autor_tipo
                  && new Date(m.enviado_en).getTime() - new Date(prev.enviado_en).getTime() < 5 * 60_000;
                return (
                  <div key={m.mensaje_id}>
                    {nuevoDia && (
                      <div className="my-4 flex items-center justify-center">
                        <span className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[11px] font-medium capitalize text-ink-500 shadow-xs">{separadorDia(m.enviado_en)}</span>
                      </div>
                    )}
                    <Burbuja m={m} agrupado={agrupado} />
                  </div>
                );
              })}
              {!todos.length && <p className="py-10 text-center text-sm text-ink-500">Aún no hay mensajes en esta conversación.</p>}
              {escribiendo && <p className="mt-3 text-right text-xs italic text-ink-400">{escribiendo} está escribiendo…</p>}
              <div ref={fondo} />
            </div>
          )}
        </div>

        <Composer conv={c} />
      </div>

      {panel && (
        <aside className="w-[320px] shrink-0 border-l border-ink-200/70 bg-white">
          <PanelContacto contactoId={c.contacto_id} conversacionId={c.conversacion_id} />
        </aside>
      )}
    </>
  );
}

