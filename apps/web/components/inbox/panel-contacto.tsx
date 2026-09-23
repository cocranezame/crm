'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Phone, Mail, Plus, Tag, KanbanSquare, StickyNote, Send, Hash } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, hace, moneda, telefonoBonito } from '@/lib/utils';
import type { Campo, Canal, EtiquetaMin } from '@/lib/types';
import { useCampos, useEtiquetas, usePipelines } from '@/hooks/datos';
import { Avatar, Button, Cargando, EtiquetaChip, Popover, Select } from '@/components/ui';
import { CanalChip } from '@/components/crm/canal';
import { valorLegible } from '@/components/crm/campos';
import { NegocioDrawer } from '@/components/crm/negocio-drawer';

export interface ContactoDetalle {
  contacto: { contacto_id: number; nombre: string | null; telefono: string | null; email: string | null; documento: string | null; empresa_nombre: string | null; valores: Record<string, unknown>; origen: string; creado_en: string };
  etiquetas: Array<EtiquetaMin & { grupo_exclusivo: string | null }>;
  identidades: Array<{ identidad_id: number; canal: Canal; externo_id: string; nombre_canal: string | null; username: string | null }>;
  negocios: Array<{ negocio_id: number; pipeline_id: number; pipeline_nombre: string; pipeline_color: string; etapa_id: number; etapa_nombre: string; etapa_color: string; etapa_tipo: string; titulo: string | null; monto: number | null; cerrado_en: string | null; asignado_nombre: string | null }>;
  conversaciones: Array<{ conversacion_id: number; canal: Canal; canal_nombre: string; estado: string; ultima_actividad: string }>;
  notas: Array<{ nota_id: number; contenido: string; autor_nombre: string | null; autor_color: string | null; creado_en: string }>;
}

export function SelectorEtiquetas({ contactoId, actuales }: { contactoId: number; actuales: EtiquetaMin[] }) {
  const qc = useQueryClient();
  const { data: todas } = useEtiquetas();
  const ids = new Set(actuales.map((e) => e.etiqueta_id));
  const alternar = useMutation({
    mutationFn: (id: number) => ids.has(id) ? api.del(`/contactos/${contactoId}/etiquetas/${id}`) : api.post(`/contactos/${contactoId}/etiquetas/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacto', contactoId] }); qc.invalidateQueries({ queryKey: ['conversaciones'] }); qc.invalidateQueries({ queryKey: ['contactos'] }); qc.invalidateQueries({ queryKey: ['tablero'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const grupos = new Map<string, typeof todas>();
  for (const t of todas ?? []) { const g = t.grupo_exclusivo ?? ''; grupos.set(g, [...(grupos.get(g) ?? []), t]); }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {actuales.map((e) => <EtiquetaChip key={e.etiqueta_id} nombre={e.nombre} color={e.color} onQuitar={() => alternar.mutate(e.etiqueta_id)} />)}
      <Popover trigger={<button className="inline-flex items-center gap-1 rounded-md border border-dashed border-ink-300 px-2 py-0.5 text-xs font-medium text-ink-500 hover:border-ink-400 hover:text-ink-700"><Plus className="h-3 w-3" />Etiqueta</button>} className="w-60 p-1.5">
        <div className="max-h-72 overflow-y-auto">
          {[...grupos.entries()].map(([g, lista]) => (
            <div key={g} className="mb-1">
              {g && <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{g} · excluyentes</p>}
              {lista!.map((t) => (
                <button key={t.etiqueta_id} onClick={() => alternar.mutate(t.etiqueta_id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-ink-50">
                  <span className={cn('flex h-4 w-4 items-center justify-center rounded border text-[10px] text-white', ids.has(t.etiqueta_id) ? 'border-transparent' : 'border-ink-300')}
                    style={ids.has(t.etiqueta_id) ? { backgroundColor: t.color } : undefined}>{ids.has(t.etiqueta_id) && '✓'}</span>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />{t.nombre}
                </button>
              ))}
            </div>
          ))}
          {!todas?.length && <p className="p-3 text-center text-xs text-ink-500">No hay etiquetas. Créalas en Configuración.</p>}
        </div>
      </Popover>
    </div>
  );
}

function Seccion({ titulo, icono, children, accion }: { titulo: string; icono: React.ReactNode; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <section className="border-b border-ink-100 px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{icono}{titulo}</h4>
        {accion}
      </div>
      {children}
    </section>
  );
}

export function PanelContacto({ contactoId, conversacionId }: { contactoId: number; conversacionId: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['contacto', contactoId], queryFn: () => api.get<ContactoDetalle>(`/contactos/${contactoId}`) });
  const { data: campos } = useCampos();
  const { data: pipelines } = usePipelines();
  const [negocio, setNegocio] = useState<number | null>(null);
  const [nota, setNota] = useState('');
  const [nuevoEn, setNuevoEn] = useState('');

  const guardarNota = useMutation({
    mutationFn: () => api.post(`/contactos/${contactoId}/notas`, { contenido: nota }),
    onSuccess: () => { setNota(''); qc.invalidateQueries({ queryKey: ['contacto', contactoId] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const crearNegocio = useMutation({
    mutationFn: (pipeline_id: number) => api.post('/negocios', { contacto_id: contactoId, pipeline_id, titulo: q.data?.contacto.nombre }),
    onSuccess: () => { setNuevoEn(''); toast.success('Negocio creado'); qc.invalidateQueries({ queryKey: ['contacto', contactoId] }); qc.invalidateQueries({ queryKey: ['tablero'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading || !q.data) return <Cargando />;
  const { contacto: c, etiquetas, identidades, negocios, notas } = q.data;
  const camposContacto = (campos ?? []).filter((x: Campo) => x.entidad === 'contacto');
  const abiertosPipes = new Set(negocios.filter((n) => !n.cerrado_en).map((n) => n.pipeline_id));
  const disponibles = pipelines?.filter((p) => p.activo && !abiertosPipes.has(p.pipeline_id)) ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col items-center border-b border-ink-100 px-5 py-6 text-center">
        <Avatar nombre={c.nombre} size={60} />
        <h3 className="mt-3 text-[15px] font-semibold text-ink-900">{c.nombre ?? 'Sin nombre'}</h3>
        {c.empresa_nombre && c.empresa_nombre !== c.nombre && <p className="text-xs text-ink-500">{c.empresa_nombre}</p>}
        <div className="mt-2 flex flex-wrap justify-center gap-1">{identidades.map((i) => <CanalChip key={i.identidad_id} canal={i.canal} />)}</div>
        <Link href={`/contactos/${c.contacto_id}`} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">Ver ficha completa <ExternalLink className="h-3 w-3" /></Link>
      </div>

      <Seccion titulo="Datos" icono={<Hash className="h-3 w-3" />}>
        <dl className="space-y-2 text-[13px]">
          <div className="flex items-center gap-2 text-ink-700"><Phone className="h-3.5 w-3.5 text-ink-400" />{telefonoBonito(c.telefono) || <span className="text-ink-400">Sin teléfono</span>}</div>
          <div className="flex items-center gap-2 text-ink-700"><Mail className="h-3.5 w-3.5 text-ink-400" /><span className="truncate">{c.email || <span className="text-ink-400">Sin email</span>}</span></div>
          {camposContacto.map((f) => (
            <div key={f.campo_id} className="flex justify-between gap-3"><dt className="text-ink-500">{f.nombre}</dt><dd className="truncate text-right font-medium text-ink-800">{valorLegible(f, c.valores[f.clave])}</dd></div>
          ))}
        </dl>
      </Seccion>

      <Seccion titulo="Etiquetas" icono={<Tag className="h-3 w-3" />}>
        <SelectorEtiquetas contactoId={c.contacto_id} actuales={etiquetas} />
      </Seccion>

      <Seccion titulo="Negocios" icono={<KanbanSquare className="h-3 w-3" />}>
        <div className="space-y-2">
          {negocios.map((n) => (
            <button key={n.negocio_id} onClick={() => setNegocio(n.negocio_id)}
              className={cn('w-full rounded-lg border border-ink-200 p-2.5 text-left transition-colors hover:border-ink-300 hover:bg-ink-50', n.cerrado_en && 'opacity-70')}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium text-ink-500">{n.pipeline_nombre}</span>
                {n.monto !== null && <span className="text-xs font-semibold text-ink-800">{moneda(n.monto, true)}</span>}
              </div>
              <p className="mt-0.5 truncate text-[13px] font-medium text-ink-900">{n.titulo ?? 'Sin título'}</p>
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: n.etapa_color + '1f', color: n.etapa_color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: n.etapa_color }} />{n.etapa_nombre}
              </span>
            </button>
          ))}
          {disponibles.length > 0 && (
            <div className="flex gap-2">
              <Select value={nuevoEn} onChange={(e) => setNuevoEn(e.target.value)} className="h-8 py-1 text-xs">
                <option value="">Agregar a pipeline…</option>
                {disponibles.map((p) => <option key={p.pipeline_id} value={p.pipeline_id}>{p.nombre}</option>)}
              </Select>
              <Button tamano="sm" variante="secundario" disabled={!nuevoEn} cargando={crearNegocio.isPending} onClick={() => crearNegocio.mutate(Number(nuevoEn))}>Crear</Button>
            </div>
          )}
        </div>
      </Seccion>

      <Seccion titulo="Notas del contacto" icono={<StickyNote className="h-3 w-3" />}>
        <div className="flex gap-2">
          <input value={nota} onChange={(e) => setNota(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && nota.trim() && guardarNota.mutate()}
            placeholder="Agregar nota…" className="input h-8 py-1 text-[13px]" />
          <Button tamano="icono-sm" variante="secundario" className="h-8 w-8" disabled={!nota.trim()} onClick={() => guardarNota.mutate()}><Send className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="mt-3 space-y-2.5">
          {notas.slice(0, 5).map((n) => (
            <div key={n.nota_id} className="rounded-lg bg-amber-50/70 px-3 py-2 text-[13px] text-ink-700">
              <p className="whitespace-pre-wrap break-words">{n.contenido}</p>
              <p className="mt-1 text-[11px] text-ink-400">{n.autor_nombre} · hace {hace(n.creado_en)}</p>
            </div>
          ))}
        </div>
      </Seccion>
      <NegocioDrawer negocioId={negocio} conversacionId={conversacionId} onClose={() => setNegocio(null)} />
    </div>
  );
}
