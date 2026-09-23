'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { KanbanSquare, Tag, SlidersHorizontal, Zap, Radio, Users, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMe } from '@/hooks/datos';

const SECCIONES = [
  { grupo: 'CRM', items: [
    { href: '/config/pipelines', label: 'Pipelines', desc: 'Etapas del embudo', icono: KanbanSquare },
    { href: '/config/etiquetas', label: 'Etiquetas', desc: 'Clasifica contactos', icono: Tag },
    { href: '/config/campos', label: 'Campos personalizados', desc: 'Datos a medida', icono: SlidersHorizontal },
  ] },
  { grupo: 'Atención', items: [
    { href: '/config/respuestas', label: 'Respuestas rápidas', desc: 'Atajos con /', icono: Zap },
    { href: '/config/canales', label: 'Canales', desc: 'WhatsApp, Messenger, TikTok', icono: Radio },
  ] },
  { grupo: 'Organización', items: [
    { href: '/config/equipo', label: 'Equipo', desc: 'Miembros y roles', icono: Users },
  ] },
];

export default function ConfigLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: me } = useMe();
  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-[228px] shrink-0 flex-col border-r border-ink-200/70 bg-white">
        <div className="flex items-center gap-2.5 border-b border-ink-200/70 px-4 py-[18px]">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-600"><Settings className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-tight text-ink-900">Configuración</p>
            <p className="truncate text-[11px] text-ink-500">{me?.empresa?.nombre ?? ''}</p>
          </div>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
          {SECCIONES.map((s) => (
            <div key={s.grupo}>
              <p className="mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">{s.grupo}</p>
              <div className="space-y-0.5">
                {s.items.map((it) => {
                  const activo = pathname.startsWith(it.href);
                  const I = it.icono;
                  return (
                    <Link key={it.href} href={it.href}
                      className={cn('group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors',
                        activo ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900')}>
                      <I className={cn('h-4 w-4 shrink-0', activo ? 'text-brand-600' : 'text-ink-400 group-hover:text-ink-600')} />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium leading-tight">{it.label}</p>
                        <p className={cn('truncate text-[11px] leading-tight', activo ? 'text-brand-500/80' : 'text-ink-400')}>{it.desc}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto bg-canvas">{children}</div>
    </div>
  );
}
