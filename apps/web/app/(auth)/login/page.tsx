'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { Button, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const setToken = useAuth((s) => s.setToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      const r = await api.post<{ token: string }>('/auth/login', { email, password });
      setToken(r.token);
      router.replace('/inicio');
    } catch (err) {
      setError((err as Error).message);
    } finally { setCargando(false); }
  }

  return (
    <div>
      <div className="mb-8 lg:hidden"><span className="text-xl font-semibold">Kallpa CRM</span></div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Ingresa a tu cuenta</h1>
      <p className="mt-1.5 text-sm text-ink-500">Bienvenido de vuelta. Continúa donde lo dejaste.</p>
      <form onSubmit={enviar} className="mt-8 space-y-4">
        <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" icono={<Mail className="h-4 w-4" />} /></Field>
        <Field label="Contraseña"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" icono={<Lock className="h-4 w-4" />} /></Field>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <Button type="submit" tamano="lg" className="w-full" cargando={cargando}>Ingresar</Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-500">¿Aún no tienes cuenta? <Link href="/registro" className="font-medium text-brand-600 hover:text-brand-700">Crea tu empresa gratis</Link></p>
      <div className="mt-10 rounded-xl border border-dashed border-ink-200 bg-ink-50/70 p-3 text-xs text-ink-500">
        <p className="font-medium text-ink-700">Entorno local de demostración</p>
        <p className="mt-0.5">admin@demo.com · ana@demo.com · luis@demo.com — contraseña <span className="font-mono">admin123</span></p>
      </div>
    </div>
  );
}
