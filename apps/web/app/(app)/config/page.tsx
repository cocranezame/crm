'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Cargando } from '@/components/ui';

export default function ConfigIndex() {
  const router = useRouter();
  useEffect(() => { router.replace('/config/pipelines'); }, [router]);
  return <Cargando />;
}
