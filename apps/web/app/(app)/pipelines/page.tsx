'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { KanbanSquare } from 'lucide-react';
import { usePipelines } from '@/hooks/datos';
import { Button, Cargando, Vacio } from '@/components/ui';

export default function PipelinesIndex() {
  const router = useRouter();
  const { data, isLoading } = usePipelines();
  useEffect(() => {
    const p = data?.find((x) => x.es_entrada && x.activo) ?? data?.find((x) => x.activo);
    if (p) router.replace(`/pipelines/${p.pipeline_id}`);
  }, [data, router]);
  if (isLoading || data?.some((p) => p.activo)) return <Cargando />;
  return <Vacio icono={<KanbanSquare />} titulo="Aún no hay tableros Kanban" texto="Crea tu primer tablero para organizar tus oportunidades de venta."
    accion={<Button onClick={() => router.push('/config/pipelines')}>Crear tablero</Button>} />;
}
