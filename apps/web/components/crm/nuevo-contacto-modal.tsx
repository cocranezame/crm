'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Etiqueta } from '@/lib/types';
import { useCampos, useEtiquetas, useMiembros, usePipelines } from '@/hooks/datos';
import { Button, Field, Input, Modal, Select } from '@/components/ui';
import { CamposForm } from '@/components/crm/campos';

// ── Selector de etiquetas (chips, respeta grupos exclusivos) ─────────────────

export function ChipsEtiquetas({ todas, valor, onChange }: { todas: Etiqueta[]; valor: number[]; onChange: (ids: number[]) => void }) {
  function alternar(t: Etiqueta) {
    if (valor.includes(t.etiqueta_id)) return onChange(valor.filter((x) => x !== t.etiqueta_id));
    const mismoGrupo = t.grupo_exclusivo ? todas.filter((o) => o.grupo_exclusivo === t.grupo_exclusivo).map((o) => o.etiqueta_id) : [];
    onChange([...valor.filter((x) => !mismoGrupo.includes(x)), t.etiqueta_id]);
  }
  if (!todas.length) return <p className="text-xs text-ink-400">No hay etiquetas creadas. Puedes crearlas en Configuración.</p>;
  const grupos = new Map<string, Etiqueta[]>();
  for (const t of todas) grupos.set(t.grupo_exclusivo ?? '', [...(grupos.get(t.grupo_exclusivo ?? '') ?? []), t]);
  const orden = [...grupos.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  return (
    <div className="space-y-2">
      {orden.map(([g, lista]) => (
        <div key={g || '_'} className="flex flex-wrap items-center gap-1.5">
          {g && <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400" title="Grupo exclusivo: solo una">{g}</span>}
          {lista.map((t) => {
            const on = valor.includes(t.etiqueta_id);
            return (
              <button key={t.etiqueta_id} type="button" onClick={() => alternar(t)}
                className={cn('inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium transition-all', g ? 'rounded-full' : 'rounded-md',
                  on ? 'shadow-xs' : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300')}
                style={on ? { backgroundColor: t.color + '18', borderColor: t.color + '80', color: t.color } : undefined}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.color }} />{t.nombre}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Modal: nuevo contacto ────────────────────────────────────────────────────

const VACIO = { nombre: '', telefono: '', email: '', documento: '', empresa_nombre: '', asignado_a: '', pipeline_id: '' };

export type ContactoCreado = { contacto_id: number; nombre: string | null };

/**
 * Modal único para crear contactos. Se usa en Contactos y en Pipelines (Nuevo negocio).
 * `ocultarPipeline`: oculta "Agregar al Kanban" cuando quien lo abre ya va a crear el negocio.
 */
export function NuevoContactoModal({ abierto, onClose, onCreado, ocultarPipeline }: {
  abierto: boolean; onClose: () => void; onCreado: (c: ContactoCreado) => void; ocultarPipeline?: boolean;
}) {
  const qc = useQueryClient();
  const { data: etiquetas } = useEtiquetas();
  const { data: campos } = useCampos();
  const { data: pipelines } = usePipelines();
  const { data: equipo } = useMiembros();
  const [f, setF] = useState(VACIO);
  const [valores, setValores] = useState<Record<string, unknown>>({});
  const [ets, setEts] = useState<number[]>([]);
  const [error, setError] = useState<{ campo?: 'telefono' | 'email'; msg: string } | null>(null);
  const camposContacto = (campos ?? []).filter((c) => c.entidad === 'contacto');

  useEffect(() => { if (abierto) { setF(VACIO); setValores({}); setEts([]); setError(null); } }, [abierto]);

  const crear = useMutation({
    mutationFn: () => api.post<{ contacto: ContactoCreado }>('/contactos', {
      nombre: f.nombre.trim() || null, telefono: f.telefono.trim() || null, email: f.email.trim() || null,
      documento: f.documento.trim() || null, empresa_nombre: f.empresa_nombre.trim() || null,
      asignado_a: f.asignado_a || null, valores, etiqueta_ids: ets, pipeline_id: f.pipeline_id ? Number(f.pipeline_id) : null,
    }),
    onSuccess: (r) => {
      toast.success('Contacto creado');
      qc.invalidateQueries({ queryKey: ['contactos'] });
      if (f.pipeline_id) qc.invalidateQueries({ queryKey: ['tablero'] });
      onClose();
      onCreado({ contacto_id: r.contacto.contacto_id, nombre: r.contacto.nombre ?? (f.nombre.trim() || null) });
    },
    onError: (e) => {
      const msg = (e as Error).message;
      const campo = /tel[eé]fono/i.test(msg) ? 'telefono' : /email|correo/i.test(msg) ? 'email' : undefined;
      setError({ campo, msg });
    },
  });

  const valido = !!(f.nombre.trim() || f.telefono.trim() || f.email.trim());
  const set = (k: keyof typeof VACIO) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); if (error) setError(null); };

  return (
    <Modal abierto={abierto} onClose={onClose} ancho="lg" titulo="Nuevo contacto" descripcion="Ingresa al menos nombre, teléfono o email."
      pie={<>
        <Button variante="secundario" onClick={onClose}>Cancelar</Button>
        <Button disabled={!valido} cargando={crear.isPending} onClick={() => crear.mutate()}>Crear contacto</Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); if (valido) crear.mutate(); }} className="space-y-6">
        {error && !error.campo && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error.msg}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" className="sm:col-span-2"><Input autoFocus value={f.nombre} onChange={set('nombre')} placeholder="Ej. María Fernández" /></Field>
          <Field label="Teléfono" hint="+51 987 654 321 o 9 dígitos" error={error?.campo === 'telefono' ? error.msg : null}>
            <Input type="tel" value={f.telefono} onChange={set('telefono')} placeholder="987 654 321" className={cn(error?.campo === 'telefono' && 'border-red-300')} />
          </Field>
          <Field label="Email" error={error?.campo === 'email' ? error.msg : null}>
            <Input type="email" value={f.email} onChange={set('email')} placeholder="nombre@correo.com" className={cn(error?.campo === 'email' && 'border-red-300')} />
          </Field>
          <Field label="Documento" hint="DNI o RUC"><Input value={f.documento} onChange={set('documento')} placeholder="12345678" /></Field>
          <Field label="Empresa"><Input value={f.empresa_nombre} onChange={set('empresa_nombre')} placeholder="Razón social o comercio" /></Field>
          <Field label="Responsable">
            <Select value={f.asignado_a} onChange={set('asignado_a')}>
              <option value="">Sin asignar</option>
              {equipo?.miembros.filter((m) => m.activo).map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nombre}</option>)}
            </Select>
          </Field>
          {!ocultarPipeline && (
            <Field label="Agregar al Kanban" hint="Crea un negocio en la primera etapa">
              <Select value={f.pipeline_id} onChange={set('pipeline_id')}>
                <option value="">No agregar</option>
                {pipelines?.filter((p) => p.activo).map((p) => <option key={p.pipeline_id} value={p.pipeline_id}>{p.nombre}</option>)}
              </Select>
            </Field>
          )}
        </div>

        <div>
          <p className="label">Etiquetas</p>
          <ChipsEtiquetas todas={etiquetas ?? []} valor={ets} onChange={setEts} />
        </div>

        {camposContacto.length > 0 && (
          <div className="border-t border-ink-100 pt-5">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-400">Campos personalizados</h4>
            <CamposForm campos={camposContacto} valores={valores} onChange={setValores} />
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
