'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, ArrowLeft, ArrowRight, Building2, CalendarDays, Check, ChevronDown, Copy, CreditCard, GitMerge, Hash, KanbanSquare,
  Mail, MessageSquare, MoreHorizontal, Pencil, Phone, Plus, StickyNote, Tag, Trash2, UserRound, UserX, Trophy, XCircle, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, fecha, fechaHora, hace, moneda, telefonoBonito } from '@/lib/utils';
import type { Campo, ContactoFila } from '@/lib/types';
import { useCampos, useCanales, useMiembros, usePipelines, usePuede } from '@/hooks/datos';
import {
  Avatar, Badge, Button, Drawer, Field, Input, Menu, Modal, PageHeader, Select, Skeleton, Tabs, Textarea, Tooltip, Vacio, confirmar,
} from '@/components/ui';
import { CanalChip, IconoCanal } from '@/components/crm/canal';
import { CamposForm, valorLegible } from '@/components/crm/campos';
import { ContactoPicker } from '@/components/crm/contacto-picker';
import { NegocioDrawer } from '@/components/crm/negocio-drawer';
import { SelectorEtiquetas, type ContactoDetalle } from '@/components/inbox/panel-contacto';

// La API devuelve más columnas que la interfaz compartida; las añadimos aquí.
type Detalle = Omit<ContactoDetalle, 'contacto' | 'negocios' | 'conversaciones'> & {
  contacto: ContactoDetalle['contacto'] & { asignado_a: string | null; asignado_nombre: string | null; creado_por_nombre: string | null; actualizado_en: string };
  negocios: Array<ContactoDetalle['negocios'][number] & { creado_en: string; etapa_desde: string }>;
  conversaciones: Array<ContactoDetalle['conversaciones'][number] & { ultimo_mensaje: string | null; no_leidos: number }>;
};

const ORIGENES: Record<string, { label: string; color: string }> = {
  manual: { label: 'Creado manualmente', color: '#64748b' },
  whatsapp: { label: 'Llegó por WhatsApp', color: '#16a34a' },
  messenger: { label: 'Llegó por Messenger', color: '#0866FF' },
  instagram: { label: 'Llegó por Instagram', color: '#E1306C' },
  tiktok: { label: 'Llegó por TikTok', color: '#111827' },
  importacion: { label: 'Importado (CSV)', color: '#d97706' },
};
const ESTADOS: Record<string, { label: string; color: string }> = {
  abierta: { label: 'Abierta', color: '#10b981' }, pendiente: { label: 'Pendiente', color: '#f59e0b' }, resuelta: { label: 'Resuelta', color: '#64748b' },
};

export default function FichaContactoPage() {
  const { id } = useParams<{ id: string }>();
  const contactoId = Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const puedeSup = usePuede('supervisor');
  const { data: campos } = useCampos();
  const { data: canales } = useCanales();
  const { data: equipo } = useMiembros();

  const q = useQuery({ queryKey: ['contacto', contactoId], queryFn: () => api.get<Detalle>(`/contactos/${contactoId}`), enabled: Number.isFinite(contactoId), retry: false });
  const [tab, setTab] = useState<'actividad' | 'negocios'>('actividad');
  const [editando, setEditando] = useState(false);
  const [fusionando, setFusionando] = useState(false);
  const [negocio, setNegocio] = useState<number | null>(null);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['contacto', contactoId] });
    qc.invalidateQueries({ queryKey: ['contactos'] });
    qc.invalidateQueries({ queryKey: ['conversaciones'] });
    qc.invalidateQueries({ queryKey: ['tablero'] });
  };

  const waCanales = (canales?.canales ?? []).filter((c) => c.tipo === 'whatsapp' && c.activo);
  const abrirChat = useMutation({
    mutationFn: (canal_id: number) => api.post<{ conversacion_id: number }>('/conversaciones/nueva', { contacto_id: contactoId, canal_id }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['conversaciones'] }); router.push(`/inbox?c=${r.conversacion_id}`); },
    onError: (e) => toast.error((e as Error).message),
  });

  async function eliminar() {
    const nombre = q.data?.contacto.nombre ?? 'este contacto';
    const ok = await confirmar({
      titulo: `¿Eliminar a ${nombre}?`, peligro: true, confirmar: 'Eliminar contacto',
      texto: 'El contacto dejará de aparecer en la lista, en los tableros y en las difusiones. Sus conversaciones se conservan en el historial.',
    });
    if (!ok) return;
    try {
      await api.del(`/contactos/${contactoId}`);
      toast.success('Contacto eliminado');
      invalidar();
      router.push('/contactos');
    } catch (e) { toast.error((e as Error).message); }
  }

  const volver = (
    <Link href="/contactos" className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-800" aria-label="Volver a contactos">
      <ArrowLeft className="h-4 w-4" />
    </Link>
  );

  if (q.isError) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader icono={volver} titulo="Contacto" descripcion="Contactos" />
        <div className="flex-1 overflow-y-auto"><div className="mx-auto max-w-7xl p-6"><div className="card">
          <Vacio icono={<UserX className="h-5 w-5" />} titulo="No encontramos este contacto" texto={(q.error as Error).message || 'Puede que haya sido eliminado o fusionado con otro.'}
            accion={<Link href="/contactos"><Button variante="secundario" icono={<ArrowLeft className="h-4 w-4" />}>Volver a contactos</Button></Link>} />
        </div></div></div>
      </div>
    );
  }

  const d = q.data;
  const c = d?.contacto;
  const camposContacto = (campos ?? []).filter((x) => x.entidad === 'contacto');
  const responsable = equipo?.miembros.find((m) => m.usuario_id === c?.asignado_a);
  const abiertos = d?.negocios.filter((n) => !n.cerrado_en) ?? [];
  const valorAbierto = abiertos.reduce((s, n) => s + (Number(n.monto) || 0), 0);
  const ganados = d?.negocios.filter((n) => n.etapa_tipo === 'ganado') ?? [];
  const puedeWA = !!c?.telefono && waCanales.length > 0;
  const motivoWA = !c?.telefono ? 'El contacto no tiene teléfono' : !waCanales.length ? 'No hay un canal de WhatsApp activo' : '';

  const botonWA = (
    <Button variante="primario" className="bg-[#1faa53] hover:bg-[#1a9448] active:bg-[#178040]" disabled={!puedeWA} cargando={abrirChat.isPending}
      icono={<IconoCanal canal="whatsapp" size={16} />} onClick={waCanales.length === 1 ? () => abrirChat.mutate(waCanales[0].canal_id) : undefined}>
      Enviar WhatsApp{waCanales.length > 1 && <ChevronDown className="-mr-1 h-3.5 w-3.5 opacity-80" />}
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader icono={volver} titulo={c ? (c.nombre || telefonoBonito(c.telefono) || c.email || 'Sin nombre') : 'Contacto'}
        descripcion={<span><Link href="/contactos" className="hover:text-ink-800 hover:underline">Contactos</Link> <span className="text-ink-300">/</span> Ficha #{contactoId}</span>} />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-6 p-6">
          {/* ── Cabecera ── */}
          {!d || !c ? (
            <div className="card flex items-center gap-5 p-6"><Skeleton className="h-20 w-20 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-60" /><Skeleton className="h-4 w-40" /><Skeleton className="h-6 w-96" /></div></div>
          ) : (
            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-start gap-5 p-6">
                <Avatar nombre={c.nombre ?? c.telefono} size={76} className="ring-4 ring-brand-50" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-xl font-semibold tracking-tight text-ink-900">{c.nombre || <span className="italic text-ink-400">Sin nombre</span>}</h2>
                    {d.etiquetas.slice(0, 4).map((e) => <span key={e.etiqueta_id} className="hidden sm:inline-flex"><Badge color={e.color}>{e.nombre}</Badge></span>)}
                  </div>
                  {c.empresa_nombre && <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-500"><Building2 className="h-3.5 w-3.5" />{c.empresa_nombre}</p>}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {c.telefono && <DatoChip icono={<Phone className="h-3.5 w-3.5" />} texto={telefonoBonito(c.telefono)} copiar={c.telefono} />}
                    {c.email && <DatoChip icono={<Mail className="h-3.5 w-3.5" />} texto={c.email} copiar={c.email} />}
                    {c.documento && <DatoChip icono={<CreditCard className="h-3.5 w-3.5" />} texto={c.documento} copiar={c.documento} />}
                    {!c.telefono && !c.email && !c.documento && <span className="text-[13px] text-ink-400">Sin datos de contacto</span>}
                  </div>

                  {d.identidades.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {d.identidades.map((i) => (
                        <span key={i.identidad_id} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-100 bg-ink-50/60 py-0.5 pl-0.5 pr-2 text-xs text-ink-600">
                          <CanalChip canal={i.canal} />
                          <span className="max-w-[180px] truncate font-mono text-[11px]">{i.username ? `@${i.username}` : i.canal === 'whatsapp' ? telefonoBonito(`+${i.externo_id}`) : i.externo_id}</span>
                          {i.nombre_canal && i.nombre_canal !== c.nombre && <span className="max-w-[140px] truncate text-ink-400">· {i.nombre_canal}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!puedeWA ? <Tooltip texto={motivoWA}><span>{botonWA}</span></Tooltip>
                    : waCanales.length > 1 ? (
                      <Menu trigger={botonWA} items={waCanales.map((w) => ({
                        label: <span className="flex flex-col"><span>{w.nombre}</span><span className="text-[11px] text-ink-400">{w.datos.numero_display ?? w.externo_id}{w.sandbox ? ' · sandbox' : ''}</span></span>,
                        icono: <IconoCanal canal="whatsapp" size={14} />, onClick: () => abrirChat.mutate(w.canal_id),
                      }))} />
                    ) : botonWA}
                  <Button variante="secundario" icono={<Pencil className="h-4 w-4" />} onClick={() => setEditando(true)}>Editar</Button>
                  {puedeSup && (
                    <Menu trigger={<Button variante="secundario" tamano="icono" aria-label="Más acciones"><MoreHorizontal className="h-4 w-4" /></Button>}
                      items={[
                        { label: 'Fusionar con otro contacto', icono: <GitMerge className="h-4 w-4" />, onClick: () => setFusionando(true) },
                        { separador: true, label: '' },
                        { label: 'Eliminar contacto', icono: <Trash2 className="h-4 w-4" />, peligro: true, onClick: eliminar },
                      ]} />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 divide-x divide-y divide-ink-100 border-t border-ink-100 bg-ink-50/40 sm:grid-cols-4 sm:divide-y-0">
                <MiniStat label="Responsable" valor={c.asignado_nombre ? <span className="flex items-center gap-1.5"><Avatar nombre={c.asignado_nombre} color={responsable?.color} size={20} /><span className="truncate">{c.asignado_nombre}</span></span> : <span className="text-ink-400">Sin asignar</span>} />
                <MiniStat label="Negocios abiertos" valor={<>{abiertos.length}{valorAbierto > 0 && <span className="ml-1.5 text-xs font-medium text-ink-500">· {moneda(valorAbierto, true)}</span>}</>} />
                <MiniStat label="Conversaciones" valor={<>{d.conversaciones.length}{d.conversaciones[0] && <span className="ml-1.5 text-xs font-medium text-ink-500">· hace {hace(d.conversaciones[0].ultima_actividad)}</span>}</>} />
                <MiniStat label="Cliente desde" valor={<span className="flex items-center gap-1.5">{fecha(c.creado_en)}<Badge color={ORIGENES[c.origen]?.color ?? '#64748b'} className="hidden lg:inline-flex">{(ORIGENES[c.origen]?.label ?? c.origen).replace('Llegó por ', '').replace('Creado manualmente', 'Manual')}</Badge></span>} />
              </div>
            </div>
          )}

          {/* ── Cuerpo ── */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <div className="flex items-center justify-between">
                <Tabs valor={tab} onChange={setTab} opciones={[
                  { valor: 'actividad', label: 'Actividad' },
                  { valor: 'negocios', label: 'Negocios', contador: d?.negocios.length },
                ]} />
              </div>
              {!d ? <div className="card space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
                : tab === 'actividad' ? <Actividad d={d} onInvalidar={invalidar} onNegocio={setNegocio} />
                  : <Negocios d={d} onNegocio={setNegocio} />}
            </div>

            <div className="space-y-4">
              <div className="card">
                <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900"><Hash className="h-4 w-4 text-ink-400" />Datos</h3>
                  {c && <Button variante="fantasma" tamano="xs" icono={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditando(true)}>Editar</Button>}
                </div>
                {!c ? <div className="space-y-2 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5" />)}</div> : (
                  <dl className="divide-y divide-ink-100 text-[13px]">
                    <Fila k="Nombre" v={c.nombre} />
                    <Fila k="Teléfono" v={telefonoBonito(c.telefono)} mono />
                    <Fila k="Email" v={c.email} />
                    <Fila k="Documento" v={c.documento} mono />
                    <Fila k="Empresa" v={c.empresa_nombre} />
                    <Fila k="Responsable" v={c.asignado_nombre} />
                    <Fila k="Origen" v={ORIGENES[c.origen]?.label ?? c.origen} />
                    <Fila k="Creado" v={`${fechaHora(c.creado_en)}${c.creado_por_nombre ? ` · ${c.creado_por_nombre}` : ''}`} />
                    <Fila k="Actualizado" v={`hace ${hace(c.actualizado_en)}`} />
                    {camposContacto.length > 0 && (
                      <>
                        <div className="bg-ink-50/60 px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">Campos personalizados</div>
                        {camposContacto.map((f) => <Fila key={f.campo_id} k={f.nombre} v={valorLegible(f, c.valores?.[f.clave])} />)}
                      </>
                    )}
                  </dl>
                )}
              </div>

              <div className="card">
                <div className="border-b border-ink-100 px-5 py-3">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900"><Tag className="h-4 w-4 text-ink-400" />Etiquetas</h3>
                </div>
                <div className="px-5 py-4">
                  {d ? <SelectorEtiquetas contactoId={contactoId} actuales={d.etiquetas} /> : <Skeleton className="h-6 w-40" />}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {d && <EditarDrawer abierto={editando} onClose={() => setEditando(false)} d={d} campos={camposContacto} onGuardado={invalidar} />}
      {d && puedeSup && <FusionarModal abierto={fusionando} onClose={() => setFusionando(false)} d={d} onFusionado={invalidar} />}
      <NegocioDrawer negocioId={negocio} conversacionId={d?.conversaciones[0]?.conversacion_id} onClose={() => setNegocio(null)} />
    </div>
  );
}

// ── Piezas pequeñas ──────────────────────────────────────────────────────────

function DatoChip({ icono, texto, copiar }: { icono: React.ReactNode; texto: string; copiar: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Tooltip texto={ok ? '¡Copiado!' : 'Copiar'}>
      <button type="button" onClick={() => { navigator.clipboard?.writeText(copiar).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }).catch(() => {}); }}
        className="group inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-[13px] text-ink-700 transition-colors hover:border-ink-300 hover:bg-ink-50">
        <span className="text-ink-400">{icono}</span>
        <span className="max-w-[240px] truncate tabular-nums">{texto}</span>
        {ok ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-ink-300 opacity-0 transition-opacity group-hover:opacity-100" />}
      </button>
    </Tooltip>
  );
}

function MiniStat({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <div className="min-w-0 px-6 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{label}</p>
      <div className="mt-0.5 flex min-w-0 items-center text-[13px] font-semibold text-ink-800">{valor}</div>
    </div>
  );
}

function Fila({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  const vacio = !v || v === '—';
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-2.5">
      <dt className="shrink-0 text-ink-500">{k}</dt>
      <dd className={cn('min-w-0 break-words text-right font-medium', vacio ? 'font-normal text-ink-300' : 'text-ink-800', mono && !vacio && 'tabular-nums')}>{vacio ? '—' : v}</dd>
    </div>
  );
}

function EtapaChip({ nombre, color }: { nombre: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: color + '1f', color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />{nombre}
    </span>
  );
}

// ── Pestaña Actividad ────────────────────────────────────────────────────────

type Evento =
  | { tipo: 'nota'; fecha: string; nota: Detalle['notas'][number] }
  | { tipo: 'negocio'; fecha: string; negocio: Detalle['negocios'][number] }
  | { tipo: 'alta'; fecha: string };

function Actividad({ d, onInvalidar, onNegocio }: { d: Detalle; onInvalidar: () => void; onNegocio: (id: number) => void }) {
  const qc = useQueryClient();
  const [nota, setNota] = useState('');
  const id = d.contacto.contacto_id;

  const guardar = useMutation({
    mutationFn: () => api.post(`/contactos/${id}/notas`, { contenido: nota.trim() }),
    onSuccess: () => { setNota(''); toast.success('Nota agregada'); qc.invalidateQueries({ queryKey: ['contacto', id] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  async function borrarNota(notaId: number) {
    if (!(await confirmar({ titulo: '¿Eliminar esta nota?', texto: 'No se puede deshacer.', confirmar: 'Eliminar', peligro: true }))) return;
    try { await api.del(`/contactos/notas/${notaId}`); toast.success('Nota eliminada'); onInvalidar(); } catch (e) { toast.error((e as Error).message); }
  }

  const eventos = useMemo<Evento[]>(() => [
    ...d.notas.map((n) => ({ tipo: 'nota' as const, fecha: n.creado_en, nota: n })),
    ...d.negocios.map((n) => ({ tipo: 'negocio' as const, fecha: n.creado_en, negocio: n })),
    { tipo: 'alta' as const, fecha: d.contacto.creado_en },
  ].sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)), [d]);

  return (
    <div className="space-y-4">
      {/* Nota */}
      <div className="card p-4">
        <Textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Escribe una nota interna sobre este contacto…"
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && nota.trim()) guardar.mutate(); }}
          className="min-h-[64px] border-ink-200 bg-amber-50/30 text-[13px] focus:bg-white" />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-ink-400">Solo visible para tu equipo · <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span></span>
          <Button tamano="sm" icono={<StickyNote className="h-3.5 w-3.5" />} disabled={!nota.trim()} cargando={guardar.isPending} onClick={() => guardar.mutate()}>Guardar nota</Button>
        </div>
      </div>

      {/* Conversaciones */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900"><MessageSquare className="h-4 w-4 text-ink-400" />Conversaciones</h3>
          <span className="text-xs text-ink-400">{d.conversaciones.length}</span>
        </div>
        {!d.conversaciones.length ? (
          <p className="px-5 py-6 text-center text-[13px] text-ink-500">Aún no hay conversaciones con este contacto.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {d.conversaciones.map((cv) => {
              const e = ESTADOS[cv.estado] ?? { label: cv.estado, color: '#64748b' };
              return (
                <li key={cv.conversacion_id}>
                  <Link href={`/inbox?c=${cv.conversacion_id}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-ink-50/70">
                    <CanalChip canal={cv.canal} conTexto={false} className="h-7 w-7 justify-center rounded-lg p-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink-900">{cv.canal_nombre}</span>
                        <Badge color={e.color}>{e.label}</Badge>
                        {cv.no_leidos > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold leading-4 text-white">{cv.no_leidos}</span>}
                      </div>
                      <p className="truncate text-xs text-ink-500">{cv.ultimo_mensaje || 'Sin mensajes'}</p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-400">hace {hace(cv.ultima_actividad)}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Historial */}
      <div className="card p-5">
        <h3 className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold text-ink-900"><CalendarDays className="h-4 w-4 text-ink-400" />Historial</h3>
        <ol className="relative space-y-4 border-l border-ink-200 pl-6">
          {eventos.map((ev, i) => (
            <li key={i} className="relative">
              {ev.tipo === 'nota' ? (
                <>
                  <span className="absolute -left-[37px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-600 ring-4 ring-white"><StickyNote className="h-3 w-3" /></span>
                  <div className="group rounded-lg border border-amber-100 bg-amber-50/60 px-3.5 py-2.5">
                    <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
                      <Avatar nombre={ev.nota.autor_nombre} color={ev.nota.autor_color} size={18} />
                      <span className="font-medium text-ink-700">{ev.nota.autor_nombre ?? 'Alguien'}</span>
                      <span>agregó una nota · <Tooltip texto={fechaHora(ev.fecha)}><span>hace {hace(ev.fecha)}</span></Tooltip></span>
                      <button onClick={() => borrarNota(ev.nota.nota_id)} aria-label="Eliminar nota"
                        className="ml-auto rounded p-1 text-ink-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-800">{ev.nota.contenido}</p>
                  </div>
                </>
              ) : ev.tipo === 'negocio' ? (
                <>
                  <span className="absolute -left-[37px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-brand-600 ring-4 ring-white"><KanbanSquare className="h-3 w-3" /></span>
                  <p className="text-[13px] text-ink-700">
                    Agregado a <b className="font-medium text-ink-900">{ev.negocio.pipeline_nombre}</b>
                    {ev.negocio.titulo && <> — <button onClick={() => onNegocio(ev.negocio.negocio_id)} className="font-medium text-brand-700 hover:underline">{ev.negocio.titulo}</button></>}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-400"><EtapaChip nombre={ev.negocio.etapa_nombre} color={ev.negocio.etapa_color} /><span>{fechaHora(ev.fecha)}</span></div>
                </>
              ) : (
                <>
                  <span className="absolute -left-[37px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 ring-4 ring-white"><Sparkles className="h-3 w-3" /></span>
                  <p className="text-[13px] text-ink-700">{ORIGENES[d.contacto.origen]?.label ?? 'Contacto creado'}{d.contacto.creado_por_nombre && <> por <b className="font-medium text-ink-900">{d.contacto.creado_por_nombre}</b></>}</p>
                  <p className="mt-0.5 text-xs text-ink-400">{fechaHora(ev.fecha)}</p>
                </>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ── Pestaña Negocios ─────────────────────────────────────────────────────────

function Negocios({ d, onNegocio }: { d: Detalle; onNegocio: (id: number) => void }) {
  const qc = useQueryClient();
  const { data: pipelines } = usePipelines();
  const [pipe, setPipe] = useState('');
  const id = d.contacto.contacto_id;
  const abiertosPipes = new Set(d.negocios.filter((n) => !n.cerrado_en).map((n) => n.pipeline_id));
  const disponibles = pipelines?.filter((p) => p.activo && !abiertosPipes.has(p.pipeline_id)) ?? [];

  const crear = useMutation({
    mutationFn: () => api.post('/negocios', { contacto_id: id, pipeline_id: Number(pipe), titulo: d.contacto.nombre }),
    onSuccess: () => {
      setPipe(''); toast.success('Negocio creado');
      qc.invalidateQueries({ queryKey: ['contacto', id] }); qc.invalidateQueries({ queryKey: ['tablero'] }); qc.invalidateQueries({ queryKey: ['pipelines'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink-900">Agregar a pipeline</p>
          <p className="text-xs text-ink-500">Crea un negocio en la primera etapa del pipeline elegido.</p>
        </div>
        {disponibles.length ? (
          <div className="flex items-center gap-2">
            <Select value={pipe} onChange={(e) => setPipe(e.target.value)} className="h-8 w-52 py-1 text-[13px]">
              <option value="">Elige un pipeline…</option>
              {disponibles.map((p) => <option key={p.pipeline_id} value={p.pipeline_id}>{p.nombre}</option>)}
            </Select>
            <Button tamano="sm" icono={<Plus className="h-3.5 w-3.5" />} disabled={!pipe} cargando={crear.isPending} onClick={() => crear.mutate()}>Agregar</Button>
          </div>
        ) : <span className="text-xs text-ink-400">Ya tiene un negocio abierto en cada pipeline activo.</span>}
      </div>

      {!d.negocios.length ? (
        <div className="card"><Vacio icono={<KanbanSquare className="h-5 w-5" />} titulo="Sin negocios" texto="Este contacto aún no está en ningún pipeline de ventas." /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {d.negocios.map((n) => {
            const cerrado = !!n.cerrado_en;
            return (
              <button key={n.negocio_id} onClick={() => onNegocio(n.negocio_id)}
                className={cn('card group p-4 text-left transition-all hover:-translate-y-px hover:border-ink-300 hover:shadow-lift', cerrado && 'bg-ink-50/50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink-500">
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: n.pipeline_color }} /><span className="truncate">{n.pipeline_nombre}</span>
                  </span>
                  {n.etapa_tipo === 'ganado' ? <Badge color="#10b981"><Trophy className="h-3 w-3" />Ganado</Badge>
                    : n.etapa_tipo === 'perdido' ? <Badge color="#ef4444"><XCircle className="h-3 w-3" />Perdido</Badge>
                      : cerrado ? <Badge>Cerrado</Badge> : null}
                </div>
                <p className="mt-1.5 truncate text-[14px] font-semibold text-ink-900 group-hover:text-brand-700">{n.titulo || 'Sin título'}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-ink-800">{n.monto !== null ? moneda(Number(n.monto)) : <span className="text-sm font-normal text-ink-400">Sin monto</span>}</p>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-100 pt-3">
                  <EtapaChip nombre={n.etapa_nombre} color={n.etapa_color} />
                  {n.asignado_nombre ? (
                    <span className="flex items-center gap-1.5 text-xs text-ink-600"><Avatar nombre={n.asignado_nombre} size={20} />{n.asignado_nombre.split(' ')[0]}</span>
                  ) : <span className="flex items-center gap-1 text-xs text-ink-400"><UserRound className="h-3.5 w-3.5" />Sin asignar</span>}
                </div>
                <p className="mt-2 text-[11px] text-ink-400">En esta etapa desde hace {hace(n.etapa_desde)}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Drawer: editar contacto ──────────────────────────────────────────────────

type Base = { nombre: string; telefono: string; email: string; documento: string; empresa_nombre: string; asignado_a: string };

function EditarDrawer({ abierto, onClose, d, campos, onGuardado }: { abierto: boolean; onClose: () => void; d: Detalle; campos: Campo[]; onGuardado: () => void }) {
  const { data: equipo } = useMiembros();
  const c = d.contacto;
  const inicial = useMemo<Base>(() => ({
    nombre: c.nombre ?? '', telefono: c.telefono ?? '', email: c.email ?? '', documento: c.documento ?? '', empresa_nombre: c.empresa_nombre ?? '', asignado_a: c.asignado_a ?? '',
  }), [c]);
  const [f, setF] = useState<Base>(inicial);
  const [valores, setValores] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<{ campo?: 'telefono' | 'email'; msg: string } | null>(null);

  useEffect(() => { if (abierto) { setF(inicial); setValores({ ...(c.valores ?? {}) }); setError(null); } }, [abierto, inicial, c.valores]);

  const cambios = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(inicial) as Array<keyof Base>) {
      const a = f[k].trim(); const b = inicial[k];
      if (k === 'telefono' ? a !== b && a !== telefonoBonito(b) : a !== b) out[k] = a || null;
    }
    const vs: Record<string, unknown> = {};
    for (const campo of campos) {
      const a = valores[campo.clave] ?? null; const b = c.valores?.[campo.clave] ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b)) vs[campo.clave] = a === '' ? null : a;
    }
    if (Object.keys(vs).length) out.valores = vs;
    return out;
  }, [f, inicial, valores, campos, c.valores]);
  const hayCambios = Object.keys(cambios).length > 0;

  const guardar = useMutation({
    mutationFn: () => api.patch(`/contactos/${c.contacto_id}`, cambios),
    onSuccess: () => { toast.success('Contacto actualizado'); onGuardado(); onClose(); },
    onError: (e) => {
      const msg = (e as Error).message;
      setError({ campo: /tel[eé]fono/i.test(msg) ? 'telefono' : /email|correo/i.test(msg) ? 'email' : undefined, msg });
    },
  });
  const set = (k: keyof Base) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); if (error) setError(null); };

  return (
    <Drawer abierto={abierto} onClose={onClose} titulo="Editar contacto" subtitulo={c.nombre ?? undefined} ancho="max-w-[560px]"
      pie={<>
        {hayCambios && <span className="mr-auto text-xs text-ink-500">{Object.keys(cambios).length} cambio{Object.keys(cambios).length === 1 ? '' : 's'} sin guardar</span>}
        <Button variante="secundario" onClick={onClose}>Cancelar</Button>
        <Button disabled={!hayCambios} cargando={guardar.isPending} onClick={() => guardar.mutate()}>Guardar cambios</Button>
      </>}>
      <form className="space-y-6 p-6" onSubmit={(e) => { e.preventDefault(); if (hayCambios) guardar.mutate(); }}>
        {error && !error.campo && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error.msg}</div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" className="sm:col-span-2"><Input value={f.nombre} onChange={set('nombre')} placeholder="Nombre completo" /></Field>
          <Field label="Teléfono" hint="+51 987 654 321 o 9 dígitos" error={error?.campo === 'telefono' ? error.msg : null}>
            <Input type="tel" value={f.telefono} onChange={set('telefono')} className={cn(error?.campo === 'telefono' && 'border-red-300')} />
          </Field>
          <Field label="Email" error={error?.campo === 'email' ? error.msg : null}>
            <Input type="email" value={f.email} onChange={set('email')} className={cn(error?.campo === 'email' && 'border-red-300')} />
          </Field>
          <Field label="Documento" hint="DNI o RUC"><Input value={f.documento} onChange={set('documento')} /></Field>
          <Field label="Empresa"><Input value={f.empresa_nombre} onChange={set('empresa_nombre')} /></Field>
          <Field label="Responsable" className="sm:col-span-2">
            <Select value={f.asignado_a} onChange={set('asignado_a')}>
              <option value="">Sin asignar</option>
              {equipo?.miembros.filter((m) => m.activo || m.usuario_id === c.asignado_a).map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nombre}</option>)}
            </Select>
          </Field>
        </div>
        {campos.length > 0 && (
          <div className="border-t border-ink-100 pt-5">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Campos personalizados</h4>
            <CamposForm campos={campos} valores={valores} onChange={setValores} />
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Drawer>
  );
}

// ── Modal: fusionar ──────────────────────────────────────────────────────────

function FusionarModal({ abierto, onClose, d, onFusionado }: { abierto: boolean; onClose: () => void; d: Detalle; onFusionado: () => void }) {
  const qc = useQueryClient();
  const [otro, setOtro] = useState<ContactoFila | null>(null);
  const c = d.contacto;
  useEffect(() => { if (abierto) setOtro(null); }, [abierto]);

  const fusionar = useMutation({
    mutationFn: () => api.post(`/contactos/${c.contacto_id}/fusionar`, { origen_id: otro!.contacto_id }),
    onSuccess: () => {
      toast.success(`${otro?.nombre ?? 'El contacto'} se fusionó en ${c.nombre ?? 'este contacto'}`);
      qc.removeQueries({ queryKey: ['contacto', otro!.contacto_id] });
      onFusionado(); onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const Tarjeta = ({ nombre, sub, tono, rotulo }: { nombre: string | null; sub: string; tono: 'rojo' | 'verde'; rotulo: string }) => (
    <div className={cn('min-w-0 flex-1 rounded-xl border p-3', tono === 'rojo' ? 'border-red-200 bg-red-50/50' : 'border-emerald-200 bg-emerald-50/50')}>
      <p className={cn('mb-2 text-[10px] font-semibold uppercase tracking-wider', tono === 'rojo' ? 'text-red-600' : 'text-emerald-700')}>{rotulo}</p>
      <div className="flex items-center gap-2.5">
        <Avatar nombre={nombre} size={32} />
        <div className="min-w-0"><p className="truncate text-[13px] font-semibold text-ink-900">{nombre ?? 'Sin nombre'}</p><p className="truncate text-xs text-ink-500">{sub || '—'}</p></div>
      </div>
    </div>
  );

  return (
    <Modal abierto={abierto} onClose={onClose} titulo="Fusionar contactos" ancho="lg"
      descripcion="Útil cuando una misma persona te escribió por distintos canales o se registró dos veces."
      pie={<>
        <Button variante="secundario" onClick={onClose}>Cancelar</Button>
        <Button variante="peligro" icono={<GitMerge className="h-4 w-4" />} disabled={!otro} cargando={fusionar.isPending} onClick={() => fusionar.mutate()}>Fusionar contactos</Button>
      </>}>
      <div className="space-y-5">
        <Field label="Contacto duplicado" hint="Busca por nombre, teléfono o email">
          <ContactoPicker valor={otro} onChange={setOtro} excluir={c.contacto_id} />
        </Field>

        <div className="flex items-center gap-3">
          <Tarjeta rotulo="Se eliminará" tono="rojo" nombre={otro ? otro.nombre : 'Elige un contacto'} sub={otro ? telefonoBonito(otro.telefono) || otro.email || '' : ''} />
          <ArrowRight className="h-5 w-5 shrink-0 text-ink-400" />
          <Tarjeta rotulo="Se conserva" tono="verde" nombre={c.nombre} sub={telefonoBonito(c.telefono) || c.email || ''} />
        </div>

        <div className="rounded-xl bg-ink-50 p-4 text-[13px] leading-relaxed text-ink-700">
          <p className="font-medium text-ink-900">
            {otro ? <>«{otro.nombre ?? 'Sin nombre'}» se integrará en «{c.nombre ?? 'este contacto'}».</> : 'El otro contacto se integrará en este.'}
          </p>
          <ul className="mt-2 space-y-1.5">
            {['Sus identidades de canal (WhatsApp, Messenger, TikTok…) y conversaciones pasan a este contacto.', 'Las notas, etiquetas y negocios también se mueven. Si ambos tienen un negocio abierto en el mismo pipeline, el del duplicado se cierra.',
              'Los datos vacíos de este contacto se completan con los del otro; los que ya tiene no se sobrescriben.'].map((t) => (
              <li key={t} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{t}</li>
            ))}
            <li className="flex gap-2 text-red-700"><Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />El contacto duplicado se elimina. Esta acción no se puede deshacer.</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}
