'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowRight, Check, CircleDollarSign, Clock3, Filter, KanbanSquare, LayoutDashboard, MessagesSquare,
  Percent, Plug, Rocket, Sparkles, Trophy, UserPlus, Users, X, Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, moneda, numero } from '@/lib/utils';
import type { Canal } from '@/lib/types';
import { useCanales, useMe, useMiembros, usePipelines, useRespuestas } from '@/hooks/datos';
import { Avatar, PageHeader, Select, Skeleton, Stat, Tabs, Vacio } from '@/components/ui';
import { CANAL_INFO, IconoCanal } from '@/components/crm/canal';

interface Resumen {
  dias: number;
  kpis: {
    contactos: number; contactos_nuevos: number; conversaciones_abiertas: number; sin_asignar: number; negocios_abiertos: number;
    monto_abierto: number; ganados: number; monto_ganado: number; perdidos: number; mensajes_entrantes: number; mensajes_salientes: number;
    tasa_conversion: number | null; primera_respuesta_seg: number | null;
  };
  por_dia: Array<{ dia: string; entrantes: number; salientes: number }>;
  por_canal: Array<{ canal: Canal; mensajes: number; conversaciones: number }>;
  embudo: Array<{ pipeline_id: number; pipeline: string; etapa_id: number; nombre: string; color: string; tipo: 'abierta' | 'ganado' | 'perdido'; orden: number; negocios: number; monto: number; entradas: number }>;
  agentes: Array<{ usuario_id: string; nombre: string; color: string; mensajes: number; abiertas: number; ganados: number }>;
  origenes: Array<{ origen: string; total: number }>;
}

type Periodo = '7' | '30' | '90';

// Validado con el script de dataviz: sky-500 / brand-600 (CVD ΔE 17.9)
const C_ENTRANTES = '#0ea5e9';
const C_SALIENTES = '#4f46e5';

const ORIGEN: Record<string, string> = {
  manual: 'Creado manualmente', whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram', tiktok: 'TikTok',
  importacion: 'Importación CSV', formulario: 'Formulario web', api: 'API',
};

function duracion(seg: number | null | undefined): string {
  if (seg === null || seg === undefined) return '—';
  if (seg < 60) return `${Math.round(seg)} s`;
  const min = seg / 60;
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0).replace('.', ',')} h`;
  return `${(h / 24).toFixed(1).replace('.', ',')} d`;
}

export default function InicioPage() {
  return <Suspense fallback={null}><Inicio /></Suspense>;
}

function Inicio() {
  const { data: me } = useMe();
  const params = useSearchParams();
  const [periodo, setPeriodo] = useState<Periodo>('30');
  const q = useQuery({
    queryKey: ['metricas', periodo],
    queryFn: () => api.get<Resumen>(`/metricas/resumen?dias=${periodo}`),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
  const d = q.data;
  const k = d?.kpis;
  const nombre = me?.usuario.nombre?.split(' ')[0] ?? '';
  const hoy = format(new Date(), "EEEE d 'de' MMMM", { locale: es });

  return (
    <div className="flex h-full flex-col">
      <PageHeader icono={<LayoutDashboard className="h-5 w-5" />} titulo="Inicio" descripcion="Resumen de actividad de tu equipo"
        acciones={<Tabs<Periodo> valor={periodo} onChange={setPeriodo} opciones={[
          { valor: '7', label: '7 días' }, { valor: '30', label: '30 días' }, { valor: '90', label: '90 días' },
        ]} />} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          {/* Saludo */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-ink-500 first-letter:uppercase">{hoy}</p>
              <h2 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink-900">Hola{nombre ? `, ${nombre}` : ''} 👋</h2>
              <p className="mt-1 text-sm text-ink-500">Esto es lo que pasa en <span className="font-medium text-ink-700">{me?.empresa?.nombre ?? 'tu empresa'}</span> en los últimos {periodo} días.</p>
            </div>
            {k && k.sin_asignar > 0 && (
              <Link href="/inbox" className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-800 transition-colors hover:bg-amber-100">
                <Clock3 className="h-4 w-4 text-amber-500" />{k.sin_asignar} {k.sin_asignar === 1 ? 'conversación espera' : 'conversaciones esperan'} agente<ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>

          {params.get('bienvenida') === '1' && <Bienvenida />}

          {/* KPIs */}
          {!k ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[112px] rounded-xl" />)}</div>
          ) : (
            <div className={cn('grid grid-cols-2 gap-4 lg:grid-cols-3 transition-opacity', q.isFetching && q.isPlaceholderData && 'opacity-60')}>
              <Stat label="Conversaciones abiertas" valor={numero(k.conversaciones_abiertas)} icono={<MessagesSquare className="h-4 w-4" />}
                detalle={k.sin_asignar ? <span className="text-amber-600">{k.sin_asignar} sin asignar</span> : 'Todas asignadas'} />
              <Stat label="Contactos nuevos" valor={numero(k.contactos_nuevos)} icono={<UserPlus className="h-4 w-4" />} tono="cielo"
                detalle={`${numero(k.contactos)} en total`} />
              <Stat label="Monto en curso" valor={moneda(k.monto_abierto, true)} icono={<CircleDollarSign className="h-4 w-4" />} tono="ambar"
                detalle={`${numero(k.negocios_abiertos)} negocio${k.negocios_abiertos !== 1 ? 's' : ''} abierto${k.negocios_abiertos !== 1 ? 's' : ''}`} />
              <Stat label="Ganado en el período" valor={moneda(k.monto_ganado, true)} icono={<Trophy className="h-4 w-4" />} tono="verde"
                detalle={`${numero(k.ganados)} negocio${k.ganados !== 1 ? 's' : ''} cerrado${k.ganados !== 1 ? 's' : ''}`} />
              <Stat label="Tasa de conversión" valor={k.tasa_conversion === null ? '—' : `${Math.round(k.tasa_conversion * 100)}%`} icono={<Percent className="h-4 w-4" />}
                detalle={`${k.ganados} ganados · ${k.perdidos} perdidos`} />
              <Stat label="Primera respuesta" valor={duracion(k.primera_respuesta_seg)} icono={<Clock3 className="h-4 w-4" />} tono="cielo"
                detalle="Mediana de tiempo humano" />
            </div>
          )}

          {/* Mensajes por día + canales */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="card p-5 lg:col-span-2">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-[15px] font-semibold text-ink-900">Mensajes por día</h3>
                  <p className="text-[13px] text-ink-500">Entrantes de clientes vs. respuestas enviadas</p>
                </div>
                {k && (
                  <div className="flex items-center gap-5">
                    <Leyenda color={C_ENTRANTES} label="Entrantes" valor={k.mensajes_entrantes} />
                    <Leyenda color={C_SALIENTES} label="Salientes" valor={k.mensajes_salientes} />
                  </div>
                )}
              </div>
              {!d ? <Skeleton className="h-[260px]" /> : <GraficoDias datos={d.por_dia} />}
            </div>
            <div className="card p-5">
              <h3 className="text-[15px] font-semibold text-ink-900">Por canal</h3>
              <p className="text-[13px] text-ink-500">Mensajes del período</p>
              {!d ? <Skeleton className="mt-4 h-[200px]" /> : <Canales datos={d.por_canal} />}
            </div>
          </div>

          {/* Embudo */}
          {d ? <Embudo datos={d.embudo} /> : <Skeleton className="h-64 rounded-xl" />}

          {/* Equipo + origenes */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="card overflow-hidden lg:col-span-2">
              <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
                <div>
                  <h3 className="text-[15px] font-semibold text-ink-900">Rendimiento del equipo</h3>
                  <p className="text-[13px] text-ink-500">Ordenado por mensajes enviados</p>
                </div>
                <Users className="h-4 w-4 text-ink-400" />
              </div>
              {!d ? <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div> : <Equipo datos={d.agentes} />}
            </div>
            <div className="card p-5">
              <h3 className="text-[15px] font-semibold text-ink-900">Origen de contactos</h3>
              <p className="text-[13px] text-ink-500">Contactos nuevos del período</p>
              {!d ? <Skeleton className="mt-4 h-[180px]" /> : <Origenes datos={d.origenes} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Leyenda({ color, label, valor }: { color: string; label: string; valor: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <div className="leading-tight">
        <p className="text-[11px] font-medium text-ink-500">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-ink-900">{numero(valor)}</p>
      </div>
    </div>
  );
}

// ── Gráfico de mensajes por día ──────────────────────────────────────────────

function GraficoDias({ datos }: { datos: Resumen['por_dia'] }) {
  const vacio = datos.every((x) => !x.entrantes && !x.salientes);
  const filas = useMemo(() => datos.map((x) => ({ ...x, fecha: new Date(`${x.dia}T12:00:00`) })), [datos]);
  if (vacio) return <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-ink-200 text-[13px] text-ink-400">Aún no hay mensajes en este período</div>;
  const intervalo = datos.length > 31 ? Math.ceil(datos.length / 10) - 1 : datos.length > 10 ? Math.ceil(datos.length / 8) - 1 : 0;
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={filas} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barGap={2} barCategoryGap={datos.length > 31 ? '15%' : '28%'}>
          <CartesianGrid vertical={false} stroke="#eef1f5" />
          <XAxis dataKey="dia" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} interval={intervalo} tickMargin={8}
            tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: string) => format(new Date(`${v}T12:00:00`), 'd MMM', { locale: es })} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} width={40} />
          <RTooltip cursor={{ fill: '#f1f5f9', radius: 4 }} content={<TooltipDia />} />
          <Bar dataKey="entrantes" name="Entrantes" fill={C_ENTRANTES} radius={[3, 3, 0, 0]} maxBarSize={14} />
          <Bar dataKey="salientes" name="Salientes" fill={C_SALIENTES} radius={[3, 3, 0, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TooltipDia({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string; name: string }>; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="min-w-[150px] rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-pop">
      <p className="mb-1.5 text-[11px] font-semibold text-ink-500 first-letter:uppercase">{format(new Date(`${label}T12:00:00`), "EEEE d 'de' MMM", { locale: es })}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 text-[13px]">
          <span className="flex items-center gap-1.5 text-ink-600"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />{p.name}</span>
          <span className="font-semibold tabular-nums text-ink-900">{numero(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Canales ─────────────────────────────────────────────────────────────────

function Canales({ datos }: { datos: Resumen['por_canal'] }) {
  const total = datos.reduce((s, x) => s + x.mensajes, 0);
  if (!total) return <p className="mt-10 text-center text-[13px] text-ink-400">Sin mensajes en este período</p>;
  return (
    <div className="mt-4">
      {/* Barra apilada */}
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {datos.map((c) => <div key={c.canal} style={{ width: `${(c.mensajes / total) * 100}%`, backgroundColor: CANAL_INFO[c.canal]?.color ?? '#94a3b8' }} />)}
      </div>
      <ul className="mt-5 space-y-3.5">
        {datos.map((c) => {
          const info = CANAL_INFO[c.canal];
          const pct = Math.round((c.mensajes / total) * 100);
          return (
            <li key={c.canal} className="flex items-center gap-3">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', info?.bg, info?.texto)}><IconoCanal canal={c.canal} size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[13px] font-medium text-ink-800">{info?.label ?? c.canal}</p>
                  <p className="text-[13px] font-semibold tabular-nums text-ink-900">{numero(c.mensajes)}<span className="ml-1.5 text-[11px] font-normal text-ink-400">{pct}%</span></p>
                </div>
                <p className="text-[11px] text-ink-500">{numero(c.conversaciones)} conversacion{c.conversaciones !== 1 ? 'es' : ''}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Embudo ──────────────────────────────────────────────────────────────────

function Embudo({ datos }: { datos: Resumen['embudo'] }) {
  const pipelines = useMemo(() => {
    const m = new Map<number, { id: number; nombre: string; etapas: Resumen['embudo'] }>();
    for (const e of datos) {
      if (!m.has(e.pipeline_id)) m.set(e.pipeline_id, { id: e.pipeline_id, nombre: e.pipeline, etapas: [] });
      m.get(e.pipeline_id)!.etapas.push(e);
    }
    const peso = { abierta: 0, ganado: 1, perdido: 2 } as const;
    for (const p of m.values()) p.etapas.sort((a, b) => peso[a.tipo] - peso[b.tipo] || a.orden - b.orden);
    return [...m.values()];
  }, [datos]);
  const [sel, setSel] = useState<number | null>(null);
  const p = pipelines.find((x) => x.id === sel) ?? pipelines[0];
  const max = Math.max(1, ...(p?.etapas.map((e) => e.negocios) ?? [1]));
  const totalMonto = p?.etapas.filter((e) => e.tipo === 'abierta').reduce((s, e) => s + e.monto, 0) ?? 0;

  return (
    <div className="card p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink-900"><Filter className="h-4 w-4 text-ink-400" />Embudo de ventas</h3>
          <p className="text-[13px] text-ink-500">Negocios por etapa · abiertos y cerrados en el período</p>
        </div>
        <div className="flex items-center gap-3">
          {p && <p className="text-[13px] text-ink-500">En curso: <span className="font-semibold text-ink-900">{moneda(totalMonto, true)}</span></p>}
          {pipelines.length > 1 && (
            <Select value={p?.id ?? ''} onChange={(e) => setSel(Number(e.target.value))} className="h-8 w-48 py-1 text-[13px]">
              {pipelines.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </Select>
          )}
          {p && <Link href={`/pipelines/${p.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700">Ver tablero<ArrowRight className="h-3.5 w-3.5" /></Link>}
        </div>
      </div>
      {!p ? (
        <Vacio icono={<KanbanSquare className="h-5 w-5" />} titulo="Sin pipelines activos" texto="Crea un pipeline para seguir tus oportunidades." className="py-8" />
      ) : (
        <div className="space-y-2.5">
          {p.etapas.map((e, i) => {
            const cerrada = e.tipo !== 'abierta';
            const primerCierre = cerrada && p.etapas[i - 1]?.tipo === 'abierta';
            return (
              <div key={e.etapa_id}>
                {primerCierre && <div className="my-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400"><span className="h-px flex-1 bg-ink-100" />Cerrados en el período<span className="h-px flex-1 bg-ink-100" /></div>}
                <div className="group grid grid-cols-[160px_1fr_150px] items-center gap-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
                    <span className="truncate text-[13px] font-medium text-ink-700">{e.nombre}</span>
                  </div>
                  <div className="relative h-7 rounded-md bg-ink-50">
                    <div className="absolute inset-y-0 left-0 flex items-center rounded-md transition-all duration-500"
                      style={{ width: `${Math.max((e.negocios / max) * 100, e.negocios ? 3 : 0)}%`, backgroundColor: e.color + (cerrada ? '33' : '2e'), boxShadow: `inset 3px 0 0 ${e.color}` }} />
                    <span className="absolute inset-y-0 left-3 flex items-center text-[12px] font-semibold tabular-nums text-ink-800">{e.negocios} negocio{e.negocios !== 1 && 's'}</span>
                  </div>
                  <p className="text-right text-[13px] font-semibold tabular-nums text-ink-900">{moneda(e.monto, true)}
                    {e.entradas > 0 && <span className="block text-[11px] font-normal text-ink-400">{e.entradas} entrada{e.entradas !== 1 && 's'}</span>}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Equipo ──────────────────────────────────────────────────────────────────

function Equipo({ datos }: { datos: Resumen['agentes'] }) {
  if (!datos.length) return <Vacio icono={<Users className="h-5 w-5" />} titulo="Sin miembros" className="py-8" />;
  const max = Math.max(1, ...datos.map((a) => a.mensajes));
  return (
    <table className="w-full">
      <thead className="bg-ink-50/60">
        <tr><th className="th">Agente</th><th className="th w-[34%]">Mensajes enviados</th><th className="th text-right">Abiertas</th><th className="th text-right">Ganados</th></tr>
      </thead>
      <tbody className="divide-y divide-ink-100">
        {datos.map((a, i) => (
          <tr key={a.usuario_id} className="hover:bg-ink-50/50">
            <td className="td">
              <div className="flex items-center gap-2.5">
                <span className="w-4 text-center text-[11px] font-semibold tabular-nums text-ink-400">{i + 1}</span>
                <Avatar nombre={a.nombre} color={a.color} size={28} />
                <span className="text-[13px] font-medium text-ink-800">{a.nombre}</span>
              </div>
            </td>
            <td className="td">
              <div className="flex items-center gap-2.5">
                <div className="h-1.5 flex-1 rounded-full bg-ink-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(a.mensajes / max) * 100}%` }} /></div>
                <span className="w-8 text-right text-[13px] font-semibold tabular-nums text-ink-900">{numero(a.mensajes)}</span>
              </div>
            </td>
            <td className="td text-right text-[13px] tabular-nums text-ink-700">{numero(a.abiertas)}</td>
            <td className="td text-right">
              {a.ganados > 0 ? <span className="chip bg-emerald-50 text-emerald-700"><Trophy className="h-3 w-3" />{a.ganados}</span> : <span className="text-[13px] text-ink-400">0</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Orígenes ────────────────────────────────────────────────────────────────

function Origenes({ datos }: { datos: Resumen['origenes'] }) {
  const total = datos.reduce((s, x) => s + x.total, 0);
  if (!total) return <p className="mt-10 text-center text-[13px] text-ink-400">No hubo contactos nuevos</p>;
  const max = Math.max(...datos.map((x) => x.total));
  return (
    <ul className="mt-4 space-y-3">
      {datos.map((o) => {
        const canal = (['whatsapp', 'messenger', 'instagram', 'tiktok'] as Canal[]).includes(o.origen as Canal) ? (o.origen as Canal) : null;
        return (
          <li key={o.origen}>
            <div className="mb-1 flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-1.5 text-ink-700">
                {canal ? <IconoCanal canal={canal} size={13} className={CANAL_INFO[canal].texto} /> : <Sparkles className="h-3.5 w-3.5 text-ink-400" />}
                {ORIGEN[o.origen] ?? o.origen}
              </span>
              <span className="font-semibold tabular-nums text-ink-900">{numero(o.total)}<span className="ml-1.5 text-[11px] font-normal text-ink-400">{Math.round((o.total / total) * 100)}%</span></span>
            </div>
            <div className="h-1.5 rounded-full bg-ink-100"><div className="h-full rounded-full bg-sky-500" style={{ width: `${(o.total / max) * 100}%` }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

// ── Bienvenida ──────────────────────────────────────────────────────────────

function Bienvenida() {
  const router = useRouter();
  const { data: canales } = useCanales();
  const { data: equipo } = useMiembros();
  const { data: pipelines } = usePipelines();
  const { data: respuestas } = useRespuestas();
  const [oculta, setOculta] = useState(false);
  useEffect(() => { try { if (localStorage.getItem('crm-bienvenida-oculta') === '1') setOculta(true); } catch { /* sin storage */ } }, []);
  if (oculta) return null;

  const pasos = [
    { t: 'Conectar un canal', d: 'WhatsApp, Messenger o TikTok para recibir mensajes', href: '/config/canales', i: Plug, hecho: !!canales?.canales.some((c) => !c.sandbox && c.activo) },
    { t: 'Invitar al equipo', d: 'Suma agentes y supervisores a tu espacio', href: '/config/equipo', i: Users, hecho: (equipo?.miembros.length ?? 0) + (equipo?.invitaciones.length ?? 0) > 1 },
    { t: 'Personalizar pipeline', d: 'Ajusta las etapas a tu proceso de venta', href: '/config/pipelines', i: KanbanSquare, hecho: (pipelines?.length ?? 0) > 1 },
    { t: 'Crear respuestas rápidas', d: 'Responde en segundos con /atajos', href: '/config/respuestas', i: Zap, hecho: (respuestas?.length ?? 0) > 0 },
  ];
  const hechos = pasos.filter((p) => p.hecho).length;
  const cerrar = () => {
    setOculta(true);
    try { localStorage.setItem('crm-bienvenida-oculta', '1'); } catch { /* sin storage */ }
    router.replace('/inicio', { scroll: false });
  };

  return (
    <div className="card relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-sky-500 to-emerald-500" />
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-3 pt-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Rocket className="h-5 w-5" /></span>
          <div>
            <h3 className="text-[15px] font-semibold text-ink-900">¡Bienvenido a tu CRM! Configura lo esencial</h3>
            <p className="text-[13px] text-ink-500">{hechos} de {pasos.length} pasos completados</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-32 rounded-full bg-ink-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(hechos / pasos.length) * 100}%` }} /></div>
          <button onClick={cerrar} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Ocultar"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid gap-3 p-5 pt-2 sm:grid-cols-2 lg:grid-cols-4">
        {pasos.map((p) => (
          <Link key={p.href} href={p.href}
            className={cn('group flex items-start gap-3 rounded-xl border p-3.5 transition-all',
              p.hecho ? 'border-emerald-200 bg-emerald-50/50' : 'border-ink-200 hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-card')}>
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', p.hecho ? 'bg-emerald-500 text-white' : 'bg-ink-100 text-ink-600 group-hover:bg-brand-100 group-hover:text-brand-700')}>
              {p.hecho ? <Check className="h-4 w-4" /> : <p.i className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className={cn('block text-[13px] font-semibold', p.hecho ? 'text-emerald-800 line-through decoration-emerald-400' : 'text-ink-900')}>{p.t}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{p.d}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

