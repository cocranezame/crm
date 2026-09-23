'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle, AtSign, Calendar, CheckSquare, ChevronDown, Eye, GripVertical, Hash, KanbanSquare, List, ListChecks, Lock, Pencil,
  Phone, Plus, SlidersHorizontal, ToggleLeft, Trash2, Type, User, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Campo } from '@/lib/types';
import { useCampos, usePuede } from '@/hooks/datos';
import { Badge, Button, Field, Input, Modal, PageHeader, Skeleton, Switch, Tabs, Vacio, confirmar } from '@/components/ui';
import { CampoInput } from '@/components/crm/campos';

type Entidad = Campo['entidad'];
type TipoCampo = Campo['tipo'];
const soloVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const TIPOS: Record<TipoCampo, { label: string; desc: string; icono: React.ComponentType<{ className?: string }> }> = {
  texto: { label: 'Texto', desc: 'Una línea de texto libre', icono: Type },
  numero: { label: 'Número', desc: 'Cantidades, montos, edades', icono: Hash },
  fecha: { label: 'Fecha', desc: 'Selector de día', icono: Calendar },
  opcion: { label: 'Lista (una opción)', desc: 'Elegir una de varias', icono: List },
  multi: { label: 'Lista (varias opciones)', desc: 'Elegir varias', icono: ListChecks },
  telefono: { label: 'Teléfono', desc: 'Número de contacto', icono: Phone },
  email: { label: 'Correo', desc: 'Dirección de email', icono: AtSign },
  booleano: { label: 'Sí / No', desc: 'Interruptor', icono: ToggleLeft },
};

function slug(s: string): string {
  let r = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (r && !/^[a-z]/.test(r)) r = `c_${r}`;
  return r.slice(0, 40);
}

export default function CamposPage() {
  const { data: campos, isLoading } = useCampos();
  const esAdmin = usePuede('admin');
  const qc = useQueryClient();
  const [entidad, setEntidad] = useState<Entidad>('contacto');
  const [editando, setEditando] = useState<Campo | 'nuevo' | null>(null);

  const delServidor = useMemo(() => (campos ?? []).filter((c) => c.entidad === entidad).sort((a, b) => a.orden - b.orden || a.campo_id - b.campo_id), [campos, entidad]);
  const [lista, setLista] = useState<Campo[]>([]);
  const ocupado = useRef(false);
  useEffect(() => { if (!ocupado.current) setLista(delServidor); }, [delServidor]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const antes = lista;
    const nuevas = arrayMove(antes, antes.findIndex((c) => c.campo_id === active.id), antes.findIndex((c) => c.campo_id === over.id));
    setLista(nuevas);
    ocupado.current = true;
    try { await api.put('/campos/orden', { campo_ids: nuevas.map((c) => c.campo_id) }); toast.success('Orden guardado'); }
    catch (err) { setLista(antes); toast.error((err as Error).message); }
    finally { ocupado.current = false; qc.invalidateQueries({ queryKey: ['campos'] }); }
  }

  async function eliminar(c: Campo) {
    const ok = await confirmar({
      titulo: `¿Eliminar el campo "${c.nombre}"?`,
      texto: <div className="space-y-2"><p>Se borrarán también <b>todos los valores guardados</b> en este campo para cada {c.entidad === 'contacto' ? 'contacto' : 'negocio'}.</p><p className="text-xs text-ink-500">Esta acción no se puede deshacer.</p></div>,
      confirmar: 'Eliminar campo y valores', peligro: true,
    });
    if (!ok) return;
    try { await api.del(`/campos/${c.campo_id}`); toast.success('Campo eliminado'); qc.invalidateQueries({ queryKey: ['campos'] }); }
    catch (err) { toast.error((err as Error).message); }
  }

  const cuenta = (e: Entidad) => (campos ?? []).filter((c) => c.entidad === e).length;

  return (
    <div>
      <PageHeader icono={<SlidersHorizontal className="h-5 w-5" />} titulo="Campos personalizados" descripcion="Guarda la información que tu negocio necesita en cada contacto y negocio"
        acciones={esAdmin && <Button icono={<Plus className="h-4 w-4" />} onClick={() => setEditando('nuevo')}>Nuevo campo</Button>} />
      <div className="mx-auto max-w-5xl p-6">
        {!esAdmin && <AvisoPermiso texto="Solo los administradores pueden crear, editar o reordenar campos." />}
        <div className="mb-4 flex items-center justify-between gap-3">
          <Tabs valor={entidad} onChange={setEntidad} opciones={[
            { valor: 'contacto', label: <><User className="h-3.5 w-3.5" />Contacto</>, contador: cuenta('contacto') },
            { valor: 'negocio', label: <><KanbanSquare className="h-3.5 w-3.5" />Negocio</>, contador: cuenta('negocio') },
          ]} />
          <p className="text-[13px] text-ink-500">{entidad === 'contacto' ? 'Aparecen en la ficha del contacto y en la bandeja' : 'Aparecen al crear y editar negocios del pipeline'}</p>
        </div>

        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !lista.length ? (
            <Vacio icono={<SlidersHorizontal className="h-5 w-5" />} titulo={`Sin campos de ${entidad}`}
              texto={entidad === 'contacto' ? 'Agrega datos como DNI, ciudad, fecha de cumpleaños o canal de origen.' : 'Agrega datos como producto de interés, forma de pago o fecha estimada de cierre.'}
              accion={esAdmin && <Button icono={<Plus className="h-4 w-4" />} onClick={() => setEditando('nuevo')}>Nuevo campo</Button>} />
          ) : (
            <>
              <div className="grid grid-cols-[28px_1fr_190px_110px_80px] items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-500">
                <span /><span>Campo</span><span>Tipo</span><span>Obligatorio</span><span />
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[soloVertical]} onDragEnd={onDragEnd}>
                <SortableContext items={lista.map((c) => c.campo_id)} strategy={verticalListSortingStrategy}>
                  <div className="divide-y divide-ink-100">
                    {lista.map((c) => <FilaCampo key={c.campo_id} c={c} esAdmin={esAdmin} onEditar={() => setEditando(c)} onEliminar={() => eliminar(c)} />)}
                  </div>
                </SortableContext>
              </DndContext>
            </>
          )}
        </div>
      </div>
      {editando && <ModalCampo campo={editando === 'nuevo' ? null : editando} entidad={entidad} existentes={campos ?? []} onClose={() => setEditando(null)} />}
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

function FilaCampo({ c, esAdmin, onEditar, onEliminar }: { c: Campo; esAdmin: boolean; onEditar: () => void; onEliminar: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: c.campo_id, disabled: !esAdmin });
  const T = TIPOS[c.tipo];
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group grid grid-cols-[28px_1fr_190px_110px_80px] items-center gap-3 bg-white px-4 py-3 transition-colors hover:bg-ink-50/50',
        isDragging && 'relative z-10 rounded-lg shadow-lift ring-1 ring-brand-200')}>
      <button ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={!esAdmin} aria-label="Arrastrar para reordenar"
        className="flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-md text-ink-300 hover:bg-ink-100 hover:text-ink-600 active:cursor-grabbing disabled:cursor-default disabled:hover:bg-transparent">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-ink-900">{c.nombre}</p>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <code className="rounded bg-ink-100 px-1.5 py-px font-mono text-[11px] text-ink-500">{c.clave}</code>
          {c.opciones?.length ? <span className="truncate text-xs text-ink-400">{c.opciones.join(' · ')}</span> : null}
        </div>
      </div>
      <span className="inline-flex items-center gap-2 text-[13px] text-ink-600">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><T.icono className="h-3.5 w-3.5" /></span>{T.label}
      </span>
      <span>{c.obligatorio ? <Badge color="#d97706">Obligatorio</Badge> : <span className="text-xs text-ink-400">Opcional</span>}</span>
      <div className="flex justify-end gap-0.5">
        {esAdmin && <>
          <button onClick={onEditar} title="Editar" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onEliminar} title="Eliminar" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
        </>}
      </div>
    </div>
  );
}

function ModalCampo({ campo, entidad, existentes, onClose }: { campo: Campo | null; entidad: Entidad; existentes: Campo[]; onClose: () => void }) {
  const qc = useQueryClient();
  const esNuevo = !campo;
  const [nombre, setNombre] = useState(campo?.nombre ?? '');
  const [clave, setClave] = useState(campo?.clave ?? '');
  const [claveManual, setClaveManual] = useState(false);
  const [tipo, setTipo] = useState<TipoCampo>(campo?.tipo ?? 'texto');
  const [opciones, setOpciones] = useState<string[]>(campo?.opciones ?? []);
  const [obligatorio, setObligatorio] = useState(campo?.obligatorio ?? false);
  const [muestra, setMuestra] = useState<unknown>(null);
  const [guardando, setGuardando] = useState(false);
  const [tipoAbierto, setTipoAbierto] = useState(esNuevo);

  useEffect(() => { if (esNuevo && !claveManual) setClave(slug(nombre)); }, [nombre, esNuevo, claveManual]);
  useEffect(() => setMuestra(null), [tipo]);

  const conOpciones = tipo === 'opcion' || tipo === 'multi';
  const claveValida = /^[a-z][a-z0-9_]{0,39}$/.test(clave);
  const claveDuplicada = esNuevo && existentes.some((c) => c.entidad === entidad && c.clave === clave);
  const errorClave = !clave ? null : !claveValida ? 'Solo minúsculas, números y _ (debe empezar con letra)' : claveDuplicada ? 'Ya existe un campo con esta clave' : null;
  const valido = nombre.trim() && claveValida && !claveDuplicada && (!conOpciones || opciones.length > 0);

  const preview: Campo = { campo_id: 0, entidad, clave: clave || 'campo', nombre: nombre || 'Nombre del campo', tipo, opciones: conOpciones ? (opciones.length ? opciones : ['Opción 1', 'Opción 2']) : null, obligatorio, orden: 0 };

  async function guardar() {
    if (!valido) return;
    setGuardando(true);
    try {
      if (campo) {
        await api.patch(`/campos/${campo.campo_id}`, { nombre: nombre.trim(), obligatorio, ...(conOpciones ? { opciones } : {}) });
      } else {
        await api.post('/campos', { entidad, clave, nombre: nombre.trim(), tipo, obligatorio, opciones: conOpciones ? opciones : null });
      }
      toast.success(campo ? 'Campo actualizado' : 'Campo creado');
      qc.invalidateQueries({ queryKey: ['campos'] });
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setGuardando(false); }
  }

  const T = TIPOS[tipo];

  return (
    <Modal abierto onClose={onClose} ancho="lg" titulo={campo ? 'Editar campo' : `Nuevo campo de ${entidad}`}
      descripcion={campo ? 'La clave y el tipo no se pueden cambiar porque los valores guardados dependen de ellos.' : undefined}
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button onClick={guardar} cargando={guardando} disabled={!valido}>{campo ? 'Guardar cambios' : 'Crear campo'}</Button></>}>
      <div className="grid gap-6 md:grid-cols-[1fr_230px]">
        <div className="space-y-5">
          <Field label="Nombre" required><Input autoFocus value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. DNI, Fecha de cumpleaños, Distrito" /></Field>
          <Field label="Clave interna" error={errorClave}
            hint={esNuevo ? <>Se usa en variables como <code className="font-mono text-ink-600">{`{campo.${clave || 'clave'}}`}</code>. No se puede cambiar después.</> : undefined}>
            <div className="relative">
              <Input value={clave} disabled={!esNuevo} maxLength={40} className="pr-9 font-mono text-[13px]"
                onChange={(e) => { setClaveManual(true); setClave(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); }} />
              {!esNuevo && <Lock className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />}
            </div>
          </Field>
          <Field label="Tipo de dato" required>
            {esNuevo && tipoAbierto ? (
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(TIPOS) as TipoCampo[]).map((k) => {
                  const I = TIPOS[k].icono;
                  return (
                    <button key={k} type="button" onClick={() => { setTipo(k); setTipoAbierto(false); }}
                      className={cn('flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all',
                        tipo === k ? 'border-brand-400 bg-brand-50/60 ring-4 ring-brand-500/10' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50')}>
                      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', tipo === k ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-500')}><I className="h-3.5 w-3.5" /></span>
                      <span className="min-w-0"><span className="block truncate text-[13px] font-medium text-ink-800">{TIPOS[k].label}</span><span className="block truncate text-[11px] text-ink-500">{TIPOS[k].desc}</span></span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <button type="button" disabled={!esNuevo} onClick={() => setTipoAbierto(true)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-ink-200 px-2.5 py-2 text-left shadow-xs transition-colors hover:bg-ink-50 disabled:bg-ink-50 disabled:hover:bg-ink-50">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-600"><T.icono className="h-3.5 w-3.5" /></span>
                <span className="flex-1"><span className="block text-[13px] font-medium text-ink-800">{T.label}</span><span className="block text-[11px] text-ink-500">{T.desc}</span></span>
                {esNuevo ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <Lock className="h-3.5 w-3.5 text-ink-400" />}
              </button>
            )}
          </Field>
          {conOpciones && (
            <Field label="Opciones" required hint="Escribe una opción y presiona Enter o coma.">
              <ChipsInput valores={opciones} onChange={setOpciones} />
              {campo && campo.opciones?.some((o) => !opciones.includes(o)) && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />Los registros que ya tengan una opción eliminada conservarán su valor anterior.</p>
              )}
            </Field>
          )}
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-ink-200 px-3.5 py-3">
            <div className="flex items-center gap-3">
              <CheckSquare className="h-4 w-4 text-ink-400" />
              <div><p className="text-[13px] font-medium text-ink-800">Obligatorio</p><p className="text-xs text-ink-500">Debe completarse al crear o editar un {entidad}</p></div>
            </div>
            <Switch checked={obligatorio} onChange={setObligatorio} />
          </label>
        </div>

        <div>
          <div className="sticky top-0 rounded-xl border border-ink-200 bg-ink-50/70 p-4">
            <p className="mb-3 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-400"><Eye className="h-3.5 w-3.5" />Vista previa</p>
            <div className="rounded-lg border border-ink-200 bg-white p-3.5 shadow-xs">
              <Field label={preview.nombre} required={obligatorio}>
                <CampoInput campo={preview} valor={muestra} onChange={setMuestra} />
              </Field>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">Así se verá en la ficha del {entidad}. Puedes probar el control.</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ChipsInput({ valores, onChange }: { valores: string[]; onChange: (v: string[]) => void }) {
  const [txt, setTxt] = useState('');
  function agregar(v: string) {
    const partes = v.split(',').map((x) => x.trim()).filter(Boolean).filter((x) => !valores.includes(x));
    if (partes.length) onChange([...valores, ...partes]);
    setTxt('');
  }
  return (
    <div className="flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2 py-1.5 shadow-xs transition-colors focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
      {valores.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-md bg-brand-50 py-0.5 pl-2 pr-1 text-xs font-medium text-brand-700">
          {v}<button type="button" onClick={() => onChange(valores.filter((x) => x !== v))} className="rounded p-0.5 text-brand-400 hover:bg-brand-100 hover:text-brand-700"><X className="h-3 w-3" /></button>
        </span>
      ))}
      <input value={txt} onChange={(e) => { if (e.target.value.endsWith(',')) agregar(e.target.value); else setTxt(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); agregar(txt); }
          if (e.key === 'Backspace' && !txt && valores.length) onChange(valores.slice(0, -1));
        }}
        onBlur={() => txt.trim() && agregar(txt)}
        placeholder={valores.length ? 'Agregar otra…' : 'Ej. Lima, Arequipa, Cusco'} className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-ink-400" />
    </div>
  );
}
