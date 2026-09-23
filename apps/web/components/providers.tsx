'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { ConfirmHost } from '@/components/ui';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, refetchOnWindowFocus: false,
        retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      },
    },
  }));
  return (
    <QueryClientProvider client={qc}>
      {children}
      <ConfirmHost />
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { fontFamily: 'inherit' } }} />
    </QueryClientProvider>
  );
}
