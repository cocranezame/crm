// Catálogo de ventanas del CRM — FUENTE ÚNICA (ficha Kallpasoft P5/P6).
// Alimenta: el menú del frontend (vía /auth/me), el gating de la API por módulo
// y la autodescripción GET /internal/v1/catalog que sincroniza Kallpasoft.
// Ventana nueva → se agrega aquí con su módulo técnico, y la entrega todo plan que lo incluya.

export const PRODUCTO_CODE = 'crm';

/** Módulos técnicos: claves ESTABLES (Kallpasoft las guarda en sus módulos comerciales). */
export const MODULOS_TECNICOS = ['crm', 'difusiones', 'chat_equipo'] as const;
export type ModuloTecnico = (typeof MODULOS_TECNICOS)[number];

export interface Ventana { href: string; label: string; grupo: string; modulo_tecnico: ModuloTecnico }

export const VENTANAS: Ventana[] = [
  { href: '/inicio',     label: 'Inicio',          grupo: 'CRM',          modulo_tecnico: 'crm' },
  { href: '/inbox',      label: 'Bandeja',         grupo: 'CRM',          modulo_tecnico: 'crm' },
  { href: '/contactos',  label: 'Contactos',       grupo: 'CRM',          modulo_tecnico: 'crm' },
  { href: '/pipelines',  label: 'Pipelines',       grupo: 'CRM',          modulo_tecnico: 'crm' },
  { href: '/plantillas', label: 'Plantillas',      grupo: 'CRM',          modulo_tecnico: 'crm' },
  { href: '/config',     label: 'Configuración',   grupo: 'CRM',          modulo_tecnico: 'crm' },
  { href: '/difusiones', label: 'Difusiones',      grupo: 'Marketing',    modulo_tecnico: 'difusiones' },
  { href: '/equipo',     label: 'Chat del equipo', grupo: 'Colaboración', modulo_tecnico: 'chat_equipo' },
];

/** Comodín del contrato (ficha §6.1): sin restricción de módulos. */
export const TODOS = 'todos';

export function tieneModulo(modulosActivos: string[] | null, modulo: ModuloTecnico): boolean {
  if (modulosActivos === null) return true; // empresa local, no gestionada por Kallpasoft
  return modulosActivos.includes(TODOS) || modulosActivos.includes(modulo);
}

/**
 * Ventanas que entrega el plan. `modulosActivos = null` → empresa local (todas).
 * `ventanasHabilitadas = null` → todas las de los módulos activos (contrato §4.1).
 * Si llega una lista, se intersecta (el plan solo puede recortar, nunca ampliar).
 */
export function ventanasDelPlan(modulosActivos: string[] | null, ventanasHabilitadas: string[] | null): string[] {
  const porModulo = VENTANAS.filter((v) => tieneModulo(modulosActivos, v.modulo_tecnico)).map((v) => v.href);
  if (!ventanasHabilitadas) return porModulo;
  return porModulo.filter((h) => ventanasHabilitadas.includes(h));
}

export function autodescripcion() {
  return { producto: PRODUCTO_CODE, modulos_tecnicos: [...MODULOS_TECNICOS], ventanas: VENTANAS };
}
