'use client';
import { Loader2 } from 'lucide-react';
import { cn, colorDe, iniciales } from '@/lib/utils';

export function Avatar({ nombre, color, size = 32, className, foto }: { nombre?: string | null; color?: string | null; size?: number; className?: string; foto?: string | null }) {
  const bg = color || colorDe(nombre);
  if (foto) return <img src={foto} alt="" className={cn('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />;
  return (
    <span className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, backgroundColor: bg, fontSize: Math.max(10, size * 0.38) }}>
      {iniciales(nombre)}
    </span>
  );
}

export function Badge({ children, color, className, variante = 'suave' }: { children: React.ReactNode; color?: string; className?: string; variante?: 'suave' | 'solido' | 'borde' }) {
  if (color) {
    const estilo = variante === 'solido' ? { backgroundColor: color, color: '#fff' } : variante === 'borde' ? { borderColor: color + '66', color } : { backgroundColor: color + '1a', color };
    return <span className={cn('chip', variante === 'borde' && 'border', className)} style={estilo}>{children}</span>;
  }
  return <span className={cn('chip bg-ink-100 text-ink-600', className)}>{children}</span>;
}

export function EtiquetaChip({ nombre, color, onQuitar, size = 'sm' }: { nombre: string; color: string; onQuitar?: () => void; size?: 'xs' | 'sm' }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md font-medium', size === 'xs' ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-xs')}
      style={{ backgroundColor: color + '18', color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {nombre}
      {onQuitar && <button onClick={onQuitar} className="-mr-0.5 ml-0.5 rounded opacity-60 hover:opacity-100">×</button>}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-ink-400', className)} />;
}

export function Cargando({ texto = 'Cargando…', className }: { texto?: string; className?: string }) {
  return <div className={cn('flex items-center justify-center gap-2 py-16 text-sm text-ink-500', className)}><Spinner className="h-4 w-4" />{texto}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-ink-200/60', className)} />;
}

export function Vacio({ icono, titulo, texto, accion, className }: { icono?: React.ReactNode; titulo: string; texto?: React.ReactNode; accion?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icono && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-8 ring-brand-50/50">{icono}</div>}
      <h3 className="text-[15px] font-semibold text-ink-900">{titulo}</h3>
      {texto && <p className="mt-1 max-w-sm text-sm text-ink-500">{texto}</p>}
      {accion && <div className="mt-5">{accion}</div>}
    </div>
  );
}

export function PageHeader({ titulo, descripcion, acciones, icono, className }: { titulo: React.ReactNode; descripcion?: React.ReactNode; acciones?: React.ReactNode; icono?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-4 border-b border-ink-200/70 bg-white px-6 py-4', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icono && <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{icono}</div>}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink-900">{titulo}</h1>
          {descripcion && <p className="truncate text-[13px] text-ink-500">{descripcion}</p>}
        </div>
      </div>
      {acciones && <div className="flex items-center gap-2">{acciones}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ valor, onChange, opciones, className }: {
  valor: T; onChange: (v: T) => void; opciones: Array<{ valor: T; label: React.ReactNode; contador?: number }>; className?: string;
}) {
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-lg bg-ink-100 p-0.5', className)}>
      {opciones.map((o) => (
        <button key={o.valor} onClick={() => onChange(o.valor)}
          className={cn('inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-all',
            valor === o.valor ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-800')}>
          {o.label}
          {o.contador !== undefined && o.contador > 0 && (
            <span className={cn('min-w-[18px] rounded-full px-1 text-center text-[10px] font-semibold leading-[16px]', valor === o.valor ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-600')}>{o.contador}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, valor, detalle, icono, tono = 'brand' }: { label: string; valor: React.ReactNode; detalle?: React.ReactNode; icono?: React.ReactNode; tono?: 'brand' | 'verde' | 'ambar' | 'rojo' | 'cielo' }) {
  const t = { brand: 'bg-brand-50 text-brand-600', verde: 'bg-emerald-50 text-emerald-600', ambar: 'bg-amber-50 text-amber-600', rojo: 'bg-red-50 text-red-600', cielo: 'bg-sky-50 text-sky-600' }[tono];
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <p className="text-[13px] font-medium text-ink-500">{label}</p>
        {icono && <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', t)}>{icono}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{valor}</p>
      {detalle && <p className="mt-1 text-xs text-ink-500">{detalle}</p>}
    </div>
  );
}
