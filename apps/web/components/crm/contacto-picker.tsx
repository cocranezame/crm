'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Check } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { cn, telefonoBonito } from '@/lib/utils';
import type { ContactoFila } from '@/lib/types';
import { Avatar, Popover, Spinner } from '@/components/ui';

export function ContactoPicker({ valor, onChange, excluir }: {
  valor: { contacto_id: number; nombre: string | null } | null; onChange: (c: ContactoFila) => void; excluir?: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');
  const r = useQuery({
    queryKey: ['contactos', 'picker', q], enabled: abierto,
    queryFn: () => api.get<{ items: ContactoFila[] }>(`/contactos${qs({ q, limit: 8 })}`),
  });
  return (
    <Popover abierto={abierto} onOpenChange={setAbierto} className="w-[var(--radix-popover-trigger-width)] p-0" trigger={
      <button type="button" className="input flex items-center gap-2 text-left">
        {valor ? <><Avatar nombre={valor.nombre} size={20} /><span className="truncate">{valor.nombre ?? `Contacto #${valor.contacto_id}`}</span></>
          : <span className="text-ink-400">Busca un contacto…</span>}
      </button>
    }>
      <div className="flex items-center gap-2 border-b border-ink-100 px-3">
        <Search className="h-4 w-4 text-ink-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, teléfono o email"
          className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400" />
        {r.isFetching && <Spinner className="h-4 w-4" />}
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {r.data?.items.filter((c) => c.contacto_id !== excluir).map((c) => (
          <button key={c.contacto_id} type="button" onClick={() => { onChange(c); setAbierto(false); }}
            className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-ink-50', valor?.contacto_id === c.contacto_id && 'bg-brand-50')}>
            <Avatar nombre={c.nombre} size={28} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink-800">{c.nombre ?? 'Sin nombre'}</p>
              <p className="truncate text-xs text-ink-500">{telefonoBonito(c.telefono) || c.email || '—'}</p>
            </div>
            {valor?.contacto_id === c.contacto_id && <Check className="h-4 w-4 text-brand-600" />}
          </button>
        ))}
        {r.data && !r.data.items.length && <p className="px-3 py-6 text-center text-sm text-ink-500">Sin resultados</p>}
      </div>
    </Popover>
  );
}
