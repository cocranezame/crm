'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter, closestCorners, pointerWithin, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Search, Settings2, Trophy, XCircle, Clock, AlertTriangle, KanbanSquare, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { cn, hace, moneda } from '@/lib/utils';
import type { Etapa, NegocioTarjeta, Pipeline } from '@/lib/types';
import { useEtiquetas, useMiembros, usePipelines, usePuede } from '@/hooks/datos';
import { Avatar, Button, Cargando, EtiquetaChip, Field, Input, Modal, Select, Tooltip, Vacio } from '@/components/ui';
import { IconoCanal } from '@/components/crm/canal';
import { ContactoPicker } from '@/components/crm/contacto-picker';
import { NegocioDrawer } from '@/components/crm/negocio-drawer';

type Columnas = Record<number, NegocioTarjeta[]>;
const cid = (n: number) => `n-${n}`;
const eid = (e: number) => `e-${e}`;

export default function TableroPage() {
  const { id } = useParams<{ id: string }>();
  const pipelineId = Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const esAdmin = usePuede('admin');
  const { data: pipelines } = usePipelines();
  const { data: etiquetas } = useEtiquetas();
  const { data: equipo } = useMiembros();

  const [q, setQ] = useState('');
  const [asignado, setAsignado] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [busqueda, setBusqueda] = useState('');
  useEffect(() => { const t = setTimeout(() => setBusqueda(q), 250); return () => clearTimeout(t); }, [q]);

  const tablero = useQuery({
    queryKey: ['tablero', pipelineId, busqueda, asignado, etiqueta],
    queryFn: () => api.get<{ pipeline: Pipeline; etapas: Etapa[]; negocios: NegocioTarjeta[] }>(`/pipelines/${pipelineId}/tablero${qs({ q: busqueda, asignado, etiqueta_id: etiqueta })}`),
  });

  // Copia local para arrastrar sin esperar al servidor
  const [cols, setCols] = useState<Columnas>({});
  const arrastrando = useRef(false);
  useEffect(() => {
    if (!tablero.data || arrastrando.current) return;
    const c: Columnas = {};
    for (const e of tablero.data.etapas) c[e.etapa_id] = [];
    for (const n of tablero.data.negocios) (c[n.etapa_id] ??= []).push(n);
    for (const k in c) c[k].sort((a, b) => a.posicion - b.posicion);
    setCols(c);
  }, [tablero.data]);

  const colsRef = useRef(cols);
  colsRef.current = cols;
  const [activo, setActivo] = useState<NegocioTarjeta | null>(null);
  const [origen, setOrigen] = useState<number | null>(null);
  const [abierto, setAbierto] = useState<NegocioTarjeta | null>(null);
  const [nuevo, setNuevo] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const mover = useMutation({
    mutationFn: (d: { negocio_id: number; etapa_id: number; posicion: number }) => api.patch(`/negocios/${d.negocio_id}/mover`, { etapa_id: d.etapa_id, posicion: d.posicion }),
    onError: (e) => { toast.error((e as Error).message); qc.invalidateQueries({ queryKey: ['tablero', pipelineId] }); },
    onSettled: () => { arrastrando.current = false; qc.invalidateQueries({ queryKey: ['pipelines'] }); },
  });

  // Si el puntero está dentro de una columna, gana esa columna (o su tarjeta más cercana).
  // closestCorners solo fallaba con columnas vacías: elegía tarjetas de la columna vecina.
  const colision: CollisionDetection = (args) => {
    const col = pointerWithin(args).find((c) => String(c.id).startsWith('e-'));
    if (col) {
      const ids = new Set((colsRef.current[Number(String(col.id).slice(2))] ?? []).map((n) => cid(n.negocio_id)));
      const tarjetas = args.droppableContainers.filter((d) => ids.has(String(d.id)));
      if (tarjetas.length) {
        const r = closestCenter({ ...args, droppableContainers: tarjetas });
        if (r.length) return r;
      }
      return [col];
    }
    return closestCorners(args);
  };

  function contenedorDe(itemId: string): number | null {
    if (itemId.startsWith('e-')) return Number(itemId.slice(2));
    const nid = Number(itemId.slice(2));
    for (const [k, lista] of Object.entries(colsRef.current)) if (lista.some((n) => n.negocio_id === nid)) return Number(k);
    return null;
  }

  function onDragStart(e: DragStartEvent) {
    arrastrando.current = true;
    const c = contenedorDe(String(e.active.id));
    setOrigen(c);
    setActivo(c !== null ? colsRef.current[c].find((n) => cid(n.negocio_id) === e.active.id) ?? null : null);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const de = contenedorDe(String(active.id));
    const a = contenedorDe(String(over.id));
    if (de === null || a === null || de === a) return;
    setCols((prev) => {
      const item = prev[de].find((n) => cid(n.negocio_id) === active.id);
      if (!item) return prev;
      const destino = prev[a];
      const idxOver = destino.findIndex((n) => cid(n.negocio_id) === over.id);
      const idx = idxOver >= 0 ? idxOver : destino.length;
      return {
        ...prev,
        [de]: prev[de].filter((n) => n.negocio_id !== item.negocio_id),
        [a]: [...destino.slice(0, idx), { ...item, etapa_id: a }, ...destino.slice(idx)],
      };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const item = activo;
    setActivo(null);
    if (!over || !item) { arrastrando.current = false; tablero.refetch(); return; }
    const a = contenedorDe(String(over.id));
    if (a === null) { arrastrando.current = false; return; }
    let lista = colsRef.current[a];
    const desde = lista.findIndex((n) => cid(n.negocio_id) === active.id);
    const hasta = over.id.toString().startsWith('e-') ? lista.length - 1 : lista.findIndex((n) => cid(n.negocio_id) === over.id);
    if (desde >= 0 && hasta >= 0 && desde !== hasta) lista = arrayMove(lista, desde, hasta);
    const idx = lista.findIndex((n) => n.negocio_id === item.negocio_id);
    const prev = lista[idx - 1]?.posicion;
    const next = lista[idx + 1]?.posicion;
    const posicion = prev !== undefined && next !== undefined ? (prev + next) / 2 : prev !== undefined ? prev + 1000 : next !== undefined ? next - 1000 : 1000;
    lista = lista.map((n) => (n.negocio_id === item.negocio_id ? { ...n, posicion, etapa_id: a } : n));
    setCols((c) => ({ ...c, [a]: lista }));
    if (origen === a && item.posicion === posicion) { arrastrando.current = false; return; }
    const etapa = tablero.data?.etapas.find((x) => x.etapa_id === a);
    if (origen !== a && etapa && etapa.tipo !== 'abierta') {
      toast.success(etapa.tipo === 'ganado' ? `🎉 ${item.contacto_nombre ?? 'Negocio'} marcado como ganado` : `${item.contacto_nombre ?? 'Negocio'} marcado como perdido`);
    }
    mover.mutate({ negocio_id: item.negocio_id, etapa_id: a, posicion });
  }

  const etapas = tablero.data?.etapas ?? [];
  const totalAbierto = useMemo(() => Object.values(cols).flat().filter((n) => !n.cerrado_en).reduce((s, n) => s + (n.monto ?? 0), 0), [cols]);
  const totalNegocios = Object.values(cols).flat().length;
  const activos = pipelines?.filter((p) => p.activo) ?? [];
  const hayFiltros = !!(q || asignado || etiqueta);

  return (
    <div className="flex h-full flex-col">
      {/* Cabecera */}
      <div className="border-b border-ink-200/70 bg-white px-6 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><KanbanSquare className="h-5 w-5" /></div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-ink-900">{tablero.data?.pipeline.nombre ?? 'Pipeline'}</h1>
              <p className="text-[13px] text-ink-500">{totalNegocios} negocios · {moneda(totalAbierto, true)} en curso</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {esAdmin && <Link href={`/config/pipelines?p=${pipelineId}`}><Button variante="secundario" icono={<Settings2 className="h-4 w-4" />}>Editar etapas</Button></Link>}
            <Button icono={<Plus className="h-4 w-4" />} onClick={() => setNuevo(etapas.find((e) => e.tipo === 'abierta')?.etapa_id ?? null)}>Nuevo negocio</Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="-mb-px flex gap-1 overflow-x-auto">
            {activos.map((p) => (
              <button key={p.pipeline_id} onClick={() => router.push(`/pipelines/${p.pipeline_id}`)}
                className={cn('flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-medium transition-colors',
                  p.pipeline_id === pipelineId ? 'border-brand-600 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800')}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />{p.nombre}
                <span className="rounded-full bg-ink-100 px-1.5 text-[11px] text-ink-500">{p.abiertos}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pb-2.5">
            <div className="w-56"><Input icono={<Search className="h-4 w-4" />} placeholder="Buscar negocio o contacto" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 text-[13px]" /></div>
            <div className="w-40">
              <Select value={asignado} onChange={(e) => setAsignado(e.target.value)} className="h-8 py-1 text-[13px]">
                <option value="">Todo el equipo</option>
                {equipo?.miembros.filter((m) => m.activo).map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nombre}</option>)}
              </Select>
            </div>
            <div className="w-36">
              <Select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} className="h-8 py-1 text-[13px]">
                <option value="">Etiquetas</option>
                {etiquetas?.map((t) => <option key={t.etiqueta_id} value={t.etiqueta_id}>{t.nombre}</option>)}
              </Select>
            </div>
            {hayFiltros && <Button tamano="sm" variante="fantasma" icono={<SlidersHorizontal className="h-3.5 w-3.5" />} onClick={() => { setQ(''); setAsignado(''); setEtiqueta(''); }}>Limpiar</Button>}
          </div>
        </div>
      </div>

      {/* Tablero */}
      {tablero.isLoading ? <Cargando /> : tablero.error ? <Vacio titulo="No se pudo cargar el pipeline" texto={(tablero.error as Error).message} /> : (
        <DndContext sensors={sensors} collisionDetection={colision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
          onDragCancel={() => { setActivo(null); arrastrando.current = false; tablero.refetch(); }}>
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
            {etapas.map((e) => (
              <Columna key={e.etapa_id} etapa={e} negocios={cols[e.etapa_id] ?? []} onAbrir={setAbierto} onNuevo={() => setNuevo(e.etapa_id)} />
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
            {activo && <Tarjeta n={activo} etapa={etapas.find((x) => x.etapa_id === activo.etapa_id)} flotando />}
          </DragOverlay>
        </DndContext>
      )}

      <NegocioDrawer negocioId={abierto?.negocio_id ?? null} conversacionId={abierto?.conversacion_id} onClose={() => setAbierto(null)} />
      {nuevo !== null && tablero.data && (
        <NuevoNegocio pipelineId={pipelineId} etapas={etapas} etapaInicial={nuevo} onClose={() => setNuevo(null)} />
      )}
    </div>
  );
}

// ── Columna ─────────────────────────────────────────────────────────────────

function Columna({ etapa, negocios, onAbrir, onNuevo }: { etapa: Etapa; negocios: NegocioTarjeta[]; onAbrir: (n: NegocioTarjeta) => void; onNuevo: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: eid(etapa.etapa_id) });
  const total = negocios.reduce((s, n) => s + (n.monto ?? 0), 0);
  const cerrada = etapa.tipo !== 'abierta';
  return (
    <div className="flex w-[292px] shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex min-w-0 items-center gap-2">
          {etapa.tipo === 'ganado' ? <Trophy className="h-4 w-4 text-emerald-600" /> : etapa.tipo === 'perdido' ? <XCircle className="h-4 w-4 text-red-500" />
            : <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: etapa.color }} />}
          <h3 className="truncate text-[13px] font-semibold text-ink-800">{etapa.nombre}</h3>
          <span className="rounded-full bg-ink-200/70 px-1.5 text-[11px] font-semibold text-ink-600">{negocios.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-ink-500">{moneda(total, true)}</span>
          {!cerrada && <button onClick={onNuevo} className="rounded-md p-1 text-ink-400 hover:bg-ink-200/60 hover:text-ink-700" title="Agregar negocio"><Plus className="h-3.5 w-3.5" /></button>}
        </div>
      </div>
      <div className="mx-1 mb-2 h-[3px] rounded-full" style={{ backgroundColor: etapa.color, opacity: 0.8 }} />
      <div ref={setNodeRef}
        className={cn('flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto rounded-xl p-1.5 transition-colors',
          isOver ? 'bg-brand-50 ring-2 ring-inset ring-brand-200' : cerrada ? 'bg-ink-100/60' : 'bg-ink-100/40')}>
        <SortableContext items={negocios.map((n) => cid(n.negocio_id))} strategy={verticalListSortingStrategy}>
          {negocios.map((n) => <TarjetaOrdenable key={n.negocio_id} n={n} etapa={etapa} onAbrir={onAbrir} />)}
        </SortableContext>
        {!negocios.length && <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-ink-200 py-8 text-xs text-ink-400">Arrastra negocios aquí</div>}
      </div>
    </div>
  );
}

function TarjetaOrdenable({ n, etapa, onAbrir }: { n: NegocioTarjeta; etapa: Etapa; onAbrir: (n: NegocioTarjeta) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cid(n.negocio_id) });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners}
      onClick={() => onAbrir(n)} className={cn('outline-none', isDragging && 'opacity-40')}>
      <Tarjeta n={n} etapa={etapa} />
    </div>
  );
}

function Tarjeta({ n, etapa, flotando }: { n: NegocioTarjeta; etapa?: Etapa; flotando?: boolean }) {
  const horas = (Date.now() - new Date(n.etapa_desde).getTime()) / 3_600_000;
  const vencido = etapa?.sla_horas && etapa.tipo === 'abierta' && horas > etapa.sla_horas;
  return (
    <div className={cn('group cursor-grab rounded-xl border bg-white p-3 transition-shadow active:cursor-grabbing',
      flotando ? 'rotate-[1.5deg] border-brand-300 shadow-lift' : 'border-ink-200/80 shadow-xs hover:border-ink-300 hover:shadow-card',
      n.cerrado_en && 'opacity-80')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink-900">{n.contacto_nombre ?? 'Sin nombre'}</p>
          {n.titulo && n.titulo !== n.contacto_nombre && <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{n.titulo}</p>}
        </div>
        {n.canales.length > 0 && (
          <div className="flex shrink-0 gap-0.5">
            {n.canales.map((c) => <IconoCanal key={c} canal={c} size={13} className="text-ink-400" />)}
          </div>
        )}
      </div>
      {n.etiquetas.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">{n.etiquetas.slice(0, 3).map((t) => <EtiquetaChip key={t.etiqueta_id} nombre={t.nombre} color={t.color} size="xs" />)}</div>
      )}
      <div className="mt-2.5 flex items-center justify-between">
        <span className={cn('text-[13px] font-semibold', n.monto ? 'text-ink-800' : 'text-ink-300')}>{n.monto ? moneda(n.monto, true) : 'S/ —'}</span>
        <div className="flex items-center gap-2">
          <Tooltip texto={vencido ? `Superó el SLA de ${etapa?.sla_horas} h en esta etapa` : 'Tiempo en esta etapa'}>
            <span className={cn('flex items-center gap-1 text-[11px]', vencido ? 'font-semibold text-amber-600' : 'text-ink-400')}>
              {vencido ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}{hace(n.etapa_desde)}
            </span>
          </Tooltip>
          {n.asignado_nombre ? <Tooltip texto={n.asignado_nombre}><span><Avatar nombre={n.asignado_nombre} color={n.asignado_color} size={22} /></span></Tooltip>
            : <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-dashed border-ink-300 text-[10px] text-ink-400">?</span>}
        </div>
      </div>
    </div>
  );
}

// ── Nuevo negocio ───────────────────────────────────────────────────────────

function NuevoNegocio({ pipelineId, etapas, etapaInicial, onClose }: { pipelineId: number; etapas: Etapa[]; etapaInicial: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: equipo } = useMiembros();
  const [contacto, setContacto] = useState<{ contacto_id: number; nombre: string | null } | null>(null);
  const [f, setF] = useState({ etapa_id: String(etapaInicial ?? etapas[0]?.etapa_id ?? ''), titulo: '', monto: '', asignado_a: '' });
  const crear = useMutation({
    mutationFn: () => api.post('/negocios', {
      contacto_id: contacto!.contacto_id, pipeline_id: pipelineId, etapa_id: Number(f.etapa_id),
      titulo: f.titulo || contacto!.nombre, monto: f.monto ? Number(f.monto) : null, asignado_a: f.asignado_a || null,
    }),
    onSuccess: () => { toast.success('Negocio creado'); qc.invalidateQueries({ queryKey: ['tablero'] }); qc.invalidateQueries({ queryKey: ['pipelines'] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Modal abierto onClose={onClose} titulo="Nuevo negocio" descripcion="Crea una oportunidad para un contacto existente."
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button disabled={!contacto} cargando={crear.isPending} onClick={() => crear.mutate()}>Crear negocio</Button></>}>
      <div className="space-y-4">
        <Field label="Contacto" required hint={<>¿No existe? <Link href="/contactos?nuevo=1" className="text-brand-600 hover:underline">Créalo primero</Link></>}>
          <ContactoPicker valor={contacto} onChange={(c) => { setContacto(c); if (!f.titulo) setF((x) => ({ ...x, titulo: '' })); }} />
        </Field>
        <Field label="Título"><Input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ej. Cotización de materiales" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Etapa">
            <Select value={f.etapa_id} onChange={(e) => setF({ ...f, etapa_id: e.target.value })}>
              {etapas.map((e) => <option key={e.etapa_id} value={e.etapa_id}>{e.nombre}</option>)}
            </Select>
          </Field>
          <Field label="Monto (S/)"><Input type="number" min={0} step="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" /></Field>
        </div>
        <Field label="Responsable">
          <Select value={f.asignado_a} onChange={(e) => setF({ ...f, asignado_a: e.target.value })}>
            <option value="">Sin asignar</option>
            {equipo?.miembros.filter((m) => m.activo).map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nombre}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
