'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import type { Campo, CanalCuenta, Etiqueta, Me, Miembro, Pipeline, RespuestaRapida, Rol } from '@/lib/types';

export function useMe() {
  const token = useAuth((s) => s.token);
  return useQuery({ queryKey: ['me', token], queryFn: () => api.get<{ ok: true } & Me>('/auth/me'), enabled: !!token, staleTime: 60_000 });
}

const NIVEL: Record<Rol, number> = { agente: 1, supervisor: 2, admin: 3, propietario: 4 };
export function usePuede(minimo: Rol): boolean {
  const { data } = useMe();
  return !!data?.rol && NIVEL[data.rol] >= NIVEL[minimo];
}

export const useEtiquetas = () => useQuery({ queryKey: ['etiquetas'], queryFn: () => api.get<{ etiquetas: Etiqueta[] }>('/etiquetas'), select: (d) => d.etiquetas });
export const useCampos = () => useQuery({ queryKey: ['campos'], queryFn: () => api.get<{ campos: Campo[] }>('/campos'), select: (d) => d.campos });
export const usePipelines = () => useQuery({ queryKey: ['pipelines'], queryFn: () => api.get<{ pipelines: Pipeline[] }>('/pipelines'), select: (d) => d.pipelines });
export const useMiembros = () => useQuery({ queryKey: ['equipo'], queryFn: () => api.get<{ miembros: Miembro[]; invitaciones: Array<{ invitacion_id: number; email: string; rol: Rol; enlace: string; expira_en: string; invitado_por_nombre: string | null }> }>('/equipo') });
export const useRespuestas = () => useQuery({ queryKey: ['respuestas'], queryFn: () => api.get<{ respuestas: RespuestaRapida[] }>('/respuestas'), select: (d) => d.respuestas });
export const useCanales = () => useQuery({
  queryKey: ['canales'],
  queryFn: () => api.get<{ canales: CanalCuenta[]; plataforma: { meta_configurada: boolean; meta_app_id: string | null; meta_config_id: string | null; meta_api_version: string; tiktok_configurada: boolean; webhook_meta: string; webhook_tiktok: string; verify_token: string } }>('/canales'),
});
