'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Inbox, Users, KanbanSquare, FileText, Megaphone, MessagesSquare, Settings,
  ChevronsUpDown, Check, Plus, LogOut, UserCircle2, ShieldCheck, Building2, LifeBuoy, CalendarClock,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { useMe, usePuede, ventanaPermitida } from '@/hooks/datos';
import { useConectado } from '@/hooks/realtime';
import { Avatar, Menu, Tooltip } from '@/components/ui';
import * as DM from '@radix-ui/react-dropdown-menu';
import { SoporteModal } from '@/components/crm/soporte-modal';

const ROL: Record<string, string> = { propietario: 'Propietario', admin: 'Administrador', supervisor: 'Supervisor', agente: 'Agente' };

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const setToken = useAuth((s) => s.setToken);
  const salir = useAuth((s) => s.salir);
  const conectado = useConectado();
  const esAdmin = usePuede('admin');
  const esSupervisor = usePuede('supervisor');
  const [soporte, setSoporte] = useState(false);

  const contadores = useQuery({ queryKey: ['contadores'], queryFn: () => api.get<{ no_leidas_mias: number; sin_asignar: number }>('/conversaciones/contadores'), refetchInterval: 60_000, enabled: !!me?.empresa });
  const chat = useQuery({ queryKey: ['chat', 'no-leidos'], queryFn: () => api.get<{ total: number }>('/chat/no-leidos'), refetchInterval: 60_000, enabled: !!me?.empresa });

  const NAV = [
    { href: '/inicio', label: 'Inicio', icono: LayoutDashboard },
    { href: '/inbox', label: 'Bandeja', icono: Inbox, badge: contadores.data?.no_leidas_mias },
    { href: '/contactos', label: 'Contactos', icono: Users },
    { href: '/pipelines', label: 'Pipelines', icono: KanbanSquare },
    { href: '/plantillas', label: 'Plantillas', icono: FileText },
    ...(esSupervisor ? [{ href: '/difusiones', label: 'Difusiones', icono: Megaphone }] : []),
    { href: '/equipo', label: 'Chat del equipo', icono: MessagesSquare, badge: chat.data?.total },
  ].filter((n) => ventanaPermitida(me, n.href)); // plan de Kallpasoft ∩ rol

  // Ficha Kallpasoft §6.4: el vencimiento no corta el acceso; solo se avisa desde 7 días antes.
  const diasParaVencer = me?.acceso?.gestionado && me.acceso.fecha_fin
    ? Math.ceil((new Date(`${me.acceso.fecha_fin}T23:59:59`).getTime() - Date.now()) / 86_400_000) : null;
  const avisoVence = diasParaVencer !== null && diasParaVencer <= 7;

  async function cambiarEmpresa(id: string) {
    try {
      const r = await api.post<{ token: string }>('/auth/cambiar-empresa', { empresa_id: id });
      setToken(r.token);
      qc.clear();
      router.push('/inicio');
    } catch (e) { toast.error((e as Error).message); }
  }

  async function nuevaEmpresa() {
    const nombre = window.prompt('Nombre de la nueva empresa');
    if (!nombre?.trim()) return;
    try {
      const r = await api.post<{ token: string }>('/auth/nueva-empresa', { nombre });
      setToken(r.token); qc.clear(); router.push('/inicio?bienvenida=1');
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <aside className="flex w-[244px] shrink-0 flex-col bg-ink-950 text-ink-300">
      {/* Empresa */}
      <div className="p-3">
        <DM.Root modal={false}>
          <DM.Trigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold text-white shadow-inner">
                {me?.empresa?.nombre?.[0]?.toUpperCase() ?? 'K'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-white">{me?.empresa?.nombre ?? 'Sin empresa'}</p>
                <p className="truncate text-[11px] text-ink-400">{me?.plan ? `Plan ${me.plan.nombre}` : 'Kallpa CRM'}</p>
              </div>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-500" />
            </button>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content align="start" sideOffset={4} className="z-50 w-[260px] rounded-xl border border-ink-200 bg-white p-1 shadow-pop animate-scale-in">
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Tus empresas</p>
              {me?.empresas.map((e) => (
                <DM.Item key={e.empresa_id} onSelect={() => e.empresa_id !== me.empresa?.empresa_id && cambiarEmpresa(e.empresa_id)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-700 outline-none data-[highlighted]:bg-ink-100">
                  <Building2 className="h-4 w-4 text-ink-400" />
                  <span className="min-w-0 flex-1 truncate">{e.nombre}<span className="ml-1.5 text-[11px] text-ink-400">{ROL[e.rol]}</span></span>
                  {e.empresa_id === me.empresa?.empresa_id && <Check className="h-4 w-4 text-brand-600" />}
                </DM.Item>
              ))}
              <DM.Separator className="my-1 h-px bg-ink-100" />
              {me?.permite_nueva_empresa ? (
                <DM.Item onSelect={nuevaEmpresa} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-700 outline-none data-[highlighted]:bg-ink-100">
                  <Plus className="h-4 w-4 text-ink-400" /> Crear otra empresa
                </DM.Item>
              ) : (
                <DM.Item disabled className="flex cursor-not-allowed items-start gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-400 outline-none">
                  <Plus className="mt-0.5 h-4 w-4 text-ink-300" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">Crear otra empresa
                      <span className="rounded-full bg-ink-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-ink-500">Próximamente</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-400">Las nuevas empresas se activan desde Kallpasoft.</span>
                  </span>
                </DM.Item>
              )}
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      </div>

      {/* Navegación */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-1">
        {NAV.map(({ href, label, icono: I, badge }) => {
          const activo = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link key={href} href={href}
              className={cn('group flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
                activo ? 'bg-white/10 text-white' : 'text-ink-400 hover:bg-white/5 hover:text-ink-100')}>
              <I className={cn('h-[18px] w-[18px] shrink-0', activo ? 'text-brand-300' : 'text-ink-500 group-hover:text-ink-300')} />
              <span className="flex-1">{label}</span>
              {!!badge && badge > 0 && <span className="min-w-[20px] rounded-full bg-brand-500 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{badge > 99 ? '99+' : badge}</span>}
            </Link>
          );
        })}
        <div className="my-3 h-px bg-white/5" />
        {ventanaPermitida(me, '/config') && <Link href="/config" className={cn('group flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
          pathname.startsWith('/config') ? 'bg-white/10 text-white' : 'text-ink-400 hover:bg-white/5 hover:text-ink-100')}>
          <Settings className={cn('h-[18px] w-[18px]', pathname.startsWith('/config') ? 'text-brand-300' : 'text-ink-500 group-hover:text-ink-300')} />
          Configuración
        </Link>}
        <button type="button" onClick={() => setSoporte(true)}
          className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium text-ink-400 transition-colors hover:bg-white/5 hover:text-ink-100">
          <LifeBuoy className="h-[18px] w-[18px] text-ink-500 group-hover:text-ink-300" /> Soporte
        </button>
        {me?.usuario.es_superadmin && (
          <Link href="/admin" className={cn('group flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
            pathname.startsWith('/admin') ? 'bg-white/10 text-white' : 'text-ink-400 hover:bg-white/5 hover:text-ink-100')}>
            <ShieldCheck className="h-[18px] w-[18px] text-amber-400/80" /> Plataforma
          </Link>
        )}
      </nav>

      {/* Aviso de vencimiento del plan (Kallpasoft) */}
      {avisoVence && esAdmin && (
        <div className="mx-3 mb-2 flex items-start gap-2.5 rounded-xl bg-amber-400/10 p-3 ring-1 ring-amber-400/20">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div className="text-[11.5px] leading-snug">
            <p className="font-semibold text-amber-200">{diasParaVencer! < 0 ? 'Tu plan venció' : diasParaVencer === 0 ? 'Tu plan vence hoy' : `Tu plan vence en ${diasParaVencer} día${diasParaVencer === 1 ? '' : 's'}`}</p>
            <p className="mt-0.5 text-amber-100/70">Renuévalo con Kallpasoft para no perder el acceso.</p>
          </div>
        </div>
      )}

      {/* Uso del plan */}
      {me?.plan && esAdmin && (
        <div className="mx-3 mb-2 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-ink-300">Contactos</span>
            <span className="text-ink-400">{me.plan.uso.contactos.toLocaleString('es-PE')} / {me.plan.contactos.toLocaleString('es-PE')}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-brand-400" style={{ width: `${Math.min(100, (me.plan.uso.contactos / me.plan.contactos) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Usuario */}
      <div className="border-t border-white/5 p-3">
        <Menu align="start" trigger={
          <button className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-white/5">
            <span className="relative">
              <Avatar nombre={me?.usuario.nombre} color={me?.usuario.color} size={32} />
              <Tooltip texto={conectado ? 'Tiempo real conectado' : 'Reconectando…'}>
                <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-ink-950', conectado ? 'bg-emerald-400' : 'bg-amber-400')} />
              </Tooltip>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">{me?.usuario.nombre}</p>
              <p className="truncate text-[11px] text-ink-400">{me?.rol ? ROL[me.rol] : me?.usuario.email}</p>
            </div>
          </button>
        } items={[
          { label: 'Mi perfil', icono: <UserCircle2 className="h-4 w-4" />, onClick: () => router.push('/perfil') },
          { separador: true, label: '' },
          { label: 'Cerrar sesión', icono: <LogOut className="h-4 w-4" />, peligro: true, onClick: () => { salir(); qc.clear(); router.replace('/login'); } },
        ]} />
      </div>
      <SoporteModal abierto={soporte} onClose={() => setSoporte(false)} />
    </aside>
  );
}
