-- ═══════════════════════════════════════════════════════════════════════════
-- 002 · Conector Kallpasoft (ficha técnica de integración v2.1, §5)
--   app.tenant_config → caché local del contrato que empuja Kallpasoft.
--   tenant_id = RUC (identidad en Kallpasoft) ↔ empresa_id = uuid (identidad en el CRM).
--   Una empresa SIN fila aquí es local (no gestionada): sin restricción de módulos.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS app.tenant_config (
  tenant_id             text PRIMARY KEY,                       -- = RUC
  empresa_id            uuid NOT NULL UNIQUE REFERENCES app.empresas ON DELETE CASCADE,
  ruc                   text NOT NULL,
  razon_social          text NOT NULL,
  slug                  text NOT NULL UNIQUE,
  estado                text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','suspendido','cancelado')),
  motivo_suspension     text,
  plan                  text,                                   -- nombre del paquete (informativo)
  modulos_activos       jsonb NOT NULL DEFAULT '[]'::jsonb,     -- ["crm","difusiones",...] | ["todos"]
  ventanas_habilitadas  jsonb,                                  -- NULL = todas las de los módulos activos
  fecha_inicio          date,
  fecha_fin             date,
  max_usuarios          int NOT NULL DEFAULT 5,
  departamento          text,
  provincia             text,
  distrito              text,
  direccion             text,
  moneda_default        text NOT NULL DEFAULT 'PEN',
  datos_retenidos_hasta date,                                   -- soft-delete: retención ≥ 90 días
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now()
);
