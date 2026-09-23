'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Eye, EyeOff, KeyRound, ShieldCheck, UserCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMe } from '@/hooks/datos';
import { Avatar, Button, Cargando, ColorPicker, Field, Input, PageHeader } from '@/components/ui';

const ROL: Record<string, { label: string; clase: string }> = {
  propietario: { label: 'Propietario', clase: 'bg-amber-50 text-amber-700' },
  admin: { label: 'Administrador', clase: 'bg-brand-50 text-brand-700' },
  supervisor: { label: 'Supervisor', clase: 'bg-sky-50 text-sky-700' },
  agente: { label: 'Agente', clase: 'bg-ink-100 text-ink-600' },
};

export default function PerfilPage() {
  const { data: me, isLoading } = useMe();
  const qc = useQueryClient();
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [guardando, setGuardando] = useState(false);
  const [pw, setPw] = useState({ actual: '', nueva: '', repetir: '' });
  const [verPw, setVerPw] = useState(false);
  const [cambiando, setCambiando] = useState(false);

  useEffect(() => { if (me) { setNombre(me.usuario.nombre); setColor(me.usuario.color); } }, [me]);

  if (isLoading || !me) return <Cargando />;
  const cambiosPerfil = nombre.trim() !== me.usuario.nombre || color !== me.usuario.color;

  async function guardarPerfil(e?: React.FormEvent) {
    e?.preventDefault();
    if (nombre.trim().length < 2) { toast.error('El nombre debe tener al menos 2 caracteres'); return; }
    setGuardando(true);
    try {
      await api.patch('/auth/perfil', { nombre: nombre.trim(), color });
      toast.success('Perfil actualizado');
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['equipo'] });
    } catch (err) { toast.error((err as Error).message); } finally { setGuardando(false); }
  }

  const errorPw = pw.nueva && pw.nueva.length < 6 ? 'Mínimo 6 caracteres' : pw.repetir && pw.repetir !== pw.nueva ? 'Las contraseñas no coinciden' : null;
  const pwValido = pw.actual && pw.nueva.length >= 6 && pw.nueva === pw.repetir;

  async function cambiarPassword(e?: React.FormEvent) {
    e?.preventDefault();
    if (!pwValido) return;
    setCambiando(true);
    try {
      await api.patch('/auth/perfil', { password_actual: pw.actual, password_nueva: pw.nueva });
      toast.success('Contraseña actualizada');
      setPw({ actual: '', nueva: '', repetir: '' });
    } catch (err) { toast.error((err as Error).message); } finally { setCambiando(false); }
  }

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <PageHeader icono={<UserCircle2 className="h-5 w-5" />} titulo="Mi perfil" descripcion="Tu información personal y seguridad de la cuenta" />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        {!me.empresa && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] text-sky-800">Aún no perteneces a ninguna empresa. Pide a un administrador que te invite o crea una nueva desde el menú de empresa.</div>
        )}

        {/* Datos personales */}
        <form onSubmit={guardarPerfil} className="card">
          <div className="border-b border-ink-100 px-5 py-4">
            <h2 className="text-[15px] font-semibold text-ink-900">Datos personales</h2>
            <p className="text-xs text-ink-500">Así te ve tu equipo en conversaciones, asignaciones y el chat interno.</p>
          </div>
          <div className="flex flex-col gap-6 p-5 sm:flex-row">
            <div className="flex flex-col items-center gap-2 sm:w-40">
              <Avatar nombre={nombre || me.usuario.nombre} color={color} size={88} className="shadow-lift ring-4 ring-white" />
              <p className="text-center text-xs text-ink-500">{me.usuario.email}</p>
              {me.usuario.es_superadmin && <span className="chip bg-violet-100 text-violet-700"><ShieldCheck className="h-3 w-3" />Superadmin</span>}
            </div>
            <div className="flex-1 space-y-5">
              <Field label="Nombre completo" required><Input value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} /></Field>
              <Field label="Correo" hint="El correo no se puede cambiar."><Input value={me.usuario.email} disabled /></Field>
              <Field label="Color de avatar"><ColorPicker value={color} onChange={setColor} /></Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 rounded-b-xl border-t border-ink-100 bg-ink-50/60 px-5 py-3">
            {cambiosPerfil && <Button variante="fantasma" onClick={() => { setNombre(me.usuario.nombre); setColor(me.usuario.color); }}>Descartar</Button>}
            <Button type="submit" cargando={guardando} disabled={!cambiosPerfil}>Guardar cambios</Button>
          </div>
        </form>

        {/* Contraseña */}
        <form onSubmit={cambiarPassword} className="card">
          <div className="flex items-center gap-3 border-b border-ink-100 px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-ink-600"><KeyRound className="h-4 w-4" /></span>
            <div><h2 className="text-[15px] font-semibold text-ink-900">Cambiar contraseña</h2><p className="text-xs text-ink-500">Usa al menos 6 caracteres. Te recomendamos combinar letras y números.</p></div>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Contraseña actual"><Input type={verPw ? 'text' : 'password'} autoComplete="current-password" value={pw.actual} onChange={(e) => setPw({ ...pw, actual: e.target.value })} /></Field>
            <Field label="Nueva contraseña"><Input type={verPw ? 'text' : 'password'} autoComplete="new-password" value={pw.nueva} onChange={(e) => setPw({ ...pw, nueva: e.target.value })} /></Field>
            <Field label="Repetir nueva" error={errorPw}><Input type={verPw ? 'text' : 'password'} autoComplete="new-password" value={pw.repetir} onChange={(e) => setPw({ ...pw, repetir: e.target.value })} /></Field>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-b-xl border-t border-ink-100 bg-ink-50/60 px-5 py-3">
            <button type="button" onClick={() => setVerPw((v) => !v)} className="inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-ink-800">
              {verPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{verPw ? 'Ocultar' : 'Mostrar'} contraseñas
            </button>
            <Button type="submit" cargando={cambiando} disabled={!pwValido}>Actualizar contraseña</Button>
          </div>
        </form>

        {/* Empresas */}
        <div className="card">
          <div className="border-b border-ink-100 px-5 py-4">
            <h2 className="text-[15px] font-semibold text-ink-900">Mis empresas</h2>
            <p className="text-xs text-ink-500">Espacios de trabajo a los que perteneces y tu rol en cada uno.</p>
          </div>
          {me.empresas.length ? (
            <ul className="divide-y divide-ink-100">
              {me.empresas.map((e) => {
                const actual = e.empresa_id === me.empresa?.empresa_id;
                const r = ROL[e.rol] ?? ROL.agente;
                return (
                  <li key={e.empresa_id} className="flex items-center gap-3 px-5 py-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold text-white">{e.nombre[0]?.toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-[13px] font-semibold text-ink-900">{e.nombre}{actual && <span className="chip bg-emerald-50 text-emerald-700"><Check className="h-3 w-3" />Actual</span>}</p>
                      <p className="text-xs text-ink-500">Plan {e.plan.charAt(0).toUpperCase() + e.plan.slice(1)} · {e.slug}</p>
                    </div>
                    <span className={cn('rounded-md px-2 py-1 text-xs font-medium', r.clase)}>{r.label}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex items-center gap-3 px-5 py-6 text-sm text-ink-500"><Building2 className="h-4 w-4" />No perteneces a ninguna empresa todavía.</div>
          )}
        </div>
      </div>
    </div>
  );
}
