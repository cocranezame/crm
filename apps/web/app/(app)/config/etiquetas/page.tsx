'use client';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Layers, Lock, MoreHorizontal, Pencil, Plus, Search, Tag, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Etiqueta } from '@/lib/types';
import { useEtiquetas, usePuede } from '@/hooks/datos';
import { Button, ColorPicker, EtiquetaChip, Field, Input, Menu, Modal, PageHeader, Skeleton, Vacio, confirmar } from '@/components/ui';

export default function EtiquetasPage() {
  const { data: etiquetas, isLoading } = useEtiquetas();
  const puede = usePuede('supervisor');
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Etiqueta | 'nueva' | null>(null);
  const [q, setQ] = useState('');

  const grupos = useMemo(() => {
    const filtradas = (etiquetas ?? []).filter((e) => !q || e.nombre.toLowerCase().includes(q.toLowerCase()) || e.grupo_exclusivo?.includes(q.toLowerCase()));
    const m = new Map<string, Etiqueta[]>();
    for (const e of filtradas) {
      const k = e.grupo_exclusivo ?? '';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [etiquetas, q]);
  const gruposExistentes = useMemo(() => [...new Set((etiquetas ?? []).map((e) => e.grupo_exclusivo).filter(Boolean) as string[])], [etiquetas]);

  async function eliminar(e: Etiqueta) {
    const ok = await confirmar({
      titulo: `¿Eliminar la etiqueta "${e.nombre}"?`,
      texto: e.contactos ? <>Se quitará de <b>{e.contactos} contacto(s)</b>. Esta acción no se puede deshacer.</> : 'Esta acción no se puede deshacer.',
      confirmar: 'Eliminar', peligro: true,
    });
    if (!ok) return;
    try {
      await api.del(`/etiquetas/${e.etiqueta_id}`);
      toast.success('Etiqueta eliminada');
      qc.invalidateQueries({ queryKey: ['etiquetas'] });
      qc.invalidateQueries({ queryKey: ['tablero'] });
    } catch (err) { toast.error((err as Error).message); }
  }

  return (
    <div>
      <PageHeader icono={<Tag className="h-5 w-5" />} titulo="Etiquetas" descripcion="Clasifica a tus contactos y filtra el tablero y la bandeja"
        acciones={puede && <Button icono={<Plus className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nueva etiqueta</Button>} />
      <div className="mx-auto max-w-5xl p-6">
        {!puede && <AvisoPermiso texto="Solo supervisores y administradores pueden crear o editar etiquetas." />}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="w-72"><Input icono={<Search className="h-4 w-4" />} placeholder="Buscar etiqueta o grupo" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <p className="text-[13px] text-ink-500">{etiquetas?.length ?? 0} etiquetas · {gruposExistentes.length} grupo{gruposExistentes.length !== 1 && 's'} exclusivo{gruposExistentes.length !== 1 && 's'}</p>
        </div>

        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : !etiquetas?.length ? (
            <Vacio icono={<Tag className="h-5 w-5" />} titulo="Aún no hay etiquetas" texto="Crea etiquetas como VIP, Recompra o Caliente para segmentar a tus contactos."
              accion={puede && <Button icono={<Plus className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nueva etiqueta</Button>} />
          ) : !grupos.length ? (
            <Vacio icono={<Search className="h-5 w-5" />} titulo="Sin resultados" texto={`No hay etiquetas que coincidan con "${q}".`} />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50/60">
                <tr><th className="th">Etiqueta</th><th className="th">Color</th><th className="th">Contactos</th><th className="th w-12" /></tr>
              </thead>
              {grupos.map(([grupo, lista]) => (
                <tbody key={grupo || '_'} className="border-b border-ink-100 last:border-0">
                  <tr className="bg-white">
                    <td colSpan={4} className="px-4 pb-1.5 pt-4">
                      {grupo ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700"><Layers className="h-3.5 w-3.5" />{grupo}</span>
                          <span className="text-xs text-ink-400">Grupo exclusivo · un contacto solo puede tener una de estas</span>
                        </div>
                      ) : <span className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Sin grupo</span>}
                    </td>
                  </tr>
                  {lista.map((e) => (
                    <tr key={e.etiqueta_id} className="group transition-colors hover:bg-ink-50/50">
                      <td className="td"><div className={cn(grupo && 'border-l-2 border-brand-100 pl-3')}><EtiquetaChip nombre={e.nombre} color={e.color} /></div></td>
                      <td className="td"><span className="inline-flex items-center gap-2 font-mono text-xs text-ink-500"><span className="h-3 w-3 rounded" style={{ backgroundColor: e.color }} />{e.color}</span></td>
                      <td className="td"><span className="inline-flex items-center gap-1.5 text-[13px] text-ink-600"><Users className="h-3.5 w-3.5 text-ink-400" />{e.contactos}</span></td>
                      <td className="td text-right">
                        {puede && (
                          <Menu trigger={<button className="rounded-md p-1.5 text-ink-400 opacity-60 transition-opacity hover:bg-ink-100 hover:text-ink-700 group-hover:opacity-100"><MoreHorizontal className="h-4 w-4" /></button>}
                            items={[
                              { label: 'Editar', icono: <Pencil className="h-3.5 w-3.5" />, onClick: () => setEditando(e) },
                              { separador: true, label: '' },
                              { label: 'Eliminar', icono: <Trash2 className="h-3.5 w-3.5" />, peligro: true, onClick: () => eliminar(e) },
                            ]} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
        </div>
      </div>
      {editando && <ModalEtiqueta etiqueta={editando === 'nueva' ? null : editando} grupos={gruposExistentes} onClose={() => setEditando(null)} />}
    </div>
  );
}

function AvisoPermiso({ texto }: { texto: string }) {
  return (
    <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-2.5 text-[13px] text-amber-800">
      <Lock className="h-4 w-4 shrink-0 text-amber-500" />{texto}
    </div>
  );
}

function ModalEtiqueta({ etiqueta, grupos, onClose }: { etiqueta: Etiqueta | null; grupos: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState(etiqueta?.nombre ?? '');
  const [color, setColor] = useState(etiqueta?.color ?? '#6366f1');
  const [grupo, setGrupo] = useState(etiqueta?.grupo_exclusivo ?? '');
  const [guardando, setGuardando] = useState(false);

  async function guardar(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (!nombre.trim()) return;
    setGuardando(true);
    const body = { nombre: nombre.trim(), color, grupo_exclusivo: grupo.trim() || null };
    try {
      if (etiqueta) await api.patch(`/etiquetas/${etiqueta.etiqueta_id}`, body);
      else await api.post('/etiquetas', body);
      toast.success(etiqueta ? 'Etiqueta actualizada' : 'Etiqueta creada');
      qc.invalidateQueries({ queryKey: ['etiquetas'] });
      qc.invalidateQueries({ queryKey: ['tablero'] });
      onClose();
    } catch (err) { toast.error((err as Error).message); } finally { setGuardando(false); }
  }

  return (
    <Modal abierto onClose={onClose} titulo={etiqueta ? 'Editar etiqueta' : 'Nueva etiqueta'}
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button onClick={() => guardar()} cargando={guardando} disabled={!nombre.trim()}>{etiqueta ? 'Guardar cambios' : 'Crear etiqueta'}</Button></>}>
      <form onSubmit={guardar} className="space-y-5">
        <div className="flex items-center justify-center rounded-xl border border-dashed border-ink-200 bg-ink-50/60 py-5">
          <EtiquetaChip nombre={nombre.trim() || 'Vista previa'} color={color} />
        </div>
        <Field label="Nombre" required><Input autoFocus value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. VIP, Recompra, Caliente" /></Field>
        <Field label="Color"><ColorPicker value={color} onChange={setColor} /></Field>
        <Field label="Grupo exclusivo (opcional)"
          hint="Etiquetas con el mismo grupo se excluyen entre sí, p. ej. temperatura: Frío/Tibio/Caliente. Al asignar una, se quita la otra del contacto.">
          <Input icono={<Layers className="h-4 w-4" />} value={grupo} maxLength={40} list="grupos-etiquetas" onChange={(e) => setGrupo(e.target.value.toLowerCase())} placeholder="Sin grupo" />
          <datalist id="grupos-etiquetas">{grupos.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        {grupos.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-500">Grupos existentes:</span>
            {grupos.map((g) => (
              <button key={g} type="button" onClick={() => setGrupo(g)}
                className={cn('rounded-md px-2 py-0.5 text-xs font-medium transition-colors', grupo === g ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}>{g}</button>
            ))}
          </div>
        )}
      </form>
    </Modal>
  );
}
