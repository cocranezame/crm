'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-store';
import { useMe, ventanaPermitida } from '@/hooks/datos';
import { RealtimeBridge } from '@/hooks/realtime';
import { Sidebar } from '@/components/layout/sidebar';
import { Lock } from 'lucide-react';
import { Button, Cargando, Vacio } from '@/components/ui';

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
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {ventanaPermitida(me.data, pathname) ? children : (
          <div className="flex flex-1 items-center justify-center">
            <Vacio icono={<Lock className="h-5 w-5" />} titulo="Esta sección no está incluida en tu plan"
              texto="Pide a Kallpasoft que active el módulo para tu empresa y aparecerá en el menú."
              accion={<Button variante="secundario" onClick={() => router.push('/inicio')}>Ir al inicio</Button>} />
          </div>
        )}
      </main>
    </div>
  );
}
