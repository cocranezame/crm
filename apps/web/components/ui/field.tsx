'use client';
import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Field({ label, hint, error, children, className, required }: {
  label?: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string; required?: boolean;
}) {
  return (
    <div className={className}>
      {label && <label className="label">{label}{required && <span className="ml-0.5 text-red-500">*</span>}</label>}
      {children}
      {error ? <p className="mt-1.5 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1.5 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icono?: React.ReactNode }>(
  function Input({ className, icono, ...p }, ref) {
    if (!icono) return <input ref={ref} className={cn('input', className)} {...p} />;
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">{icono}</span>
        <input ref={ref} className={cn('input pl-9', className)} {...p} />
      </div>
    );
  });

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...p }, ref) {
    return <textarea ref={ref} className={cn('input min-h-[80px] resize-y leading-relaxed', className)} {...p} />;
  });

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...p }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={cn('input appearance-none pr-9', className)} {...p}>{children}</select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      </div>
    );
  });

export function Switch({ checked, onChange, disabled, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? { w: 'h-4 w-7', k: 'h-3 w-3', t: 'translate-x-3' } : { w: 'h-5 w-9', k: 'h-4 w-4', t: 'translate-x-4' };
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50', s.w, checked ? 'bg-brand-600' : 'bg-ink-300')}>
      <span className={cn('rounded-full bg-white shadow transition-transform', s.k, checked && s.t)} />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; className?: string }) {
  return (
    <label className={cn('inline-flex cursor-pointer select-none items-center gap-2 text-sm text-ink-700', className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-ink-300 text-brand-600 accent-brand-600 focus:ring-brand-500" />
      {label}
    </label>
  );
}

export const COLORES = ['#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLORES.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c}
          className={cn('h-7 w-7 rounded-full ring-offset-2 transition-transform hover:scale-110', value === c && 'ring-2 ring-ink-800')}
          style={{ backgroundColor: c }} />
      ))}
    </div>
  );
}
