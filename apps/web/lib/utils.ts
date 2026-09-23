import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNowStrict, format, isToday, isYesterday, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function iniciales(nombre?: string | null): string {
  if (!nombre) return '?';
  const p = nombre.replace(/[@._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : p[0]?.[1] ?? '')).toUpperCase() || '?';
}

const COLORES_AVATAR = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b'];
export function colorDe(seed: string | number | null | undefined): string {
  const s = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORES_AVATAR[h % COLORES_AVATAR.length];
}

export function moneda(v: number | null | undefined, sinDecimales = false): string {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: sinDecimales ? 0 : 2, minimumFractionDigits: sinDecimales ? 0 : 2 }).format(v);
}

export function numero(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : new Intl.NumberFormat('es-PE').format(v);
}

export function hace(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 45) return 'ahora';
  return formatDistanceToNowStrict(d, { locale: es, addSuffix: false })
    .replace(' segundos', ' s').replace(' minutos', ' min').replace(' minuto', ' min')
    .replace(' horas', ' h').replace(' hora', ' h').replace(' días', ' d').replace(' día', ' d')
    .replace(' meses', ' m').replace(' mes', ' m').replace(' años', ' a').replace(' año', ' a');
}

/** Hora corta para listas: 14:05 · Ayer · lun · 12/09 */
export function horaLista(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Ayer';
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, 'EEE', { locale: es });
  return format(d, 'dd/MM/yy');
}

export function fechaHora(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return format(new Date(iso), "d MMM yyyy, HH:mm", { locale: es });
}

export function fecha(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return format(new Date(iso), "d MMM yyyy", { locale: es });
}

export function separadorDia(iso: string | Date): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Hoy';
  if (isYesterday(d)) return 'Ayer';
  return format(d, "EEEE d 'de' MMMM", { locale: es });
}

export function telefonoBonito(t?: string | null): string {
  if (!t) return '';
  const m = t.match(/^\+51(\d{3})(\d{3})(\d{3})$/);
  return m ? `+51 ${m[1]} ${m[2]} ${m[3]}` : t;
}
