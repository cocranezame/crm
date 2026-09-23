'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, MessageSquare, Trash2, UserRound, History, Trophy, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fechaHora, hace, moneda } from '@/lib/utils';
import type { Etapa } from '@/lib/types';
import { useCampos, useMiembros, usePipelines, usePuede } from '@/hooks/datos';
import { Avatar, Button, Cargando, Drawer, Field, Input, Select, confirmar } from '@/components/ui';
import { CamposForm } from './campos';

interface NegocioDetalle {
  negocio_id: number; contacto_id: number; pipeline_id: number; etapa_id: number; titulo: string | null; monto: number | null;
  asignado_a: string | null; valores: Record<string, unknown>; cerrado_en: string | null; creado_en: string; etapa_desde: string;
  contacto_nombre: string | null; contacto_telefono: string | null; contacto_email: string | null;
  pipeline_nombre: string; etapa_nombre: string; etapa_color: string; etapa_tipo: Etapa['tipo'];
}
interface Hist { id: number; de_nombre: string | null; a_nombre: string | null; actor_tipo: string; actor_nombre: string | null; creado_en: string }

export function NegocioDrawer({ negocioId, onClose, conversacionId }: { negocioId: number | null; onClose: () => void; conversacionId?: number | null }) {
  const qc = useQueryClient();
  const puedeBorrar = usePuede('supervisor');
  const q = useQuery({ queryKey: ['negocio', negocioId], enabled: !!negocioId, queryFn: () => api.get<{ negocio: NegocioDetalle; historial: Hist[] }>(`/negocios/${negocioId}`) });
  const { data: campos } = useCampos();
  const { data: equipo } = useMiembros();
  const { data: pipelines } = usePipelines();
  const n = q.data?.negocio;
  const etapas = pipelines?.find((p) => p.pipeline_id === n?.pipeline_id)?.etapas ?? [];

  const [f, setF] = useState<{ titulo: string; monto: string; asignado_a: string; valores: Record<string, unknown> }>({ titulo: '', monto: '', asignado_a: '', valores: {} });
  useEffect(() => {
    if (n) setF({ titulo: n.titulo ?? '', monto: n.monto?.toString() ?? '', asignado_a: n.asignado_a ?? '', valores: n.valores ?? {} });
  }, [n]);

  const invalidar = () => { qc.invalidateQueries({ queryKey: ['negocio', negocioId] }); qc.invalidateQueries({ queryKey: ['tablero'] }); qc.invalidateQueries({ queryKey: ['contacto'] }); };
  const guardar = useMutation({
    mutationFn: () => api.patch(`/negocios/${negocioId}`, {
      titulo: f.titulo || null, monto: f.monto === '' ? null : Number(f.monto), asignado_a: f.asignado_a || null, valores: f.valores,
    }),
    onSuccess: () => { toast.success('Negocio actualizado'); invalidar(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const mover = useMutation({
    mutationFn: (etapa_id: number) => api.patch(`/negocios/${negocioId}/mover`, { etapa_id }),
    onSuccess: () => invalidar(),
    onError: (e) => toast.error((e as Error).message),
  });

  async function borrar() {
    if (!(await confirmar({ titulo: 'Eliminar negocio', texto: 'Se eliminará el negocio y su historial. El contacto no se borra.', confirmar: 'Eliminar', peligro: true }))) return;
    try { await api.del(`/negocios/${negocioId}`); toast.success('Negocio eliminado'); invalidar(); onClose(); } catch (e) { toast.error((e as Error).message); }
  }

  const camposNegocio = campos?.filter((c) => c.entidad === 'negocio') ?? [];
  const ganado = etapas.find((e) => e.tipo === 'ganado');
  const perdido = etapas.find((e) => e.tipo === 'perdido');

  return (
    <Drawer abierto={!!negocioId} onClose={onClose} ancho="max-w-[560px]"
      titulo={n ? (n.titulo || n.contacto_nombre || 'Negocio') : 'Negocio'}
      subtitulo={n ? `${n.pipeline_nombre} · creado ${hace(n.creado_en)}` : undefined}
      pie={n && <>
        {puedeBorrar && <Button variante="fantasma" className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700" icono={<Trash2 className="h-4 w-4" />} onClick={borrar}>Eliminar</Button>}
        <Button variante="secundario" onClick={onClose}>Cerrar</Button>
        <Button cargando={guardar.isPending} onClick={() => guardar.mutate()}>Guardar cambios</Button>
      </>}>
      {!n ? <Cargando /> : (
        <div className="space-y-6 p-6">
          {/* Etapa */}
          <div className="rounded-xl border border-ink-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-ink-500">Etapa actual</p>
                <p className="mt-1 flex items-center gap-2 text-[15px] font-semibold text-ink-900">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: n.etapa_color }} />{n.etapa_nombre}
                  <span className="text-xs font-normal text-ink-400">desde hace {hace(n.etapa_desde)}</span>
                </p>
              </div>
              <div className="flex gap-2">
                {ganado && n.etapa_id !== ganado.etapa_id && <Button tamano="sm" variante="secundario" className="text-emerald-700" icono={<Trophy className="h-4 w-4" />} onClick={() => mover.mutate(ganado.etapa_id)}>Ganado</Button>}
                {perdido && n.etapa_id !== perdido.etapa_id && <Button tamano="sm" variante="secundario" className="text-red-600" icono={<XCircle className="h-4 w-4" />} onClick={() => mover.mutate(perdido.etapa_id)}>Perdido</Button>}
              </div>
            </div>
            <div className="mt-4 flex gap-1">
              {etapas.map((e) => {
                const idx = etapas.findIndex((x) => x.etapa_id === n.etapa_id);
                const pos = etapas.findIndex((x) => x.etapa_id === e.etapa_id);
                const activo = pos <= idx && e.tipo === 'abierta' && etapas[idx].tipo === 'abierta' || e.etapa_id === n.etapa_id;
                return (
                  <button key={e.etapa_id} title={`Mover a ${e.nombre}`} onClick={() => e.etapa_id !== n.etapa_id && mover.mutate(e.etapa_id)}
                    className="group flex-1">
                    <span className="block h-1.5 rounded-full transition-all group-hover:opacity-80" style={{ backgroundColor: activo ? e.color : '#e2e8f0' }} />
                    <span className="mt-1.5 block truncate text-[10px] font-medium text-ink-500 group-hover:text-ink-800">{e.nombre}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contacto */}
          <div className="flex items-center gap-3 rounded-xl bg-ink-50 p-3">
            <Avatar nombre={n.contacto_nombre} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink-900">{n.contacto_nombre ?? 'Sin nombre'}</p>
              <p className="truncate text-xs text-ink-500">{[n.contacto_telefono, n.contacto_email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</p>
            </div>
            <Link href={`/contactos/${n.contacto_id}`}><Button tamano="sm" variante="secundario" icono={<UserRound className="h-4 w-4" />}>Ficha</Button></Link>
            {conversacionId && <Link href={`/inbox?c=${conversacionId}`}><Button tamano="sm" variante="secundario" icono={<MessageSquare className="h-4 w-4" />}>Chat</Button></Link>}
          </div>

          {/* Datos */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Título" className="sm:col-span-2"><Input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ej. Pedido de materiales" /></Field>
            <Field label="Monto (S/)"><Input type="number" min={0} step="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" /></Field>
            <Field label="Responsable">
              <Select value={f.asignado_a} onChange={(e) => setF({ ...f, asignado_a: e.target.value })}>
                <option value="">Sin asignar</option>
                {equipo?.miembros.filter((m) => m.activo).map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nombre}</option>)}
              </Select>
            </Field>
          </div>
          {camposNegocio.length > 0 && (
            <div>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Campos personalizados</h4>
              <CamposForm campos={camposNegocio} valores={f.valores} onChange={(valores) => setF({ ...f, valores })} />
            </div>
          )}

          {/* Historial */}
          <div>
            <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400"><History className="h-3.5 w-3.5" />Historial de etapas</h4>
            <ol className="relative space-y-3 border-l border-ink-200 pl-4">
              {q.data!.historial.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500 ring-1 ring-ink-200" />
                  <p className="text-[13px] text-ink-700">
                    {h.de_nombre ? <>{h.de_nombre} <ArrowRight className="inline h-3 w-3 text-ink-400" /> </> : 'Creado en '}
                    <b className="font-medium text-ink-900">{h.a_nombre}</b>
                  </p>
                  <p className="text-xs text-ink-400">{h.actor_tipo === 'sistema' ? 'Automático' : h.actor_tipo === 'ia' ? 'Agente IA' : h.actor_nombre ?? '—'} · {fechaHora(h.creado_en)}</p>
                </li>
              ))}
            </ol>
          </div>
          {n.monto !== null && <p className="text-right text-xs text-ink-400">Monto registrado: {moneda(n.monto)}</p>}
        </div>
      )}
    </Drawer>
  );
}
