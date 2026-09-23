'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, CalendarClock, Check, Copy, CreditCard, ExternalLink, Eye, EyeOff, KeyRound, MessageSquare, MoreHorizontal, Plug,
  Search, ShieldCheck, Sparkles, Users, UserSquare2, Webhook,
} from 'lucide-react';
import { toast } from 'sonner';
import { addDays } from 'date-fns';
import { api, API_URL, qs } from '@/lib/api';
import { cn, fecha, numero } from '@/lib/utils';
import { useCanales, useMe } from '@/hooks/datos';
import { Avatar, Badge, Button, Input, Menu, PageHeader, Select, Skeleton, Stat, Switch, Tabs, Tooltip, Vacio, confirmar } from '@/components/ui';
import { IconoCanal } from '@/components/crm/canal';

type PlanCodigo = 'trial' | 'basico' | 'pro' | 'enterprise';
interface LimitesPlan { nombre: string; usuarios: number; contactos: number; canales: number; difusionesMes: number; precio: number }
interface ResumenAdmin { resumen: { empresas: number; empresas_activas: number; usuarios: number; contactos: number; canales: number; mensajes_30d: number }; planes: Record<PlanCodigo, LimitesPlan> }
interface EmpresaAdmin {
  empresa_id: string; nombre: string; slug: string; plan: PlanCodigo; activo: boolean; trial_hasta: string | null; creado_en: string;
  usuarios: number; contactos: number; canales: number; mensajes_30d: number; propietario: string | null;
}
interface ConfigItem { clave: string; etiqueta: string; secreto: boolean; origen: 'panel' | 'entorno' | 'defecto' | null; valor: string | null }

type Pestana = 'empresas' | 'planes' | 'plataforma';
const PLANES_ORDEN: PlanCodigo[] = ['trial', 'basico', 'pro', 'enterprise'];
const PLAN_COLOR: Record<PlanCodigo, string> = { trial: '#64748b', basico: '#0ea5e9', pro: '#6366f1', enterprise: '#a855f7' };

export default function AdminPage() {
  const { data: me, isLoading } = useMe();
  const [tab, setTab] = useState<Pestana>('empresas');
  const esSuper = !!me?.usuario.es_superadmin;
  const resumen = useQuery({ queryKey: ['admin', 'resumen'], queryFn: () => api.get<ResumenAdmin>('/admin/resumen'), enabled: esSuper });

  if (isLoading) return null;
  if (!esSuper) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader icono={<ShieldCheck className="h-5 w-5" />} titulo="Plataforma" />
        <div className="flex flex-1 items-center justify-center">
          <Vacio icono={<ShieldCheck className="h-5 w-5" />} titulo="Solo superadministrador" texto="Esta sección es para quienes administran la plataforma completa." />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader icono={<ShieldCheck className="h-5 w-5" />} titulo="Panel de plataforma"
        descripcion="Empresas, planes y credenciales compartidas por todos los clientes"
        acciones={<Tabs<Pestana> valor={tab} onChange={setTab} opciones={[
          { valor: 'empresas', label: 'Empresas' }, { valor: 'planes', label: 'Planes' }, { valor: 'plataforma', label: 'Plataforma' },
        ]} />} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          {tab === 'empresas' && <Empresas resumen={resumen.data} />}
          {tab === 'planes' && <Planes planes={resumen.data?.planes} />}
          {tab === 'plataforma' && <Plataforma />}
        </div>
      </div>
    </div>
  );
}

// ── Empresas ────────────────────────────────────────────────────────────────

function Empresas({ resumen }: { resumen?: ResumenAdmin }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  useEffect(() => { const t = setTimeout(() => setBusqueda(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const empresas = useQuery({
    queryKey: ['admin', 'empresas', busqueda],
    queryFn: () => api.get<{ empresas: EmpresaAdmin[] }>(`/admin/empresas${qs({ q: busqueda })}`),
    select: (d) => d.empresas, placeholderData: (prev) => prev,
  });
  const r = resumen?.resumen;
  const planes = resumen?.planes;

  async function actualizar(e: EmpresaAdmin, cambios: Partial<Pick<EmpresaAdmin, 'plan' | 'activo' | 'trial_hasta'>>, ok: string) {
    try {
      await api.patch(`/admin/empresas/${e.empresa_id}`, cambios);
      toast.success(ok);
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) { toast.error((err as Error).message); }
  }

  async function cambiarActivo(e: EmpresaAdmin, activo: boolean) {
    const ok = await confirmar(activo
      ? { titulo: `¿Reactivar ${e.nombre}?`, texto: 'Sus usuarios podrán volver a ingresar y los canales seguirán recibiendo mensajes.', confirmar: 'Reactivar' }
      : { titulo: `¿Suspender ${e.nombre}?`, texto: 'Sus usuarios no podrán ingresar al CRM hasta que la reactives. Los datos se conservan.', confirmar: 'Suspender', peligro: true });
    if (ok) await actualizar(e, { activo }, activo ? 'Empresa reactivada' : 'Empresa suspendida');
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {!r ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />) : <>
          <Stat label="Empresas" valor={numero(r.empresas)} detalle={`${numero(r.empresas_activas)} activas`} icono={<Building2 className="h-4 w-4" />} />
          <Stat label="Usuarios" valor={numero(r.usuarios)} icono={<Users className="h-4 w-4" />} tono="cielo" />
          <Stat label="Contactos" valor={numero(r.contactos)} icono={<UserSquare2 className="h-4 w-4" />} tono="verde" />
          <Stat label="Canales conectados" valor={numero(r.canales)} detalle="Sin contar pruebas" icono={<Plug className="h-4 w-4" />} tono="ambar" />
          <Stat label="Mensajes (30 d)" valor={numero(r.mensajes_30d)} icono={<MessageSquare className="h-4 w-4" />} />
        </>}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3">
          <div>
            <h3 className="text-[15px] font-semibold text-ink-900">Empresas</h3>
            <p className="text-[12.5px] text-ink-500">Uso actual frente a los límites de su plan</p>
          </div>
          <div className="w-72"><Input icono={<Search className="h-4 w-4" />} placeholder="Buscar por nombre o slug" value={q} onChange={(e) => setQ(e.target.value)} className="h-9" /></div>
        </div>
        {empresas.isLoading ? (
          <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !empresas.data?.length ? (
          <Vacio icono={<Building2 className="h-5 w-5" />} titulo={busqueda ? 'Sin resultados' : 'Aún no hay empresas'} texto={busqueda ? `Nada coincide con “${busqueda}”.` : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead className="bg-ink-50/60">
                <tr><th className="th">Empresa</th><th className="th w-[150px]">Plan</th><th className="th">Usuarios</th><th className="th">Contactos</th><th className="th">Canales</th><th className="th text-right">Msjs 30 d</th><th className="th text-center">Activa</th><th className="th w-10" /></tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {empresas.data.map((e) => {
                  const lim = planes?.[e.plan];
                  const trialVencido = e.plan === 'trial' && e.trial_hasta && new Date(e.trial_hasta) < new Date();
                  return (
                    <tr key={e.empresa_id} className={cn('transition-colors hover:bg-ink-50/50', !e.activo && 'bg-red-50/30')}>
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <Avatar nombre={e.nombre} size={34} className="rounded-lg" />
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate text-[13.5px] font-semibold text-ink-900">{e.nombre}
                              {!e.activo && <span className="chip bg-red-100 text-red-700">Suspendida</span>}</p>
                            <p className="truncate text-[12px] text-ink-500"><span className="font-mono">{e.slug}</span>{e.propietario && <> · {e.propietario}</>}</p>
                            <p className="text-[11px] text-ink-400">Alta {fecha(e.creado_en)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <Select value={e.plan} onChange={(ev) => actualizar(e, { plan: ev.target.value as PlanCodigo }, `Plan cambiado a ${planes?.[ev.target.value as PlanCodigo]?.nombre ?? ev.target.value}`)} className="h-8 py-1 text-[13px]">
                          {PLANES_ORDEN.map((p) => <option key={p} value={p}>{planes?.[p]?.nombre ?? p}</option>)}
                        </Select>
                        {e.plan === 'trial' && e.trial_hasta && (
                          <p className={cn('mt-1 flex items-center gap-1 text-[11px]', trialVencido ? 'text-red-600' : 'text-ink-500')}>
                            <CalendarClock className="h-3 w-3" />{trialVencido ? 'Venció' : 'Vence'} {fecha(e.trial_hasta)}
                          </p>
                        )}
                      </td>
                      <td className="td"><Uso v={e.usuarios} max={lim?.usuarios} /></td>
                      <td className="td"><Uso v={e.contactos} max={lim?.contactos} /></td>
                      <td className="td"><Uso v={e.canales} max={lim?.canales} /></td>
                      <td className="td text-right text-[13px] tabular-nums text-ink-700">{numero(e.mensajes_30d)}</td>
                      <td className="td text-center"><div className="inline-flex"><Switch checked={e.activo} onChange={(v) => cambiarActivo(e, v)} /></div></td>
                      <td className="td">
                        <Menu trigger={<button className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><MoreHorizontal className="h-4 w-4" /></button>}
                          items={[
                            { label: 'Extender prueba 14 días', icono: <CalendarClock className="h-3.5 w-3.5" />,
                              onClick: () => actualizar(e, { trial_hasta: addDays(e.trial_hasta && new Date(e.trial_hasta) > new Date() ? new Date(e.trial_hasta) : new Date(), 14).toISOString() }, 'Prueba extendida 14 días') },
                            { label: 'Quitar fecha de prueba', icono: <CalendarClock className="h-3.5 w-3.5" />, disabled: !e.trial_hasta, onClick: () => actualizar(e, { trial_hasta: null }, 'Fecha de prueba eliminada') },
                            { separador: true, label: '' },
                            { label: e.activo ? 'Suspender empresa' : 'Reactivar empresa', peligro: e.activo, onClick: () => cambiarActivo(e, !e.activo) },
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
    </>
  );
}

function Uso({ v, max }: { v: number; max?: number }) {
  const pct = max ? Math.min(v / max, 1) : 0;
  const tono = pct >= 1 ? 'bg-red-500' : pct >= 0.8 ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div className="w-[104px]">
      <p className="text-[13px] tabular-nums text-ink-800"><span className="font-semibold">{numero(v)}</span><span className="text-ink-400"> / {max !== undefined ? numero(max) : '—'}</span></p>
      <div className="mt-1 h-1 rounded-full bg-ink-100"><div className={cn('h-full rounded-full', tono)} style={{ width: `${Math.max(pct * 100, v ? 2 : 0)}%` }} /></div>
    </div>
  );
}

// ── Planes ──────────────────────────────────────────────────────────────────

function Planes({ planes }: { planes?: Record<PlanCodigo, LimitesPlan> }) {
  if (!planes) return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-80 rounded-xl" />)}</div>;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLANES_ORDEN.map((c) => {
          const p = planes[c];
          const destacado = c === 'pro';
          return (
            <div key={c} className={cn('card relative flex flex-col p-5', destacado && 'border-brand-300 ring-4 ring-brand-500/10')}>
              {destacado && <span className="absolute -top-2.5 left-5 chip bg-brand-600 text-white"><Sparkles className="h-3 w-3" />Más elegido</span>}
              <div className="flex items-center justify-between">
                <Badge color={PLAN_COLOR[c]}>{p.nombre}</Badge>
                <code className="font-mono text-[11px] text-ink-400">{c}</code>
              </div>
              <p className="mt-4 text-3xl font-semibold tracking-tight text-ink-900">
                {p.precio > 0 ? <>US$ {p.precio}<span className="text-sm font-medium text-ink-500"> /mes</span></> : c === 'trial' ? 'Gratis' : <span className="text-2xl">A medida</span>}
              </p>
              <p className="mt-1 text-[12.5px] text-ink-500">{c === 'trial' ? 'Periodo de prueba de 14 días' : c === 'enterprise' ? 'Precio negociado por contrato' : 'Facturación mensual'}</p>
              <ul className="mt-5 space-y-2.5 border-t border-ink-100 pt-4 text-[13px] text-ink-700">
                <Limite n={p.usuarios} t="usuarios" />
                <Limite n={p.contactos} t="contactos" />
                <Limite n={p.canales} t="canales conectados" />
                <Limite n={p.difusionesMes} t="difusiones al mes" />
              </ul>
            </div>
          );
        })}
      </div>
      <p className="flex items-center gap-2 text-[12.5px] text-ink-500"><CreditCard className="h-4 w-4 text-ink-400" />Los límites se definen en <code className="rounded bg-ink-100 px-1 font-mono text-[11.5px]">apps/api/src/lib/planes.ts</code>. Los canales de prueba no cuentan para el límite.</p>
    </>
  );
}

function Limite({ n, t }: { n: number; t: string }) {
  const v = n >= 1_000_000 ? `${numero(n / 1_000_000)} ${n === 1_000_000 ? 'millón' : 'millones'} de` : n >= 10_000 ? `${numero(n / 1000)} mil` : numero(n);
  return <li className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-500" /><span><b className="font-semibold tabular-nums text-ink-900">{v}</b> {t}</span></li>;
}

// ── Plataforma ──────────────────────────────────────────────────────────────

const GRUPOS: Array<{ id: string; titulo: string; canal: 'whatsapp' | 'tiktok'; desc: React.ReactNode; enlace: { href: string; label: string }; claves: string[] }> = [
  {
    id: 'meta', titulo: 'Meta · WhatsApp, Messenger e Instagram', canal: 'whatsapp',
    desc: 'Una sola App de Meta para todas las empresas. Los clientes conectan sus números y páginas con Embedded Signup.',
    enlace: { href: 'https://developers.facebook.com/apps', label: 'Meta for Developers' },
    claves: ['meta_app_id', 'meta_app_secret', 'meta_config_id', 'meta_verify_token', 'meta_api_version'],
  },
  {
    id: 'tiktok', titulo: 'TikTok · Mensajes directos', canal: 'tiktok',
    desc: 'App de TikTok for Business con permisos de mensajería para recibir y responder DMs.',
    enlace: { href: 'https://business-api.tiktok.com/portal/apps', label: 'TikTok for Business' },
    claves: ['tiktok_app_id', 'tiktok_app_secret', 'tiktok_api_version'],
  },
];

const AYUDA: Record<string, string> = {
  meta_app_id: 'Panel de la app → Configuración → Básica → Identificador de la app.',
  meta_app_secret: 'Configuración → Básica → Clave secreta de la app. Se guarda cifrada.',
  meta_config_id: 'Inicio de sesión con Facebook para empresas → Configuraciones → ID de la configuración de registro insertado.',
  meta_verify_token: 'Texto libre que debes pegar igual en Webhooks → Token de verificación.',
  meta_api_version: 'Versión de Graph API, por ejemplo v22.0.',
  tiktok_app_id: 'Portal de desarrolladores → My Apps → App ID.',
  tiktok_app_secret: 'My Apps → Secret. Se guarda cifrada.',
  tiktok_api_version: 'Versión de la Business API, por ejemplo v1.3.',
};

const ORIGEN: Record<NonNullable<ConfigItem['origen']>, { label: string; clase: string }> = {
  panel: { label: 'Panel', clase: 'bg-brand-50 text-brand-700' },
  entorno: { label: 'Variable de entorno', clase: 'bg-sky-50 text-sky-700' },
  defecto: { label: 'Por defecto', clase: 'bg-ink-100 text-ink-600' },
};

function Plataforma() {
  const cfg = useQuery({ queryKey: ['admin', 'config'], queryFn: () => api.get<{ config: ConfigItem[] }>('/admin/config'), select: (d) => d.config });
  const { data: me } = useMe();
  const canales = useCanales();
  const plataforma = me?.empresa ? canales.data?.plataforma : undefined;
  const webhookMeta = plataforma?.webhook_meta ?? `${API_URL}/webhooks/meta`;
  const webhookTiktok = plataforma?.webhook_tiktok ?? `${API_URL}/webhooks/tiktok`;

  if (cfg.isLoading) return <div className="space-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-72 rounded-xl" />)}</div>;
  const items = cfg.data ?? [];

  return (
    <div className="space-y-6">
      {GRUPOS.map((g) => {
        const claves = g.claves.map((k) => items.find((i) => i.clave === k)).filter(Boolean) as ConfigItem[];
        const faltan = claves.filter((c) => !c.valor && !c.clave.endsWith('_version') && c.clave !== 'meta_config_id').length;
        return (
          <section key={g.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', g.canal === 'whatsapp' ? 'bg-blue-50 text-[#0866FF]' : 'bg-ink-100 text-ink-900')}>
                  <IconoCanal canal={g.canal === 'whatsapp' ? 'messenger' : 'tiktok'} size={18} />
                </span>
                <div>
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">{g.titulo}
                    {faltan ? <span className="chip bg-amber-100 text-amber-700">Incompleta</span> : <span className="chip bg-emerald-100 text-emerald-700"><Check className="h-3 w-3" />Configurada</span>}
                  </h3>
                  <p className="mt-0.5 max-w-2xl text-[13px] text-ink-500">{g.desc}</p>
                </div>
              </div>
              <a href={g.enlace.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700">{g.enlace.label}<ExternalLink className="h-3.5 w-3.5" /></a>
            </div>
            <div className="divide-y divide-ink-100">
              {claves.map((c) => <FilaConfig key={c.clave} c={c} />)}
            </div>
            <div className="border-t border-ink-100 bg-ink-50/50 px-5 py-4">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500"><Webhook className="h-3.5 w-3.5" />URL del webhook</p>
              <Copiable valor={g.id === 'meta' ? webhookMeta : webhookTiktok} />
              <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
                {g.id === 'meta'
                  ? <>En tu app de Meta: <b className="font-medium text-ink-700">WhatsApp → Configuración</b> y <b className="font-medium text-ink-700">Webhooks</b> (Page / Instagram). Usa el verify token de arriba y suscríbete a <code className="font-mono">messages</code>, <code className="font-mono">message_template_status_update</code> y <code className="font-mono">messaging_postbacks</code>.</>
                  : <>En TikTok for Business: <b className="font-medium text-ink-700">My Apps → Webhooks</b>. Suscríbete a los eventos de mensajes directos.</>}
                {API_URL.includes('localhost') && <span className="mt-1 block text-amber-700">El API corre en localhost: expón una URL pública (por ejemplo con un túnel) para que Meta o TikTok puedan llamarla.</span>}
              </p>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FilaConfig({ c }: { c: ConfigItem }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [ver, setVer] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const etiqueta = c.etiqueta.replace(/^(Meta|TikTok) · /, '');

  function empezar() { setValor(c.secreto ? '' : c.valor ?? ''); setEditando(true); setVer(false); }

  async function guardar(v: string | null) {
    setGuardando(true);
    try {
      const r = await api.put<{ config: ConfigItem[] }>('/admin/config', { clave: c.clave, valor: v });
      qc.setQueryData(['admin', 'config'], { ok: true, config: r.config });
      qc.invalidateQueries({ queryKey: ['canales'] });
      toast.success(v ? `${etiqueta} guardado` : `${etiqueta} restablecido`);
      setEditando(false);
    } catch (e) { toast.error((e as Error).message); } finally { setGuardando(false); }
  }

  async function restablecer() {
    const ok = await confirmar({ titulo: `¿Restablecer ${etiqueta}?`, texto: 'Se borrará el valor del panel y se usará la variable de entorno o el valor por defecto, si existen.', confirmar: 'Restablecer', peligro: true });
    if (ok) guardar(null);
  }

  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[260px_1fr]">
      <div>
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-800">{c.secreto && <KeyRound className="h-3.5 w-3.5 text-ink-400" />}{etiqueta}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">{AYUDA[c.clave]}</p>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {editando ? (
          <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (valor.trim()) guardar(valor.trim()); }}>
            <div className="relative flex-1">
              <Input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} maxLength={500} type={c.secreto && !ver ? 'password' : 'text'}
                placeholder={c.secreto ? 'Pega el nuevo valor' : 'Valor'} className="h-9 pr-9 font-mono text-[13px]" />
              {c.secreto && (
                <button type="button" onClick={() => setVer(!ver)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700" aria-label={ver ? 'Ocultar' : 'Mostrar'}>
                  {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              )}
            </div>
            <Button tamano="sm" type="submit" cargando={guardando} disabled={!valor.trim()}>Guardar</Button>
            <Button tamano="sm" variante="fantasma" onClick={() => setEditando(false)}>Cancelar</Button>
          </form>
        ) : (<>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {c.valor ? <code className="truncate rounded-md bg-ink-50 px-2 py-1 font-mono text-[12.5px] text-ink-800 ring-1 ring-ink-200/70">{c.valor}</code>
              : <span className="text-[13px] italic text-ink-400">Sin configurar</span>}
            {c.origen && <Tooltip texto={c.origen === 'panel' ? 'Guardado desde este panel (tiene prioridad)' : c.origen === 'entorno' ? 'Leído de la variable de entorno del API' : 'Valor por defecto del sistema'}>
              <span className={cn('chip shrink-0 cursor-help', ORIGEN[c.origen].clase)}>{ORIGEN[c.origen].label}</span>
            </Tooltip>}
          </div>
          {c.origen === 'panel' && <Button tamano="sm" variante="fantasma" onClick={restablecer}>Restablecer</Button>}
          <Button tamano="sm" variante="secundario" onClick={empezar}>{c.valor ? 'Cambiar' : 'Configurar'}</Button>
        </>)}
      </div>
    </div>
  );
}

function Copiable({ valor }: { valor: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-[12.5px] text-ink-800 ring-1 ring-ink-200">{valor}</code>
      <Button tamano="sm" variante="secundario" icono={ok ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        onClick={() => { navigator.clipboard?.writeText(valor).then(() => { setOk(true); toast.success('Copiado'); setTimeout(() => setOk(false), 1500); }).catch(() => toast.error('No se pudo copiar')); }}>
        {ok ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  );
}

