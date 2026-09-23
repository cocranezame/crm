'use client';
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro' | 'suave' | 'enlace';
type Tamano = 'xs' | 'sm' | 'md' | 'lg' | 'icono' | 'icono-sm';

const VAR: Record<Variante, string> = {
  primario: 'bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-brand-500/30',
  secundario: 'bg-white text-ink-700 border border-ink-200 shadow-xs hover:bg-ink-50 hover:border-ink-300 focus-visible:ring-ink-400/20',
  fantasma: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-ink-400/20',
  peligro: 'bg-red-600 text-white shadow-xs hover:bg-red-700 focus-visible:ring-red-500/30',
  suave: 'bg-brand-50 text-brand-700 hover:bg-brand-100 focus-visible:ring-brand-500/20',
  enlace: 'text-brand-600 hover:text-brand-700 hover:underline underline-offset-2 px-0',
};
const TAM: Record<Tamano, string> = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icono: 'h-9 w-9 rounded-lg',
  'icono-sm': 'h-7 w-7 rounded-md',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante; tamano?: Tamano; cargando?: boolean; icono?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variante = 'primario', tamano = 'md', cargando, icono, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref} type={type} disabled={disabled || cargando}
      className={cn('inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-all duration-150 focus:outline-none focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50',
        VAR[variante], TAM[tamano], className)}
      {...rest}
    >
      {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : icono}
      {children}
    </button>
  );
});
