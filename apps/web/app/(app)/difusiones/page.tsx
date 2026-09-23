'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban, Check, CheckCircle2, ChevronLeft, ChevronRight, FileText, FlaskConical, Loader2, Lock, Megaphone, MoreHorizontal, Pencil,
  Play, Plus, Rocket, Search, Tag, Trash2, Users, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { cn, fechaHora, hace, numero } from '@/lib/utils';
import type { Difusion, Plantilla } from '@/lib/types';
import { useCanales, useEtiquetas, usePuede } from '@/hooks/datos';
import { Button, EtiquetaChip, Field, Input, Menu, Modal, PageHeader, Select, Skeleton, Tabs, Tooltip, Vacio, confirmar } from '@/components/ui';
import { IconoCanal } from '@/components/crm/canal';

type EstadoD = Difusion['estado'];

const ESTADO: Record<EstadoD, { label: string; clase: string; icono: React.ElementType }> = {
  borrador: { label: 'Borrador', clase: 'bg-ink-100 text-ink-600', icono: Pencil },
  enviando: { label: 'Enviando', clase: 'bg-sky-100 text-sky-700', icono: Loader2 },
  completada: { label: 'Completada', clase: 'bg-emerald-100 text-emerald-700', icono: CheckCircle2 },
  cancelada: { label: 'Cancelada', clase: 'bg-red-100 text-red-700', icono: Ban },
};

function EstadoDifusion({ estado }: { estado: EstadoD }) {
  const e = ESTADO[estado] ?? ESTADO.borrador;
  return <span className={cn('chip', e.clase)}><e.icono className={cn('h-3 w-3', estado === 'enviando' && 'animate-spin')} />{e.label}</span>;
}

function Progreso({ d, alto = 'h-1.5' }: { d: Pick<Difusion, 'total' | 'enviados' | 'fallidos'>; alto?: string }) {
  const t = Math.max(d.total, 1);
  return (
    <div className={cn('flex w-full gap-px overflow-hidden rounded-full bg-ink-100', alto)}>
      <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${(d.enviados / t) * 100}%` }} />
      <div className="bg-red-500 transition-all duration-500" style={{ width: `${(d.fallidos / t) * 100}%` }} />
    </div>
  );
}

export default function DifusionesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const puede = usePuede('supervisor');
  const [nueva, setNueva] = useState(false);
  const [filtro, setFiltro] = useState<'todas' | EstadoD>('todas');
  const [q, setQ] = useState('');
  const lista = useQuery({ queryKey: ['difusiones'], queryFn: () => api.get<{ difusiones: Difusion[] }>('/difusiones'), select: (d) => d.difusiones, enabled: puede });
  const todas = lista.data ?? [];
  const filtradas = todas.filter((d) => (filtro === 'todas' || d.estado === filtro) && (!q.trim() || d.nombre.toLowerCase().includes(q.trim().toLowerCase())));
  const cuenta = (e: EstadoD) => todas.filter((d) => d.estado === e).length;

  async function iniciar(d: Difusion) {
    const ok = await confirmar({ titulo: `¿Iniciar "${d.nombre}"?`, texto: 'Se enviará la plantilla a todos los contactos de la audiencia. Esta acción no se puede deshacer.', confirmar: 'Iniciar envío' });
    if (!ok) return;
    try {
      const r = await api.post<{ total: number }>(`/difusiones/${d.difusion_id}/iniciar`);
      toast.success(`Envío iniciado a ${numero(r.total)} contacto${r.total !== 1 ? 's' : ''}`);
      qc.invalidateQueries({ queryKey: ['difusiones'] });
      router.push(`/difusiones/${d.difusion_id}`);
    } catch (e) { errorDifusion(e); }
  }
  async function cancelar(d: Difusion) {
    const ok = await confirmar({ titulo: '¿Cancelar la difusión?', texto: 'Los mensajes ya enviados no se pueden retirar. Los pendientes no se enviarán.', confirmar: 'Cancelar difusión', peligro: true });
    if (!ok) return;
    try { await api.post(`/difusiones/${d.difusion_id}/cancelar`); toast.success('Difusión cancelada'); qc.invalidateQueries({ queryKey: ['difusiones'] }); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function eliminar(d: Difusion) {
    const ok = await confirmar({ titulo: `¿Eliminar "${d.nombre}"?`, texto: 'Se borrará la difusión y su registro de destinatarios. Los mensajes enviados seguirán en cada conversación.', confirmar: 'Eliminar', peligro: true });
    if (!ok) return;
    try { await api.del(`/difusiones/${d.difusion_id}`); toast.success('Difusión eliminada'); qc.invalidateQueries({ queryKey: ['difusiones'] }); }
    catch (e) { toast.error((e as Error).message); }
  }

  if (!puede) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader icono={<Megaphone className="h-5 w-5" />} titulo="Difusiones" />
        <div className="flex flex-1 items-center justify-center"><Vacio icono={<Lock className="h-5 w-5" />} titulo="Solo para supervisores" texto="Pide a un supervisor o administrador que cree las difusiones." /></div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader icono={<Megaphone className="h-5 w-5" />} titulo="Difusiones"
        descripcion="Envía una plantilla aprobada de WhatsApp a segmentos de contactos"
        acciones={<Button icono={<Plus className="h-4 w-4" />} onClick={() => setNueva(true)}>Nueva difusión</Button>} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs<'todas' | EstadoD> valor={filtro} onChange={setFiltro} opciones={[
              { valor: 'todas', label: 'Todas', contador: todas.length },
              { valor: 'enviando', label: 'Enviando', contador: cuenta('enviando') },
              { valor: 'completada', label: 'Completadas', contador: cuenta('completada') },
              { valor: 'borrador', label: 'Borradores', contador: cuenta('borrador') },
              { valor: 'cancelada', label: 'Canceladas', contador: cuenta('cancelada') },
            ]} />
            <div className="w-64"><Input icono={<Search className="h-4 w-4" />} placeholder="Buscar difusión" value={q} onChange={(e) => setQ(e.target.value)} className="h-9" /></div>
          </div>

          {lista.isLoading ? (
            <div className="card space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : !todas.length ? (
            <div className="card"><Vacio icono={<Megaphone className="h-5 w-5" />} titulo="Aún no hay difusiones"
              texto="Envía promociones o avisos a todos tus clientes de una etiqueta con una plantilla aprobada."
              accion={<Button icono={<Plus className="h-4 w-4" />} onClick={() => setNueva(true)}>Nueva difusión</Button>} /></div>
          ) : !filtradas.length ? (
            <div className="card"><Vacio icono={<Search className="h-5 w-5" />} titulo="Sin resultados" texto="Ninguna difusión coincide con los filtros." /></div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-ink-100 bg-ink-50/60">
                  <tr><th className="th">Difusión</th><th className="th">Audiencia</th><th className="th">Estado</th><th className="th w-[210px]">Progreso</th><th className="th">Fecha</th><th className="th w-12" /></tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {filtradas.map((d) => {
                    const hechos = d.enviados + d.fallidos;
                    return (
                      <tr key={d.difusion_id} className="cursor-pointer transition-colors hover:bg-ink-50/50" onClick={() => router.push(`/difusiones/${d.difusion_id}`)}>
                        <td className="td max-w-[280px]">
                          <p className="truncate text-[13.5px] font-semibold text-ink-900">{d.nombre}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-ink-500">
                            <FileText className="h-3 w-3 shrink-0" /><code className="font-mono">{d.plantilla_nombre}</code>
                            <span className="text-ink-300">·</span><IconoCanal canal="whatsapp" size={11} className="shrink-0 text-emerald-600" />{d.canal_nombre}
                          </p>
                        </td>
                        <td className="td">
                          <div className="flex flex-wrap gap-1">
                            {d.etiquetas?.length ? d.etiquetas.slice(0, 3).map((t) => <EtiquetaChip key={t.etiqueta_id} nombre={t.nombre} color={t.color} size="xs" />)
                              : <span className="text-[12px] text-ink-500">Todos los contactos</span>}
                            {(d.etiquetas?.length ?? 0) > 3 && <span className="text-[11px] text-ink-400">+{d.etiquetas.length - 3}</span>}
                          </div>
                        </td>
                        <td className="td"><EstadoDifusion estado={d.estado} /></td>
                        <td className="td">
                          {d.estado === 'borrador' ? <span className="text-[12px] text-ink-400">Sin iniciar</span> : (
                            <div>
                              <Progreso d={d} />
                              <p className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-500">
                                <span>{numero(hechos)} / {numero(d.total)}</span>
                                <span>{d.fallidos > 0 && <span className="text-red-600">{d.fallidos} fallido{d.fallidos !== 1 && 's'}</span>}</span>
                              </p>
                            </div>
                          )}
                        </td>
                        <td className="td text-[12.5px] text-ink-500">
                          <Tooltip texto={<>Creada {fechaHora(d.creado_en)}{d.creado_por_nombre ? ` por ${d.creado_por_nombre}` : ''}{d.finalizada_en ? <><br />Finalizada {fechaHora(d.finalizada_en)}</> : null}</>}>
                            <span>{hace2(d.iniciada_en ? 'Enviada' : 'Creada', d.iniciada_en ?? d.creado_en)}</span>
                          </Tooltip>
                        </td>
                        <td className="td" onClick={(e) => e.stopPropagation()}>
                          <Menu trigger={<button className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><MoreHorizontal className="h-4 w-4" /></button>}
                            items={[
                              { label: 'Ver detalle', icono: <Users className="h-3.5 w-3.5" />, onClick: () => router.push(`/difusiones/${d.difusion_id}`) },
                              ...(d.estado === 'borrador' ? [{ label: 'Iniciar envío', icono: <Play className="h-3.5 w-3.5" />, onClick: () => iniciar(d) }] : []),
                              ...(d.estado === 'enviando' || d.estado === 'borrador' ? [{ label: 'Cancelar', icono: <XCircle className="h-3.5 w-3.5" />, peligro: true, onClick: () => cancelar(d) }] : []),
                              ...(d.estado !== 'enviando' ? [{ separador: true, label: '' }, { label: 'Eliminar', icono: <Trash2 className="h-3.5 w-3.5" />, peligro: true, onClick: () => eliminar(d) }] : []),
                            ]} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {nueva && <Asistente onClose={() => setNueva(false)} />}
    </div>
  );
}

function hace2(pre: string, iso: string) { const h = hace(iso); return h === 'ahora' ? `${pre} ahora` : `${pre} hace ${h}`; }

function errorDifusion(e: unknown) {
  if (e instanceof ApiError && e.status === 402) toast.error('Límite del plan alcanzado', { description: e.message });
  else toast.error((e as Error).message);
}

// ── Asistente de nueva difusión ─────────────────────────────────────────────

function Asistente({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: canalesData } = useCanales();
  const { data: etiquetas } = useEtiquetas();
  const canalesWa = useMemo(() => (canalesData?.canales ?? []).filter((c) => c.tipo === 'whatsapp' && c.activo), [canalesData]);
  const [paso, setPaso] = useState(1);
  const [nombre, setNombre] = useState('');
  const [canalId, setCanalId] = useState<number | null>(null);
  const [plantillaId, setPlantillaId] = useState<number | null>(null);
  const [etiquetaIds, setEtiquetaIds] = useState<number[]>([]);
  const [enviando, setEnviando] = useState<'borrador' | 'enviar' | null>(null);

  useEffect(() => { if (!canalId && canalesWa[0]) setCanalId(canalesWa[0].canal_id); }, [canalesWa, canalId]);

  const plantillas = useQuery({
    queryKey: ['plantillas', String(canalId ?? '')],
    queryFn: () => api.get<{ plantillas: Plantilla[] }>(`/plantillas?canal_id=${canalId}`),
    select: (d) => d.plantillas.filter((p) => p.estado === 'aprobada'),
    enabled: !!canalId,
  });
  const plantilla = plantillas.data?.find((p) => p.plantilla_id === plantillaId);
  useEffect(() => { setPlantillaId(null); }, [canalId]);

  const idsQs = [...etiquetaIds].sort((a, b) => a - b).join(',');
  const audiencia = useQuery({
    queryKey: ['difusiones', 'audiencia', idsQs],
    queryFn: () => api.get<{ total: number }>(`/difusiones/audiencia?etiqueta_ids=${idsQs}`),
    placeholderData: (prev) => prev,
  });
  const total = audiencia.data?.total ?? 0;
  const canal = canalesWa.find((c) => c.canal_id === canalId);

  const paso1Ok = nombre.trim().length > 0 && !!canalId && !!plantillaId;
  const paso2Ok = total > 0;

  async function crear(iniciar: boolean) {
    if (!canalId || !plantillaId) return;
    setEnviando(iniciar ? 'enviar' : 'borrador');
    try {
      const r = await api.post<{ difusion: { difusion_id: number } }>('/difusiones', { nombre: nombre.trim(), canal_id: canalId, plantilla_id: plantillaId, etiqueta_ids: etiquetaIds });
      const id = r.difusion.difusion_id;
      qc.invalidateQueries({ queryKey: ['difusiones'] });
      if (!iniciar) { toast.success('Difusión guardada como borrador'); onClose(); return; }
      try {
        const x = await api.post<{ total: number }>(`/difusiones/${id}/iniciar`);
        toast.success(`Enviando a ${numero(x.total)} contacto${x.total !== 1 ? 's' : ''}`, { description: 'Puedes seguir el progreso en tiempo real.' });
        qc.invalidateQueries({ queryKey: ['difusiones'] });
        onClose();
        router.push(`/difusiones/${id}`);
      } catch (e) {
        errorDifusion(e);
        toast.message('La difusión quedó guardada como borrador');
        onClose();
      }
    } catch (e) { errorDifusion(e); } finally { setEnviando(null); }
  }

  const PASOS = ['Mensaje', 'Audiencia', 'Confirmar'];

  return (
    <Modal abierto onClose={onClose} ancho="xl" titulo="Nueva difusión"
      descripcion="Envío masivo de una plantilla aprobada de WhatsApp"
      pie={<>
        {paso > 1 && <Button variante="fantasma" className="mr-auto" icono={<ChevronLeft className="h-4 w-4" />} onClick={() => setPaso(paso - 1)}>Atrás</Button>}
        <Button variante="secundario" onClick={onClose}>Cancelar</Button>
        {paso < 3 ? (
          <Button onClick={() => setPaso(paso + 1)} disabled={paso === 1 ? !paso1Ok : !paso2Ok}>Continuar<ChevronRight className="h-4 w-4" /></Button>
        ) : (<>
          <Button variante="secundario" cargando={enviando === 'borrador'} disabled={!!enviando} onClick={() => crear(false)}>Guardar borrador</Button>
          <Button icono={<Rocket className="h-4 w-4" />} cargando={enviando === 'enviar'} disabled={!!enviando} onClick={() => crear(true)}>Enviar a {numero(total)}</Button>
        </>)}
      </>}>
      {/* Pasos */}
      <ol className="mb-6 flex items-center gap-2">
        {PASOS.map((t, i) => {
          const n = i + 1;
          const hecho = paso > n;
          return (
            <li key={t} className="flex flex-1 items-center gap-2">
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                hecho ? 'bg-brand-600 text-white' : paso === n ? 'bg-brand-600 text-white ring-4 ring-brand-500/15' : 'bg-ink-100 text-ink-500')}>
                {hecho ? <Check className="h-3.5 w-3.5" /> : n}
              </span>
              <span className={cn('text-[13px] font-medium', paso >= n ? 'text-ink-900' : 'text-ink-400')}>{t}</span>
              {n < PASOS.length && <span className={cn('h-px flex-1', paso > n ? 'bg-brand-300' : 'bg-ink-200')} />}
            </li>
          );
        })}
      </ol>

      {paso === 1 && (
        <div className="grid gap-6 md:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <Field label="Nombre de la difusión" required hint="Solo lo ve tu equipo">
              <Input autoFocus value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Promo fin de mes – clientes calientes" />
            </Field>
            <Field label="Cuenta de WhatsApp" required>
              {!canalesWa.length ? <p className="text-[13px] text-ink-500">No hay cuentas de WhatsApp activas. <Link className="text-brand-600 hover:underline" href="/config/canales">Conectar</Link></p> : (
                <Select value={canalId ?? ''} onChange={(e) => setCanalId(Number(e.target.value))}>
                  {canalesWa.map((c) => <option key={c.canal_id} value={c.canal_id}>{c.nombre}{c.sandbox ? ' (prueba)' : ''}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Plantilla aprobada" required>
              {plantillas.isLoading ? <Skeleton className="h-24" /> : !plantillas.data?.length ? (
                <div className="rounded-lg border border-dashed border-ink-200 px-4 py-5 text-center text-[13px] text-ink-500">
                  Esta cuenta no tiene plantillas aprobadas. <Link href="/plantillas" className="font-medium text-brand-600 hover:underline">Crear una plantilla</Link>
                </div>
              ) : (
                <div className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
                  {plantillas.data.map((p) => (
                    <button key={p.plantilla_id} type="button" onClick={() => setPlantillaId(p.plantilla_id)}
                      className={cn('flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-all',
                        plantillaId === p.plantilla_id ? 'border-brand-400 bg-brand-50/60 ring-4 ring-brand-500/10' : 'border-ink-200 hover:bg-ink-50')}>
                      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', plantillaId === p.plantilla_id ? 'border-brand-600 bg-brand-600' : 'border-ink-300')}>
                        {plantillaId === p.plantilla_id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2"><code className="truncate font-mono text-[13px] font-semibold text-ink-900">{p.nombre}</code><span className="text-[11px] text-ink-400">{p.idioma}</span></span>
                        <span className="mt-0.5 line-clamp-1 block text-[12px] text-ink-500">{p.cuerpo}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Field>
          </div>
          <div>
            <p className="label">Vista previa</p>
            <Burbuja p={plantilla ?? null} canal={canal?.nombre ?? 'WhatsApp'} />
          </div>
        </div>
      )}

      {paso === 2 && (
        <div className="space-y-5">
          <div>
            <p className="label">¿A quién se enviará?</p>
            <p className="-mt-1 mb-3 text-[12.5px] text-ink-500">Elige una o más etiquetas: se incluye a los contactos que tengan <b className="font-medium text-ink-700">cualquiera</b> de ellas. Sin etiquetas se envía a todos los contactos con teléfono.</p>
            {!etiquetas?.length ? <p className="text-[13px] text-ink-500">No hay etiquetas creadas.</p> : (
              <div className="flex flex-wrap gap-2">
                {etiquetas.map((t) => {
                  const on = etiquetaIds.includes(t.etiqueta_id);
                  return (
                    <button key={t.etiqueta_id} type="button"
                      onClick={() => setEtiquetaIds((x) => (on ? x.filter((i) => i !== t.etiqueta_id) : [...x, t.etiqueta_id]))}
                      className={cn('inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all',
                        on ? 'border-transparent ring-2' : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50')}
                      style={on ? { backgroundColor: t.color + '18', color: t.color, ['--tw-ring-color' as string]: t.color + '80' } : undefined}>
                      {on ? <Check className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />}
                      {t.nombre}
                      <span className={cn('text-[11px] tabular-nums', on ? 'opacity-80' : 'text-ink-400')}>{t.contactos}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className={cn('flex items-center gap-4 rounded-xl border p-4 transition-colors', total ? 'border-brand-200 bg-brand-50/50' : 'border-amber-200 bg-amber-50/60')}>
            <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', total ? 'bg-brand-600 text-white' : 'bg-amber-100 text-amber-600')}><Users className="h-5 w-5" /></span>
            <div className="flex-1">
              <p className="text-2xl font-semibold tabular-nums tracking-tight text-ink-900">
                {audiencia.isFetching && !audiencia.data ? '…' : numero(total)}<span className="ml-1.5 text-sm font-medium text-ink-500">destinatario{total !== 1 && 's'}</span>
              </p>
              <p className="text-[12.5px] text-ink-500">{total ? 'Contactos con teléfono que recibirán la plantilla' : 'Ningún contacto con teléfono coincide con esta selección'}</p>
            </div>
            {audiencia.isFetching && <Loader2 className="h-4 w-4 animate-spin text-ink-400" />}
          </div>
        </div>
      )}

      {paso === 3 && (
        <div className="grid gap-6 md:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <dl className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200">
              <Fila t="Nombre">{nombre}</Fila>
              <Fila t="Cuenta"><span className="flex items-center gap-1.5"><IconoCanal canal="whatsapp" size={13} className="text-emerald-600" />{canal?.nombre}
                {canal?.sandbox && <span className="chip bg-violet-100 text-violet-700"><FlaskConical className="h-2.5 w-2.5" />prueba</span>}</span></Fila>
              <Fila t="Plantilla"><code className="font-mono text-[13px]">{plantilla?.nombre}</code></Fila>
              <Fila t="Audiencia">
                <div className="flex flex-wrap items-center gap-1">
                  {etiquetaIds.length ? etiquetas?.filter((t) => etiquetaIds.includes(t.etiqueta_id)).map((t) => <EtiquetaChip key={t.etiqueta_id} nombre={t.nombre} color={t.color} />)
                    : <span className="flex items-center gap-1 text-ink-600"><Tag className="h-3.5 w-3.5" />Todos los contactos</span>}
                </div>
              </Fila>
              <Fila t="Destinatarios"><span className="text-base font-semibold tabular-nums text-ink-900">{numero(total)}</span></Fila>
            </dl>
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
              Los mensajes se envían de forma escalonada. Meta cobra cada conversación de marketing iniciada por la empresa y puede limitar envíos si los clientes marcan como spam.
            </div>
          </div>
          <div>
            <p className="label">Mensaje</p>
            <Burbuja p={plantilla ?? null} canal={canal?.nombre ?? 'WhatsApp'} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function Fila({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5">
      <dt className="w-28 shrink-0 text-[12.5px] text-ink-500">{t}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-ink-800">{children}</dd>
    </div>
  );
}

/** Vista previa compacta de una plantilla, estilo WhatsApp. */
function Burbuja({ p, canal }: { p: Plantilla | null; canal: string }) {
  const texto = p ? p.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n) => p.variables.find((v) => v.indice === Number(n))?.ejemplo || `{{${n}}}`) : '';
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200">
      <div className="flex items-center gap-2 bg-[#008069] px-3 py-2 text-white">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20"><IconoCanal canal="whatsapp" size={12} /></span>
        <span className="truncate text-[12px] font-semibold">{canal}</span>
      </div>
      <div className="min-h-[200px] bg-[#efeae2] p-3" style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,.05) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
        {!p ? <p className="pt-16 text-center text-xs text-ink-400">Elige una plantilla</p> : (
          <div className="max-w-[94%] animate-pop-in">
            <div className="rounded-lg rounded-tl-none bg-white px-2.5 pb-1 pt-2 text-[12.5px] leading-[1.4] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
              {p.encabezado && <p className="mb-1 font-bold">{p.encabezado}</p>}
              <p className="whitespace-pre-wrap break-words">{texto.split(/(\*[^*\n]+\*)/g).map((x, i) => (/^\*[^*]+\*$/.test(x) ? <b key={i}>{x.slice(1, -1)}</b> : x))}</p>
              {p.pie && <p className="mt-1 text-[11px] text-[#667781]">{p.pie}</p>}
              <p className="text-right text-[10px] text-[#667781]">12:30</p>
            </div>
            {p.botones.map((b, i) => <div key={i} className="mt-[2px] rounded-lg bg-white py-1.5 text-center text-[12.5px] font-medium text-[#0b93d8] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">{b.texto}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
