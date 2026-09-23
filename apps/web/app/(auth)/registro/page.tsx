'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { Button, Field, Input } from '@/components/ui';

export default function RegistroPage() {
  const router = useRouter();
  const setToken = useAuth((s) => s.setToken);
  const [f, setF] = useState({ empresa_nombre: '', nombre: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      const r = await api.post<{ token: string }>('/auth/registro', f);
      setToken(r.token);
      router.replace('/inicio?bienvenida=1');
    } catch (err) { setError((err as Error).message); } finally { setCargando(false); }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Crea tu empresa</h1>
      <p className="mt-1.5 text-sm text-ink-500">14 días de prueba. Te dejamos un pipeline, etiquetas y respuestas listas para empezar.</p>
      <form onSubmit={enviar} className="mt-8 space-y-4">
        <Field label="Nombre de tu negocio" required><Input required value={f.empresa_nombre} onChange={set('empresa_nombre')} placeholder="Ferretería El Maestro" /></Field>
        <Field label="Tu nombre" required><Input required value={f.nombre} onChange={set('nombre')} placeholder="Nombre y apellido" /></Field>
        <Field label="Email" required><Input type="email" required value={f.email} onChange={set('email')} placeholder="tu@empresa.com" /></Field>
        <Field label="Contraseña" required hint="Mínimo 6 caracteres"><Input type="password" required minLength={6} value={f.password} onChange={set('password')} /></Field>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <Button type="submit" tamano="lg" className="w-full" cargando={cargando}>Crear empresa</Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-500">¿Ya tienes cuenta? <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">Ingresa</Link></p>
    </div>
  );
}
