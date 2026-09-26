export type Canal = 'whatsapp' | 'messenger' | 'instagram' | 'tiktok';
export type Rol = 'propietario' | 'admin' | 'supervisor' | 'agente';

export interface Me {
  usuario: { usuario_id: string; email: string; nombre: string; color: string; es_superadmin: boolean };
  empresas: Array<{ empresa_id: string; nombre: string; slug: string; plan: string; rol: Rol }>;
  empresa: { empresa_id: string; nombre: string; slug: string; plan: string; rol: Rol } | null;
  rol: Rol | null;
  plan: null | {
    codigo: string; nombre: string; usuarios: number; contactos: number; canales: number; difusionesMes: number;
    uso: { usuarios: number; contactos: number; canales: number; difusionesMes: number }; trial_hasta: string | null;
  };
  /** Contrato con Kallpasoft. `gestionado=false` → empresa local, sin restricción de ventanas. */
  acceso: null | {
    gestionado: boolean; tenant_id: string | null; estado: 'activo' | 'suspendido' | 'cancelado'; fecha_fin: string | null;
    modulos: string[] | null; ventanas: string[]; catalogo: string[];
  };
  permite_nueva_empresa: boolean;
}

export interface EtiquetaMin { etiqueta_id: number; nombre: string; color: string }
export interface Etiqueta extends EtiquetaMin { grupo_exclusivo: string | null; contactos: number }

export interface Campo {
  campo_id: number; entidad: 'contacto' | 'negocio'; clave: string; nombre: string;
  tipo: 'texto' | 'numero' | 'fecha' | 'opcion' | 'multi' | 'telefono' | 'email' | 'booleano';
  opciones: string[] | null; obligatorio: boolean; orden: number;
}

export interface Etapa { etapa_id: number; pipeline_id: number; nombre: string; color: string; orden: number; tipo: 'abierta' | 'ganado' | 'perdido'; sla_horas: number | null; abiertos?: number }
export interface Pipeline { pipeline_id: number; nombre: string; color: string; orden: number; es_entrada: boolean; activo: boolean; etapas: Etapa[]; abiertos: number }

export interface NegocioTarjeta {
  negocio_id: number; etapa_id: number; titulo: string | null; monto: number | null; posicion: number;
  asignado_a: string | null; asignado_nombre: string | null; asignado_color: string | null;
  cerrado_en: string | null; etapa_desde: string; creado_en: string; valores: Record<string, unknown>;
  contacto_id: number; contacto_nombre: string | null; contacto_telefono: string | null;
  etiquetas: EtiquetaMin[]; canales: Canal[]; conversacion_id: number | null;
}

export interface ContactoFila {
  contacto_id: number; nombre: string | null; telefono: string | null; email: string | null; documento: string | null;
  empresa_nombre: string | null; origen: string; creado_en: string; asignado_a: string | null;
  asignado_nombre: string | null; asignado_color: string | null; ultima_actividad: string | null;
  etiquetas: EtiquetaMin[]; canales: Canal[];
}

export interface Miembro { usuario_id: string; nombre: string; email: string; color: string; rol: Rol; activo: boolean; ultimo_acceso: string | null; conversaciones_abiertas: number }

export interface ConversacionFila {
  conversacion_id: number; contacto_id: number; canal_id: number; estado: 'abierta' | 'pendiente' | 'resuelta'; modo: 'ia' | 'humano';
  no_leidos: number; ultimo_mensaje: string | null; ultimo_entrante_en: string | null; ultima_actividad: string;
  asignado_a: string | null; asignado_nombre: string | null; asignado_color: string | null;
  contacto_nombre: string | null; contacto_telefono: string | null; identidad: string; nombre_canal: string | null; username: string | null;
  canal: Canal; canal_nombre: string; sandbox: boolean; etiquetas: EtiquetaMin[];
  capacidades?: { ventanaHoras: number | null; soportaAdjuntosSalientes: boolean; plantillasFueraDeVentana: boolean; maxMensajesConsecutivos: number | null; soportaCaptionEnAdjunto: boolean };
}

export interface Mensaje {
  mensaje_id: number; conversacion_id: number; direccion: 'entrante' | 'saliente' | 'nota';
  autor_tipo: 'contacto' | 'humano' | 'ia' | 'sistema'; autor_id: string | null; autor_nombre: string | null; autor_color: string | null;
  tipo: 'texto' | 'imagen' | 'audio' | 'video' | 'documento' | 'ubicacion' | 'plantilla' | 'sistema';
  contenido: string | null; media_url: string | null; media_mime: string | null; media_nombre: string | null;
  externo_id: string | null; estado_envio: string | null; error: string | null; metadatos: Record<string, unknown>; enviado_en: string;
}

export interface CanalCuenta {
  canal_id: number; tipo: Canal; externo_id: string; waba_id: string | null; nombre: string; sandbox: boolean;
  estado_conexion: string; activo: boolean; datos: Record<string, string | undefined>; conversaciones: number; creado_en: string;
  token_expira_en: string | null; refresh_expira_en: string | null;
}

export interface RespuestaRapida { respuesta_id: number; atajo: string; titulo: string; contenido: string; carpeta: string | null; media_url: string | null; visible_para: 'todos' | 'solo_yo'; creado_por: string | null; creado_por_nombre: string | null }

export interface VariablePlantilla { indice: number; origen: 'contacto' | 'campo' | 'empresa' | 'manual'; valor: string; ejemplo: string }
export interface Plantilla {
  plantilla_id: number; canal_id: number; canal_nombre: string; sandbox: boolean; nombre: string; idioma: string;
  categoria: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'; encabezado: string | null; cuerpo: string; pie: string | null;
  botones: Array<{ tipo: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; texto: string; url?: string; telefono?: string }>;
  variables: VariablePlantilla[]; estado: 'borrador' | 'pendiente' | 'aprobada' | 'rechazada' | 'pausada';
  motivo_rechazo: string | null; actualizado_en: string; creado_por_nombre: string | null;
}

export interface Difusion {
  difusion_id: number; nombre: string; canal_id: number; canal_nombre: string; plantilla_id: number; plantilla_nombre: string;
  etiqueta_ids: number[]; etiquetas: EtiquetaMin[]; estado: 'borrador' | 'enviando' | 'completada' | 'cancelada';
  total: number; enviados: number; fallidos: number; creado_en: string; iniciada_en: string | null; finalizada_en: string | null; creado_por_nombre: string | null;
}
