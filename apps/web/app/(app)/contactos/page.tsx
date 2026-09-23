'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import {
  AlertCircle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileUp, Plus,
  Search, SlidersHorizontal, Upload, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, descargar, qs } from '@/lib/api';
import { cn, hace, numero, telefonoBonito } from '@/lib/utils';
import type { Campo, ContactoFila, Etiqueta } from '@/lib/types';
import { useCampos, useEtiquetas, useMiembros, usePipelines, usePuede } from '@/hooks/datos';
import {
  Avatar, Badge, Button, Cargando, EtiquetaChip, Field, Input, Modal, PageHeader, Select, Skeleton, Tooltip, Vacio,
} from '@/components/ui';
import { CANAL_INFO, IconoCanal } from '@/components/crm/canal';
import { CamposForm } from '@/components/crm/campos';

// ── Constantes ───────────────────────────────────────────────────────────────

const ORIGENES: Record<string, { label: string; color: string }> = {
  manual: { label: 'Manual', color: '#64748b' },
  whatsapp: { label: 'WhatsApp', color: '#16a34a' },
  messenger: { label: 'Messenger', color: '#0866FF' },
  instagram: { label: 'Instagram', color: '#E1306C' },
  tiktok: { label: 'TikTok', color: '#111827' },
  importacion: { label: 'Importado', color: '#d97706' },
};

function OrigenBadge({ origen }: { origen: string }) {
  const o = ORIGENES[origen] ?? { label: origen, color: '#64748b' };
  return <Badge color={o.color}>{o.label}</Badge>;
}

interface Listado { items: ContactoFila[]; total: number; page: number; limit: number }

// ── Página ───────────────────────────────────────────────────────────────────

export default function ContactosPage() {
  return <Suspense fallback={<Cargando />}><Contactos /></Suspense>;
}

function Contactos() {
  const router = useRouter();
  const params = useSearchParams();
  const puedeSup = usePuede('supervisor');
  const { data: etiquetas } = useEtiquetas();
  const { data: equipo } = useMiembros();

  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [asignado, setAsignado] = useState('');
  const [origen, setOrigen] = useState('');
  const [orden, setOrden] = useState<'recientes' | 'nombre' | 'actividad'>('recientes');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [exportando, setExportando] = useState(false);

  useEffect(() => { const t = setTimeout(() => setBusqueda(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [busqueda, etiqueta, asignado, origen, orden, limit]);

  // ?nuevo=1 abre el modal de creación (usado desde otras pantallas)
  useEffect(() => {
    if (params.get('nuevo') === '1') { setCreando(true); router.replace('/contactos'); }
  }, [params, router]);

  const lista = useQuery({
    queryKey: ['contactos', 'lista', { busqueda, etiqueta, asignado, origen, orden, page, limit }],
    queryFn: () => api.get<Listado>(`/contactos${qs({ q: busqueda, etiqueta_id: etiqueta, asignado, origen, orden, page, limit })}`),
    placeholderData: keepPreviousData,
  });
  const items = lista.data?.items ?? [];
  const total = lista.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / limit));
  const desde = total ? (page - 1) * limit + 1 : 0;
  const hasta = Math.min(page * limit, total);
  const hayFiltros = !!(busqueda || etiqueta || asignado || origen);

  const todosSel = items.length > 0 && items.every((c) => sel.has(c.contacto_id));
  const algunoSel = items.some((c) => sel.has(c.contacto_id));
  function alternarTodos() {
    const s = new Set(sel);
    if (todosSel) items.forEach((c) => s.delete(c.contacto_id)); else items.forEach((c) => s.add(c.contacto_id));
    setSel(s);
  }
  function alternar(id: number) {
    const s = new Set(sel);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSel(s);
  }
  function limpiarFiltros() { setQ(''); setBusqueda(''); setEtiqueta(''); setAsignado(''); setOrigen(''); }

  async function exportar() {
    setExportando(true);
    try { await descargar('/contactos/exportar', 'contactos.csv'); toast.success('Exportación descargada'); }
    catch (e) { toast.error((e as Error).message); }
    finally { setExportando(false); }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader icono={<Users className="h-5 w-5" />} titulo="Contactos"
        descripcion={lista.data ? `${numero(total)} contacto${total === 1 ? '' : 's'}${hayFiltros ? ' con los filtros aplicados' : ' en tu base'}` : 'Tu base de clientes y prospectos'}
        acciones={<>
          {puedeSup && <Button variante="secundario" icono={<Upload className="h-4 w-4" />} onClick={() => setImportando(true)}>Importar CSV</Button>}
          {puedeSup && <Button variante="secundario" icono={<Download className="h-4 w-4" />} cargando={exportando} onClick={exportar}>Exportar</Button>}
          <Button icono={<Plus className="h-4 w-4" />} onClick={() => setCreando(true)}>Nuevo contacto</Button>
        </>} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex h-full max-w-7xl flex-col p-6">
          <div className="card flex min-h-[420px] flex-1 flex-col overflow-hidden">
            {/* Barra de herramientas */}
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3">
              <div className="w-full sm:w-64">
                <Input icono={<Search className="h-4 w-4" />} placeholder="Buscar nombre, teléfono, email, DNI…" value={q}
                  onChange={(e) => setQ(e.target.value)} className="h-9 py-1.5 text-[13px]" />
              </div>
              <Select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} className={cn('h-9 w-44 py-1.5 text-[13px]', etiqueta && 'border-brand-300 bg-brand-50/40')}>
                <option value="">Todas las etiquetas</option>
                {etiquetas?.map((t) => <option key={t.etiqueta_id} value={t.etiqueta_id}>{t.nombre}</option>)}
              </Select>
              <Select value={asignado} onChange={(e) => setAsignado(e.target.value)} className={cn('h-9 w-48 py-1.5 text-[13px]', asignado && 'border-brand-300 bg-brand-50/40')}>
                <option value="">Cualquier responsable</option>
                {equipo?.miembros.filter((m) => m.activo).map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nombre}</option>)}
              </Select>
              <Select value={origen} onChange={(e) => setOrigen(e.target.value)} className={cn('h-9 w-40 py-1.5 text-[13px]', origen && 'border-brand-300 bg-brand-50/40')}>
                <option value="">Todo origen</option>
                {Object.entries(ORIGENES).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
              </Select>
              {hayFiltros && <Button variante="fantasma" tamano="sm" icono={<X className="h-3.5 w-3.5" />} onClick={limpiarFiltros}>Limpiar</Button>}
              <div className="ml-auto flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-ink-400" />
                <Select value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)} className="h-9 w-44 py-1.5 text-[13px]">
                  <option value="recientes">Más recientes</option>
                  <option value="actividad">Última actividad</option>
                  <option value="nombre">Nombre (A–Z)</option>
                </Select>
              </div>
            </div>

            {sel.size > 0 && (
              <div className="flex items-center gap-3 border-b border-brand-100 bg-brand-50/60 px-4 py-2 text-[13px] text-brand-800">
                <span className="font-semibold">{sel.size} seleccionado{sel.size === 1 ? '' : 's'}</span>
                <span className="text-brand-600/80">Las acciones masivas estarán disponibles pronto.</span>
                <Button variante="fantasma" tamano="xs" className="ml-auto text-brand-700 hover:bg-brand-100" onClick={() => setSel(new Set())}>Quitar selección</Button>
              </div>
            )}

            {/* Tabla */}
            <div className={cn('relative min-h-0 flex-1 overflow-auto', lista.isFetching && lista.isPlaceholderData && 'opacity-60 transition-opacity')}>
              {lista.isLoading ? (
                <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
              ) : lista.isError ? (
                <Vacio icono={<AlertCircle className="h-5 w-5" />} titulo="No se pudieron cargar los contactos" texto={(lista.error as Error).message}
                  accion={<Button variante="secundario" onClick={() => lista.refetch()}>Reintentar</Button>} />
              ) : !items.length ? (
                hayFiltros ? (
                  <Vacio icono={<Search className="h-5 w-5" />} titulo="Sin resultados" texto="Ningún contacto coincide con la búsqueda o los filtros."
                    accion={<Button variante="secundario" onClick={limpiarFiltros}>Limpiar filtros</Button>} />
                ) : (
                  <Vacio icono={<Users className="h-5 w-5" />} titulo="Aún no tienes contactos"
                    texto="Se crean solos cuando te escriben por tus canales, o puedes agregarlos a mano o importarlos desde un CSV."
                    accion={<div className="flex gap-2">
                      {puedeSup && <Button variante="secundario" icono={<Upload className="h-4 w-4" />} onClick={() => setImportando(true)}>Importar CSV</Button>}
                      <Button icono={<Plus className="h-4 w-4" />} onClick={() => setCreando(true)}>Nuevo contacto</Button>
                    </div>} />
                )
              ) : (
                <table className="w-full min-w-[1080px] text-[13px]">
                  <thead className="sticky top-0 z-10 bg-ink-50/95 backdrop-blur supports-[backdrop-filter]:bg-ink-50/80">
                    <tr className="border-b border-ink-100">
                      <th className="th w-10 pr-0">
                        <input type="checkbox" aria-label="Seleccionar página" checked={todosSel}
                          ref={(el) => { if (el) el.indeterminate = algunoSel && !todosSel; }}
                          onChange={alternarTodos} className="h-4 w-4 cursor-pointer rounded border-ink-300 accent-brand-600" />
                      </th>
                      <th className="th">Contacto</th>
                      <th className="th">Teléfono</th>
                      <th className="th">Email</th>
                      <th className="th">Canales</th>
                      <th className="th">Etiquetas</th>
                      <th className="th">Responsable</th>
                      <th className="th">Origen</th>
                      <th className="th text-right">Actividad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {items.map((c) => {
                      const marcado = sel.has(c.contacto_id);
                      return (
                        <tr key={c.contacto_id} onClick={() => router.push(`/contactos/${c.contacto_id}`)}
                          className={cn('group cursor-pointer transition-colors', marcado ? 'bg-brand-50/50 hover:bg-brand-50' : 'hover:bg-ink-50/70')}>
                          <td className="td w-10 py-2.5 pr-0" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" aria-label="Seleccionar" checked={marcado} onChange={() => alternar(c.contacto_id)}
                              className="h-4 w-4 cursor-pointer rounded border-ink-300 accent-brand-600" />
                          </td>
                          <td className="td py-2.5">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <Avatar nombre={c.nombre ?? c.telefono} size={32} />
                              <div className="min-w-0">
                                <p className="max-w-[220px] truncate font-medium text-ink-900 group-hover:text-brand-700">{c.nombre || <span className="italic text-ink-400">Sin nombre</span>}</p>
                                {c.empresa_nombre && <p className="max-w-[220px] truncate text-xs text-ink-500">{c.empresa_nombre}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="td whitespace-nowrap py-2.5 tabular-nums text-ink-700">{telefonoBonito(c.telefono) || <span className="text-ink-300">—</span>}</td>
                          <td className="td py-2.5 text-ink-600"><span className="block max-w-[200px] truncate">{c.email || <span className="text-ink-300">—</span>}</span></td>
                          <td className="td py-2.5">
                            <div className="flex items-center gap-1">
                              {c.canales.length ? c.canales.map((k) => (
                                <Tooltip key={k} texto={CANAL_INFO[k]?.label ?? k}>
                                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', CANAL_INFO[k]?.bg, CANAL_INFO[k]?.texto)}>
                                    <IconoCanal canal={k} size={13} />
                                  </span>
                                </Tooltip>
                              )) : <span className="text-ink-300">—</span>}
                            </div>
                          </td>
                          <td className="td py-2.5">
                            <div className="flex max-w-[240px] flex-wrap items-center gap-1">
                              {c.etiquetas.slice(0, 3).map((e) => <EtiquetaChip key={e.etiqueta_id} nombre={e.nombre} color={e.color} size="xs" />)}
                              {c.etiquetas.length > 3 && (
                                <Tooltip texto={c.etiquetas.slice(3).map((e) => e.nombre).join(', ')}>
                                  <span className="rounded-md bg-ink-100 px-1.5 py-px text-[10px] font-semibold text-ink-600">+{c.etiquetas.length - 3}</span>
                                </Tooltip>
                              )}
                              {!c.etiquetas.length && <span className="text-ink-300">—</span>}
                            </div>
                          </td>
                          <td className="td py-2.5">
                            {c.asignado_nombre ? (
                              <div className="flex items-center gap-1.5">
                                <Avatar nombre={c.asignado_nombre} color={c.asignado_color} size={22} />
                                <span className="max-w-[110px] truncate text-ink-700">{c.asignado_nombre.split(' ')[0]}</span>
                              </div>
                            ) : <span className="text-xs text-ink-400">Sin asignar</span>}
                          </td>
                          <td className="td py-2.5"><OrigenBadge origen={c.origen} /></td>
                          <td className="td whitespace-nowrap py-2.5 text-right text-xs text-ink-500">
                            {c.ultima_actividad ? <Tooltip texto={new Date(c.ultima_actividad).toLocaleString('es-PE')}><span>hace {hace(c.ultima_actividad)}</span></Tooltip> : <span className="text-ink-300">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pie: paginación */}
            {total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/40 px-4 py-2.5 text-[13px] text-ink-600">
                <p><span className="font-medium text-ink-900">{numero(desde)}–{numero(hasta)}</span> de <span className="font-medium text-ink-900">{numero(total)}</span></p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-ink-500">
                    Filas por página
                    <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                      className="h-7 rounded-md border border-ink-200 bg-white px-1.5 text-xs text-ink-800 focus:border-brand-500 focus:outline-none">
                      {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <span className="text-xs text-ink-500">Página {page} de {paginas}</span>
                  <div className="flex gap-1">
                    <Button variante="secundario" tamano="icono-sm" aria-label="Anterior" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                    <Button variante="secundario" tamano="icono-sm" aria-label="Siguiente" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <NuevoContactoModal abierto={creando} onClose={() => setCreando(false)} onCreado={(id) => router.push(`/contactos/${id}`)} />
      {puedeSup && <ImportarModal abierto={importando} onClose={() => setImportando(false)} />}
    </div>
  );
}

// ── Selector de etiquetas (chips, respeta grupos exclusivos) ─────────────────

function ChipsEtiquetas({ todas, valor, onChange }: { todas: Etiqueta[]; valor: number[]; onChange: (ids: number[]) => void }) {
  function alternar(t: Etiqueta) {
    if (valor.includes(t.etiqueta_id)) return onChange(valor.filter((x) => x !== t.etiqueta_id));
    const mismoGrupo = t.grupo_exclusivo ? todas.filter((o) => o.grupo_exclusivo === t.grupo_exclusivo).map((o) => o.etiqueta_id) : [];
    onChange([...valor.filter((x) => !mismoGrupo.includes(x)), t.etiqueta_id]);
  }
  if (!todas.length) return <p className="text-xs text-ink-400">No hay etiquetas creadas. Puedes crearlas en Configuración.</p>;
  const grupos = new Map<string, Etiqueta[]>();
  for (const t of todas) grupos.set(t.grupo_exclusivo ?? '', [...(grupos.get(t.grupo_exclusivo ?? '') ?? []), t]);
  const orden = [...grupos.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  return (
    <div className="space-y-2">
      {orden.map(([g, lista]) => (
        <div key={g || '_'} className="flex flex-wrap items-center gap-1.5">
          {g && <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400" title="Grupo exclusivo: solo una">{g}</span>}
          {lista.map((t) => {
            const on = valor.includes(t.etiqueta_id);
            return (
              <button key={t.etiqueta_id} type="button" onClick={() => alternar(t)}
                className={cn('inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium transition-all', g ? 'rounded-full' : 'rounded-md',
                  on ? 'shadow-xs' : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300')}
                style={on ? { backgroundColor: t.color + '18', borderColor: t.color + '80', color: t.color } : undefined}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.color }} />{t.nombre}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Modal: nuevo contacto ────────────────────────────────────────────────────

const VACIO = { nombre: '', telefono: '', email: '', documento: '', empresa_nombre: '', asignado_a: '', pipeline_id: '' };

function NuevoContactoModal({ abierto, onClose, onCreado }: { abierto: boolean; onClose: () => void; onCreado: (id: number) => void }) {
  const qc = useQueryClient();
  const { data: etiquetas } = useEtiquetas();
  const { data: campos } = useCampos();
  const { data: pipelines } = usePipelines();
  const { data: equipo } = useMiembros();
  const [f, setF] = useState(VACIO);
  const [valores, setValores] = useState<Record<string, unknown>>({});
  const [ets, setEts] = useState<number[]>([]);
  const [error, setError] = useState<{ campo?: 'telefono' | 'email'; msg: string } | null>(null);
  const camposContacto = (campos ?? []).filter((c) => c.entidad === 'contacto');

  useEffect(() => { if (abierto) { setF(VACIO); setValores({}); setEts([]); setError(null); } }, [abierto]);

  const crear = useMutation({
    mutationFn: () => api.post<{ contacto: { contacto_id: number } }>('/contactos', {
      nombre: f.nombre.trim() || null, telefono: f.telefono.trim() || null, email: f.email.trim() || null,
      documento: f.documento.trim() || null, empresa_nombre: f.empresa_nombre.trim() || null,
      asignado_a: f.asignado_a || null, valores, etiqueta_ids: ets, pipeline_id: f.pipeline_id ? Number(f.pipeline_id) : null,
    }),
    onSuccess: (r) => {
      toast.success('Contacto creado');
      qc.invalidateQueries({ queryKey: ['contactos'] });
      if (f.pipeline_id) qc.invalidateQueries({ queryKey: ['tablero'] });
      onClose();
      onCreado(r.contacto.contacto_id);
    },
    onError: (e) => {
      const msg = (e as Error).message;
      const campo = /tel[eé]fono/i.test(msg) ? 'telefono' : /email|correo/i.test(msg) ? 'email' : undefined;
      setError({ campo, msg });
    },
  });

  const valido = !!(f.nombre.trim() || f.telefono.trim() || f.email.trim());
  const set = (k: keyof typeof VACIO) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); if (error) setError(null); };

  return (
    <Modal abierto={abierto} onClose={onClose} ancho="lg" titulo="Nuevo contacto" descripcion="Ingresa al menos nombre, teléfono o email."
      pie={<>
        <Button variante="secundario" onClick={onClose}>Cancelar</Button>
        <Button disabled={!valido} cargando={crear.isPending} onClick={() => crear.mutate()}>Crear contacto</Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); if (valido) crear.mutate(); }} className="space-y-6">
        {error && !error.campo && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error.msg}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" className="sm:col-span-2"><Input autoFocus value={f.nombre} onChange={set('nombre')} placeholder="Ej. María Fernández" /></Field>
          <Field label="Teléfono" hint="+51 987 654 321 o 9 dígitos" error={error?.campo === 'telefono' ? error.msg : null}>
            <Input type="tel" value={f.telefono} onChange={set('telefono')} placeholder="987 654 321" className={cn(error?.campo === 'telefono' && 'border-red-300')} />
          </Field>
          <Field label="Email" error={error?.campo === 'email' ? error.msg : null}>
            <Input type="email" value={f.email} onChange={set('email')} placeholder="nombre@correo.com" className={cn(error?.campo === 'email' && 'border-red-300')} />
          </Field>
          <Field label="Documento" hint="DNI o RUC"><Input value={f.documento} onChange={set('documento')} placeholder="12345678" /></Field>
          <Field label="Empresa"><Input value={f.empresa_nombre} onChange={set('empresa_nombre')} placeholder="Razón social o comercio" /></Field>
          <Field label="Responsable">
            <Select value={f.asignado_a} onChange={set('asignado_a')}>
              <option value="">Sin asignar</option>
              {equipo?.miembros.filter((m) => m.activo).map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nombre}</option>)}
            </Select>
          </Field>
          <Field label="Agregar a pipeline" hint="Crea un negocio en la primera etapa">
            <Select value={f.pipeline_id} onChange={set('pipeline_id')}>
              <option value="">No agregar</option>
              {pipelines?.filter((p) => p.activo).map((p) => <option key={p.pipeline_id} value={p.pipeline_id}>{p.nombre}</option>)}
            </Select>
          </Field>
        </div>

        <div>
          <p className="label">Etiquetas</p>
          <ChipsEtiquetas todas={etiquetas ?? []} valor={ets} onChange={setEts} />
        </div>

        {camposContacto.length > 0 && (
          <div className="border-t border-ink-100 pt-5">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Campos personalizados</h4>
            <CamposForm campos={camposContacto} valores={valores} onChange={setValores} />
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

// ── Importación CSV ──────────────────────────────────────────────────────────

type Destino = 'ignorar' | 'nombre' | 'telefono' | 'email' | 'documento' | 'empresa_nombre' | `campo:${string}`;
const ESTANDAR: Array<{ valor: Destino; label: string }> = [
  { valor: 'nombre', label: 'Nombre' }, { valor: 'telefono', label: 'Teléfono' }, { valor: 'email', label: 'Email' },
  { valor: 'documento', label: 'Documento (DNI/RUC)' }, { valor: 'empresa_nombre', label: 'Empresa' },
];
const CHUNK = 500;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function adivinar(header: string, campos: Campo[]): Destino {
  const h = norm(header);
  if (!h) return 'ignorar';
  const tiene = (...ps: string[]) => ps.some((p) => h === p || h.split(' ').includes(p));
  if (tiene('nombre', 'nombres', 'name', 'cliente', 'contacto', 'full name', 'nombre completo')) return 'nombre';
  if (tiene('telefono', 'celular', 'phone', 'whatsapp', 'movil', 'cel', 'tel', 'numero', 'mobile')) return 'telefono';
  if (tiene('email', 'correo', 'mail', 'e mail')) return 'email';
  if (tiene('dni', 'ruc', 'documento', 'doc', 'ce', 'pasaporte')) return 'documento';
  if (tiene('empresa', 'company', 'compania', 'negocio', 'razon social', 'organizacion')) return 'empresa_nombre';
  const c = campos.find((x) => norm(x.clave) === h || norm(x.nombre) === h);
  return c ? `campo:${c.clave}` : 'ignorar';
}

interface Resultado { creados: number; actualizados: number; omitidos: number; errores: Array<{ fila: number; error: string }> }

function ImportarModal({ abierto, onClose }: { abierto: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: etiquetas } = useEtiquetas();
  const { data: campos } = useCampos();
  const camposContacto = useMemo(() => (campos ?? []).filter((c) => c.entidad === 'contacto'), [campos]);
  const inputRef = useRef<HTMLInputElement>(null);

  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [archivo, setArchivo] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [filas, setFilas] = useState<Record<string, string>[]>([]);
  const [mapa, setMapa] = useState<Record<string, Destino>>({});
  const [ets, setEts] = useState<number[]>([]);
  const [duplicados, setDuplicados] = useState<'omitir' | 'actualizar'>('omitir');
  const [arrastrando, setArrastrando] = useState(false);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [progreso, setProgreso] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);

  function reiniciar() {
    setPaso(1); setArchivo(null); setHeaders([]); setFilas([]); setMapa({}); setEts([]); setDuplicados('omitir');
    setErrorArchivo(null); setProgreso(0); setEnviando(false); setRes(null);
  }
  useEffect(() => { if (abierto) reiniciar(); }, [abierto]);

  function leer(file: File) {
    setErrorArchivo(null);
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') { setErrorArchivo('El archivo debe ser .csv'); return; }
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      transformHeader: (h) => h.replace(/^﻿/, '').trim(),
      complete: (r) => {
        const hs = (r.meta.fields ?? []).filter(Boolean);
        if (!hs.length || !r.data.length) { setErrorArchivo('No se encontraron filas. Verifica que el CSV tenga cabecera y datos.'); return; }
        const m: Record<string, Destino> = {};
        const usados = new Set<Destino>();
        for (const h of hs) {
          const g = adivinar(h, camposContacto);
          m[h] = g !== 'ignorar' && usados.has(g) ? 'ignorar' : g;
          usados.add(m[h]);
        }
        setArchivo(file.name); setHeaders(hs); setFilas(r.data); setMapa(m);
      },
      error: (e) => setErrorArchivo(e.message),
    });
  }

  function construir(r: Record<string, string>) {
    const o: { nombre?: string; telefono?: string; email?: string; documento?: string; empresa_nombre?: string; valores?: Record<string, string> } = {};
    for (const h of headers) {
      const d = mapa[h];
      const v = (r[h] ?? '').trim();
      if (!d || d === 'ignorar' || !v) continue;
      if (d.startsWith('campo:')) (o.valores ??= {})[d.slice(6)] = v;
      else o[d as 'nombre'] = v;
    }
    return o;
  }

  const destinos = Object.values(mapa);
  const tieneClave = destinos.some((d) => d === 'nombre' || d === 'telefono' || d === 'email');
  const repetidos = destinos.filter((d, i) => d !== 'ignorar' && destinos.indexOf(d) !== i);
  const columnasPrev = headers.filter((h) => mapa[h] && mapa[h] !== 'ignorar');
  const etiquetaDe = (d: Destino) => ESTANDAR.find((x) => x.valor === d)?.label ?? camposContacto.find((c) => `campo:${c.clave}` === d)?.nombre ?? d;

  async function importar() {
    setPaso(3); setEnviando(true); setProgreso(0);
    const acc: Resultado = { creados: 0, actualizados: 0, omitidos: 0, errores: [] };
    const todas = filas.map(construir);
    try {
      for (let i = 0; i < todas.length; i += CHUNK) {
        const r = await api.post<Resultado>('/contactos/importar', { filas: todas.slice(i, i + CHUNK), etiqueta_ids: ets, duplicados });
        acc.creados += r.creados; acc.actualizados += r.actualizados; acc.omitidos += r.omitidos;
        acc.errores.push(...r.errores.map((e) => ({ ...e, fila: e.fila + i })));
        setProgreso(Math.min(todas.length, i + CHUNK) / todas.length);
      }
      setRes(acc);
      toast.success(`Importación completa: ${acc.creados} creados, ${acc.actualizados} actualizados`);
    } catch (e) {
      setRes(acc);
      acc.errores.push({ fila: 0, error: `Se detuvo la importación: ${(e as Error).message}` });
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
      qc.invalidateQueries({ queryKey: ['contactos'] });
      qc.invalidateQueries({ queryKey: ['etiquetas'] });
    }
  }

  function plantilla() {
    const cab = ['nombre', 'telefono', 'email', 'documento', 'empresa', ...camposContacto.map((c) => c.clave)];
    const ej = [
      ['María Fernández', '987654321', 'maria@correo.com', '45678912', 'Ferretería El Sol', ...camposContacto.map(() => '')],
      ['Juan Pérez', '+51 912 345 678', 'juan.perez@gmail.com', '20123456789', 'Constructora JP SAC', ...camposContacto.map(() => '')],
    ];
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = '﻿' + [cab, ...ej].map((l) => l.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'plantilla-contactos.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  const PASOS = ['Archivo', 'Columnas', 'Importar'];

  return (
    <Modal abierto={abierto} onClose={() => !enviando && onClose()} ancho="lg" titulo="Importar contactos desde CSV"
      descripcion="Los teléfonos se normalizan a formato internacional (+51…). Hasta miles de filas por archivo."
      pie={<>
        {paso === 1 && <>
          <Button variante="secundario" onClick={onClose}>Cancelar</Button>
          <Button disabled={!archivo} icono={<ArrowRight className="h-4 w-4" />} onClick={() => setPaso(2)}>Continuar</Button>
        </>}
        {paso === 2 && <>
          <Button variante="secundario" className="mr-auto" icono={<ChevronLeft className="h-4 w-4" />} onClick={() => setPaso(1)}>Atrás</Button>
          <Button variante="secundario" onClick={onClose}>Cancelar</Button>
          <Button disabled={!tieneClave || repetidos.length > 0} icono={<Upload className="h-4 w-4" />} onClick={importar}>Importar {numero(filas.length)} fila{filas.length === 1 ? '' : 's'}</Button>
        </>}
        {paso === 3 && <>
          {!enviando && res && <Button variante="secundario" className="mr-auto" onClick={reiniciar}>Importar otro archivo</Button>}
          <Button disabled={enviando} onClick={onClose}>{enviando ? 'Importando…' : 'Listo'}</Button>
        </>}
      </>}>
      {/* Indicador de pasos */}
      <ol className="mb-6 flex items-center gap-2">
        {PASOS.map((p, i) => {
          const n = i + 1;
          const hecho = paso > n || (paso === 3 && !!res && !enviando);
          return (
            <li key={p} className="flex flex-1 items-center gap-2">
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                hecho ? 'bg-emerald-500 text-white' : paso === n ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-500')}>
                {hecho ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
              </span>
              <span className={cn('text-[13px] font-medium', paso === n ? 'text-ink-900' : 'text-ink-500')}>{p}</span>
              {i < PASOS.length - 1 && <span className={cn('h-px flex-1', paso > n ? 'bg-emerald-300' : 'bg-ink-200')} />}
            </li>
          );
        })}
      </ol>

      {paso === 1 && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); const f = e.dataTransfer.files?.[0]; if (f) leer(f); }}
            onClick={() => inputRef.current?.click()}
            className={cn('flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              arrastrando ? 'border-brand-400 bg-brand-50/60' : archivo ? 'border-emerald-300 bg-emerald-50/40' : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50/60')}>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="csv-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) leer(f); e.target.value = ''; }} />
            {archivo ? (
              <>
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600"><FileSpreadsheet className="h-6 w-6" /></span>
                <p className="text-sm font-semibold text-ink-900">{archivo}</p>
                <p className="mt-0.5 text-[13px] text-ink-500">{numero(filas.length)} fila{filas.length === 1 ? '' : 's'} · {headers.length} columna{headers.length === 1 ? '' : 's'}</p>
                <p className="mt-3 text-xs font-medium text-brand-600">Elegir otro archivo</p>
              </>
            ) : (
              <>
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><FileUp className="h-6 w-6" /></span>
                <p className="text-sm font-semibold text-ink-900">Arrastra tu archivo CSV aquí</p>
                <p className="mt-0.5 text-[13px] text-ink-500">o <span className="font-medium text-brand-600">haz clic para buscarlo</span> · la primera fila debe ser la cabecera</p>
              </>
            )}
          </div>
          {errorArchivo && <p className="flex items-center gap-1.5 text-[13px] text-red-600"><AlertCircle className="h-4 w-4" />{errorArchivo}</p>}
          <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2.5 text-[13px] text-ink-600">
            <span>¿No sabes qué formato usar? Descarga un ejemplo con las columnas esperadas.</span>
            <Button variante="enlace" tamano="sm" icono={<Download className="h-3.5 w-3.5" />} onClick={plantilla}>Descargar plantilla CSV</Button>
          </div>
        </div>
      )}

      {paso === 2 && (
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="label mb-0">Asigna cada columna del archivo</p>
              <span className="text-xs text-ink-400">{archivo} · {numero(filas.length)} filas</span>
            </div>
            <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">
              {headers.map((h) => {
                const dup = repetidos.includes(mapa[h]);
                return (
                  <div key={h} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink-800">{h}</p>
                      <p className="truncate text-xs text-ink-400">{filas.slice(0, 3).map((r) => r[h]).filter(Boolean).join(' · ') || 'vacío'}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-300" />
                    <div className="w-52 shrink-0">
                      <Select value={mapa[h]} onChange={(e) => setMapa({ ...mapa, [h]: e.target.value as Destino })}
                        className={cn('h-8 py-1 text-[13px]', mapa[h] === 'ignorar' ? 'text-ink-400' : 'border-brand-200 bg-brand-50/30', dup && 'border-red-300 bg-red-50')}>
                        <option value="ignorar">— Ignorar —</option>
                        <optgroup label="Datos del contacto">
                          {ESTANDAR.map((d) => <option key={d.valor} value={d.valor}>{d.label}</option>)}
                        </optgroup>
                        {camposContacto.length > 0 && (
                          <optgroup label="Campos personalizados">
                            {camposContacto.map((c) => <option key={c.clave} value={`campo:${c.clave}`}>{c.nombre}</option>)}
                          </optgroup>
                        )}
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
            {!tieneClave && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700"><AlertCircle className="h-3.5 w-3.5" />Asigna al menos una columna a Nombre, Teléfono o Email.</p>}
            {repetidos.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600"><AlertCircle className="h-3.5 w-3.5" />Hay columnas asignadas al mismo destino ({[...new Set(repetidos)].map(etiquetaDe).join(', ')}).</p>}
          </div>

          {columnasPrev.length > 0 && (
            <div>
              <p className="label">Vista previa <span className="font-normal text-ink-400">(primeras {Math.min(5, filas.length)} filas)</span></p>
              <div className="overflow-x-auto rounded-lg border border-ink-200">
                <table className="w-full text-xs">
                  <thead className="bg-ink-50"><tr>{columnasPrev.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-ink-600">{etiquetaDe(mapa[h])}</th>)}</tr></thead>
                  <tbody className="divide-y divide-ink-100">
                    {filas.slice(0, 5).map((r, i) => (
                      <tr key={i}>{columnasPrev.map((h) => <td key={h} className="max-w-[180px] truncate whitespace-nowrap px-3 py-1.5 text-ink-700">{r[h] || <span className="text-ink-300">—</span>}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <p className="label">Aplicar etiquetas a todos los importados</p>
            <ChipsEtiquetas todas={etiquetas ?? []} valor={ets} onChange={setEts} />
          </div>

          <div>
            <p className="label">Si el teléfono o email ya existe</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {([['omitir', 'Omitir la fila', 'No se modifica el contacto existente.'], ['actualizar', 'Actualizar el contacto', 'Completa y sobrescribe con los datos del archivo.']] as const).map(([v, t, d]) => (
                <label key={v} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors', duplicados === v ? 'border-brand-400 bg-brand-50/50 ring-4 ring-brand-500/10' : 'border-ink-200 hover:border-ink-300')}>
                  <input type="radio" name="duplicados" checked={duplicados === v} onChange={() => setDuplicados(v)} className="mt-0.5 accent-brand-600" />
                  <span><span className="block text-[13px] font-medium text-ink-900">{t}</span><span className="block text-xs text-ink-500">{d}</span></span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {paso === 3 && (
        <div className="space-y-5">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <span className="font-medium text-ink-800">{enviando ? 'Importando contactos…' : 'Importación finalizada'}</span>
              <span className="tabular-nums text-ink-500">{Math.round(progreso * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-100">
              <div className={cn('h-full rounded-full transition-all duration-500', enviando ? 'bg-brand-500' : 'bg-emerald-500')} style={{ width: `${Math.max(progreso * 100, enviando ? 4 : 0)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-ink-400">{numero(filas.length)} filas en lotes de {CHUNK}</p>
          </div>
          {res && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { l: 'Creados', v: res.creados, c: 'text-emerald-600 bg-emerald-50' },
                  { l: 'Actualizados', v: res.actualizados, c: 'text-sky-600 bg-sky-50' },
                  { l: 'Omitidos', v: res.omitidos, c: 'text-ink-600 bg-ink-100' },
                  { l: 'Con error', v: res.errores.length, c: res.errores.length ? 'text-red-600 bg-red-50' : 'text-ink-600 bg-ink-100' },
                ].map((s) => (
                  <div key={s.l} className={cn('rounded-xl px-3 py-3', s.c)}>
                    <p className="text-2xl font-semibold tabular-nums">{numero(s.v)}</p>
                    <p className="text-xs font-medium opacity-80">{s.l}</p>
                  </div>
                ))}
              </div>
              {res.errores.length > 0 && (
                <div>
                  <p className="label">Filas con error</p>
                  <div className="max-h-52 overflow-y-auto rounded-lg border border-red-100 bg-red-50/30">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-red-100">
                        {res.errores.map((e, i) => (
                          <tr key={i}>
                            <td className="w-20 whitespace-nowrap px-3 py-1.5 font-mono text-ink-500">{e.fila ? `Fila ${e.fila}` : '—'}</td>
                            <td className="px-3 py-1.5 text-red-700">{e.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1.5 text-xs text-ink-400">El número de fila corresponde a la línea del archivo (la cabecera es la fila 1).</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
