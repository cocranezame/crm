'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Ban, CheckCircle2, Clock3, FileText, Loader2, Megaphone, MessageSquare, Pencil, Play, Search, Send, Trash2, Users, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { cn, fechaHora, numero, telefonoBonito } from '@/lib/utils';
import type { Difusion } from '@/lib/types';
import { useEtiquetas, usePuede } from '@/hooks/datos';
import { Avatar, Button, Cargando, EtiquetaChip, Input, PageHeader, Tabs, Tooltip, Vacio, confirmar } from '@/components/ui';
import { IconoCanal } from '@/components/crm/canal';

interface Destinatario { id: number; contacto_id: number; contacto_nombre: string | null; destino: string; estado: 'pendiente' | 'enviado' | 'error'; error: string | null; enviado_en: string | null }
interface Detalle { difusion: Difusion & { plantilla_cuerpo: string }; destinatarios: Destinatario[] }

const ESTADO: Record<Difusion['estado'], { label: string; clase: string; icono: React.ElementType }> = {
  borrador: { label: 'Borrador', clase: 'bg-ink-100 text-ink-600', icono: Pencil },
  enviando: { label: 'Enviando', clase: 'bg-sky-100 text-sky-700', icono: Loader2 },
  completada: { label: 'Completada', clase: 'bg-emerald-100 text-emerald-700', icono: CheckCircle2 },
  cancelada: { label: 'Cancelada', clase: 'bg-red-100 text-red-700', icono: Ban },
};

type Filtro = 'todos' | Destinatario['estado'];

export default function DifusionDetalle() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const puede = usePuede('supervisor');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [q, setQ] = useState('');
  const [accion, setAccion] = useState<string | null>(null);
  const { data: todasEtiquetas } = useEtiquetas();

  const det = useQuery({
    queryKey: ['difusion', id],
    queryFn: () => api.get<Detalle>(`/difusiones/${id}`),
    enabled: puede,
    // Respaldo por si se pierde algún evento del socket mientras envía
    refetchInterval: (query) => (query.state.data?.difusion.estado === 'enviando' ? 5000 : false),
  });

  const inv = () => { qc.invalidateQueries({ queryKey: ['difusion', id] }); qc.invalidateQueries({ queryKey: ['difusiones'] }); };

  async function iniciar() {
    const ok = await confirmar({ titulo: 'Iniciar envío', texto: 'Se enviará la plantilla a todos los contactos de la audiencia. Esta acción no se puede deshacer.', confirmar: 'Iniciar envío' });
    if (!ok) return;
    setAccion('iniciar');
    try { const r = await api.post<{ total: number }>(`/difusiones/${id}/iniciar`); toast.success(`Envío iniciado a ${numero(r.total)} contactos`); inv(); }
    catch (e) { if (e instanceof ApiError && e.status === 402) toast.error('Límite del plan alcanzado', { description: e.message }); else toast.error((e as Error).message); }
    finally { setAccion(null); }
  }
  async function cancelar() {
    const ok = await confirmar({ titulo: '¿Cancelar la difusión?', texto: 'Los mensajes ya enviados no se pueden retirar. Los pendientes no se enviarán.', confirmar: 'Cancelar difusión', peligro: true });
    if (!ok) return;
    setAccion('cancelar');
    try { await api.post(`/difusiones/${id}/cancelar`); toast.success('Difusión cancelada'); inv(); }
    catch (e) { toast.error((e as Error).message); } finally { setAccion(null); }
  }
  async function eliminar() {
    const ok = await confirmar({ titulo: '¿Eliminar la difusión?', texto: 'Se borrará el registro de destinatarios. Los mensajes enviados seguirán en cada conversación.', confirmar: 'Eliminar', peligro: true });
    if (!ok) return;
    setAccion('eliminar');
    try { await api.del(`/difusiones/${id}`); toast.success('Difusión eliminada'); qc.invalidateQueries({ queryKey: ['difusiones'] }); router.push('/difusiones'); }
    catch (e) { toast.error((e as Error).message); setAccion(null); }
  }

  if (!puede) return <div className="flex h-full items-center justify-center"><Vacio titulo="Solo para supervisores" /></div>;
  if (det.isLoading) return <Cargando />;
  if (!det.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Vacio icono={<Megaphone className="h-5 w-5" />} titulo="Difusión no encontrada" texto="Puede que se haya eliminado."
          accion={<Link href="/difusiones"><Button variante="secundario" icono={<ArrowLeft className="h-4 w-4" />}>Volver a difusiones</Button></Link>} />
      </div>
    );
  }

  const { difusion: d, destinatarios } = det.data;
  const pendientes = Math.max(d.total - d.enviados - d.fallidos, 0);
  const hechos = d.enviados + d.fallidos;
  const pct = d.total ? Math.round((hechos / d.total) * 100) : 0;
  const e = ESTADO[d.estado];
  const ids = (d.etiqueta_ids ?? []).map(Number);
  const etiquetas = d.etiquetas?.length ? d.etiquetas : (todasEtiquetas ?? []).filter((t) => ids.includes(t.etiqueta_id));
  const lista = destinatarios.filter((x) => (filtro === 'todos' || x.estado === filtro)
    && (!q.trim() || (x.contacto_nombre ?? '').toLowerCase().includes(q.trim().toLowerCase()) || x.destino.includes(q.trim())));
  const duracion = d.iniciada_en && d.finalizada_en ? Math.max(1, Math.round((new Date(d.finalizada_en).getTime() - new Date(d.iniciada_en).getTime()) / 1000)) : null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icono={<Link href="/difusiones" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800" aria-label="Volver"><ArrowLeft className="h-5 w-5" /></Link>}
        titulo={d.nombre}
        descripcion={<span className="flex items-center gap-1.5"><IconoCanal canal="whatsapp" size={12} className="text-emerald-600" />{d.canal_nombre}<span className="text-ink-300">·</span>Creada {fechaHora(d.creado_en)}{d.creado_por_nombre && ` por ${d.creado_por_nombre}`}</span>}
        acciones={<>
          {d.estado === 'borrador' && <Button icono={<Play className="h-4 w-4" />} cargando={accion === 'iniciar'} onClick={iniciar}>Iniciar envío</Button>}
          {(d.estado === 'enviando' || d.estado === 'borrador') && <Button variante="secundario" className="text-red-600 hover:text-red-700" icono={<XCircle className="h-4 w-4" />} cargando={accion === 'cancelar'} onClick={cancelar}>Cancelar</Button>}
          {d.estado !== 'enviando' && <Button variante="secundario" icono={<Trash2 className="h-4 w-4" />} cargando={accion === 'eliminar'} onClick={eliminar}>Eliminar</Button>}
        </>} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          {/* Progreso */}
          <div className="card overflow-hidden">
            <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
              <div>
                <div className="flex items-center gap-2">
                  <span className={cn('chip', e.clase)}><e.icono className={cn('h-3 w-3', d.estado === 'enviando' && 'animate-spin')} />{e.label}</span>
                  {d.estado === 'enviando' && <span className="flex items-center gap-1.5 text-[12px] text-ink-500"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" /></span>En vivo</span>}
                </div>
                <div className="mt-4 flex items-end gap-3">
                  <p className="text-5xl font-semibold tabular-nums tracking-tight text-ink-900">{d.estado === 'borrador' ? '—' : `${pct}%`}</p>
                  <p className="pb-1.5 text-sm text-ink-500">{d.estado === 'borrador' ? 'Aún no se inicia el envío' : <>{numero(hechos)} de {numero(d.total)} procesados</>}</p>
                </div>
                <div className="mt-4 flex h-3 w-full gap-px overflow-hidden rounded-full bg-ink-100">
                  <div className="bg-emerald-500 transition-all duration-700" style={{ width: `${d.total ? (d.enviados / d.total) * 100 : 0}%` }} />
                  <div className="bg-red-500 transition-all duration-700" style={{ width: `${d.total ? (d.fallidos / d.total) * 100 : 0}%` }} />
                  {d.estado === 'enviando' && <div className="animate-pulse bg-sky-200" style={{ width: `${d.total ? Math.min(pendientes / d.total, 0.04) * 100 : 0}%` }} />}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Cifra icono={<Users className="h-4 w-4" />} tono="text-ink-500 bg-ink-100" label="Destinatarios" valor={d.total} />
                  <Cifra icono={<Send className="h-4 w-4" />} tono="text-emerald-600 bg-emerald-50" label="Enviados" valor={d.enviados} />
                  <Cifra icono={<AlertTriangle className="h-4 w-4" />} tono="text-red-600 bg-red-50" label="Fallidos" valor={d.fallidos} />
                  <Cifra icono={<Clock3 className="h-4 w-4" />} tono="text-sky-600 bg-sky-50" label="Pendientes" valor={pendientes} />
                </div>
              </div>
              <div className="space-y-3 border-t border-ink-100 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500"><FileText className="h-3.5 w-3.5" />Plantilla</p>
                <code className="block font-mono text-[13px] font-semibold text-ink-900">{d.plantilla_nombre}</code>
                <p className="line-clamp-4 whitespace-pre-wrap rounded-lg rounded-tl-none bg-[#efeae2] p-3 text-[12.5px] leading-relaxed text-ink-800">{d.plantilla_cuerpo}</p>
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Audiencia</p>
                  <div className="flex flex-wrap gap-1">
                    {ids.length ? etiquetas.map((t) => <EtiquetaChip key={t.etiqueta_id} nombre={t.nombre} color={t.color} />) : <span className="text-[13px] text-ink-600">Todos los contactos con teléfono</span>}
                    {ids.length > 0 && !etiquetas.length && <span className="text-[13px] text-ink-500">{ids.length} etiqueta{ids.length !== 1 && 's'} (eliminadas)</span>}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-2 pt-1 text-[12px]">
                  <div><dt className="text-ink-400">Inicio</dt><dd className="text-ink-700">{d.iniciada_en ? fechaHora(d.iniciada_en) : '—'}</dd></div>
                  <div><dt className="text-ink-400">Fin</dt><dd className="text-ink-700">{d.finalizada_en ? fechaHora(d.finalizada_en) : '—'}{duracion ? <span className="text-ink-400"> · {duracion < 60 ? `${duracion} s` : `${Math.round(duracion / 60)} min`}</span> : null}</dd></div>
                </dl>
              </div>
            </div>
          </div>

          {/* Destinatarios */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3">
              <Tabs<Filtro> valor={filtro} onChange={setFiltro} opciones={[
                { valor: 'todos', label: 'Todos', contador: destinatarios.length },
                { valor: 'enviado', label: 'Enviados', contador: destinatarios.filter((x) => x.estado === 'enviado').length },
                { valor: 'error', label: 'Fallidos', contador: destinatarios.filter((x) => x.estado === 'error').length },
                { valor: 'pendiente', label: 'Pendientes', contador: destinatarios.filter((x) => x.estado === 'pendiente').length },
              ]} />
              <div className="w-60"><Input icono={<Search className="h-4 w-4" />} placeholder="Buscar contacto" value={q} onChange={(ev) => setQ(ev.target.value)} className="h-8 text-[13px]" /></div>
            </div>
            {!destinatarios.length ? (
              <Vacio icono={<Users className="h-5 w-5" />} titulo="Sin destinatarios aún" texto={d.estado === 'borrador' ? 'La lista se genera al iniciar el envío, con los contactos que tengan las etiquetas elegidas.' : 'No hay destinatarios registrados.'} />
            ) : !lista.length ? (
              <Vacio icono={<Search className="h-5 w-5" />} titulo="Sin resultados" className="py-10" />
            ) : (
              <table className="w-full">
                <thead className="bg-ink-50/60"><tr><th className="th">Contacto</th><th className="th">Teléfono</th><th className="th">Estado</th><th className="th">Enviado</th><th className="th w-12" /></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {lista.map((x) => (
                    <tr key={x.id} className="hover:bg-ink-50/50">
                      <td className="td"><div className="flex items-center gap-2.5"><Avatar nombre={x.contacto_nombre ?? x.destino} size={28} /><span className="text-[13px] font-medium text-ink-800">{x.contacto_nombre ?? 'Sin nombre'}</span></div></td>
                      <td className="td font-mono text-[12.5px] text-ink-600">{telefonoBonito(x.destino)}</td>
                      <td className="td">
                        {x.estado === 'enviado' ? <span className="chip bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-3 w-3" />Enviado</span>
                          : x.estado === 'error' ? <Tooltip texto={x.error ?? 'Error desconocido'}><span className="chip cursor-help bg-red-50 text-red-700"><AlertTriangle className="h-3 w-3" />Falló</span></Tooltip>
                            : <span className="chip bg-ink-100 text-ink-600"><Clock3 className="h-3 w-3" />Pendiente</span>}
                        {x.estado === 'error' && x.error && <p className="mt-1 max-w-[320px] truncate text-[11px] text-red-600">{x.error}</p>}
                      </td>
                      <td className="td text-[12.5px] text-ink-500">{x.enviado_en ? fechaHora(x.enviado_en) : '—'}</td>
                      <td className="td">
                        <Tooltip texto="Ver contacto"><Link href={`/contactos/${x.contacto_id}`} className="inline-flex rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><MessageSquare className="h-4 w-4" /></Link></Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {destinatarios.length >= 500 && <p className="border-t border-ink-100 px-5 py-2.5 text-[12px] text-ink-500">Se muestran los primeros 500 destinatarios.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cifra({ icono, tono, label, valor }: { icono: React.ReactNode; tono: string; label: string; valor: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-50/40 px-3 py-2.5">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', tono)}>{icono}</span>
      <div className="leading-tight">
        <p className="text-lg font-semibold tabular-nums text-ink-900">{numero(valor)}</p>
        <p className="text-[11.5px] text-ink-500">{label}</p>
      </div>
    </div>
  );
}
