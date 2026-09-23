'use client';
import { useAuth } from './auth-store';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(metodo: Metodo, ruta: string, body?: unknown): Promise<T> {
  const token = useAuth.getState().token;
  const esForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${ruta}`, {
      method: metodo,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined && !esForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : esForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. ¿Está corriendo el API?');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) {
      useAuth.getState().salir();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    throw new ApiError(res.status, json?.error ?? `Error ${res.status}`, json?.code);
  }
  return json as T;
}

export const api = {
  get: <T>(r: string) => request<T>('GET', r),
  post: <T>(r: string, b?: unknown) => request<T>('POST', r, b ?? {}),
  patch: <T>(r: string, b?: unknown) => request<T>('PATCH', r, b ?? {}),
  put: <T>(r: string, b?: unknown) => request<T>('PUT', r, b ?? {}),
  del: <T>(r: string) => request<T>('DELETE', r),
  subir: (archivo: File) => {
    const fd = new FormData();
    fd.append('archivo', archivo);
    return request<{ ok: true; archivo: Archivo }>('POST', '/archivos', fd);
  },
};

export interface Archivo { key: string; url: string; mime: string; nombre: string; tipo: 'imagen' | 'video' | 'audio' | 'documento'; tamano: number }

/** Construye querystring ignorando vacíos. */
export function qs(p: Record<string, string | number | boolean | null | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v));
  const r = s.toString();
  return r ? `?${r}` : '';
}

/** Descarga autenticada (CSV de contactos). */
export async function descargar(ruta: string, nombre: string) {
  const token = useAuth.getState().token;
  const r = await fetch(`${API_URL}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new ApiError(r.status, 'No se pudo descargar');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}
