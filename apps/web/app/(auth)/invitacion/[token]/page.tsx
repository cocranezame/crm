'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { Button, Cargando, Field, Input } from '@/components/ui';

const ROL: Record<string, string> = { admin: 'Administrador', supervisor: 'Supervisor', agente: 'Agente' };

export default function InvitacionPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const setToken = useAuth((s) => s.setToken);
  const q = useQuery({ queryKey: ['invitacion', token], queryFn: () => api.get<{ invitacion: { email: string; rol: string; empresa: string; usuario_existe: boolean } }>(`/auth/invitacion/${token}`), retry: false });
  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  if (q.isLoading) return <Cargando />;
  if (q.error) return (
    <div className="text-center">
      <h1 className="text-xl font-semibold text-ink-900">Invitación no disponible</h1>
      <p className="mt-2 text-sm text-ink-500">{(q.error as Error).message}</p>
      <Button className="mt-6" variante="secundario" onClick={() => router.push('/login')}>Ir al inicio de sesión</Button>
    </div>
  );
  const inv = q.data!.invitacion;

  async function aceptar(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      const r = await api.post<{ token: string }>(`/auth/invitacion/${token}/aceptar`, { nombre: inv.usuario_existe ? undefined : nombre, password });
      setToken(r.token);
      router.replace('/inbox');
    } catch (err) { setError((err as Error).message); } finally { setCargando(false); }
  }

  return (
    <div>
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><MailCheck className="h-6 w-6" /></div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Únete a {inv.empresa}</h1>
      <p className="mt-1.5 text-sm text-ink-500">Te invitaron como <b className="text-ink-700">{ROL[inv.rol] ?? inv.rol}</b> con el email <b className="text-ink-700">{inv.email}</b>.</p>
      <form onSubmit={aceptar} className="mt-8 space-y-4">
        {!inv.usuario_existe && <Field label="Tu nombre" required><Input required value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>}
        <Field label={inv.usuario_existe ? 'Tu contraseña actual' : 'Crea una contraseña'} hint={inv.usuario_existe ? 'Ya tienes cuenta: la empresa se agregará a tu usuario.' : 'Mínimo 6 caracteres'} required>
          <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <Button type="submit" tamano="lg" className="w-full" cargando={cargando}>Aceptar invitación</Button>
      </form>
    </div>
  );
}
