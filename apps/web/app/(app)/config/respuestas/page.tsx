'use client';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Braces, Folder, Globe, Lock, MoreHorizontal, Pencil, Plus, Search, Trash2, UserRound, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Campo, RespuestaRapida } from '@/lib/types';
import { useCampos, useMe, usePuede, useRespuestas } from '@/hooks/datos';
import { Badge, Button, Field, Input, Menu, Modal, PageHeader, Skeleton, Textarea, Vacio, confirmar } from '@/components/ui';

const MUESTRA_CAMPO: Record<Campo['tipo'], string> = {
  texto: 'Lima', numero: '3', fecha: '15/10/2026', opcion: 'Opción A', multi: 'A, B', telefono: '+51 912 345 678', email: 'maria@correo.pe', booleano: 'Sí',
};

export default function RespuestasPage() {
  const { data: respuestas, isLoading } = useRespuestas();
  const { data: me } = useMe();
  const esSupervisor = usePuede('supervisor');
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editando, setEditando] = useState<RespuestaRapida | 'nueva' | null>(null);

  const puedeEditar = (r: RespuestaRapida) => esSupervisor || r.creado_por === me?.usuario.usuario_id;

  const carpetas = useMemo(() => [...new Set((respuestas ?? []).map((r) => r.carpeta).filter(Boolean) as string[])].sort(), [respuestas]);
  const grupos = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^\//, '');
    const f = (respuestas ?? []).filter((r) => !t || r.atajo.includes(t) || r.titulo.toLowerCase().includes(t) || r.contenido.toLowerCase().includes(t));
    const m = new Map<string, RespuestaRapida[]>();
    for (const r of f) { const k = r.carpeta ?? ''; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [respuestas, q]);

  async function eliminar(r: RespuestaRapida) {
    const ok = await confirmar({ titulo: `¿Eliminar /${r.atajo}?`, texto: 'La respuesta rápida dejará de estar disponible en la bandeja.', confirmar: 'Eliminar', peligro: true });
    if (!ok) return;
    try { await api.del(`/respuestas/${r.respuesta_id}`); toast.success('Respuesta eliminada'); qc.invalidateQueries({ queryKey: ['respuestas'] }); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div>
      <PageHeader icono={<Zap className="h-5 w-5" />} titulo="Respuestas rápidas" descripcion={<>Escribe <span className="kbd">/</span> en la bandeja para insertar mensajes frecuentes</>}
        acciones={<Button icono={<Plus className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nueva respuesta</Button>} />
      <div className="mx-auto max-w-5xl p-6">
        {!esSupervisor && (
          <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-2.5 text-[13px] text-amber-800">
            <Lock className="h-4 w-4 shrink-0 text-amber-500" />Como agente, las respuestas que crees serán personales. Solo supervisores pueden compartirlas con todo el equipo.
          </div>
        )}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="w-80"><Input icono={<Search className="h-4 w-4" />} placeholder="Buscar por atajo, título o contenido" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <p className="text-[13px] text-ink-500">{respuestas?.length ?? 0} respuestas · {carpetas.length} carpeta{carpetas.length !== 1 && 's'}</p>
        </div>

        {isLoading ? (
          <div className="card space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !respuestas?.length ? (
          <div className="card"><Vacio icono={<Zap className="h-5 w-5" />} titulo="Aún no hay respuestas rápidas" texto="Guarda saludos, horarios o datos de pago para responder en segundos."
            accion={<Button icono={<Plus className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nueva respuesta</Button>} /></div>
        ) : !grupos.length ? (
          <div className="card"><Vacio icono={<Search className="h-5 w-5" />} titulo="Sin resultados" texto={`Nada coincide con "${q}".`} /></div>
        ) : (
          <div className="space-y-5">
            {grupos.map(([carpeta, lista]) => (
              <section key={carpeta || '_'}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <Folder className="h-4 w-4 text-ink-400" />
                  <h2 className="text-[13px] font-semibold text-ink-700">{carpeta || 'Sin carpeta'}</h2>
                  <span className="rounded-full bg-ink-200/70 px-1.5 text-[11px] font-semibold text-ink-600">{lista.length}</span>
                </div>
                <div className="card divide-y divide-ink-100 overflow-hidden">
                  {lista.map((r) => (
                    <div key={r.respuesta_id} className="group flex items-start gap-4 px-4 py-3.5 transition-colors hover:bg-ink-50/50">
                      <div className="w-32 shrink-0 pt-0.5"><code className="inline-block max-w-full truncate rounded-md bg-brand-50 px-2 py-1 font-mono text-xs font-semibold text-brand-700">/{r.atajo}</code></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[13px] font-semibold text-ink-900">{r.titulo}</p>
                          {r.visible_para === 'todos'
                            ? <Badge color="#0284c7"><Globe className="h-3 w-3" />Todos</Badge>
                            : <Badge><UserRound className="h-3 w-3" />Solo yo</Badge>}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-ink-500"><Resaltar texto={r.contenido} /></p>
                        {r.creado_por_nombre && <p className="mt-1 text-[11px] text-ink-400">Creada por {r.creado_por_nombre}</p>}
                      </div>
                      {puedeEditar(r) && (
                        <Menu trigger={<button className="rounded-md p-1.5 text-ink-400 opacity-60 hover:bg-ink-100 hover:text-ink-700 group-hover:opacity-100"><MoreHorizontal className="h-4 w-4" /></button>}
                          items={[
                            { label: 'Editar', icono: <Pencil className="h-3.5 w-3.5" />, onClick: () => setEditando(r) },
                            { separador: true, label: '' },
                            { label: 'Eliminar', icono: <Trash2 className="h-3.5 w-3.5" />, peligro: true, onClick: () => eliminar(r) },
                          ]} />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      {editando && <ModalRespuesta r={editando === 'nueva' ? null : editando} carpetas={carpetas} esSupervisor={esSupervisor} onClose={() => setEditando(null)} />}
    </div>
  );
}

/** Pinta las {variables} resaltadas. */
function Resaltar({ texto }: { texto: string }) {
  const partes = texto.split(/(\{[a-z_.0-9]+\})/gi);
  return <>{partes.map((p, i) => (/^\{[a-z_.0-9]+\}$/i.test(p) ? <span key={i} className="rounded bg-amber-50 px-0.5 font-mono text-[12px] text-amber-700">{p}</span> : p))}</>;
}

function ModalRespuesta({ r, carpetas, esSupervisor, onClose }: { r: RespuestaRapida | null; carpetas: string[]; esSupervisor: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: campos } = useCampos();
  const camposContacto = (campos ?? []).filter((c) => c.entidad === 'contacto');
  const [atajo, setAtajo] = useState(r?.atajo ?? '');
  const [titulo, setTitulo] = useState(r?.titulo ?? '');
  const [carpeta, setCarpeta] = useState(r?.carpeta ?? '');
  const [contenido, setContenido] = useState(r?.contenido ?? '');
  const [visible, setVisible] = useState<'todos' | 'solo_yo'>(r?.visible_para ?? (esSupervisor ? 'todos' : 'solo_yo'));
  const [guardando, setGuardando] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const cursor = useRef<number | null>(null);
  // Restaura el cursor tras insertar una variable (síncrono, antes de la siguiente tecla)
  useLayoutEffect(() => {
    if (cursor.current === null || !ta.current) return;
    ta.current.focus();
    ta.current.setSelectionRange(cursor.current, cursor.current);
    cursor.current = null;
  }, [contenido]);

  const VARIABLES = [
    { v: '{nombre}', label: 'Nombre', ej: 'María' },
    { v: '{nombre_completo}', label: 'Nombre completo', ej: 'María Fernández' },
    { v: '{empresa}', label: 'Mi empresa', ej: me?.empresa?.nombre ?? 'Mi empresa' },
    { v: '{telefono}', label: 'Teléfono', ej: '+51 987 654 321' },
  ];
  const muestras: Record<string, string> = Object.fromEntries([
    ...VARIABLES.map((x) => [x.v, x.ej]),
    ...camposContacto.map((c) => [`{campo.${c.clave}}`, MUESTRA_CAMPO[c.tipo]]),
  ]);
  const previa = contenido.replace(/\{[a-z_.0-9]+\}/gi, (m) => muestras[m] ?? m);

  function insertar(v: string) {
    const el = ta.current;
    if (!el) { setContenido((c) => c + v); return; }
    const ini = el.selectionStart ?? contenido.length;
    const fin = el.selectionEnd ?? contenido.length;
    cursor.current = ini + v.length;
    setContenido(contenido.slice(0, ini) + v + contenido.slice(fin));
  }

  const atajoValido = /^[a-z0-9_-]{1,40}$/.test(atajo);
  const valido = atajoValido && titulo.trim() && contenido.trim();

  async function guardar() {
    if (!valido) return;
    setGuardando(true);
    const body = { atajo, titulo: titulo.trim(), contenido: contenido.trim(), carpeta: carpeta.trim() || null, visible_para: visible };
    try {
      if (r) await api.patch(`/respuestas/${r.respuesta_id}`, body); else await api.post('/respuestas', body);
      toast.success(r ? 'Respuesta actualizada' : 'Respuesta creada');
      qc.invalidateQueries({ queryKey: ['respuestas'] });
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setGuardando(false); }
  }

  return (
    <Modal abierto onClose={onClose} ancho="xl" titulo={r ? 'Editar respuesta rápida' : 'Nueva respuesta rápida'}
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button onClick={guardar} cargando={guardando} disabled={!valido}>{r ? 'Guardar cambios' : 'Crear respuesta'}</Button></>}>
      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <Field label="Atajo" required error={atajo && !atajoValido ? 'Solo minúsculas, números, - y _' : null}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm font-semibold text-brand-600">/</span>
                <Input autoFocus value={atajo} maxLength={40} className="pl-6 font-mono" placeholder="saludo"
                  onChange={(e) => setAtajo(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, ''))} />
              </div>
            </Field>
            <Field label="Título" required><Input value={titulo} maxLength={80} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Saludo inicial" /></Field>
          </div>
          <Field label="Carpeta" hint="Agrupa respuestas similares. Escribe una nueva o elige una existente.">
            <Input icono={<Folder className="h-4 w-4" />} value={carpeta} maxLength={40} list="carpetas-respuestas" onChange={(e) => setCarpeta(e.target.value)} placeholder="Sin carpeta" />
            <datalist id="carpetas-respuestas">{carpetas.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Mensaje" required>
            <div className="rounded-lg border border-ink-200 shadow-xs transition-colors focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
              <Textarea ref={ta} value={contenido} maxLength={4000} onChange={(e) => setContenido(e.target.value)} rows={6}
                placeholder="Hola {nombre}, gracias por escribirnos…" className="rounded-b-none border-0 shadow-none focus:ring-0" />
              <div className="flex flex-wrap items-center gap-1 rounded-b-lg border-t border-ink-100 bg-ink-50/70 px-2 py-1.5">
                <Braces className="mr-0.5 h-3.5 w-3.5 text-ink-400" />
                {VARIABLES.map((x) => (
                  <button key={x.v} type="button" onClick={() => insertar(x.v)}
                    className="rounded-md border border-ink-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink-600 transition-colors hover:border-brand-300 hover:text-brand-700">{x.label}</button>
                ))}
                {camposContacto.map((c) => (
                  <button key={c.campo_id} type="button" onClick={() => insertar(`{campo.${c.clave}}`)} title={`{campo.${c.clave}}`}
                    className="rounded-md border border-dashed border-ink-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink-600 transition-colors hover:border-brand-300 hover:text-brand-700">{c.nombre}</button>
                ))}
                <span className="ml-auto text-[11px] tabular-nums text-ink-400">{contenido.length}/4000</span>
              </div>
            </div>
          </Field>
          <Field label="Visible para">
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: 'todos', t: 'Todo el equipo', d: 'Cualquier agente puede usarla', i: Globe },
                { v: 'solo_yo', t: 'Solo yo', d: 'Respuesta personal', i: UserRound },
              ] as const).map((o) => {
                const bloqueado = o.v === 'todos' && !esSupervisor;
                return (
                  <button key={o.v} type="button" disabled={bloqueado} onClick={() => setVisible(o.v)}
                    className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50',
                      visible === o.v ? 'border-brand-400 bg-brand-50/60 ring-4 ring-brand-500/10' : 'border-ink-200 hover:bg-ink-50')}>
                    <o.i className={cn('h-4 w-4', visible === o.v ? 'text-brand-600' : 'text-ink-400')} />
                    <span><span className="block text-[13px] font-medium text-ink-800">{o.t}</span><span className="block text-[11px] text-ink-500">{bloqueado ? 'Requiere rol supervisor' : o.d}</span></span>
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        {/* Vista previa tipo chat */}
        <div>
          <p className="label">Vista previa</p>
          <div className="overflow-hidden rounded-xl border border-ink-200">
            <div className="flex items-center gap-2 border-b border-ink-200 bg-white px-3 py-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pink-500 text-[11px] font-semibold text-white">MF</span>
              <div><p className="text-xs font-semibold text-ink-800">María Fernández</p><p className="text-[10px] text-ink-400">Datos de ejemplo</p></div>
            </div>
            <div className="min-h-[220px] space-y-2 bg-[#efeae2] p-3" style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,.04) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
              <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 text-[13px] text-ink-800 shadow-xs">Hola, quería información 🙂</div>
              {previa.trim() ? (
                <div className="ml-auto max-w-[88%] animate-pop-in whitespace-pre-wrap break-words rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 text-[13px] leading-relaxed text-ink-800 shadow-xs">
                  {previa}
                  <span className="ml-2 inline-block translate-y-0.5 text-[10px] text-ink-400">12:30 ✓✓</span>
                </div>
              ) : <p className="pt-6 text-center text-xs text-ink-400">Escribe el mensaje para verlo aquí</p>}
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">Las variables se reemplazan con los datos reales del contacto al enviar.</p>
        </div>
      </div>
    </Modal>
  );
}
