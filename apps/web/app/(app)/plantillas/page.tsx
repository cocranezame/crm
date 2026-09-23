'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, ArrowLeft, Braces, CheckCircle2, Clock3, CornerUpLeft, ExternalLink, FileText, FlaskConical, Info,
  MoreHorizontal, PauseCircle, Pencil, Phone, Plus, RefreshCw, Search, Send, Trash2, Variable, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { cn, fechaHora, hace } from '@/lib/utils';
import type { Plantilla, VariablePlantilla } from '@/lib/types';
import { useCampos, useCanales, useMe, usePuede } from '@/hooks/datos';
import { Button, Field, Input, Menu, Modal, PageHeader, Select, Skeleton, Tabs, Textarea, Tooltip, Vacio, confirmar } from '@/components/ui';
import { IconoCanal } from '@/components/crm/canal';

type Estado = Plantilla['estado'];
type Boton = Plantilla['botones'][number];

const ESTADO_PLANTILLA: Record<Estado, { label: string; clase: string; icono: React.ElementType }> = {
  borrador: { label: 'Borrador', clase: 'bg-ink-100 text-ink-600', icono: Pencil },
  pendiente: { label: 'En revisión', clase: 'bg-amber-100 text-amber-700', icono: Clock3 },
  aprobada: { label: 'Aprobada', clase: 'bg-emerald-100 text-emerald-700', icono: CheckCircle2 },
  rechazada: { label: 'Rechazada', clase: 'bg-red-100 text-red-700', icono: AlertCircle },
  pausada: { label: 'Pausada', clase: 'bg-orange-100 text-orange-700', icono: PauseCircle },
};

const CATEGORIAS = [
  { v: 'MARKETING', label: 'Marketing', d: 'Promociones, ofertas, novedades y reactivación de clientes.' },
  { v: 'UTILITY', label: 'Utilidad', d: 'Confirmaciones, recordatorios y avisos sobre un pedido o cita.' },
  { v: 'AUTHENTICATION', label: 'Autenticación', d: 'Códigos de verificación de un solo uso.' },
] as const;
const CATEGORIA_LABEL: Record<string, string> = { MARKETING: 'Marketing', UTILITY: 'Utilidad', AUTHENTICATION: 'Autenticación' };

const IDIOMAS = [
  { v: 'es', label: 'Español' }, { v: 'es_PE', label: 'Español (Perú)' }, { v: 'es_MX', label: 'Español (México)' }, { v: 'en_US', label: 'Inglés (EE. UU.)' },
];

const CAMPOS_CONTACTO = [
  { v: 'nombre', label: 'Nombre', ej: 'María' }, { v: 'telefono', label: 'Teléfono', ej: '+51 987 654 321' },
  { v: 'email', label: 'Correo', ej: 'maria@correo.pe' }, { v: 'documento', label: 'Documento', ej: '45678912' },
  { v: 'empresa_nombre', label: 'Empresa del contacto', ej: 'Constructora Andina' },
];

function indicesDe(cuerpo: string): number[] {
  const set = new Set<number>();
  for (const m of cuerpo.matchAll(/\{\{(\d+)\}\}/g)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

export default function PlantillasPage() {
  const qc = useQueryClient();
  const puede = usePuede('supervisor');
  const { data: canalesData, isLoading: cargandoCanales } = useCanales();
  const canalesWa = useMemo(() => (canalesData?.canales ?? []).filter((c) => c.tipo === 'whatsapp'), [canalesData]);
  const [canal, setCanal] = useState('');
  const [estado, setEstado] = useState<'todas' | Estado>('todas');
  const [q, setQ] = useState('');
  const [editando, setEditando] = useState<Plantilla | 'nueva' | null>(null);
  const [sincronizando, setSincronizando] = useState<number | null>(null);

  const lista = useQuery({
    queryKey: ['plantillas', canal],
    queryFn: () => api.get<{ plantillas: Plantilla[] }>(`/plantillas${qs({ canal_id: canal })}`),
    select: (d) => d.plantillas,
  });
  const todas = lista.data ?? [];
  const cuenta = (e: Estado) => todas.filter((p) => p.estado === e).length;
  const filtradas = todas.filter((p) => (estado === 'todas' || p.estado === estado)
    && (!q.trim() || p.nombre.includes(q.trim().toLowerCase()) || p.cuerpo.toLowerCase().includes(q.trim().toLowerCase())));

  const inv = () => qc.invalidateQueries({ queryKey: ['plantillas'] });

  const revision = useMutation({
    mutationFn: (p: Plantilla) => api.post<{ estado: Estado }>(`/plantillas/${p.plantilla_id}/enviar-revision`),
    onSuccess: (r, p) => {
      toast.success(r.estado === 'aprobada' ? 'Plantilla aprobada por Meta' : p.sandbox ? 'Enviada a revisión · el canal de prueba la aprobará en unos segundos' : 'Enviada a revisión de Meta');
      inv();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function sincronizar(canalId: number) {
    setSincronizando(canalId);
    try {
      const r = await api.post<{ actualizadas: number; importadas: number }>('/plantillas/sincronizar', { canal_id: canalId });
      const c = canalesWa.find((x) => x.canal_id === canalId);
      toast.success(c?.sandbox ? 'Canal de prueba: no hay nada que sincronizar con Meta' : `Sincronizado · ${r.actualizadas} actualizada${r.actualizadas !== 1 ? 's' : ''}, ${r.importadas} importada${r.importadas !== 1 ? 's' : ''}`);
      inv();
    } catch (e) { toast.error((e as Error).message); } finally { setSincronizando(null); }
  }

  async function eliminar(p: Plantilla) {
    const ok = await confirmar({
      titulo: `¿Eliminar ${p.nombre}?`, confirmar: 'Eliminar', peligro: true,
      texto: p.estado === 'borrador' ? 'El borrador se eliminará definitivamente.' : 'También se eliminará en Meta. Las difusiones que ya la usaron conservan su historial.',
    });
    if (!ok) return;
    try { await api.del(`/plantillas/${p.plantilla_id}`); toast.success('Plantilla eliminada'); inv(); }
    catch (e) { toast.error((e as Error).message); }
  }

  const botonSync = puede && canalesWa.length > 0 && (canalesWa.length === 1 ? (
    <Button variante="secundario" icono={<RefreshCw className={cn('h-4 w-4', sincronizando && 'animate-spin')} />} disabled={!!sincronizando}
      onClick={() => sincronizar(canalesWa[0].canal_id)}>Sincronizar con Meta</Button>
  ) : (
    <Menu trigger={<Button variante="secundario" icono={<RefreshCw className={cn('h-4 w-4', sincronizando && 'animate-spin')} />} disabled={!!sincronizando}>Sincronizar con Meta</Button>}
      items={canalesWa.map((c) => ({ label: c.nombre, icono: <IconoCanal canal="whatsapp" size={14} />, onClick: () => sincronizar(c.canal_id) }))} />
  ));

  return (
    <div className="flex h-full flex-col">
      <PageHeader icono={<FileText className="h-5 w-5" />} titulo="Plantillas de WhatsApp"
        descripcion="Mensajes preaprobados por Meta para escribir fuera de la ventana de 24 h y enviar difusiones"
        acciones={<>{botonSync}{puede && canalesWa.length > 0 && <Button icono={<Plus className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nueva plantilla</Button>}</>} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6">
          {cargandoCanales ? (
            <div className="card space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : !canalesWa.length ? (
            <div className="card"><Vacio icono={<IconoCanal canal="whatsapp" size={20} />} titulo="Conecta WhatsApp para usar plantillas"
              texto="Las plantillas solo aplican a cuentas de WhatsApp Business. Conecta un número o crea un canal de prueba."
              accion={<Link href="/config/canales"><Button>Ir a canales</Button></Link>} /></div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Tabs<'todas' | Estado> valor={estado} onChange={setEstado} opciones={[
                  { valor: 'todas', label: 'Todas', contador: todas.length },
                  { valor: 'aprobada', label: 'Aprobadas', contador: cuenta('aprobada') },
                  { valor: 'pendiente', label: 'En revisión', contador: cuenta('pendiente') },
                  { valor: 'borrador', label: 'Borradores', contador: cuenta('borrador') },
                  { valor: 'rechazada', label: 'Rechazadas', contador: cuenta('rechazada') },
                ]} />
                <div className="ml-auto flex items-center gap-2">
                  {canalesWa.length > 1 && (
                    <Select value={canal} onChange={(e) => setCanal(e.target.value)} className="h-9 w-52 py-1.5 text-[13px]">
                      <option value="">Todas las cuentas</option>
                      {canalesWa.map((c) => <option key={c.canal_id} value={c.canal_id}>{c.nombre}</option>)}
                    </Select>
                  )}
                  <div className="w-64"><Input icono={<Search className="h-4 w-4" />} placeholder="Buscar plantilla" value={q} onChange={(e) => setQ(e.target.value)} className="h-9" /></div>
                </div>
              </div>

              {lista.isLoading ? (
                <div className="card space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
              ) : !todas.length ? (
                <div className="card"><Vacio icono={<FileText className="h-5 w-5" />} titulo="Aún no hay plantillas"
                  texto="Crea tu primera plantilla y envíala a revisión. Meta suele aprobarlas en minutos."
                  accion={puede ? <Button icono={<Plus className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nueva plantilla</Button> : undefined} /></div>
              ) : !filtradas.length ? (
                <div className="card"><Vacio icono={<Search className="h-5 w-5" />} titulo="Sin resultados" texto="Ninguna plantilla coincide con los filtros." /></div>
              ) : (
                <div className="card overflow-hidden">
                  <table className="w-full">
                    <thead className="border-b border-ink-100 bg-ink-50/60">
                      <tr><th className="th">Plantilla</th><th className="th">Categoría</th><th className="th">Estado</th><th className="th">Cuenta</th><th className="th">Actualizada</th><th className="th w-12" /></tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {filtradas.map((p) => {
                        const editable = p.estado === 'borrador' || p.estado === 'rechazada';
                        return (
                          <tr key={p.plantilla_id} className="group cursor-pointer transition-colors hover:bg-ink-50/50" onClick={() => puede && setEditando(p)}>
                            <td className="td max-w-[380px]">
                              <div className="flex items-center gap-2">
                                <code className="truncate font-mono text-[13px] font-semibold text-ink-900">{p.nombre}</code>
                                <span className="rounded bg-ink-100 px-1 font-mono text-[10px] font-medium uppercase text-ink-500">{p.idioma}</span>
                              </div>
                              <p className="mt-0.5 truncate text-[12.5px] text-ink-500">{p.cuerpo}</p>
                            </td>
                            <td className="td text-[13px] text-ink-600">{CATEGORIA_LABEL[p.categoria] ?? p.categoria}</td>
                            <td className="td"><EstadoBadge p={p} /></td>
                            <td className="td">
                              <span className="flex items-center gap-1.5 text-[13px] text-ink-700">
                                <IconoCanal canal="whatsapp" size={13} className="text-emerald-600" />{p.canal_nombre}
                                {p.sandbox && <Tooltip texto="Canal de prueba: aprueba automáticamente"><span className="chip bg-violet-100 text-violet-700"><FlaskConical className="h-2.5 w-2.5" />prueba</span></Tooltip>}
                              </span>
                            </td>
                            <td className="td text-[13px] text-ink-500"><Tooltip texto={fechaHora(p.actualizado_en)}><span>{hace(p.actualizado_en) === 'ahora' ? 'Ahora' : `hace ${hace(p.actualizado_en)}`}</span></Tooltip></td>
                            <td className="td" onClick={(e) => e.stopPropagation()}>
                              {puede && (
                                <div className="flex items-center justify-end gap-1">
                                  {editable && (
                                    <Tooltip texto="Enviar a revisión de Meta">
                                      <Button variante="suave" tamano="xs" icono={<Send className="h-3 w-3" />} cargando={revision.isPending && revision.variables?.plantilla_id === p.plantilla_id}
                                        onClick={() => revision.mutate(p)}>Enviar</Button>
                                    </Tooltip>
                                  )}
                                  <Menu trigger={<button className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><MoreHorizontal className="h-4 w-4" /></button>}
                                    items={[
                                      { label: editable ? 'Editar' : 'Editar variables', icono: editable ? <Pencil className="h-3.5 w-3.5" /> : <Variable className="h-3.5 w-3.5" />, onClick: () => setEditando(p) },
                                      ...(editable ? [{ label: 'Enviar a revisión', icono: <Send className="h-3.5 w-3.5" />, onClick: () => revision.mutate(p) }] : []),
                                      { separador: true, label: '' },
                                      { label: 'Eliminar', icono: <Trash2 className="h-3.5 w-3.5" />, peligro: true, onClick: () => eliminar(p) },
                                    ]} />
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!puede && <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-500"><Info className="h-3.5 w-3.5" />Solo supervisores pueden crear o editar plantillas.</p>}
            </>
          )}
        </div>
      </div>
      {editando && (
        <Editor p={editando === 'nueva' ? null : editando} canales={canalesWa.map((c) => ({ id: c.canal_id, nombre: c.nombre, sandbox: c.sandbox }))}
          canalInicial={canal ? Number(canal) : canalesWa[0]?.canal_id} onClose={() => setEditando(null)} />
      )}
    </div>
  );
}

function EstadoBadge({ p }: { p: Pick<Plantilla, 'estado' | 'motivo_rechazo'> }) {
  const e = ESTADO_PLANTILLA[p.estado] ?? ESTADO_PLANTILLA.borrador;
  const badge = <span className={cn('chip', e.clase)}><e.icono className="h-3 w-3" />{e.label}</span>;
  if (p.estado === 'rechazada' && p.motivo_rechazo) return <Tooltip texto={<>Motivo: {p.motivo_rechazo}</>}><span className="cursor-help">{badge}</span></Tooltip>;
  if (p.estado === 'pendiente') return <Tooltip texto="Meta está revisando la plantilla"><span>{badge}</span></Tooltip>;
  return badge;
}

// ── Editor ──────────────────────────────────────────────────────────────────

interface BotonForm { tipo: Boton['tipo']; texto: string; url: string; telefono: string }

function Editor({ p, canales, canalInicial, onClose }: {
  p: Plantilla | null; canales: Array<{ id: number; nombre: string; sandbox: boolean }>; canalInicial?: number; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: campos } = useCampos();
  const camposContacto = (campos ?? []).filter((c) => c.entidad === 'contacto');
  const soloVariables = !!p && p.estado !== 'borrador' && p.estado !== 'rechazada';

  const [canalId, setCanalId] = useState<number | undefined>(p?.canal_id ?? canalInicial);
  const [nombre, setNombre] = useState(p?.nombre ?? '');
  const [categoria, setCategoria] = useState<Plantilla['categoria']>(p?.categoria ?? 'MARKETING');
  const [idioma, setIdioma] = useState(p?.idioma ?? 'es');
  const [encabezado, setEncabezado] = useState(p?.encabezado ?? '');
  const [cuerpo, setCuerpo] = useState(p?.cuerpo ?? '');
  const [pie, setPie] = useState(p?.pie ?? '');
  const [botones, setBotones] = useState<BotonForm[]>((p?.botones ?? []).map((b) => ({ tipo: b.tipo, texto: b.texto, url: b.url ?? '', telefono: b.telefono ?? '' })));
  const [vars, setVars] = useState<Record<number, VariablePlantilla>>(() => Object.fromEntries((p?.variables ?? []).map((v) => [v.indice, v])));
  const [guardando, setGuardando] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const cursor = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (cursor.current === null || !ta.current) return;
    ta.current.focus();
    ta.current.setSelectionRange(cursor.current, cursor.current);
    cursor.current = null;
  }, [cuerpo]);

  const indices = useMemo(() => indicesDe(cuerpo), [cuerpo]);
  const consecutivas = indices.every((n, i) => n === i + 1);

  // Crea la configuración por defecto de variables nuevas
  useEffect(() => {
    setVars((v) => {
      let cambio = false;
      const n = { ...v };
      for (const i of indices) if (!n[i]) { n[i] = { indice: i, origen: i === 1 ? 'contacto' : 'manual', valor: i === 1 ? 'nombre' : '', ejemplo: i === 1 ? 'María' : '' }; cambio = true; }
      return cambio ? n : v;
    });
  }, [indices]);

  function agregarVariable() {
    const sig = (indices.length ? Math.max(...indices) : 0) + 1;
    const v = `{{${sig}}}`;
    const el = ta.current;
    const ini = el?.selectionStart ?? cuerpo.length;
    const fin = el?.selectionEnd ?? cuerpo.length;
    cursor.current = ini + v.length;
    setCuerpo(cuerpo.slice(0, ini) + v + cuerpo.slice(fin));
  }

  const setVar = (i: number, cambios: Partial<VariablePlantilla>) => setVars((v) => ({ ...v, [i]: { ...v[i], ...cambios } }));
  const setBoton = (i: number, cambios: Partial<BotonForm>) => setBotones((b) => b.map((x, j) => (j === i ? { ...x, ...cambios } : x)));

  // Validación
  const errores: string[] = [];
  if (!canalId) errores.push('Elige la cuenta de WhatsApp');
  if (!/^[a-z0-9_]{1,512}$/.test(nombre)) errores.push('El nombre solo admite minúsculas, números y _');
  if (!cuerpo.trim()) errores.push('Escribe el cuerpo del mensaje');
  if (!consecutivas) errores.push('Las variables deben ser consecutivas: {{1}}, {{2}}, {{3}}…');
  for (const i of indices) {
    const v = vars[i];
    if (!v?.ejemplo?.trim()) { errores.push(`Agrega un ejemplo para {{${i}}}`); break; }
    if ((v.origen === 'contacto' || v.origen === 'campo') && !v.valor) { errores.push(`Elige el dato para {{${i}}}`); break; }
  }
  for (const b of botones) {
    if (!b.texto.trim()) { errores.push('Todos los botones necesitan texto'); break; }
    if (b.tipo === 'URL' && !/^https?:\/\/\S+\.\S+/.test(b.url)) { errores.push('La URL del botón no es válida'); break; }
    if (b.tipo === 'PHONE_NUMBER' && !/^\+\d{8,15}$/.test(b.telefono)) { errores.push('El teléfono debe tener formato +51987654321'); break; }
  }

  async function guardar() {
    if (errores.length) { toast.error(errores[0]); return; }
    setGuardando(true);
    const variables = indices.map((i) => ({ indice: i, origen: vars[i].origen, valor: vars[i].valor ?? '', ejemplo: vars[i].ejemplo.trim() }));
    try {
      if (soloVariables && p) {
        await api.patch(`/plantillas/${p.plantilla_id}`, { variables });
      } else {
        const body = {
          nombre, idioma, categoria, encabezado: encabezado.trim() || null, cuerpo: cuerpo.trim(), pie: pie.trim() || null,
          botones: botones.map((b) => (b.tipo === 'URL' ? { tipo: b.tipo, texto: b.texto.trim(), url: b.url.trim() }
            : b.tipo === 'PHONE_NUMBER' ? { tipo: b.tipo, texto: b.texto.trim(), telefono: b.telefono.trim() } : { tipo: b.tipo, texto: b.texto.trim() })),
          variables,
        };
        if (p) await api.patch(`/plantillas/${p.plantilla_id}`, body);
        else await api.post('/plantillas', { ...body, canal_id: canalId });
      }
      toast.success(p ? 'Plantilla actualizada' : 'Plantilla creada como borrador', { description: p ? undefined : 'Envíala a revisión cuando esté lista.' });
      qc.invalidateQueries({ queryKey: ['plantillas'] });
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setGuardando(false); }
  }

  const ejemplos = (i: number) => vars[i]?.ejemplo?.trim() || `{{${i}}}`;
  const canalSel = canales.find((c) => c.id === canalId);

  return (
    <Modal abierto onClose={onClose} ancho="xl" className="max-w-6xl"
      titulo={p ? (soloVariables ? `Variables de ${p.nombre}` : `Editar ${p.nombre}`) : 'Nueva plantilla de WhatsApp'}
      descripcion={soloVariables ? 'La plantilla ya fue enviada a Meta: solo puedes cambiar de dónde salen sus variables.' : 'Se guarda como borrador. Luego envíala a revisión de Meta.'}
      pie={<>
        {errores.length > 0 && !soloVariables && <p className="mr-auto flex items-center gap-1.5 text-[12px] text-ink-500"><Info className="h-3.5 w-3.5" />{errores[0]}</p>}
        <Button variante="secundario" onClick={onClose}>Cancelar</Button>
        <Button onClick={guardar} cargando={guardando} disabled={errores.length > 0}>{p ? 'Guardar cambios' : 'Crear borrador'}</Button>
      </>}>
      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          {p?.estado === 'rechazada' && p.motivo_rechazo && (
            <div className="flex gap-2.5 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-[13px] text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div><p className="font-semibold">Meta rechazó esta plantilla</p><p className="mt-0.5 text-red-700">{p.motivo_rechazo}. Corrígela y vuelve a enviarla.</p></div>
            </div>
          )}

          <fieldset disabled={soloVariables} className={cn('space-y-5', soloVariables && 'opacity-60')}>
            <Seccion titulo="Datos generales">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Cuenta de WhatsApp" required>
                  <Select value={canalId ?? ''} onChange={(e) => setCanalId(Number(e.target.value))} disabled={!!p || soloVariables}>
                    {canales.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.sandbox ? ' (prueba)' : ''}</option>)}
                  </Select>
                </Field>
                <Field label="Nombre" required hint="Solo minúsculas, números y guion bajo">
                  <Input value={nombre} maxLength={512} className="font-mono" placeholder="promo_fin_de_mes" autoFocus={!p}
                    onChange={(e) => setNombre(e.target.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, ''))} />
                </Field>
              </div>
              <Field label="Categoría" required>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CATEGORIAS.map((c) => (
                    <button key={c.v} type="button" onClick={() => setCategoria(c.v)}
                      className={cn('rounded-lg border px-3 py-2.5 text-left transition-all',
                        categoria === c.v ? 'border-brand-400 bg-brand-50/60 ring-4 ring-brand-500/10' : 'border-ink-200 hover:bg-ink-50')}>
                      <span className={cn('block text-[13px] font-semibold', categoria === c.v ? 'text-brand-700' : 'text-ink-800')}>{c.label}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">{c.d}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Idioma" className="sm:w-1/2">
                <Select value={idioma} onChange={(e) => setIdioma(e.target.value)}>
                  {IDIOMAS.map((i) => <option key={i.v} value={i.v}>{i.label} · {i.v}</option>)}
                </Select>
              </Field>
            </Seccion>

            <Seccion titulo="Contenido">
              <Field label={<span className="flex justify-between">Encabezado <Opcional n={encabezado.length} max={60} /></span>}>
                <Input value={encabezado} maxLength={60} onChange={(e) => setEncabezado(e.target.value)} placeholder="Ej. ¡Oferta exclusiva! 🎉" />
              </Field>
              <Field label={<>Cuerpo<span className="ml-0.5 text-red-500">*</span></>}>
                <div className="rounded-lg border border-ink-200 shadow-xs transition-colors focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
                  <Textarea ref={ta} value={cuerpo} maxLength={1024} rows={6} onChange={(e) => setCuerpo(e.target.value)}
                    placeholder="Hola {{1}}, tenemos una promoción especial para ti…" className="rounded-b-none border-0 shadow-none focus:ring-0" />
                  <div className="flex items-center gap-2 rounded-b-lg border-t border-ink-100 bg-ink-50/70 px-2 py-1.5">
                    <button type="button" onClick={agregarVariable}
                      className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-0.5 text-[11.5px] font-medium text-ink-600 transition-colors hover:border-brand-300 hover:text-brand-700">
                      <Braces className="h-3 w-3" />Agregar variable
                    </button>
                    <span className="text-[11px] text-ink-400">Usa *negrita* y _cursiva_ como en WhatsApp</span>
                    <span className={cn('ml-auto text-[11px] tabular-nums', cuerpo.length > 980 ? 'text-amber-600' : 'text-ink-400')}>{cuerpo.length}/1024</span>
                  </div>
                </div>
                {!consecutivas && <p className="mt-1.5 text-xs text-red-600">Las variables deben ser consecutivas empezando en {'{{1}}'}.</p>}
              </Field>
              <Field label={<span className="flex justify-between">Pie de página <Opcional n={pie.length} max={60} /></span>}>
                <Input value={pie} maxLength={60} onChange={(e) => setPie(e.target.value)} placeholder="Ej. Responde STOP para no recibir más mensajes" />
              </Field>
            </Seccion>

            <Seccion titulo="Botones" extra={<span className="text-[12px] text-ink-400">{botones.length}/3</span>}>
              {botones.length > 0 && (
                <div className="space-y-2">
                  {botones.map((b, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50/40 p-2.5">
                      <Select value={b.tipo} onChange={(e) => setBoton(i, { tipo: e.target.value as Boton['tipo'] })} className="h-9 w-40 py-1.5 text-[13px]">
                        <option value="QUICK_REPLY">Respuesta rápida</option>
                        <option value="URL">Visitar sitio web</option>
                        <option value="PHONE_NUMBER">Llamar</option>
                      </Select>
                      <div className="grid flex-1 gap-2 sm:grid-cols-2">
                        <Input value={b.texto} maxLength={25} placeholder="Texto del botón" onChange={(e) => setBoton(i, { texto: e.target.value })} className={cn('h-9', b.tipo === 'QUICK_REPLY' && 'sm:col-span-2')} />
                        {b.tipo === 'URL' && <Input value={b.url} placeholder="https://tusitio.pe/oferta" onChange={(e) => setBoton(i, { url: e.target.value })} className="h-9" />}
                        {b.tipo === 'PHONE_NUMBER' && <Input value={b.telefono} placeholder="+51987654321" onChange={(e) => setBoton(i, { telefono: e.target.value.replace(/[^\d+]/g, '') })} className="h-9 font-mono" />}
                      </div>
                      <Button variante="fantasma" tamano="icono" className="h-9 w-9" onClick={() => setBotones((x) => x.filter((_, j) => j !== i))} aria-label="Quitar botón"><X className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </div>
              )}
              {botones.length < 3 && (
                <Button variante="secundario" tamano="sm" icono={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setBotones((x) => [...x, { tipo: 'QUICK_REPLY', texto: '', url: '', telefono: '' }])}>Agregar botón</Button>
              )}
            </Seccion>
          </fieldset>

          <div className={cn(soloVariables && 'order-first')}>
          <Seccion titulo="Variables" extra={<span className="text-[12px] text-ink-400">Meta exige un ejemplo para cada una</span>}>
            {!indices.length ? (
              <div className="rounded-lg border border-dashed border-ink-200 px-4 py-5 text-center text-[13px] text-ink-500">
                Sin variables. Usa <b className="font-semibold text-ink-700">Agregar variable</b> para personalizar el mensaje con {'{{1}}'}, {'{{2}}'}…
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-ink-200">
                <table className="w-full">
                  <thead className="bg-ink-50/70"><tr><th className="th w-16 px-3">Var.</th><th className="th px-3">Origen</th><th className="th px-3">Dato</th><th className="th px-3">Ejemplo *</th></tr></thead>
                  <tbody className="divide-y divide-ink-100">
                    {indices.map((i) => {
                      const v = vars[i] ?? { indice: i, origen: 'manual', valor: '', ejemplo: '' };
                      return (
                        <tr key={i}>
                          <td className="px-3 py-2"><code className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-amber-700">{`{{${i}}}`}</code></td>
                          <td className="px-3 py-2">
                            <Select value={v.origen} className="h-8 py-1 text-[13px]"
                              onChange={(e) => {
                                const origen = e.target.value as VariablePlantilla['origen'];
                                setVar(i, { origen, valor: origen === 'contacto' ? 'nombre' : origen === 'empresa' ? 'nombre' : origen === 'campo' ? camposContacto[0]?.clave ?? '' : '',
                                  ejemplo: v.ejemplo || (origen === 'empresa' ? me?.empresa?.nombre ?? '' : origen === 'contacto' ? 'María' : '') });
                              }}>
                              <option value="contacto">Contacto</option>
                              <option value="campo">Campo personalizado</option>
                              <option value="empresa">Mi empresa</option>
                              <option value="manual">Texto fijo</option>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            {v.origen === 'contacto' ? (
                              <Select value={v.valor} onChange={(e) => setVar(i, { valor: e.target.value })} className="h-8 py-1 text-[13px]">
                                {CAMPOS_CONTACTO.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                              </Select>
                            ) : v.origen === 'campo' ? (
                              camposContacto.length ? (
                                <Select value={v.valor} onChange={(e) => setVar(i, { valor: e.target.value })} className="h-8 py-1 text-[13px]">
                                  <option value="">Elegir campo…</option>
                                  {camposContacto.map((c) => <option key={c.campo_id} value={c.clave}>{c.nombre}</option>)}
                                </Select>
                              ) : <Link href="/config/campos" className="text-[12px] text-brand-600 hover:underline">Crear campos</Link>
                            ) : v.origen === 'empresa' ? (
                              <span className="text-[13px] text-ink-600">Nombre de la empresa</span>
                            ) : (
                              <Input value={v.valor} maxLength={200} onChange={(e) => setVar(i, { valor: e.target.value })} placeholder="Valor por defecto" className="h-8 py-1 text-[13px]" />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Input value={v.ejemplo} maxLength={200} onChange={(e) => setVar(i, { ejemplo: e.target.value })} placeholder="Ej. María"
                              className={cn('h-8 py-1 text-[13px]', !v.ejemplo.trim() && 'border-amber-300')} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Seccion>
          </div>
        </div>

        {/* Vista previa */}
        <div className="lg:sticky lg:top-0 lg:self-start">
          <p className="label">Vista previa</p>
          <VistaPrevia nombreCanal={canalSel?.nombre ?? 'Tu negocio'} encabezado={encabezado} pie={pie}
            cuerpo={cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n) => ejemplos(Number(n)))} botones={botones} />
          <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-400">Las variables se muestran con sus ejemplos.<br />Al enviar se reemplazan con los datos reales.</p>
        </div>
      </div>
    </Modal>
  );
}

function Seccion({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between border-b border-ink-100 pb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{titulo}</h3>
        {extra}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Opcional({ n, max }: { n: number; max: number }) {
  return <span className="font-normal text-ink-400">{n > 0 ? <span className="tabular-nums">{n}/{max}</span> : 'Opcional'}</span>;
}

/** Formato básico de WhatsApp: *negrita*, _cursiva_, ~tachado~. */
function FormatoWa({ texto }: { texto: string }) {
  const partes = texto.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return <>{partes.map((p, i) => p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <b key={i}>{p.slice(1, -1)}</b>
    : p.startsWith('_') && p.endsWith('_') && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i>
      : p.startsWith('~') && p.endsWith('~') && p.length > 2 ? <s key={i}>{p.slice(1, -1)}</s> : p)}</>;
}

function VistaPrevia({ nombreCanal, encabezado, cuerpo, pie, botones, compacta }: {
  nombreCanal: string; encabezado?: string | null; cuerpo: string; pie?: string | null; botones: Array<{ tipo: string; texto: string }>; compacta?: boolean;
}) {
  const ICONO: Record<string, React.ElementType> = { QUICK_REPLY: CornerUpLeft, URL: ExternalLink, PHONE_NUMBER: Phone };
  return (
    <div className={cn('mx-auto overflow-hidden rounded-[2rem] border-[6px] border-ink-900 bg-ink-900 shadow-lift', compacta ? 'w-full max-w-[320px]' : 'w-[320px]')}>
      <div className="flex items-center gap-2.5 bg-[#008069] px-3 py-2.5 text-white">
        <ArrowLeft className="h-4 w-4 opacity-90" />
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20"><IconoCanal canal="whatsapp" size={16} /></span>
        <div className="min-w-0 leading-tight">
          <p className="flex items-center gap-1 truncate text-[13px] font-semibold">{nombreCanal}<CheckCircle2 className="h-3 w-3 fill-emerald-300 text-[#008069]" /></p>
          <p className="text-[10.5px] opacity-80">Cuenta de empresa</p>
        </div>
      </div>
      <div className={cn('bg-[#efeae2] px-3 py-4', compacta ? 'min-h-[260px]' : 'min-h-[440px]')}
        style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,.05) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
        <div className="mx-auto mb-3 w-fit rounded-md bg-white/90 px-2 py-0.5 text-[10.5px] font-medium text-ink-500 shadow-xs">HOY</div>
        {cuerpo.trim() ? (
          <div className="max-w-[92%] animate-pop-in">
            <div className="relative rounded-lg rounded-tl-none bg-white px-2.5 pb-1.5 pt-2 text-[13px] leading-[1.4] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
              {encabezado?.trim() && <p className="mb-1 font-bold">{encabezado}</p>}
              <p className="whitespace-pre-wrap break-words"><FormatoWa texto={cuerpo} /></p>
              {pie?.trim() && <p className="mt-1 text-[11.5px] text-[#667781]">{pie}</p>}
              <p className="mt-0.5 text-right text-[10px] text-[#667781]">12:30</p>
            </div>
            {botones.map((b, i) => {
              const I = ICONO[b.tipo] ?? CornerUpLeft;
              return (
                <div key={i} className="mt-[2px] flex items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-[13px] font-medium text-[#0b93d8] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                  <I className="h-3.5 w-3.5" />{b.texto.trim() || 'Botón'}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="pt-20 text-center text-xs text-ink-400">Escribe el cuerpo para ver la vista previa</p>
        )}
      </div>
    </div>
  );
}
