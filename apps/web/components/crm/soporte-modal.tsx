'use client';
// Botón "Ticket" del contrato Kallpasoft (ficha §4.3). El CRM no guarda tickets: el API los reenvía al central.
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, LifeBuoy, Link2Off, MessageSquareReply, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, fechaHora } from '@/lib/utils';
import { Badge, Button, Cargando, Field, Input, Modal, Tabs, Textarea, Vacio } from '@/components/ui';

interface Adjunto { nombre: string; content_type: string; data_base64: string; preview: string }
interface Ticket {
  numero: string; titulo: string; estado: string; atendido: boolean; categoria: string | null;
  respuesta?: string | null; creado: string; atendido_at?: string | null;
}

const MAX_ADJ = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const ESTADO: Record<string, { label: string; color: string }> = {
  nuevo: { label: 'Nuevo', color: '#6366f1' },
  en_atencion: { label: 'En atención', color: '#f59e0b' },
  atendido: { label: 'Atendido', color: '#10b981' },
  descartado: { label: 'Descartado', color: '#64748b' },
};

function leer(file: File): Promise<Adjunto> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => { const url = String(r.result); ok({ nombre: file.name, content_type: file.type, data_base64: url.split(',')[1] ?? '', preview: url }); };
    r.onerror = () => mal(new Error('No se pudo leer la imagen'));
    r.readAsDataURL(file);
  });
}

export function SoporteModal({ abierto, onClose }: { abierto: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'nuevo' | 'mis'>('nuevo');
  const [f, setF] = useState({ titulo: '', descripcion: '' });
  const [adj, setAdj] = useState<Adjunto[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (abierto) { setTab('nuevo'); setF({ titulo: '', descripcion: '' }); setAdj([]); } }, [abierto]);

  const estado = useQuery({
    queryKey: ['soporte', 'estado'], enabled: abierto,
    queryFn: () => api.get<{ vinculada: boolean; configurado: boolean; disponible: boolean }>('/soporte/estado'),
  });
  const disponible = !!estado.data?.disponible;
  const tickets = useQuery({
    queryKey: ['soporte', 'tickets'], enabled: abierto && tab === 'mis' && disponible, retry: false,
    queryFn: () => api.get<{ tickets: Ticket[] }>('/soporte/tickets'),
  });

  const enviar = useMutation({
    mutationFn: () => api.post<{ ticket: { numero: string } }>('/soporte/tickets', {
      titulo: f.titulo.trim(), descripcion: f.descripcion.trim(), ventana: pathname,
      adjuntos: adj.map(({ nombre, content_type, data_base64 }) => ({ nombre, content_type, data_base64 })),
    }),
    onSuccess: (r) => {
      toast.success(`Ticket ${r.ticket.numero} enviado`, { description: 'Te responderemos desde Kallpasoft.' });
      setF({ titulo: '', descripcion: '' }); setAdj([]);
      qc.invalidateQueries({ queryKey: ['soporte', 'tickets'] });
      setTab('mis');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function agregar(files: FileList | null) {
    if (!files) return;
    const nuevos: Adjunto[] = [];
    for (const file of Array.from(files)) {
      if (adj.length + nuevos.length >= MAX_ADJ) { toast.error(`Máximo ${MAX_ADJ} imágenes`); break; }
      if (!file.type.startsWith('image/')) { toast.error(`${file.name} no es una imagen`); continue; }
      if (file.size > MAX_BYTES) { toast.error(`${file.name} supera los 2 MB`); continue; }
      nuevos.push(await leer(file));
    }
    setAdj((a) => [...a, ...nuevos]);
    if (inputRef.current) inputRef.current.value = '';
  }

  const valido = f.titulo.trim().length >= 3 && f.descripcion.trim().length >= 5;

  return (
    <Modal abierto={abierto} onClose={onClose} titulo="Soporte" descripcion="Reporta un problema o pide ayuda al equipo de Kallpasoft."
      pie={tab === 'nuevo' && disponible ? <>
        <Button variante="secundario" onClick={onClose}>Cancelar</Button>
        <Button disabled={!valido} cargando={enviar.isPending} onClick={() => enviar.mutate()}>Enviar ticket</Button>
      </> : undefined}>
      {estado.isLoading ? <Cargando className="py-10" /> : !disponible ? (
        <Vacio icono={<Link2Off className="h-5 w-5" />} titulo={estado.data?.vinculada ? 'Soporte no disponible' : 'Empresa sin vincular a Kallpasoft'}
          texto={estado.data?.vinculada
            ? 'El servidor aún no tiene configurada la conexión con Kallpasoft. Inténtalo más tarde.'
            : 'Los tickets de soporte se habilitan cuando esta empresa se activa desde Kallpasoft.'} className="py-8" />
      ) : (
        <div className="space-y-5">
          <Tabs valor={tab} onChange={setTab} opciones={[{ valor: 'nuevo', label: 'Nuevo ticket' }, { valor: 'mis', label: 'Mis tickets' }]} />
          {tab === 'nuevo' ? (
            <form onSubmit={(e) => { e.preventDefault(); if (valido) enviar.mutate(); }} className="space-y-4">
              <Field label="Título" required><Input autoFocus value={f.titulo} maxLength={150} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ej. No puedo enviar una plantilla" /></Field>
              <Field label="Descripción" required hint="Cuéntanos qué pasó y qué esperabas que pasara.">
                <Textarea value={f.descripcion} maxLength={5000} rows={5} onChange={(e) => setF({ ...f, descripcion: e.target.value })} placeholder="Pasos para reproducirlo, mensaje de error…" />
              </Field>
              <div>
                <p className="label">Capturas <span className="font-normal text-ink-400">(opcional · hasta 3, 2 MB c/u)</span></p>
                <div className="flex flex-wrap gap-2">
                  {adj.map((a, i) => (
                    <div key={i} className="group relative h-20 w-20 overflow-hidden rounded-lg ring-1 ring-ink-200">
                      <img src={a.preview} alt={a.nombre} className="h-full w-full object-cover" />
                      <button type="button" onClick={() => setAdj(adj.filter((_, j) => j !== i))} aria-label="Quitar imagen"
                        className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {adj.length < MAX_ADJ && (
                    <button type="button" onClick={() => inputRef.current?.click()}
                      className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ink-300 text-[11px] font-medium text-ink-500 transition-colors hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-600">
                      <ImagePlus className="h-5 w-5" /> Agregar
                    </button>
                  )}
                </div>
                <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => agregar(e.target.files)} />
              </div>
              <button type="submit" className="hidden" />
            </form>
          ) : tickets.isLoading ? <Cargando className="py-10" /> : tickets.isError ? (
            <Vacio icono={<LifeBuoy className="h-5 w-5" />} titulo="No pudimos cargar tus tickets" texto={(tickets.error as Error).message} className="py-8" />
          ) : !tickets.data?.tickets.length ? (
            <Vacio icono={<LifeBuoy className="h-5 w-5" />} titulo="Aún no tienes tickets" texto="Cuando envíes uno, verás aquí su estado y la respuesta del equipo." className="py-8" />
          ) : (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {tickets.data.tickets.map((t) => {
                const e = ESTADO[t.estado] ?? { label: t.estado, color: '#64748b' };
                return (
                  <li key={t.numero} className="rounded-xl border border-ink-200/80 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-ink-900">{t.titulo}</p>
                        <p className="mt-0.5 text-xs text-ink-500">{t.numero} · {fechaHora(t.creado)}{t.categoria ? ` · ${t.categoria}` : ''}</p>
                      </div>
                      <Badge color={e.color}>{e.label}</Badge>
                    </div>
                    {t.respuesta && (
                      <div className={cn('mt-3 flex gap-2 rounded-lg bg-emerald-50/70 p-2.5 text-[13px] text-ink-700 ring-1 ring-emerald-100')}>
                        <MessageSquareReply className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        <p className="whitespace-pre-wrap">{t.respuesta}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
