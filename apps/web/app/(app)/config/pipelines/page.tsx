'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowRight, Check, ChevronDown, Circle, Clock, ExternalLink, GripVertical, Inbox, KanbanSquare, Lock, Plus, Trash2, Trophy, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Etapa, Pipeline } from '@/lib/types';
import { usePipelines, usePuede } from '@/hooks/datos';
import {
  Badge, Button, Cargando, ColorPicker, Field, Input, Menu, Modal, PageHeader, Popover, Select, Skeleton, Switch, Tooltip, Vacio, confirmar,
} from '@/components/ui';

type TipoEtapa = Etapa['tipo'];
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const TIPOS: Record<TipoEtapa, { label: string; desc: string; icono: React.ReactNode; clase: string }> = {
  abierta: { label: 'Abierta', desc: 'El negocio sigue en curso', icono: <Circle className="h-3.5 w-3.5" />, clase: 'text-ink-600 bg-ink-100' },
  ganado: { label: 'Ganado', desc: 'Cierra el negocio como ganado', icono: <Trophy className="h-3.5 w-3.5" />, clase: 'text-emerald-700 bg-emerald-50' },
  perdido: { label: 'Perdido', desc: 'Cierra el negocio como perdido', icono: <XCircle className="h-3.5 w-3.5" />, clase: 'text-red-600 bg-red-50' },
};

function useRefrescar() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); qc.invalidateQueries({ queryKey: ['tablero'] }); };
}

export default function PipelinesConfigPage() {
  return <Suspense fallback={<Cargando />}><PipelinesConfig /></Suspense>;
}

function PipelinesConfig() {
  const { data: pipelines, isLoading } = usePipelines();
  const esAdmin = usePuede('admin');
  const params = useSearchParams();
  const router = useRouter();
  const [nuevo, setNuevo] = useState(false);

  const pParam = Number(params.get('p')) || null;
  const seleccionado = pipelines?.find((p) => p.pipeline_id === pParam) ?? pipelines?.[0] ?? null;
  const seleccionar = (id: number) => router.replace(`/config/pipelines?p=${id}`, { scroll: false });

  return (
    <div>
      <PageHeader icono={<KanbanSquare className="h-5 w-5" />} titulo="Kanban"
        descripcion="Define los embudos de venta y las etapas por las que avanza cada negocio"
        acciones={esAdmin && <Button icono={<Plus className="h-4 w-4" />} onClick={() => setNuevo(true)}>Nuevo tablero</Button>} />
      <div className="mx-auto max-w-5xl p-6">
        {!esAdmin && <AvisoPermiso texto="Solo los administradores pueden modificar tableros y etapas." />}
        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-[240px_1fr]">
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
            <Skeleton className="h-96" />
          </div>
        ) : !pipelines?.length ? (
          <div className="card"><Vacio icono={<KanbanSquare className="h-5 w-5" />} titulo="Aún no tienes tableros Kanban" texto="Crea tu primer embudo para organizar tus negocios por etapas."
            accion={esAdmin && <Button icono={<Plus className="h-4 w-4" />} onClick={() => setNuevo(true)}>Nuevo tablero</Button>} /></div>
        ) : (
          <div className="grid items-start gap-6 md:grid-cols-[240px_1fr]">
            <div className="space-y-1.5">
              <p className="mb-2 px-1 text-2xs font-semibold uppercase tracking-wider text-ink-400">{pipelines.length} tablero{pipelines.length !== 1 && 's'}</p>
              {pipelines.map((p) => {
                const activo = p.pipeline_id === seleccionado?.pipeline_id;
                return (
                  <button key={p.pipeline_id} onClick={() => seleccionar(p.pipeline_id)}
                    className={cn('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
                      activo ? 'border-brand-300 bg-white shadow-card ring-4 ring-brand-500/10' : 'border-transparent hover:border-ink-200 hover:bg-white')}>
                    <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className={cn('truncate text-[13px] font-semibold', p.activo ? 'text-ink-900' : 'text-ink-400 line-through decoration-ink-300')}>{p.nombre}</p>
                        {p.es_entrada && <Tooltip texto="Tablero de entrada: aquí llegan los nuevos leads"><Inbox className="h-3.5 w-3.5 shrink-0 text-brand-500" /></Tooltip>}
                      </div>
                      <p className="text-xs text-ink-500">{p.etapas.length} etapas · {p.abiertos} abiertos</p>
                    </div>
                  </button>
                );
              })}
            </div>
            {seleccionado && <EditorPipeline key={seleccionado.pipeline_id} p={seleccionado} esAdmin={esAdmin} alBorrar={() => {
              const otro = pipelines.find((x) => x.pipeline_id !== seleccionado.pipeline_id);
              if (otro) seleccionar(otro.pipeline_id); else router.replace('/config/pipelines');
            }} />}
          </div>
        )}
      </div>
      <NuevoPipeline abierto={nuevo} onClose={() => setNuevo(false)} onCreado={(id) => { setNuevo(false); seleccionar(id); }} />
    </div>
  );
}

function AvisoPermiso({ texto }: { texto: string }) {
  return (
    <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-2.5 text-[13px] text-amber-800">
      <Lock className="h-4 w-4 shrink-0 text-amber-500" />{texto}
    </div>
  );
}

// ── Nuevo pipeline ──────────────────────────────────────────────────────────

function NuevoPipeline({ abierto, onClose, onCreado }: { abierto: boolean; onClose: () => void; onCreado: (id: number) => void }) {
  const refrescar = useRefrescar();
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [entrada, setEntrada] = useState(false);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (abierto) { setNombre(''); setColor('#6366f1'); setEntrada(false); } }, [abierto]);

  async function crear(e?: React.FormEvent) {
    e?.preventDefault();
    if (!nombre.trim()) return;
    setGuardando(true);
    try {
      const r = await api.post<{ pipeline: Pipeline }>('/pipelines', { nombre: nombre.trim(), color, es_entrada: entrada });
      toast.success('Tablero creado con 4 etapas iniciales');
      refrescar();
      onCreado(r.pipeline.pipeline_id);
    } catch (err) { toast.error((err as Error).message); } finally { setGuardando(false); }
  }

  return (
    <Modal abierto={abierto} onClose={onClose} titulo="Nuevo tablero" descripcion="Se crea con las etapas Nuevo, En proceso, Ganado y Perdido. Luego podrás editarlas."
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button onClick={() => crear()} cargando={guardando} disabled={!nombre.trim()}>Crear tablero</Button></>}>
      <form onSubmit={crear} className="space-y-5">
        <Field label="Nombre" required><Input autoFocus value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Postventa, Mayoristas…" /></Field>
        <Field label="Color"><ColorPicker value={color} onChange={setColor} /></Field>
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-ink-200 p-3.5">
          <div>
            <p className="text-[13px] font-medium text-ink-800">Tablero de entrada</p>
            <p className="text-xs text-ink-500">Los nuevos leads que llegan por los canales se crean aquí. Solo puede haber uno.</p>
          </div>
          <Switch checked={entrada} onChange={setEntrada} />
        </label>
      </form>
    </Modal>
  );
}

// ── Editor de un pipeline ───────────────────────────────────────────────────

function EditorPipeline({ p, esAdmin, alBorrar }: { p: Pipeline; esAdmin: boolean; alBorrar: () => void }) {
  const refrescar = useRefrescar();
  const [nombre, setNombre] = useState(p.nombre);
  useEffect(() => setNombre(p.nombre), [p.nombre]);

  async function patch(d: Partial<Pick<Pipeline, 'nombre' | 'color' | 'es_entrada' | 'activo'>>, msg = 'Tablero actualizado') {
    try { await api.patch(`/pipelines/${p.pipeline_id}`, d); toast.success(msg); refrescar(); }
    catch (e) { toast.error((e as Error).message); if (d.nombre) setNombre(p.nombre); }
  }

  function guardarNombre() {
    const n = nombre.trim();
    if (!n) { setNombre(p.nombre); return; }
    if (n !== p.nombre) patch({ nombre: n }, 'Nombre actualizado');
  }

  async function eliminar() {
    const ok = await confirmar({ titulo: `¿Eliminar "${p.nombre}"?`, texto: 'Se eliminarán también sus etapas. Esta acción no se puede deshacer.', confirmar: 'Eliminar tablero', peligro: true });
    if (!ok) return;
    try { await api.del(`/pipelines/${p.pipeline_id}`); toast.success('Pipeline eliminado'); refrescar(); alBorrar(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="min-w-0 space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Popover trigger={
            <button disabled={!esAdmin} className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-xs transition-transform hover:scale-105 disabled:hover:scale-100" style={{ backgroundColor: p.color }} title="Cambiar color">
              <KanbanSquare className="h-5 w-5" />
            </button>}>
            <div className="w-[248px] p-3"><p className="mb-2 text-xs font-medium text-ink-500">Color del tablero</p><ColorPicker value={p.color} onChange={(c) => patch({ color: c }, 'Color actualizado')} /></div>
          </Popover>
          <div className="min-w-0 flex-1">
            <input value={nombre} disabled={!esAdmin} maxLength={60} onChange={(e) => setNombre(e.target.value)} onBlur={guardarNombre}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setNombre(p.nombre); (e.target as HTMLInputElement).blur(); } }}
              className="-ml-1.5 w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-semibold tracking-tight text-ink-900 transition-colors hover:border-ink-200 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10 disabled:hover:border-transparent" />
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
              {p.es_entrada && <Badge color="#4f46e5"><Inbox className="h-3 w-3" />Entrada de leads</Badge>}
              {!p.activo && <Badge>Inactivo</Badge>}
              <span>{p.etapas.length} etapas · {p.abiertos} negocios abiertos</span>
              <Link href={`/pipelines/${p.pipeline_id}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700">Ver tablero<ExternalLink className="h-3 w-3" /></Link>
            </div>
          </div>
          {esAdmin && <Tooltip texto={p.es_entrada ? 'No puedes eliminar el tablero de entrada' : 'Eliminar tablero'}>
            <span><Button variante="fantasma" tamano="icono" onClick={eliminar} disabled={p.es_entrada} className="text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></Button></span>
          </Tooltip>}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <OpcionSwitch titulo="Tablero de entrada" texto="Los leads nuevos de los canales llegan aquí"
            checked={p.es_entrada} disabled={!esAdmin || p.es_entrada} onChange={(v) => patch({ es_entrada: v }, 'Ahora es el tablero de entrada')}
            ayuda={p.es_entrada ? 'Para cambiarlo, marca otro tablero como entrada' : undefined} />
          <OpcionSwitch titulo="Activo" texto="Los inactivos se ocultan del tablero"
            checked={p.activo} disabled={!esAdmin} onChange={(v) => patch({ activo: v }, v ? 'Tablero activado' : 'Tablero desactivado')} />
        </div>

        {/* Vista previa del flujo */}
        <div className="mt-5 rounded-xl bg-ink-50/80 p-3.5">
          <p className="mb-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">Flujo del negocio</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {p.etapas.map((e, i) => (
              <div key={e.etapa_id} className="flex items-center gap-1.5">
                <span className={cn('inline-flex items-center gap-1.5 rounded-lg border bg-white px-2 py-1 text-xs font-medium shadow-xs',
                  e.tipo === 'ganado' ? 'border-emerald-200 text-emerald-700' : e.tipo === 'perdido' ? 'border-red-200 text-red-600' : 'border-ink-200 text-ink-700')}>
                  {e.tipo === 'ganado' ? <Trophy className="h-3 w-3" /> : e.tipo === 'perdido' ? <XCircle className="h-3 w-3" /> : <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />}
                  {e.nombre}
                  {!!e.abiertos && <span className="rounded bg-ink-100 px-1 text-[10px] text-ink-500">{e.abiertos}</span>}
                </span>
                {i < p.etapas.length - 1 && <ArrowRight className="h-3 w-3 text-ink-300" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <EditorEtapas p={p} esAdmin={esAdmin} />
    </div>
  );
}

function OpcionSwitch({ titulo, texto, checked, disabled, onChange, ayuda }: { titulo: string; texto: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; ayuda?: string }) {
  const contenido = (
    <div className={cn('flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-3.5 py-3', disabled && 'bg-ink-50/50')}>
      <div className="min-w-0"><p className="text-[13px] font-medium text-ink-800">{titulo}</p><p className="truncate text-xs text-ink-500">{texto}</p></div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
  return ayuda ? <Tooltip texto={ayuda}>{contenido}</Tooltip> : contenido;
}

// ── Etapas ──────────────────────────────────────────────────────────────────

function EditorEtapas({ p, esAdmin }: { p: Pipeline; esAdmin: boolean }) {
  const refrescar = useRefrescar();
  const [etapas, setEtapas] = useState<Etapa[]>(p.etapas);
  const ocupado = useRef(false);
  useEffect(() => { if (!ocupado.current) setEtapas(p.etapas); }, [p.etapas]);
  const [borrando, setBorrando] = useState<Etapa | null>(null);
  const [nueva, setNueva] = useState('');
  const [nuevaTipo, setNuevaTipo] = useState<TipoEtapa>('abierta');
  const [creando, setCreando] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const antes = etapas;
    const desde = antes.findIndex((x) => x.etapa_id === active.id);
    const hasta = antes.findIndex((x) => x.etapa_id === over.id);
    const nuevas = arrayMove(antes, desde, hasta);
    setEtapas(nuevas);
    ocupado.current = true;
    try {
      await api.put(`/pipelines/${p.pipeline_id}/etapas/orden`, { etapa_ids: nuevas.map((x) => x.etapa_id) });
      toast.success('Orden de etapas guardado');
    } catch (err) {
      setEtapas(antes);
      toast.error((err as Error).message);
    } finally { ocupado.current = false; refrescar(); }
  }

  async function actualizar(etapa: Etapa, d: Partial<Pick<Etapa, 'nombre' | 'color' | 'tipo' | 'sla_horas'>>) {
    setEtapas((l) => l.map((x) => (x.etapa_id === etapa.etapa_id ? { ...x, ...d } : x)));
    try { await api.patch(`/etapas/${etapa.etapa_id}`, d); toast.success('Etapa actualizada'); }
    catch (err) { toast.error((err as Error).message); setEtapas((l) => l.map((x) => (x.etapa_id === etapa.etapa_id ? etapa : x))); }
    finally { refrescar(); }
  }

  async function eliminar(etapa: Etapa) {
    if (etapas.length <= 1) { toast.error('Un tablero necesita al menos una etapa'); return; }
    if ((etapa.abiertos ?? 0) > 0) { setBorrando(etapa); return; }
    const ok = await confirmar({ titulo: `¿Eliminar la etapa "${etapa.nombre}"?`, texto: 'Esta acción no se puede deshacer.', confirmar: 'Eliminar etapa', peligro: true });
    if (!ok) return;
    try { await api.del(`/etapas/${etapa.etapa_id}`); toast.success('Etapa eliminada'); refrescar(); }
    catch (err) {
      // Etapas con negocios cerrados (ganados/perdidos) también exigen destino
      if (err instanceof ApiError && /negocio/i.test(err.message)) { setBorrando(etapa); return; }
      toast.error((err as Error).message);
    }
  }

  async function agregar(e?: React.FormEvent) {
    e?.preventDefault();
    const nombre = nueva.trim();
    if (!nombre) return;
    setCreando(true);
    const usados = new Set(etapas.map((x) => x.color));
    const color = nuevaTipo === 'ganado' ? '#10b981' : nuevaTipo === 'perdido' ? '#ef4444' : ['#3b82f6', '#0ea5e9', '#14b8a6', '#f59e0b', '#a855f7', '#ec4899', '#6366f1', '#84cc16'].find((c) => !usados.has(c)) ?? '#94a3b8';
    try {
      await api.post(`/pipelines/${p.pipeline_id}/etapas`, { nombre, color, tipo: nuevaTipo });
      toast.success(`Etapa "${nombre}" agregada`);
      setNueva(''); setNuevaTipo('abierta');
      refrescar();
    } catch (err) { toast.error((err as Error).message); } finally { setCreando(false); }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-900">Etapas</h2>
          <p className="text-xs text-ink-500">{esAdmin ? 'Arrastra desde el asa para reordenar. Los cambios se guardan al instante.' : 'Orden en que avanza cada negocio.'}</p>
        </div>
        <Badge>{etapas.length}</Badge>
      </div>
      <div className="grid grid-cols-[28px_28px_1fr_132px_104px_60px_36px] items-center gap-2 border-b border-ink-100 bg-ink-50/60 px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-500">
        <span /><span /><span>Nombre</span><span>Tipo</span><span>SLA</span><span className="text-right">Abiertos</span><span />
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
        <SortableContext items={etapas.map((x) => x.etapa_id)} strategy={verticalListSortingStrategy}>
          <div className="divide-y divide-ink-100">
            {etapas.map((e) => <FilaEtapa key={e.etapa_id} e={e} esAdmin={esAdmin} onCambio={(d) => actualizar(e, d)} onEliminar={() => eliminar(e)} />)}
          </div>
        </SortableContext>
      </DndContext>
      {esAdmin && (
        <form onSubmit={agregar} className="flex items-center gap-2 border-t border-ink-100 bg-ink-50/40 px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-ink-300 text-ink-400"><Plus className="h-3.5 w-3.5" /></div>
          <input value={nueva} onChange={(e) => setNueva(e.target.value)} maxLength={40} placeholder="Nombre de la nueva etapa…"
            className="input h-8 flex-1 py-1 text-[13px]" />
          <div className="w-32"><Select value={nuevaTipo} onChange={(e) => setNuevaTipo(e.target.value as TipoEtapa)} className="h-8 py-1 text-[13px]">
            {(Object.keys(TIPOS) as TipoEtapa[]).map((t) => <option key={t} value={t}>{TIPOS[t].label}</option>)}
          </Select></div>
          <Button type="submit" tamano="sm" cargando={creando} disabled={!nueva.trim()}>Agregar etapa</Button>
        </form>
      )}
      {borrando && <ModalMoverYBorrar etapa={borrando} etapas={etapas} onClose={() => setBorrando(null)} onHecho={() => { setBorrando(null); refrescar(); }} />}
    </div>
  );
}

function FilaEtapa({ e, esAdmin, onCambio, onEliminar }: { e: Etapa; esAdmin: boolean; onCambio: (d: Partial<Etapa>) => void; onEliminar: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: e.etapa_id, disabled: !esAdmin });
  const [nombre, setNombre] = useState(e.nombre);
  const [sla, setSla] = useState(e.sla_horas?.toString() ?? '');
  const [colorAbierto, setColorAbierto] = useState(false);
  useEffect(() => setNombre(e.nombre), [e.nombre]);
  useEffect(() => setSla(e.sla_horas?.toString() ?? ''), [e.sla_horas]);

  function guardarNombre() {
    const n = nombre.trim();
    if (!n) { setNombre(e.nombre); return; }
    if (n !== e.nombre) onCambio({ nombre: n });
  }
  function guardarSla() {
    const v = sla.trim() === '' ? null : Math.round(Number(sla));
    if (v !== null && (!Number.isFinite(v) || v <= 0)) { toast.error('El SLA debe ser un número de horas mayor a 0'); setSla(e.sla_horas?.toString() ?? ''); return; }
    if (v !== e.sla_horas) onCambio({ sla_horas: v });
  }
  const t = TIPOS[e.tipo];

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('grid grid-cols-[28px_28px_1fr_132px_104px_60px_36px] items-center gap-2 bg-white px-4 py-2 transition-colors hover:bg-ink-50/50',
        isDragging && 'relative z-10 rounded-lg shadow-lift ring-1 ring-brand-200')}>
      <button ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={!esAdmin} aria-label="Arrastrar para reordenar"
        className="flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-md text-ink-300 hover:bg-ink-100 hover:text-ink-600 active:cursor-grabbing disabled:cursor-default disabled:hover:bg-transparent">
        <GripVertical className="h-4 w-4" />
      </button>
      <Popover abierto={colorAbierto} onOpenChange={setColorAbierto} trigger={
        <button disabled={!esAdmin} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-ink-100 disabled:hover:bg-transparent" title="Color">
          <span className="h-3.5 w-3.5 rounded-full ring-2 ring-white ring-offset-1" style={{ backgroundColor: e.color, boxShadow: `0 0 0 1px ${e.color}55` }} />
        </button>}>
        <div className="w-[248px] p-3"><p className="mb-2 text-xs font-medium text-ink-500">Color de la etapa</p>
          <ColorPicker value={e.color} onChange={(c) => { setColorAbierto(false); if (c !== e.color) onCambio({ color: c }); }} /></div>
      </Popover>
      <input value={nombre} disabled={!esAdmin} maxLength={40} onChange={(ev) => setNombre(ev.target.value)} onBlur={guardarNombre}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') { setNombre(e.nombre); (ev.target as HTMLInputElement).blur(); } }}
        className="h-8 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium text-ink-800 transition-colors hover:border-ink-200 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-500/10 disabled:hover:border-transparent" />
      {esAdmin ? (
        <Menu align="start" trigger={
          <button className={cn('inline-flex h-7 items-center justify-between gap-1.5 rounded-md px-2 text-xs font-medium transition-opacity hover:opacity-80', t.clase)}>
            <span className="inline-flex items-center gap-1.5">{t.icono}{t.label}</span><ChevronDown className="h-3 w-3 opacity-60" />
          </button>}
          items={(Object.keys(TIPOS) as Array<TipoEtapa>).map((k) => ({
            icono: TIPOS[k].icono,
            label: <span className="flex flex-1 items-center justify-between gap-3"><span><span className="block font-medium">{TIPOS[k].label}</span><span className="block text-[11px] text-ink-500">{TIPOS[k].desc}</span></span>{k === e.tipo && <Check className="h-3.5 w-3.5 text-brand-600" />}</span>,
            onClick: () => { if (k !== e.tipo) onCambio({ tipo: k }); },
          }))} />
      ) : <span className={cn('inline-flex h-7 w-fit items-center gap-1.5 rounded-md px-2 text-xs font-medium', t.clase)}>{t.icono}{t.label}</span>}
      <Tooltip texto="Horas máximas que un negocio debería permanecer en esta etapa">
        <div className="relative">
          <Clock className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input value={sla} disabled={!esAdmin || e.tipo !== 'abierta'} inputMode="numeric" placeholder="—"
            onChange={(ev) => setSla(ev.target.value.replace(/[^\d]/g, ''))} onBlur={guardarSla}
            onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
            className="input h-7 py-0 pl-7 pr-6 text-xs disabled:bg-transparent" />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-400">h</span>
        </div>
      </Tooltip>
      <span className={cn('text-right text-[13px] tabular-nums', e.abiertos ? 'font-semibold text-ink-800' : 'text-ink-400')}>{e.abiertos ?? 0}</span>
      {esAdmin ? (
        <button onClick={onEliminar} title="Eliminar etapa" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-300 transition-colors hover:bg-red-50 hover:text-red-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : <span />}
    </div>
  );
}

function ModalMoverYBorrar({ etapa, etapas, onClose, onHecho }: { etapa: Etapa; etapas: Etapa[]; onClose: () => void; onHecho: () => void }) {
  const opciones = useMemo(() => etapas.filter((x) => x.etapa_id !== etapa.etapa_id), [etapas, etapa]);
  const [destino, setDestino] = useState<number>(opciones.find((x) => x.tipo === 'abierta')?.etapa_id ?? opciones[0]?.etapa_id);
  const [cargando, setCargando] = useState(false);

  async function confirmarBorrado() {
    setCargando(true);
    try {
      await api.del(`/etapas/${etapa.etapa_id}?destino_etapa_id=${destino}`);
      const d = opciones.find((x) => x.etapa_id === destino);
      toast.success(`Etapa eliminada. Negocios movidos a "${d?.nombre}"`);
      onHecho();
    } catch (e) { toast.error((e as Error).message); } finally { setCargando(false); }
  }

  return (
    <Modal abierto onClose={onClose} titulo={`Eliminar "${etapa.nombre}"`} ancho="sm"
      descripcion="Esta etapa tiene negocios. Elige a qué etapa moverlos antes de eliminarla."
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button variante="peligro" cargando={cargando} disabled={!destino} onClick={confirmarBorrado}>Mover y eliminar</Button></>}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] text-amber-800">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 font-semibold">{etapa.abiertos || '!'}</span>
          <span>{etapa.abiertos ? `${etapa.abiertos} negocio(s) abiertos` : 'Negocios cerrados'} se moverán a la etapa que elijas. Su historial se conserva.</span>
        </div>
        <Field label="Mover negocios a">
          <div className="space-y-1.5">
            {opciones.map((o) => (
              <label key={o.etapa_id} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
                destino === o.etapa_id ? 'border-brand-400 bg-brand-50/60 ring-4 ring-brand-500/10' : 'border-ink-200 hover:bg-ink-50')}>
                <input type="radio" name="destino" checked={destino === o.etapa_id} onChange={() => setDestino(o.etapa_id)} className="accent-brand-600" />
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: o.color }} />
                <span className="flex-1 text-[13px] font-medium text-ink-800">{o.nombre}</span>
                <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]', TIPOS[o.tipo].clase)}>{TIPOS[o.tipo].icono}{TIPOS[o.tipo].label}</span>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
