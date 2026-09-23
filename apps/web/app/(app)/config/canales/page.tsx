'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowRight, Beaker, Check, CheckCircle2, Copy, FlaskConical, Globe, Image as ImageIcon, Inbox, KeyRound, Lock,
  MapPin, MessageSquareText, MoreHorizontal, Pencil, Plug, Radio, Send, Shuffle, Sparkles, Trash2, TriangleAlert, Wifi, WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { cn, fecha, numero } from '@/lib/utils';
import type { Canal, CanalCuenta } from '@/lib/types';
import { useCanales, useMe, usePuede } from '@/hooks/datos';
import { Button, Field, Input, Menu, Modal, PageHeader, Skeleton, Switch, Tabs, Textarea, Tooltip, Vacio, confirmar } from '@/components/ui';
import { CANAL_INFO, IconoCanal } from '@/components/crm/canal';

type Plataforma = NonNullable<ReturnType<typeof useCanales>['data']>['plataforma'];
type TipoConectable = 'whatsapp' | 'messenger' | 'tiktok';

// ── SDK de Facebook (Embedded Signup) ─────────────────────────────────────────

interface FBLoginResp { authResponse?: { code?: string } | null; status?: string }
interface FBSdk { init: (o: Record<string, unknown>) => void; login: (cb: (r: FBLoginResp) => void, o: Record<string, unknown>) => void }
declare global { interface Window { FB?: FBSdk; fbAsyncInit?: () => void } }

let sdkPromesa: Promise<FBSdk> | null = null;
function cargarSdkFacebook(appId: string, version: string): Promise<FBSdk> {
  if (sdkPromesa) return sdkPromesa;
  sdkPromesa = new Promise<FBSdk>((resolve, reject) => {
    const listo = () => { window.FB!.init({ appId, version, xfbml: false, cookie: true }); resolve(window.FB!); };
    if (window.FB) { listo(); return; }
    window.fbAsyncInit = listo;
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/es_LA/sdk.js';
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.onerror = () => { sdkPromesa = null; reject(new Error('No se pudo cargar el SDK de Facebook. Revisa tu conexión o bloqueadores de anuncios.')); };
    document.body.appendChild(s);
  });
  return sdkPromesa;
}

// ── Datos de ejemplo para el simulador ────────────────────────────────────────

const NOMBRES = ['María Fernández', 'José Quispe', 'Lucía Ramos', 'Carlos Huamán', 'Rosa Mendoza', 'Diego Salazar', 'Valeria Chávez', 'Jorge Paredes', 'Camila Rojas', 'Luis Vargas', 'Andrea Flores', 'Miguel Torres'];
const TEXTOS = ['Hola, ¿tienen stock disponible?', 'Buenas tardes, quisiera una cotización 🙏', '¿Hacen envíos a provincia?', '¿Cuál es el precio con delivery?', 'Quiero agendar una visita para mañana', '¿Aceptan Yape o Plin?'];
const azar = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const digitos = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
function identidadAleatoria(tipo: Canal): string {
  if (tipo === 'whatsapp') return `519${digitos(8)}`;
  if (tipo === 'messenger') return `2${digitos(15)}`;
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return `_000${Array.from({ length: 28 }, () => abc[Math.floor(Math.random() * abc.length)]).join('')}`;
}
const IDENTIDAD_INFO: Record<Canal, { label: string; hint: string }> = {
  whatsapp: { label: 'Teléfono (wa_id)', hint: 'Código de país + número, sin +. Ej. 51987654321' },
  messenger: { label: 'PSID del usuario', hint: 'ID que Messenger asigna a la persona para tu Página' },
  tiktok: { label: 'open_id del usuario', hint: 'Identificador de TikTok de la persona' },
  instagram: { label: 'IGSID', hint: '' },
};

function useRefrescar() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ['canales'] }); qc.invalidateQueries({ queryKey: ['me'] }); };
}

export default function CanalesPage() {
  const { data, isLoading } = useCanales();
  const { data: me } = useMe();
  const esAdmin = usePuede('admin');
  const [conectar, setConectar] = useState<TipoConectable | 'sandbox' | null>(null);
  const canales = data?.canales ?? [];
  const plataforma = data?.plataforma;
  const sandboxes = canales.filter((c) => c.sandbox);

  return (
    <div>
      <PageHeader icono={<Radio className="h-5 w-5" />} titulo="Canales"
        descripcion={me?.plan ? `Conecta WhatsApp, Messenger y TikTok · ${me.plan.uso.canales} de ${me.plan.canales} canales reales del plan en uso` : 'Conecta WhatsApp, Messenger y TikTok a tu bandeja'}
        acciones={esAdmin && <Button icono={<Plug className="h-4 w-4" />} onClick={() => document.getElementById('conectar')?.scrollIntoView({ behavior: 'smooth' })}>Conectar canal</Button>} />
      <div className="mx-auto max-w-5xl space-y-8 p-6">
        {!esAdmin && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-2.5 text-[13px] text-amber-800">
            <Lock className="h-4 w-4 shrink-0 text-amber-500" />Solo los administradores pueden conectar, editar o eliminar canales.
          </div>
        )}

        {/* Cuentas conectadas */}
        <section>
          <TituloSeccion titulo="Cuentas conectadas" texto={`${canales.length} canal${canales.length !== 1 ? 'es' : ''} · ${canales.filter((c) => c.activo).length} activo${canales.filter((c) => c.activo).length !== 1 ? 's' : ''}`} />
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>
          ) : !canales.length ? (
            <div className="card"><Vacio icono={<Radio className="h-5 w-5" />} titulo="Aún no hay canales conectados"
              texto="Conecta tu WhatsApp Business, tu Página de Facebook o tu cuenta de TikTok. ¿Solo quieres probar? Crea un canal de prueba."
              accion={esAdmin && <Button variante="suave" icono={<FlaskConical className="h-4 w-4" />} onClick={() => setConectar('sandbox')}>Crear canal de prueba</Button>} /></div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {canales.map((c) => <TarjetaCanal key={c.canal_id} c={c} esAdmin={esAdmin} />)}
            </div>
          )}
        </section>

        {/* Simulador */}
        <Simulador sandboxes={sandboxes} esAdmin={esAdmin} onCrearSandbox={() => setConectar('sandbox')} />

        {/* Conectar */}
        {esAdmin && (
          <section id="conectar" className="scroll-mt-6">
            <TituloSeccion titulo="Conectar un canal" texto="Elige cómo quieres recibir mensajes en tu bandeja" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OpcionConectar canal="whatsapp" titulo="WhatsApp Business" texto="API oficial de Meta (Cloud API). Registro integrado o manual."
                estado={plataforma?.meta_configurada ? 'Listo' : 'Solo manual'} onClick={() => setConectar('whatsapp')} />
              <OpcionConectar canal="messenger" titulo="Messenger" texto="Recibe los mensajes de tu Página de Facebook."
                estado={plataforma?.meta_configurada ? 'Listo' : 'Requiere App de Meta'} onClick={() => setConectar('messenger')} />
              <OpcionConectar canal="tiktok" titulo="TikTok" texto="Mensajes directos de tu cuenta de TikTok Business."
                estado={plataforma?.tiktok_configurada ? 'Listo' : 'No configurado'} onClick={() => setConectar('tiktok')} />
              <button onClick={() => setConectar('sandbox')}
                className="group flex flex-col rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-lift">
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-xs"><FlaskConical className="h-5 w-5" /></span>
                  <span className="chip bg-violet-100 text-violet-700">100% local</span>
                </div>
                <p className="mt-3 text-[14px] font-semibold text-ink-900">Canal de prueba</p>
                <p className="mt-0.5 flex-1 text-xs leading-relaxed text-ink-500">Simula WhatsApp, Messenger o TikTok sin Meta ni internet.</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-violet-700">Crear<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </button>
            </div>
          </section>
        )}

        {plataforma && <Webhooks p={plataforma} />}
      </div>

      {conectar === 'whatsapp' && plataforma && <ModalWhatsapp p={plataforma} onClose={() => setConectar(null)} />}
      {conectar === 'messenger' && <ModalMessenger onClose={() => setConectar(null)} />}
      {conectar === 'tiktok' && plataforma && <ModalTiktok p={plataforma} onClose={() => setConectar(null)} />}
      {conectar === 'sandbox' && <ModalSandbox onClose={() => setConectar(null)} />}
    </div>
  );
}

function TituloSeccion({ titulo, texto, icono }: { titulo: string; texto?: string; icono?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">{icono}{titulo}</h2>
      {texto && <p className="text-[13px] text-ink-500">{texto}</p>}
    </div>
  );
}

function LogoCanal({ canal, size = 40 }: { canal: Canal; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-xl text-white shadow-xs" style={{ width: size, height: size, backgroundColor: CANAL_INFO[canal].color }}>
      <IconoCanal canal={canal} size={size * 0.52} />
    </span>
  );
}

function EstadoBadge({ estado, activo }: { estado: string; activo: boolean }) {
  if (!activo) return <span className="chip bg-ink-100 text-ink-500"><WifiOff className="h-3 w-3" />Inactivo</span>;
  if (estado === 'conectado') return <span className="chip bg-emerald-50 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Conectado</span>;
  if (estado === 'error') return <span className="chip bg-red-50 text-red-600"><TriangleAlert className="h-3 w-3" />Error</span>;
  return <span className="chip bg-amber-50 text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{estado.charAt(0).toUpperCase() + estado.slice(1).replace(/_/g, ' ')}</span>;
}

// ── Tarjeta de una cuenta ─────────────────────────────────────────────────────

function TarjetaCanal({ c, esAdmin }: { c: CanalCuenta; esAdmin: boolean }) {
  const refrescar = useRefrescar();
  const [probando, setProbando] = useState(false);
  const [renombrar, setRenombrar] = useState(false);
  const [conflicto, setConflicto] = useState<string | null>(null);
  const sub = c.datos.numero_display ?? (c.datos.username ? `@${c.datos.username}` : c.datos.pagina ?? c.externo_id);

  async function patch(d: { activo?: boolean; nombre?: string }, msg: string) {
    try { await api.patch(`/canales/${c.canal_id}`, d); toast.success(msg); refrescar(); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
  }

  async function probar() {
    setProbando(true);
    try { const r = await api.post<{ mensaje: string }>(`/canales/${c.canal_id}/probar`); toast.success(r.mensaje); }
    catch (e) { toast.error((e as Error).message); } finally { setProbando(false); refrescar(); }
  }

  async function eliminar() {
    const ok = await confirmar({ titulo: `¿Eliminar "${c.nombre}"?`, texto: 'El canal dejará de recibir y enviar mensajes.', confirmar: 'Eliminar canal', peligro: true });
    if (!ok) return;
    try { await api.del(`/canales/${c.canal_id}`); toast.success('Canal eliminado'); refrescar(); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'tiene_conversaciones') setConflicto(e.message);
      else toast.error((e as Error).message);
    }
  }

  async function forzar() {
    const ok = await confirmar({
      titulo: 'Eliminar canal y conversaciones',
      texto: <>Se borrarán <b>{c.conversaciones} conversación(es)</b> y todos sus mensajes. Los contactos se conservan. <span className="font-semibold text-red-600">No se puede deshacer.</span></>,
      confirmar: 'Sí, eliminar todo', peligro: true,
    });
    if (!ok) return;
    try { await api.del(`/canales/${c.canal_id}?forzar=1`); toast.success('Canal y conversaciones eliminados'); setConflicto(null); refrescar(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className={cn('card flex flex-col transition-shadow hover:shadow-lift', !c.activo && 'bg-ink-50/40')}>
      <div className="flex items-start gap-3 p-4">
        <div className={cn(!c.activo && 'opacity-50 grayscale')}><LogoCanal canal={c.tipo} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[14px] font-semibold text-ink-900">{c.nombre}</p>
          </div>
          <p className="truncate font-mono text-xs text-ink-500">{sub}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <EstadoBadge estado={c.estado_conexion} activo={c.activo} />
            <span className={cn('chip', CANAL_INFO[c.tipo].bg, CANAL_INFO[c.tipo].texto)}>{CANAL_INFO[c.tipo].label}</span>
            {c.sandbox && <span className="chip bg-violet-100 text-violet-700"><FlaskConical className="h-3 w-3" />Canal de prueba</span>}
          </div>
        </div>
        {esAdmin && (
          <Menu trigger={<button className="-mr-1 rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><MoreHorizontal className="h-4 w-4" /></button>}
            items={[
              { label: 'Renombrar', icono: <Pencil className="h-3.5 w-3.5" />, onClick: () => setRenombrar(true) },
              { label: 'Probar conexión', icono: <Activity className="h-3.5 w-3.5" />, onClick: probar },
              { separador: true, label: '' },
              { label: 'Eliminar canal', icono: <Trash2 className="h-3.5 w-3.5" />, peligro: true, onClick: eliminar },
            ]} />
        )}
      </div>
      <div className="grid grid-cols-3 divide-x divide-ink-100 border-y border-ink-100 bg-ink-50/40 text-center">
        <Dato label="Conversaciones" valor={numero(c.conversaciones)} />
        <Dato label="Conectado" valor={fecha(c.creado_en)} />
        <Dato label={c.token_expira_en ? 'Token vence' : 'ID externo'} valor={c.token_expira_en ? fecha(c.token_expira_en) : <span className="font-mono text-[11px]">{c.externo_id.length > 14 ? `…${c.externo_id.slice(-10)}` : c.externo_id}</span>} />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <label className="flex items-center gap-2.5 text-[13px] text-ink-700">
          <Switch size="sm" checked={c.activo} disabled={!esAdmin} onChange={(v) => patch({ activo: v }, v ? 'Canal activado' : 'Canal desactivado')} />
          {c.activo ? 'Recibiendo mensajes' : 'Pausado'}
        </label>
        {esAdmin && <Button tamano="xs" variante="secundario" cargando={probando} icono={<Activity className="h-3.5 w-3.5" />} onClick={probar}>Probar conexión</Button>}
      </div>

      {renombrar && <ModalRenombrar c={c} onClose={() => setRenombrar(false)} onGuardar={async (n) => { if (await patch({ nombre: n }, 'Canal renombrado')) setRenombrar(false); }} />}
      <Modal abierto={!!conflicto} onClose={() => setConflicto(null)} titulo="Este canal tiene conversaciones" ancho="sm"
        pie={<>
          <Button variante="fantasma" className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700" onClick={forzar}>Eliminar todo</Button>
          <Button variante="secundario" onClick={() => setConflicto(null)}>Cancelar</Button>
          {c.activo && <Button onClick={async () => { if (await patch({ activo: false }, 'Canal desactivado. El historial se conserva.')) setConflicto(null); }}>Desactivar</Button>}
        </>}>
        <div className="space-y-3 text-sm text-ink-600">
          <p>{conflicto}</p>
          <div className="rounded-lg bg-ink-50 p-3 text-[13px]">
            <p className="font-medium text-ink-800">Recomendado: desactivar</p>
            <p className="text-ink-500">Deja de recibir mensajes, pero conservas el historial para consultarlo después.</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: React.ReactNode }) {
  return <div className="px-3 py-2.5"><p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-400">{label}</p><p className="mt-0.5 truncate text-[13px] font-semibold text-ink-800">{valor}</p></div>;
}

function ModalRenombrar({ c, onClose, onGuardar }: { c: CanalCuenta; onClose: () => void; onGuardar: (n: string) => Promise<void> }) {
  const [n, setN] = useState(c.nombre);
  const [g, setG] = useState(false);
  const enviar = async () => { if (!n.trim()) return; setG(true); await onGuardar(n.trim()); setG(false); };
  return (
    <Modal abierto onClose={onClose} titulo="Renombrar canal" ancho="sm"
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button cargando={g} disabled={!n.trim()} onClick={enviar}>Guardar</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <Field label="Nombre visible para el equipo"><Input autoFocus value={n} maxLength={60} onChange={(e) => setN(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

// ── Opción para conectar ──────────────────────────────────────────────────────

function OpcionConectar({ canal, titulo, texto, estado, onClick }: { canal: Canal; titulo: string; texto: string; estado: string; onClick: () => void }) {
  const listo = estado === 'Listo';
  return (
    <button onClick={onClick} className="group card flex flex-col p-4 text-left transition-all hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-lift">
      <div className="flex items-center justify-between">
        <LogoCanal canal={canal} />
        <span className={cn('chip', listo ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500')}>{listo && <Check className="h-3 w-3" />}{estado}</span>
      </div>
      <p className="mt-3 text-[14px] font-semibold text-ink-900">{titulo}</p>
      <p className="mt-0.5 flex-1 text-xs leading-relaxed text-ink-500">{texto}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600">Conectar<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
    </button>
  );
}

// ── Simulador de mensajes entrantes ───────────────────────────────────────────

interface Enviado { id: number; canal: CanalCuenta; nombre: string; tipo: string; texto: string; hora: Date }

function Simulador({ sandboxes, esAdmin, onCrearSandbox }: { sandboxes: CanalCuenta[]; esAdmin: boolean; onCrearSandbox: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const activos = sandboxes.filter((c) => c.activo);
  const [canalId, setCanalId] = useState<number | null>(null);
  const canal = activos.find((c) => c.canal_id === canalId) ?? activos[0] ?? null;
  const [nombre, setNombre] = useState('');
  const [identidad, setIdentidad] = useState('');
  const [tipo, setTipo] = useState<'texto' | 'imagen' | 'ubicacion'>('texto');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [historial, setHistorial] = useState<Enviado[]>([]);
  const tipoCanal = canal?.tipo;

  function nuevoContacto(t: Canal | undefined = tipoCanal) {
    if (!t) return;
    setNombre(azar(NOMBRES));
    setIdentidad(identidadAleatoria(t));
  }
  // Datos de ejemplo al elegir canal (la identidad depende de la plataforma)
  useEffect(() => { nuevoContacto(tipoCanal); if (!texto) setTexto(azar(TEXTOS)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tipoCanal]);
  useEffect(() => { if (tipoCanal === 'tiktok' && tipo === 'ubicacion') setTipo('texto'); }, [tipoCanal, tipo]);

  const valido = !!canal && nombre.trim() && identidad.trim().length >= 3 && (tipo !== 'texto' || texto.trim());

  async function enviar(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canal || !valido) return;
    setEnviando(true);
    try {
      await api.post(`/canales/${canal.canal_id}/simular`, { nombre: nombre.trim(), identidad: identidad.trim(), tipo, texto: texto.trim() || undefined });
      toast.success('Mensaje recibido — revisa la Bandeja', {
        description: `${nombre} escribió por ${canal.nombre}`,
        action: { label: 'Abrir Bandeja', onClick: () => router.push('/inbox') },
      });
      setHistorial((h) => [{ id: Date.now(), canal, nombre, tipo, texto: tipo === 'ubicacion' ? 'Ubicación: Plaza Norte' : tipo === 'imagen' ? `📷 ${texto || 'Imagen'}` : texto, hora: new Date() }, ...h].slice(0, 5));
      setTexto('');
      qc.invalidateQueries({ queryKey: ['canales'] });
      qc.invalidateQueries({ queryKey: ['conversaciones'] });
      qc.invalidateQueries({ queryKey: ['contadores'] });
    } catch (err) { toast.error((err as Error).message); } finally { setEnviando(false); }
  }

  const tiposPermitidos = tipoCanal === 'tiktok'
    ? [{ valor: 'texto' as const, label: <><MessageSquareText className="h-3.5 w-3.5" />Texto</> }, { valor: 'imagen' as const, label: <><ImageIcon className="h-3.5 w-3.5" />Imagen</> }]
    : [{ valor: 'texto' as const, label: <><MessageSquareText className="h-3.5 w-3.5" />Texto</> }, { valor: 'imagen' as const, label: <><ImageIcon className="h-3.5 w-3.5" />Imagen</> }, { valor: 'ubicacion' as const, label: <><MapPin className="h-3.5 w-3.5" />Ubicación</> }];

  return (
    <section>
      <div className="overflow-hidden rounded-2xl border border-violet-200/80 bg-white shadow-card">
        <div className="relative overflow-hidden bg-gradient-to-r from-violet-600 via-indigo-600 to-brand-600 px-5 py-4 text-white">
          <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute right-24 top-8 h-20 w-20 rounded-full bg-white/5" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25"><Beaker className="h-5 w-5" /></span>
              <div>
                <h2 className="text-[15px] font-semibold">Simulador de mensajes entrantes</h2>
                <p className="text-[13px] text-white/75">Envía mensajes como si fueras un cliente. Pasan por el mismo flujo que un webhook real.</p>
              </div>
            </div>
            <Link href="/inbox" className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-[13px] font-medium ring-1 ring-white/25 transition-colors hover:bg-white/25">
              <Inbox className="h-4 w-4" />Ir a la Bandeja
            </Link>
          </div>
        </div>

        {!activos.length ? (
          <Vacio icono={<FlaskConical className="h-5 w-5" />} titulo={sandboxes.length ? 'Tus canales de prueba están desactivados' : 'Necesitas un canal de prueba'}
            texto={sandboxes.length ? 'Activa un canal de prueba para simular mensajes.' : 'Crea un canal de prueba de WhatsApp, Messenger o TikTok para simular conversaciones sin conectar Meta.'}
            accion={esAdmin && !sandboxes.length && <Button variante="suave" icono={<FlaskConical className="h-4 w-4" />} onClick={onCrearSandbox}>Crear canal de prueba</Button>} />
        ) : (
          <div className="grid md:grid-cols-[1fr_300px]">
            <form onSubmit={enviar} className="space-y-4 p-5">
              <Field label="Canal de prueba">
                <div className="flex flex-wrap gap-2">
                  {activos.map((c) => (
                    <button key={c.canal_id} type="button" onClick={() => setCanalId(c.canal_id)}
                      className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-all',
                        canal?.canal_id === c.canal_id ? 'border-violet-400 bg-violet-50 text-violet-800 ring-4 ring-violet-500/10' : 'border-ink-200 text-ink-600 hover:bg-ink-50')}>
                      <span className="flex h-5 w-5 items-center justify-center rounded-md text-white" style={{ backgroundColor: CANAL_INFO[c.tipo].color }}><IconoCanal canal={c.tipo} size={12} /></span>
                      {c.nombre}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre del contacto"><Input value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} /></Field>
                <Field label={IDENTIDAD_INFO[canal!.tipo].label} hint={IDENTIDAD_INFO[canal!.tipo].hint}>
                  <div className="flex gap-1.5">
                    <Input value={identidad} maxLength={60} onChange={(e) => setIdentidad(e.target.value)} className="font-mono text-[13px]" />
                    <Tooltip texto="Generar otro contacto"><Button variante="secundario" tamano="icono" onClick={() => nuevoContacto()}><Shuffle className="h-4 w-4" /></Button></Tooltip>
                  </div>
                </Field>
              </div>
              <p className="-mt-2 text-xs text-ink-500">Usa la misma identidad para continuar una conversación, o una nueva para crear otro contacto.</p>
              <Field label="Tipo de mensaje"><Tabs valor={tipo} onChange={setTipo} opciones={tiposPermitidos} /></Field>
              {tipo === 'ubicacion' ? (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-ink-200 bg-ink-50/60 px-3.5 py-3 text-[13px] text-ink-600">
                  <MapPin className="h-4 w-4 text-red-500" />Se enviará la ubicación de ejemplo <b className="font-medium text-ink-800">Plaza Norte, Independencia, Lima</b>.
                </div>
              ) : (
                <Field label={tipo === 'imagen' ? 'Pie de foto (opcional)' : 'Mensaje'}>
                  <Textarea value={texto} rows={3} maxLength={4000} onChange={(e) => setTexto(e.target.value)} placeholder={tipo === 'imagen' ? 'Así quedó el producto…' : 'Escribe lo que diría el cliente'}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) enviar(); }} />
                  {tipo === 'texto' && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {TEXTOS.slice(0, 4).map((t) => (
                        <button key={t} type="button" onClick={() => setTexto(t)} className="rounded-full border border-ink-200 bg-white px-2.5 py-0.5 text-[11px] text-ink-600 transition-colors hover:border-violet-300 hover:text-violet-700">{t}</button>
                      ))}
                    </div>
                  )}
                </Field>
              )}
              <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
                <span className="text-xs text-ink-400"><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> para enviar</span>
                <Button type="submit" cargando={enviando} disabled={!valido} icono={<Send className="h-4 w-4" />} className="bg-violet-600 hover:bg-violet-700 active:bg-violet-800 focus-visible:ring-violet-500/30">Simular mensaje entrante</Button>
              </div>
            </form>

            {/* Vista del cliente + historial */}
            <div className="border-t border-ink-100 bg-ink-50/50 p-5 md:border-l md:border-t-0">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-400">Lo que verá tu bandeja</p>
              <div className="rounded-xl border border-ink-200 bg-white p-3 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-200 text-xs font-semibold text-ink-600">{nombre.split(' ').map((x) => x[0]).slice(0, 2).join('') || '?'}</span>
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white" style={{ backgroundColor: CANAL_INFO[canal!.tipo].color }}>
                      <IconoCanal canal={canal!.tipo} size={10} className="text-white" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2"><p className="truncate text-[13px] font-semibold text-ink-900">{nombre || 'Contacto'}</p><span className="text-[11px] text-brand-600">ahora</span></div>
                    <p className="truncate text-xs text-ink-500">{tipo === 'ubicacion' ? '📍 Ubicación' : tipo === 'imagen' ? `📷 ${texto || 'Foto'}` : texto || '…'}</p>
                  </div>
                </div>
              </div>
              <p className="mb-2 mt-5 text-2xs font-semibold uppercase tracking-wider text-ink-400">Enviados en esta sesión</p>
              {historial.length ? (
                <ul className="space-y-1.5">
                  {historial.map((h) => (
                    <li key={h.id} className="flex animate-pop-in items-start gap-2 rounded-lg bg-white px-2.5 py-2 text-xs shadow-xs ring-1 ring-ink-200/70">
                      <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink-800">{h.nombre}</p><p className="truncate text-ink-500">{h.texto}</p></div>
                      <span className="shrink-0 text-[10px] text-ink-400">{h.hora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
                  <li><Link href="/inbox" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">Ver en la Bandeja<ArrowRight className="h-3 w-3" /></Link></li>
                </ul>
              ) : <p className="rounded-lg border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400">Aún no enviaste mensajes</p>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

function Copiable({ label, valor }: { label: string; valor: string }) {
  const [ok, setOk] = useState(false);
  async function copiar() {
    try { await navigator.clipboard.writeText(valor); setOk(true); toast.success('Copiado al portapapeles'); setTimeout(() => setOk(false), 1500); }
    catch { toast.error('No se pudo copiar'); }
  }
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex items-center gap-1.5">
        <code className="flex h-9 min-w-0 flex-1 items-center truncate rounded-lg border border-ink-200 bg-ink-50 px-3 font-mono text-[12.5px] text-ink-700">{valor}</code>
        <Button variante="secundario" tamano="icono" onClick={copiar} title="Copiar">{ok ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}</Button>
      </div>
    </div>
  );
}

function Webhooks({ p }: { p: Plataforma }) {
  const local = /localhost|127\.0\.0\.1/.test(p.webhook_meta);
  return (
    <section>
      <TituloSeccion titulo="Webhooks" texto="Para canales reales de Meta y TikTok" />
      <div className="card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Copiable label="URL de webhook de Meta (WhatsApp y Messenger)" valor={p.webhook_meta} />
          <Copiable label="Token de verificación (Verify token)" valor={p.verify_token} />
          <Copiable label="URL de webhook de TikTok" valor={p.webhook_tiktok} />
        </div>
        <div className={cn('mt-5 flex gap-3 rounded-xl px-4 py-3 text-[13px]', local ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800')}>
          <Globe className={cn('mt-0.5 h-4 w-4 shrink-0', local ? 'text-amber-500' : 'text-sky-500')} />
          <div className="space-y-1">
            <p className="font-medium">{local ? 'Tu API está en localhost: Meta y TikTok no pueden alcanzarla.' : 'Registra estas URLs en la configuración de tu App.'}</p>
            <p className={local ? 'text-amber-700' : 'text-sky-700'}>
              Para recibir mensajes reales necesitas una URL pública HTTPS. Abre un túnel con <code className="whitespace-nowrap rounded bg-white/70 px-1 font-mono text-xs">ngrok http 4000</code> o <code className="whitespace-nowrap rounded bg-white/70 px-1 font-mono text-xs">cloudflared tunnel --url http://localhost:4000</code>, define <code className="whitespace-nowrap rounded bg-white/70 px-1 font-mono text-xs">PUBLIC_API_URL</code> con esa URL y reinicia el API. Los canales de prueba no lo necesitan.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Modales de conexión ──────────────────────────────────────────────────────

function CabeceraModal({ canal, titulo }: { canal: Canal; titulo: string }) {
  return <span className="flex items-center gap-2.5"><LogoCanal canal={canal} size={28} />{titulo}</span>;
}

function ModalWhatsapp({ p, onClose }: { p: Plataforma; onClose: () => void }) {
  const refrescar = useRefrescar();
  const embeddedDisponible = p.meta_configurada && !!p.meta_config_id;
  const [modo, setModo] = useState<'embedded' | 'manual'>(embeddedDisponible ? 'embedded' : 'manual');
  const [conectando, setConectando] = useState(false);
  const [opciones, setOpciones] = useState<{ seleccion: string; numeros: Array<{ waba_id: string; id: string; display_phone_number: string; verified_name: string }> } | null>(null);
  const [elegido, setElegido] = useState('');
  const [f, setF] = useState({ nombre: '', phone_number_id: '', waba_id: '', access_token: '' });
  const [guardando, setGuardando] = useState(false);

  function listo() { toast.success('WhatsApp conectado'); refrescar(); onClose(); }

  async function embedded() {
    if (!p.meta_app_id || !p.meta_config_id) return;
    setConectando(true);
    try {
      const FB = await cargarSdkFacebook(p.meta_app_id, p.meta_api_version);
      const code = await new Promise<string>((resolve, reject) => {
        FB.login((r) => (r.authResponse?.code ? resolve(r.authResponse.code) : reject(new Error('Se canceló el registro de WhatsApp'))), {
          config_id: p.meta_config_id, response_type: 'code', override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        });
      });
      const r = await api.post<{ canal_id?: number; opciones?: Array<{ waba_id: string; id: string; display_phone_number: string; verified_name: string }>; seleccion?: string }>('/canales/whatsapp/embedded', { code });
      if (r.canal_id) listo();
      else if (r.opciones && r.seleccion) { setOpciones({ seleccion: r.seleccion, numeros: r.opciones }); setElegido(r.opciones[0]?.id ?? ''); }
    } catch (e) { toast.error((e as Error).message); } finally { setConectando(false); }
  }

  async function seleccionar() {
    if (!opciones || !elegido) return;
    setConectando(true);
    try { await api.post('/canales/whatsapp/embedded/seleccionar', { seleccion: opciones.seleccion, phone_number_id: elegido }); listo(); }
    catch (e) { toast.error((e as Error).message); } finally { setConectando(false); }
  }

  async function manual(e?: React.FormEvent) {
    e?.preventDefault();
    setGuardando(true);
    try { await api.post('/canales/whatsapp/manual', { ...f, nombre: f.nombre.trim() }); listo(); }
    catch (err) { toast.error((err as Error).message); } finally { setGuardando(false); }
  }
  const manualValido = f.nombre.trim() && /^\d+$/.test(f.phone_number_id.trim()) && /^\d+$/.test(f.waba_id.trim()) && f.access_token.trim().length >= 20;

  return (
    <Modal abierto onClose={onClose} ancho="lg" titulo={<CabeceraModal canal="whatsapp" titulo="Conectar WhatsApp Business" />}
      pie={modo === 'manual' ? <><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button cargando={guardando} disabled={!manualValido} onClick={() => manual()}>Conectar número</Button></>
        : opciones ? <><Button variante="secundario" onClick={() => setOpciones(null)}>Atrás</Button><Button cargando={conectando} disabled={!elegido} onClick={seleccionar}>Conectar este número</Button></>
          : <Button variante="secundario" onClick={onClose}>Cerrar</Button>}>
      <Tabs className="mb-5" valor={modo} onChange={setModo} opciones={[{ valor: 'embedded', label: <><Sparkles className="h-3.5 w-3.5" />Registro integrado</> }, { valor: 'manual', label: <><KeyRound className="h-3.5 w-3.5" />Manual (token)</> }]} />
      {modo === 'embedded' ? (
        opciones ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-600">Tu cuenta tiene varios números. Elige cuál conectar:</p>
            {opciones.numeros.map((n) => (
              <label key={n.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-all', elegido === n.id ? 'border-brand-400 bg-brand-50/60 ring-4 ring-brand-500/10' : 'border-ink-200 hover:bg-ink-50')}>
                <input type="radio" checked={elegido === n.id} onChange={() => setElegido(n.id)} className="accent-brand-600" />
                <LogoCanal canal="whatsapp" size={32} />
                <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-ink-900">{n.verified_name}</p><p className="font-mono text-xs text-ink-500">{n.display_phone_number}</p></div>
                <span className="font-mono text-[11px] text-ink-400">WABA {n.waba_id}</span>
              </label>
            ))}
          </div>
        ) : embeddedDisponible ? (
          <div className="flex flex-col items-center py-4 text-center">
            <LogoCanal canal="whatsapp" size={56} />
            <h3 className="mt-4 text-[15px] font-semibold text-ink-900">Conecta tu número en 2 minutos</h3>
            <p className="mt-1 max-w-md text-sm text-ink-500">Inicia sesión con Facebook, elige o crea tu cuenta de WhatsApp Business y verifica tu número. Nosotros hacemos el resto.</p>
            <Button tamano="lg" className="mt-5 bg-[#1877F2] hover:bg-[#166fe5] active:bg-[#1464d0]" cargando={conectando} onClick={embedded}
              icono={<svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z" /></svg>}>
              Continuar con Facebook
            </Button>
            <p className="mt-3 text-xs text-ink-400">Se abrirá una ventana emergente de Meta.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-ink-300 bg-ink-50/60 px-6 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-200/70 text-ink-500"><Lock className="h-5 w-5" /></span>
            <h3 className="mt-3 text-[15px] font-semibold text-ink-800">Registro integrado no disponible</h3>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              {p.meta_configurada ? 'Falta el Configuration ID de Embedded Signup.' : 'La App de Meta aún no está configurada.'} El superadministrador debe completarla en <b className="font-medium text-ink-700">Plataforma → Meta</b> (App ID, App Secret y Configuration ID).
            </p>
            <Button variante="secundario" className="mt-4" icono={<KeyRound className="h-4 w-4" />} onClick={() => setModo('manual')}>Usar conexión manual</Button>
          </div>
        )
      ) : (
        <form onSubmit={manual} className="space-y-4">
          <div className="rounded-xl bg-sky-50 px-4 py-3 text-[13px] text-sky-800">
            Necesitas un <b>token de usuario del sistema</b> con permisos <code className="font-mono text-xs">whatsapp_business_messaging</code> y <code className="font-mono text-xs">whatsapp_business_management</code>. Encuentra los IDs en Meta Business → WhatsApp Manager → Configuración de la API.
          </div>
          <Field label="Nombre del canal" required><Input autoFocus value={f.nombre} maxLength={60} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej. WhatsApp Ventas" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone number ID" required><Input value={f.phone_number_id} inputMode="numeric" className="font-mono text-[13px]" onChange={(e) => setF({ ...f, phone_number_id: e.target.value.replace(/\D/g, '') })} placeholder="1234567890123456" /></Field>
            <Field label="WhatsApp Business Account ID" required><Input value={f.waba_id} inputMode="numeric" className="font-mono text-[13px]" onChange={(e) => setF({ ...f, waba_id: e.target.value.replace(/\D/g, '') })} placeholder="1029384756" /></Field>
          </div>
          <Field label="Access token (usuario del sistema)" required hint="Se guarda cifrado. Validamos los datos con Meta antes de conectar.">
            <Input type="password" value={f.access_token} className="font-mono text-[13px]" onChange={(e) => setF({ ...f, access_token: e.target.value })} placeholder="EAAG…" autoComplete="off" />
          </Field>
        </form>
      )}
    </Modal>
  );
}

function ModalMessenger({ onClose }: { onClose: () => void }) {
  const refrescar = useRefrescar();
  const [f, setF] = useState({ page_id: '', page_token: '', nombre: '' });
  const [g, setG] = useState(false);
  const valido = /^\d+$/.test(f.page_id) && f.page_token.trim().length >= 20;
  async function conectar(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valido) return;
    setG(true);
    try { await api.post('/canales/messenger/manual', { page_id: f.page_id, page_token: f.page_token.trim(), nombre: f.nombre.trim() || undefined }); toast.success('Página de Facebook conectada'); refrescar(); onClose(); }
    catch (err) { toast.error((err as Error).message); } finally { setG(false); }
  }
  return (
    <Modal abierto onClose={onClose} titulo={<CabeceraModal canal="messenger" titulo="Conectar Messenger" />}
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button cargando={g} disabled={!valido} onClick={() => conectar()}>Conectar página</Button></>}>
      <form onSubmit={conectar} className="space-y-4">
        <div className="rounded-xl bg-sky-50 px-4 py-3 text-[13px] text-sky-800">Usa un <b>Page Access Token</b> de larga duración con permisos <code className="font-mono text-xs">pages_messaging</code> y <code className="font-mono text-xs">pages_manage_metadata</code>. Suscribimos la página al webhook automáticamente.</div>
        <Field label="ID de la Página" required><Input autoFocus value={f.page_id} inputMode="numeric" className="font-mono text-[13px]" onChange={(e) => setF({ ...f, page_id: e.target.value.replace(/\D/g, '') })} placeholder="102938475610293" /></Field>
        <Field label="Page Access Token" required hint="Se guarda cifrado."><Input type="password" value={f.page_token} className="font-mono text-[13px]" autoComplete="off" onChange={(e) => setF({ ...f, page_token: e.target.value })} placeholder="EAAG…" /></Field>
        <Field label="Nombre (opcional)" hint="Si lo dejas vacío usamos el nombre de la Página."><Input value={f.nombre} maxLength={60} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

function ModalTiktok({ p, onClose }: { p: Plataforma; onClose: () => void }) {
  const [cargando, setCargando] = useState(false);
  async function autorizar() {
    setCargando(true);
    try { const r = await api.get<{ url: string }>('/canales/tiktok/autorizar'); window.location.href = r.url; }
    catch (e) { toast.error((e as Error).message); setCargando(false); }
  }
  return (
    <Modal abierto onClose={onClose} titulo={<CabeceraModal canal="tiktok" titulo="Conectar TikTok" />} pie={<Button variante="secundario" onClick={onClose}>Cerrar</Button>}>
      {p.tiktok_configurada ? (
        <div className="flex flex-col items-center py-4 text-center">
          <LogoCanal canal="tiktok" size={56} />
          <h3 className="mt-4 text-[15px] font-semibold text-ink-900">Autoriza tu cuenta de TikTok Business</h3>
          <p className="mt-1 max-w-sm text-sm text-ink-500">Te llevaremos a TikTok para que apruebes el acceso a tus mensajes directos. Al terminar volverás aquí.</p>
          <Button tamano="lg" className="mt-5 bg-ink-900 hover:bg-black" cargando={cargando} onClick={autorizar} icono={<IconoCanal canal="tiktok" size={18} />}>Continuar con TikTok</Button>
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-ink-300 bg-ink-50/60 px-6 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-200/70 text-ink-500"><Lock className="h-5 w-5" /></span>
          <h3 className="mt-3 text-[15px] font-semibold text-ink-800">TikTok no está configurado</h3>
          <p className="mt-1 max-w-sm text-sm text-ink-500">El superadministrador debe registrar el App ID y App Secret de TikTok en <b className="font-medium text-ink-700">Plataforma</b>. Mientras tanto, puedes usar un canal de prueba de TikTok.</p>
        </div>
      )}
    </Modal>
  );
}

function ModalSandbox({ onClose }: { onClose: () => void }) {
  const refrescar = useRefrescar();
  const [tipo, setTipo] = useState<TipoConectable>('whatsapp');
  const sugerido = useMemo(() => ({ whatsapp: 'WhatsApp de prueba', messenger: 'Messenger de prueba', tiktok: 'TikTok de prueba' }), []);
  const [nombre, setNombre] = useState(sugerido.whatsapp);
  const tocado = useRef(false);
  const [g, setG] = useState(false);
  useEffect(() => { if (!tocado.current) setNombre(sugerido[tipo]); }, [tipo, sugerido]);
  async function crear(e?: React.FormEvent) {
    e?.preventDefault();
    if (!nombre.trim()) return;
    setG(true);
    try { await api.post('/canales/sandbox', { tipo, nombre: nombre.trim() }); toast.success('Canal de prueba creado. ¡Ya puedes simular mensajes!'); refrescar(); onClose(); }
    catch (err) { toast.error((err as Error).message); } finally { setG(false); }
  }
  return (
    <Modal abierto onClose={onClose} titulo={<span className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white"><FlaskConical className="h-4 w-4" /></span>Nuevo canal de prueba</span>}
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button cargando={g} disabled={!nombre.trim()} onClick={() => crear()} className="bg-violet-600 hover:bg-violet-700">Crear canal de prueba</Button></>}>
      <form onSubmit={crear} className="space-y-5">
        <div className="flex gap-3 rounded-xl bg-violet-50 px-4 py-3 text-[13px] text-violet-800">
          <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
          <p>Funciona <b>100% en local</b>, sin Meta, sin TikTok y sin túneles. Recibe mensajes desde el simulador y tus respuestas reciben acuses simulados de entregado y leído. No cuenta para el límite de canales de tu plan.</p>
        </div>
        <Field label="Plataforma a simular">
          <div className="grid grid-cols-3 gap-2">
            {(['whatsapp', 'messenger', 'tiktok'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTipo(t)}
                className={cn('flex flex-col items-center gap-2 rounded-xl border px-3 py-3.5 transition-all',
                  tipo === t ? 'border-violet-400 bg-violet-50/60 ring-4 ring-violet-500/10' : 'border-ink-200 hover:bg-ink-50')}>
                <LogoCanal canal={t} size={36} />
                <span className="text-[13px] font-medium text-ink-800">{CANAL_INFO[t].label}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Nombre del canal" required><Input value={nombre} maxLength={60} onChange={(e) => { tocado.current = true; setNombre(e.target.value); }} /></Field>
      </form>
    </Modal>
  );
}

