import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Variable de entorno ${name} no definida`);
  return v;
}

export const ENV = {
  NODE_ENV:        process.env.NODE_ENV ?? 'development',
  PORT:            Number(process.env.PORT ?? 4000),
  DATABASE_URL:    req('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5440/crm'),
  JWT_SECRET:      req('JWT_SECRET', 'dev-jwt-secret-cambiar-en-produccion'),
  JWT_EXPIRES:     process.env.JWT_EXPIRES ?? '12h',
  ENCRYPTION_KEY:  req('CRM_ENCRYPTION_KEY', '6b616c6c70612d63726d2d6c6f63616c2d646576656c6f706d656e742d6b6579'),
  WEB_URL:         process.env.WEB_URL ?? 'http://localhost:3010',
  PUBLIC_API_URL:  process.env.PUBLIC_API_URL ?? 'http://localhost:4000',
  MEDIA_DIR:       process.env.MEDIA_DIR ?? './.media',
  // Conector Kallpasoft (ficha técnica §8). Sin INTERNAL_API_KEY, /internal/v1 responde 403 a todo.
  INTERNAL_API_KEY:   process.env.INTERNAL_API_KEY ?? '',
  KALLPASOFT_API_URL: (process.env.KALLPASOFT_API_URL ?? '').replace(/\/+$/, ''),
  // Alta de empresas desde el propio CRM (menú de empresas). Deshabilitada: las empresas las crea Kallpasoft.
  PERMITIR_NUEVA_EMPRESA: process.env.PERMITIR_NUEVA_EMPRESA === 'true',
};

export const esProduccion = ENV.NODE_ENV === 'production';
