'use client';
import type { Campo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Field, Input, Select, Switch } from '@/components/ui';

export function CampoInput({ campo, valor, onChange }: { campo: Campo; valor: unknown; onChange: (v: unknown) => void }) {
  const v = valor ?? '';
  switch (campo.tipo) {
    case 'numero': return <Input type="number" step="any" value={String(v)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'fecha': return <Input type="date" value={String(v)} onChange={(e) => onChange(e.target.value || null)} />;
    case 'email': return <Input type="email" value={String(v)} onChange={(e) => onChange(e.target.value || null)} />;
    case 'telefono': return <Input type="tel" value={String(v)} onChange={(e) => onChange(e.target.value || null)} />;
    case 'booleano': return <div className="flex h-9 items-center"><Switch checked={v === true} onChange={onChange} /></div>;
    case 'opcion': return (
      <Select value={String(v)} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {campo.opciones?.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    );
    case 'multi': {
      const arr = Array.isArray(valor) ? (valor as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {campo.opciones?.map((o) => {
            const sel = arr.includes(o);
            return (
              <button key={o} type="button" onClick={() => onChange(sel ? arr.filter((x) => x !== o) : [...arr, o])}
                className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', sel ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-600 hover:border-ink-300')}>
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    default: return <Input value={String(v)} onChange={(e) => onChange(e.target.value || null)} />;
  }
}

export function CamposForm({ campos, valores, onChange, columnas = 2 }: {
  campos: Campo[]; valores: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; columnas?: 1 | 2;
}) {
  if (!campos.length) return null;
  return (
    <div className={cn('grid gap-4', columnas === 2 && 'sm:grid-cols-2')}>
      {campos.map((c) => (
        <Field key={c.campo_id} label={c.nombre} required={c.obligatorio} className={c.tipo === 'multi' ? 'sm:col-span-2' : ''}>
          <CampoInput campo={c} valor={valores[c.clave]} onChange={(x) => onChange({ ...valores, [c.clave]: x })} />
        </Field>
      ))}
    </div>
  );
}

export function valorLegible(campo: Campo, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (campo.tipo === 'booleano') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  if (campo.tipo === 'fecha') { const [y, m, d] = String(v).split('-'); return `${d}/${m}/${y}`; }
  return String(v);
}
