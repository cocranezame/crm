import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, ZodSchema } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export const noEncontrado = (que = 'Recurso') => new HttpError(404, `${que} no encontrado`, 'no_encontrado');
export const prohibido = (msg = 'No tienes permiso para esta acción') => new HttpError(403, msg, 'prohibido');
export const invalido = (msg: string) => new HttpError(400, msg, 'invalido');
export const conflicto = (msg: string) => new HttpError(409, msg, 'conflicto');

/** Envuelve handlers async para que los errores lleguen al middleware de errores. */
export function ah(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { fn(req, res, next).catch(next); };
}

export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw invalido(`Parámetro ${name} inválido`);
  return n;
}

export function manejadorErrores(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const primero = err.issues[0];
    res.status(400).json({ ok: false, error: `${primero.path.join('.') || 'dato'}: ${primero.message}`, code: 'validacion', issues: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ ok: false, error: err.message, code: err.code });
    return;
  }
  const httpErr = err as { status?: number; expose?: boolean; type?: string };
  if (httpErr?.expose && httpErr.status && httpErr.status < 500) {
    const msg = httpErr.type === 'entity.parse.failed' ? 'JSON inválido' : httpErr.type === 'entity.too.large' ? 'El contenido es demasiado grande' : 'Solicitud inválida';
    res.status(httpErr.status).json({ ok: false, error: msg, code: httpErr.type ?? 'solicitud' });
    return;
  }
  const multerErr = err as { name?: string; code?: string };
  if (multerErr?.name === 'MulterError') {
    res.status(400).json({ ok: false, error: multerErr.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera los 16 MB' : 'Archivo inválido', code: 'archivo' });
    return;
  }
  const pgErr = err as { code?: string; constraint?: string; detail?: string };
  if (pgErr?.code === '23505') {
    res.status(409).json({ ok: false, error: mensajeUnico(pgErr.constraint), code: 'duplicado' });
    return;
  }
  if (pgErr?.code === '23503') {
    res.status(409).json({ ok: false, error: 'El registro está en uso o referencia a algo inexistente', code: 'referencia' });
    return;
  }
  console.error('[api] error no controlado:', err);
  res.status(500).json({ ok: false, error: 'Error interno del servidor', code: 'interno' });
}

function mensajeUnico(constraint?: string): string {
  const m: Record<string, string> = {
    ux_contacto_tel: 'Ya existe un contacto con ese teléfono',
    ux_contacto_email: 'Ya existe un contacto con ese email',
    ux_negocio_abierto: 'El contacto ya tiene un negocio abierto en ese tablero',
    ux_usuarios_email: 'Ya existe un usuario con ese email',
    etiquetas_empresa_id_nombre_key: 'Ya existe una etiqueta con ese nombre',
    campos_empresa_id_entidad_clave_key: 'Ya existe un campo con esa clave',
    respuestas_rapidas_empresa_id_atajo_key: 'Ya existe una respuesta con ese atajo',
    canales_tipo_externo_id_key: 'Esa cuenta del canal ya está conectada (en esta u otra empresa)',
    plantillas_canal_id_nombre_idioma_key: 'Ya existe una plantilla con ese nombre e idioma',
    empresas_slug_key: 'Ese identificador de empresa ya está en uso',
  };
  return (constraint && m[constraint]) || 'Registro duplicado';
}
