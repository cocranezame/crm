'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, Cargando } from '@/components/ui';
import { IconoCanal } from '@/components/crm/canal';

export default function TiktokCallbackPage() {
  return <Suspense fallback={<Cargando />}><Callback /></Suspense>;
}

function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const enviado = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (enviado.current) return;
    enviado.current = true;
    const code = params.get('code');
    const state = params.get('state');
    const errTiktok = params.get('error_description') || params.get('error');
    if (errTiktok) { setError(errTiktok === 'access_denied' ? 'Cancelaste la autorización en TikTok.' : `TikTok devolvió un error: ${errTiktok}`); return; }
    if (!code || !state) { setError('Faltan parámetros de autorización. Vuelve a iniciar la conexión desde Canales.'); return; }
    api.post('/canales/tiktok/callback', { code, state })
      .then(() => {
        toast.success('Cuenta de TikTok conectada');
        qc.invalidateQueries({ queryKey: ['canales'] });
        qc.invalidateQueries({ queryKey: ['me'] });
        router.replace('/config/canales');
      })
      .catch((e) => setError((e as Error).message));
  }, [params, router, qc]);

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-900 text-white shadow-xs">
          <IconoCanal canal="tiktok" size={28} />
          {error && <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 ring-4 ring-white"><TriangleAlert className="h-3.5 w-3.5" /></span>}
        </div>
        {error ? (
          <>
            <h1 className="mt-5 text-lg font-semibold text-ink-900">No se pudo conectar TikTok</h1>
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            <Link href="/config/canales"><Button className="mt-6" variante="secundario" icono={<ArrowLeft className="h-4 w-4" />}>Volver a Canales</Button></Link>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-lg font-semibold text-ink-900">Conectando tu cuenta de TikTok…</h1>
            <p className="mt-1.5 text-sm text-ink-500">Estamos validando la autorización. No cierres esta ventana.</p>
            <Loader2 className="mx-auto mt-6 h-6 w-6 animate-spin text-ink-400" />
          </>
        )}
      </div>
    </div>
  );
}
