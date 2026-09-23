'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Copy, Crown, Eye, Headset, Link2, Lock, Mail, MoreHorizontal, Power, PowerOff, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { cn, fecha, hace } from '@/lib/utils';
import type { Miembro, Rol } from '@/lib/types';
import { useMe, useMiembros, usePuede } from '@/hooks/datos';
import { Avatar, Button, Field, Input, Menu, Modal, PageHeader, Select, Skeleton, Vacio, confirmar } from '@/components/ui';

const ROLES: Record<Rol, { label: string; desc: string; icono: React.ComponentType<{ className?: string }>; clase: string }> = {
  propietario: { label: 'Propietario', desc: 'Control total, incluida la facturación y otros propietarios.', icono: Crown, clase: 'bg-amber-50 text-amber-700' },
  admin: { label: 'Administrador', desc: 'Configura canales, pipelines, campos y gestiona al equipo.', icono: ShieldCheck, clase: 'bg-brand-50 text-brand-700' },
  supervisor: { label: 'Supervisor', desc: 'Ve todas las conversaciones, reasigna, gestiona etiquetas, respuestas y difusiones.', icono: Eye, clase: 'bg-sky-50 text-sky-700' },
  agente: { label: 'Agente', desc: 'Atiende sus conversaciones asignadas y la cola sin asignar.', icono: Headset, clase: 'bg-ink-100 text-ink-600' },
};

function error402(e: unknown) {
  if (e instanceof ApiError && e.status === 402) toast.error(e.message, { description: 'Mejora tu plan para agregar más usuarios.' });
  else toast.error((e as Error).message);
}

function useCopiar() {
  const [copiado, setCopiado] = useState<string | null>(null);
  return {
    copiado,
    copiar: async (t: string) => {
      try { await navigator.clipboard.writeText(t); setCopiado(t); toast.success('Enlace copiado'); setTimeout(() => setCopiado(null), 1500); }
      catch { toast.error('No se pudo copiar'); }
    },
  };
}

export default function EquipoPage() {
  const { data, isLoading } = useMiembros();
  const { data: me } = useMe();
  const esAdmin = usePuede('admin');
  const qc = useQueryClient();
  const [invitar, setInvitar] = useState(false);
  const { copiado, copiar } = useCopiar();
  const miembros = data?.miembros ?? [];
  const invitaciones = data?.invitaciones ?? [];
  const plan = me?.plan;
  const yo = me?.usuario.usuario_id;
  const soyPropietario = me?.rol === 'propietario';

  async function patch(m: Miembro, d: { rol?: Rol; activo?: boolean }, msg: string) {
    try {
      await api.patch(`/equipo/${m.usuario_id}`, d);
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ['equipo'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) { error402(e); }
  }

  async function desactivar(m: Miembro) {
    const ok = await confirmar({ titulo: `¿Desactivar a ${m.nombre}?`, texto: <>No podrá iniciar sesión en esta empresa y sus <b>{m.conversaciones_abiertas} conversación(es) abiertas</b> volverán a la cola sin asignar.</>, confirmar: 'Desactivar', peligro: true });
    if (ok) patch(m, { activo: false }, `${m.nombre} fue desactivado`);
  }

  async function revocar(id: number, email: string) {
    const ok = await confirmar({ titulo: 'Revocar invitación', texto: `El enlace enviado a ${email} dejará de funcionar.`, confirmar: 'Revocar', peligro: true });
    if (!ok) return;
    try { await api.del(`/equipo/invitaciones/${id}`); toast.success('Invitación revocada'); qc.invalidateQueries({ queryKey: ['equipo'] }); }
    catch (e) { toast.error((e as Error).message); }
  }

  const pct = plan ? Math.min(100, Math.round((plan.uso.usuarios / plan.usuarios) * 100)) : 0;

  return (
    <div>
      <PageHeader icono={<Users className="h-5 w-5" />} titulo="Equipo" descripcion="Invita a tu equipo y define qué puede hacer cada persona"
        acciones={esAdmin && <Button icono={<UserPlus className="h-4 w-4" />} onClick={() => setInvitar(true)}>Invitar miembro</Button>} />
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        {!esAdmin && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-2.5 text-[13px] text-amber-800">
            <Lock className="h-4 w-4 shrink-0 text-amber-500" />Solo los administradores pueden invitar miembros o cambiar roles.
          </div>
        )}

        {plan && (
          <div className="card flex flex-wrap items-center gap-5 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Users className="h-5 w-5" /></span>
              <div>
                <p className="text-[13px] font-medium text-ink-500">Usuarios del plan {plan.nombre}</p>
                <p className="text-xl font-semibold tracking-tight text-ink-900">{plan.uso.usuarios} <span className="text-sm font-normal text-ink-400">de {plan.usuarios}</span></p>
              </div>
            </div>
            <div className="min-w-[200px] flex-1">
              <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                <div className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-ink-500">{pct >= 100 ? 'Alcanzaste el límite. Mejora tu plan para invitar a más personas.' : `Puedes sumar ${plan.usuarios - plan.uso.usuarios} usuario(s) más. Las invitaciones pendientes también cuentan.`}</p>
            </div>
          </div>
        )}

        {/* Miembros */}
        <div className="card overflow-hidden">
          {isLoading ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            : !miembros.length ? <Vacio icono={<Users className="h-5 w-5" />} titulo="Sin miembros" />
              : (
                <table className="w-full text-sm">
                  <thead className="border-b border-ink-100 bg-ink-50/60">
                    <tr><th className="th">Miembro</th><th className="th">Rol</th><th className="th">Estado</th><th className="th text-right">Conv. abiertas</th><th className="th">Último acceso</th><th className="th w-12" /></tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {miembros.map((m) => {
                      const R = ROLES[m.rol];
                      const esYo = m.usuario_id === yo;
                      const editable = esAdmin && !esYo && (m.rol !== 'propietario' || soyPropietario);
                      return (
                        <tr key={m.usuario_id} className={cn('transition-colors hover:bg-ink-50/50', !m.activo && 'bg-ink-50/40')}>
                          <td className="td">
                            <div className={cn('flex items-center gap-3', !m.activo && 'opacity-60')}>
                              <Avatar nombre={m.nombre} color={m.color} size={34} />
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-semibold text-ink-900">{m.nombre}{esYo && <span className="ml-1.5 rounded bg-ink-100 px-1.5 py-px text-[10px] font-medium text-ink-500">Tú</span>}</p>
                                <p className="truncate text-xs text-ink-500">{m.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="td">
                            {editable ? (
                              <div className="w-40">
                                <Select value={m.rol} onChange={(e) => patch(m, { rol: e.target.value as Rol }, `Rol actualizado a ${ROLES[e.target.value as Rol].label}`)} className="h-8 py-1 text-[13px]">
                                  {(Object.keys(ROLES) as Rol[]).filter((r) => r !== 'propietario' || soyPropietario).map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
                                </Select>
                              </div>
                            ) : <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium', R.clase)}><R.icono className="h-3.5 w-3.5" />{R.label}</span>}
                          </td>
                          <td className="td">
                            {m.activo ? <span className="chip bg-emerald-50 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Activo</span>
                              : <span className="chip bg-ink-100 text-ink-500">Inactivo</span>}
                          </td>
                          <td className="td text-right tabular-nums"><span className={m.conversaciones_abiertas ? 'font-semibold text-ink-800' : 'text-ink-400'}>{m.conversaciones_abiertas}</span></td>
                          <td className="td text-[13px] text-ink-500">{m.ultimo_acceso ? <span title={fecha(m.ultimo_acceso)}>hace {hace(m.ultimo_acceso)}</span> : <span className="text-ink-400">Nunca</span>}</td>
                          <td className="td text-right">
                            {editable && (
                              <Menu trigger={<button className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><MoreHorizontal className="h-4 w-4" /></button>}
                                items={m.activo
                                  ? [{ label: 'Desactivar acceso', icono: <PowerOff className="h-3.5 w-3.5" />, peligro: true, onClick: () => desactivar(m) }]
                                  : [{ label: 'Reactivar acceso', icono: <Power className="h-3.5 w-3.5" />, onClick: () => patch(m, { activo: true }, `${m.nombre} fue reactivado`) }]} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
        </div>

        {/* Invitaciones pendientes */}
        {esAdmin && (
          <section>
            <div className="mb-3 flex items-end justify-between">
              <h2 className="text-[15px] font-semibold text-ink-900">Invitaciones pendientes</h2>
              <p className="text-[13px] text-ink-500">Vencen a los 7 días</p>
            </div>
            <div className="card overflow-hidden">
              {!invitaciones.length ? (
                <Vacio className="py-10" icono={<Mail className="h-5 w-5" />} titulo="No hay invitaciones pendientes" texto="Invita a alguien y comparte el enlace para que se una."
                  accion={<Button variante="suave" icono={<UserPlus className="h-4 w-4" />} onClick={() => setInvitar(true)}>Invitar miembro</Button>} />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {invitaciones.map((i) => {
                    const R = ROLES[i.rol];
                    return (
                      <li key={i.invitacion_id} className="flex flex-wrap items-center gap-4 px-4 py-3 transition-colors hover:bg-ink-50/50">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-ink-300 text-ink-400"><Mail className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-ink-900">{i.email}</p>
                          <p className="flex items-center gap-1 text-xs text-ink-500"><Clock className="h-3 w-3" />Vence el {fecha(i.expira_en)}{i.invitado_por_nombre && ` · invitado por ${i.invitado_por_nombre}`}</p>
                        </div>
                        <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium', R.clase)}><R.icono className="h-3.5 w-3.5" />{R.label}</span>
                        <Button tamano="sm" variante="secundario" icono={copiado === i.enlace ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5" />} onClick={() => copiar(i.enlace)}>Copiar enlace</Button>
                        <button onClick={() => revocar(i.invitacion_id, i.email)} title="Revocar" className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Referencia de roles */}
        <section>
          <h2 className="mb-3 text-[15px] font-semibold text-ink-900">Qué puede hacer cada rol</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(ROLES) as Rol[]).map((r) => {
              const R = ROLES[r];
              return (
                <div key={r} className="card p-4">
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', R.clase)}><R.icono className="h-4 w-4" /></span>
                  <p className="mt-2.5 text-[13px] font-semibold text-ink-900">{R.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{R.desc}</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      {invitar && <ModalInvitar onClose={() => setInvitar(false)} />}
    </div>
  );
}

function ModalInvitar({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<Exclude<Rol, 'propietario'>>('agente');
  const [g, setG] = useState(false);
  const [enlace, setEnlace] = useState<string | null>(null);
  const { copiado, copiar } = useCopiar();
  const valido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function enviar(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valido) return;
    setG(true);
    try {
      const r = await api.post<{ invitacion: { enlace: string } }>('/equipo/invitaciones', { email: email.trim(), rol });
      setEnlace(r.invitacion.enlace);
      toast.success('Invitación creada');
      qc.invalidateQueries({ queryKey: ['equipo'] });
    } catch (err) { error402(err); } finally { setG(false); }
  }

  if (enlace) {
    return (
      <Modal abierto onClose={onClose} titulo="Invitación lista" descripcion={`Comparte este enlace con ${email}. Vence en 7 días.`}
        pie={<><Button variante="secundario" onClick={() => { setEnlace(null); setEmail(''); }}>Invitar a otra persona</Button><Button onClick={onClose}>Listo</Button></>}>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-4 w-4" /></span>
            <p>En este entorno no se envían correos: copia el enlace y envíaselo por WhatsApp, Slack o email.</p>
          </div>
          <div className="rounded-xl border-2 border-dashed border-brand-200 bg-brand-50/40 p-4">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-brand-600">Enlace de invitación</p>
            <code className="block break-all rounded-lg bg-white px-3 py-2.5 font-mono text-[12.5px] text-ink-700 ring-1 ring-ink-200">{enlace}</code>
            <Button className="mt-3 w-full" tamano="lg" icono={copiado === enlace ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} onClick={() => copiar(enlace)}>
              {copiado === enlace ? 'Copiado' : 'Copiar enlace'}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal abierto onClose={onClose} titulo="Invitar miembro" descripcion="Recibirá un enlace para crear su cuenta o unirse con la que ya tiene."
      pie={<><Button variante="secundario" onClick={onClose}>Cancelar</Button><Button cargando={g} disabled={!valido} onClick={() => enviar()} icono={<UserPlus className="h-4 w-4" />}>Crear invitación</Button></>}>
      <form onSubmit={enviar} className="space-y-5">
        <Field label="Correo electrónico" required><Input autoFocus type="email" icono={<Mail className="h-4 w-4" />} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.pe" /></Field>
        <Field label="Rol">
          <div className="space-y-2">
            {(['admin', 'supervisor', 'agente'] as const).map((r) => {
              const R = ROLES[r];
              return (
                <label key={r} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-all',
                  rol === r ? 'border-brand-400 bg-brand-50/50 ring-4 ring-brand-500/10' : 'border-ink-200 hover:bg-ink-50')}>
                  <input type="radio" name="rol" checked={rol === r} onChange={() => setRol(r)} className="mt-1 accent-brand-600" />
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', R.clase)}><R.icono className="h-4 w-4" /></span>
                  <span><span className="block text-[13px] font-semibold text-ink-900">{R.label}</span><span className="block text-xs leading-relaxed text-ink-500">{R.desc}</span></span>
                </label>
              );
            })}
          </div>
        </Field>
      </form>
    </Modal>
  );
}
