'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-store';
import { useMe } from '@/hooks/datos';
import { RealtimeBridge } from '@/hooks/realtime';
import { Sidebar } from '@/components/layout/sidebar';
import { Cargando } from '@/components/ui';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  // Evita parpadeo mientras zustand-persist rehidrata el token desde localStorage
  const [hidratado, setHidratado] = useState(false);

  useEffect(() => { setHidratado(true); }, []);
  useEffect(() => { if (hidratado && !token) router.replace('/login'); }, [hidratado, token, router]);
  useEffect(() => {
    if (me.data && !me.data.empresa && !pathname.startsWith('/admin') && !pathname.startsWith('/perfil')) {
      router.replace(me.data.usuario.es_superadmin ? '/admin' : '/perfil');
    }
  }, [me.data, pathname, router]);

  if (!hidratado || !token || me.isLoading) {
    return <div className="flex h-screen items-center justify-center"><Cargando texto="Preparando tu espacio…" /></div>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <RealtimeBridge />
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
