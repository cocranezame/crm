-- ═══════════════════════════════════════════════════════════════════════════
-- 001 · Esquema base del CRM multi-empresa
--   app.*  → plataforma: usuarios, empresas, miembros, invitaciones, config
--   crm.*  → núcleo del CRM. TODA tabla de negocio lleva empresa_id.
-- La API filtra SIEMPRE por empresa_id tomado del JWT.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS crm;

-- ── Plataforma ─────────────────────────────────────────────────────────────

CREATE TABLE app.usuarios (
  usuario_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  password_hash  text NOT NULL,
  nombre         text NOT NULL,
  color          text NOT NULL DEFAULT '#6366f1',
  es_superadmin  boolean NOT NULL DEFAULT false,
  activo         boolean NOT NULL DEFAULT true,
  ultimo_acceso  timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_usuarios_email ON app.usuarios (lower(email));

CREATE TABLE app.empresas (
  empresa_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       text NOT NULL,
  slug         text NOT NULL UNIQUE,
  plan         text NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','basico','pro','enterprise')),
  zona_horaria text NOT NULL DEFAULT 'America/Lima',
  activo       boolean NOT NULL DEFAULT true,
  trial_hasta  timestamptz DEFAULT (now() + interval '14 days'),
  creado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.miembros (
  empresa_id uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES app.usuarios ON DELETE CASCADE,
  rol        text NOT NULL CHECK (rol IN ('propietario','admin','supervisor','agente')),
  activo     boolean NOT NULL DEFAULT true,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, usuario_id)
);
CREATE INDEX ix_miembros_usuario ON app.miembros (usuario_id);

CREATE TABLE app.invitaciones (
  invitacion_id bigserial PRIMARY KEY,
  empresa_id    uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  email         text NOT NULL,
  rol           text NOT NULL CHECK (rol IN ('admin','supervisor','agente')),
  token         text NOT NULL UNIQUE,
  invitado_por  uuid REFERENCES app.usuarios ON DELETE SET NULL,
  expira_en     timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  aceptada_en   timestamptz,
  creado_en     timestamptz NOT NULL DEFAULT now()
);

-- Credenciales a nivel plataforma (una App de Meta y una de TikTok para todos los tenants).
-- Los valores secretos se guardan cifrados por la API (AES-256-GCM).
CREATE TABLE app.config_plataforma (
  clave          text PRIMARY KEY,
  valor          text,
  secreto        boolean NOT NULL DEFAULT false,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

-- ── Contactos ──────────────────────────────────────────────────────────────

CREATE TABLE crm.contactos (
  contacto_id    bigserial PRIMARY KEY,
  empresa_id     uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  nombre         text,
  telefono       text,
  email          text,
  documento      text,
  empresa_nombre text,
  valores        jsonb NOT NULL DEFAULT '{}',
  origen         text NOT NULL DEFAULT 'manual'
                 CHECK (origen IN ('manual','whatsapp','messenger','instagram','tiktok','importacion')),
  asignado_a     uuid REFERENCES app.usuarios ON DELETE SET NULL,
  creado_por     uuid REFERENCES app.usuarios ON DELETE SET NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  eliminado_en   timestamptz
);
CREATE UNIQUE INDEX ux_contacto_tel   ON crm.contactos (empresa_id, telefono)     WHERE telefono IS NOT NULL AND eliminado_en IS NULL;
CREATE UNIQUE INDEX ux_contacto_email ON crm.contactos (empresa_id, lower(email)) WHERE email IS NOT NULL AND eliminado_en IS NULL;
CREATE INDEX ix_contactos_empresa ON crm.contactos (empresa_id, creado_en DESC) WHERE eliminado_en IS NULL;
CREATE INDEX ix_contactos_nombre_trgm ON crm.contactos USING gin (nombre gin_trgm_ops);

CREATE TABLE crm.identidades (
  identidad_id bigserial PRIMARY KEY,
  empresa_id   uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  contacto_id  bigint NOT NULL REFERENCES crm.contactos ON DELETE CASCADE,
  canal        text NOT NULL CHECK (canal IN ('whatsapp','messenger','instagram','tiktok')),
  externo_id   text NOT NULL,
  nombre_canal text,
  username     text,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, canal, externo_id)
);
CREATE INDEX ix_identidades_contacto ON crm.identidades (contacto_id);

CREATE TABLE crm.contacto_notas (
  nota_id     bigserial PRIMARY KEY,
  empresa_id  uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  contacto_id bigint NOT NULL REFERENCES crm.contactos ON DELETE CASCADE,
  autor_id    uuid REFERENCES app.usuarios ON DELETE SET NULL,
  contenido   text NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notas_contacto ON crm.contacto_notas (contacto_id, creado_en DESC);

-- ── Pipelines, etapas y negocios ───────────────────────────────────────────

CREATE TABLE crm.pipelines (
  pipeline_id bigserial PRIMARY KEY,
  empresa_id  uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  nombre      text NOT NULL,
  color       text NOT NULL DEFAULT '#6366f1',
  orden       int  NOT NULL DEFAULT 0,
  es_entrada  boolean NOT NULL DEFAULT false,
  activo      boolean NOT NULL DEFAULT true,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_pipeline_entrada ON crm.pipelines (empresa_id) WHERE es_entrada;

CREATE TABLE crm.etapas (
  etapa_id    bigserial PRIMARY KEY,
  empresa_id  uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  pipeline_id bigint NOT NULL REFERENCES crm.pipelines ON DELETE CASCADE,
  nombre      text NOT NULL,
  color       text NOT NULL DEFAULT '#94a3b8',
  orden       int  NOT NULL,
  tipo        text NOT NULL DEFAULT 'abierta' CHECK (tipo IN ('abierta','ganado','perdido')),
  sla_horas   int,
  CONSTRAINT ux_etapa_orden UNIQUE (pipeline_id, orden) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE crm.negocios (
  negocio_id     bigserial PRIMARY KEY,
  empresa_id     uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  contacto_id    bigint NOT NULL REFERENCES crm.contactos ON DELETE CASCADE,
  pipeline_id    bigint NOT NULL REFERENCES crm.pipelines ON DELETE CASCADE,
  etapa_id       bigint NOT NULL REFERENCES crm.etapas,
  titulo         text,
  monto          numeric(12,2),
  asignado_a     uuid REFERENCES app.usuarios ON DELETE SET NULL,
  posicion       double precision NOT NULL DEFAULT 0,
  valores        jsonb NOT NULL DEFAULT '{}',
  cerrado_en     timestamptz,
  etapa_desde    timestamptz NOT NULL DEFAULT now(),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_negocio_abierto ON crm.negocios (contacto_id, pipeline_id) WHERE cerrado_en IS NULL;
CREATE INDEX ix_negocios_tablero ON crm.negocios (pipeline_id, etapa_id, posicion);

CREATE TABLE crm.negocio_historial (
  id         bigserial PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  negocio_id bigint NOT NULL REFERENCES crm.negocios ON DELETE CASCADE,
  de_etapa   bigint,
  a_etapa    bigint,
  actor_tipo text NOT NULL CHECK (actor_tipo IN ('humano','ia','sistema')),
  actor_id   uuid,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_historial_negocio ON crm.negocio_historial (negocio_id, creado_en DESC);

-- ── Etiquetas y campos personalizados ──────────────────────────────────────

CREATE TABLE crm.etiquetas (
  etiqueta_id     bigserial PRIMARY KEY,
  empresa_id      uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  nombre          text NOT NULL,
  color           text NOT NULL DEFAULT '#6366f1',
  grupo_exclusivo text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre)
);

CREATE TABLE crm.contacto_etiquetas (
  contacto_id  bigint NOT NULL REFERENCES crm.contactos ON DELETE CASCADE,
  etiqueta_id  bigint NOT NULL REFERENCES crm.etiquetas ON DELETE CASCADE,
  aplicada_por text NOT NULL DEFAULT 'humano',
  aplicada_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contacto_id, etiqueta_id)
);
CREATE INDEX ix_contacto_etiquetas_etiqueta ON crm.contacto_etiquetas (etiqueta_id);

CREATE TABLE crm.campos (
  campo_id    bigserial PRIMARY KEY,
  empresa_id  uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  entidad     text NOT NULL CHECK (entidad IN ('contacto','negocio')),
  clave       text NOT NULL CHECK (clave ~ '^[a-z][a-z0-9_]{0,39}$'),
  nombre      text NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('texto','numero','fecha','opcion','multi','telefono','email','booleano')),
  opciones    jsonb,
  obligatorio boolean NOT NULL DEFAULT false,
  orden       int NOT NULL DEFAULT 0,
  UNIQUE (empresa_id, entidad, clave)
);

-- ── Canales y mensajería ───────────────────────────────────────────────────

CREATE TABLE crm.canales (
  canal_id          bigserial PRIMARY KEY,
  empresa_id        uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  tipo              text NOT NULL CHECK (tipo IN ('whatsapp','messenger','instagram','tiktok')),
  externo_id        text NOT NULL,          -- phone_number_id | page_id | business_id (open_id)
  waba_id           text,
  nombre            text NOT NULL,
  token_enc         text,                   -- AES-256-GCM
  refresh_token_enc text,                   -- tiktok
  token_expira_en   timestamptz,
  refresh_expira_en timestamptz,
  datos             jsonb NOT NULL DEFAULT '{}',   -- numero_display, verified_name, username, foto…
  sandbox           boolean NOT NULL DEFAULT false,   -- canal de prueba local: no llama a Meta/TikTok
  estado_conexion   text NOT NULL DEFAULT 'conectado',
  activo            boolean NOT NULL DEFAULT true,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, externo_id)
);

CREATE TABLE crm.conversaciones (
  conversacion_id         bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  contacto_id             bigint NOT NULL REFERENCES crm.contactos ON DELETE CASCADE,
  canal_id                bigint NOT NULL REFERENCES crm.canales ON DELETE CASCADE,
  identidad_id            bigint NOT NULL REFERENCES crm.identidades ON DELETE CASCADE,
  conversacion_externa_id text,             -- tiktok: conversation_id
  asignado_a              uuid REFERENCES app.usuarios ON DELETE SET NULL,
  estado                  text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','pendiente','resuelta')),
  modo                    text NOT NULL DEFAULT 'humano' CHECK (modo IN ('ia','humano')),
  no_leidos               int NOT NULL DEFAULT 0,
  ultimo_mensaje          text,
  ultimo_entrante_en      timestamptz,
  ultima_actividad        timestamptz NOT NULL DEFAULT now(),
  creado_en               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canal_id, identidad_id)
);
CREATE INDEX ix_conv_bandeja ON crm.conversaciones (empresa_id, ultima_actividad DESC);

CREATE TABLE crm.mensajes (
  mensaje_id      bigserial PRIMARY KEY,
  empresa_id      uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  conversacion_id bigint NOT NULL REFERENCES crm.conversaciones ON DELETE CASCADE,
  direccion       text NOT NULL CHECK (direccion IN ('entrante','saliente','nota')),
  autor_tipo      text NOT NULL CHECK (autor_tipo IN ('contacto','humano','ia','sistema')),
  autor_id        uuid REFERENCES app.usuarios ON DELETE SET NULL,
  tipo            text NOT NULL DEFAULT 'texto'
                  CHECK (tipo IN ('texto','imagen','audio','video','documento','ubicacion','plantilla','sistema')),
  contenido       text,
  media_url       text,
  media_mime      text,
  media_nombre    text,
  externo_id      text,
  estado_envio    text,                     -- pendiente | sent | delivered | read | failed | error | bloqueado
  error           text,
  metadatos       jsonb NOT NULL DEFAULT '{}',
  enviado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_mensaje_externo ON crm.mensajes (empresa_id, externo_id) WHERE externo_id IS NOT NULL;
CREATE INDEX ix_mensajes_conv ON crm.mensajes (conversacion_id, enviado_en);

CREATE TABLE crm.respuestas_rapidas (
  respuesta_id bigserial PRIMARY KEY,
  empresa_id   uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  atajo        text NOT NULL CHECK (atajo ~ '^[a-z0-9_-]{1,40}$'),
  titulo       text NOT NULL,
  contenido    text NOT NULL,
  carpeta      text,
  media_url    text,
  visible_para text NOT NULL DEFAULT 'todos' CHECK (visible_para IN ('todos','solo_yo')),
  creado_por   uuid REFERENCES app.usuarios ON DELETE SET NULL,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, atajo)
);

-- Registro crudo de webhooks recibidos (diagnóstico; se puede purgar).
CREATE TABLE crm.webhook_log (
  id         bigserial PRIMARY KEY,
  canal      text NOT NULL,
  empresa_id uuid,
  payload    jsonb NOT NULL,
  resultado  text,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

-- ── Plantillas de WhatsApp y difusiones ────────────────────────────────────

CREATE TABLE crm.plantillas (
  plantilla_id   bigserial PRIMARY KEY,
  empresa_id     uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  canal_id       bigint NOT NULL REFERENCES crm.canales ON DELETE CASCADE,
  nombre         text NOT NULL CHECK (nombre ~ '^[a-z0-9_]+$' AND length(nombre) <= 512),
  idioma         text NOT NULL DEFAULT 'es',
  categoria      text NOT NULL DEFAULT 'MARKETING' CHECK (categoria IN ('MARKETING','UTILITY','AUTHENTICATION')),
  encabezado     text,
  cuerpo         text NOT NULL,
  pie            text,
  botones        jsonb NOT NULL DEFAULT '[]',
  variables      jsonb NOT NULL DEFAULT '[]',   -- [{indice, origen: contacto|campo|empresa|manual, valor, ejemplo}]
  estado         text NOT NULL DEFAULT 'borrador'
                 CHECK (estado IN ('borrador','pendiente','aprobada','rechazada','pausada')),
  externo_id     text,
  motivo_rechazo text,
  creado_por     uuid REFERENCES app.usuarios ON DELETE SET NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canal_id, nombre, idioma)
);

CREATE TABLE crm.difusiones (
  difusion_id   bigserial PRIMARY KEY,
  empresa_id    uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  nombre        text NOT NULL,
  canal_id      bigint NOT NULL REFERENCES crm.canales ON DELETE CASCADE,
  plantilla_id  bigint NOT NULL REFERENCES crm.plantillas ON DELETE CASCADE,
  etiqueta_ids  bigint[] NOT NULL DEFAULT '{}',
  estado        text NOT NULL DEFAULT 'borrador'
                CHECK (estado IN ('borrador','enviando','completada','cancelada')),
  total         int NOT NULL DEFAULT 0,
  enviados      int NOT NULL DEFAULT 0,
  fallidos      int NOT NULL DEFAULT 0,
  creado_por    uuid REFERENCES app.usuarios ON DELETE SET NULL,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  iniciada_en   timestamptz,
  finalizada_en timestamptz
);

CREATE TABLE crm.difusion_destinatarios (
  id           bigserial PRIMARY KEY,
  difusion_id  bigint NOT NULL REFERENCES crm.difusiones ON DELETE CASCADE,
  empresa_id   uuid NOT NULL,
  contacto_id  bigint NOT NULL REFERENCES crm.contactos ON DELETE CASCADE,
  destino      text NOT NULL,
  estado       text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviado','error')),
  error        text,
  externo_id   text,
  enviado_en   timestamptz,
  UNIQUE (difusion_id, contacto_id)
);
CREATE INDEX ix_dest_pendientes ON crm.difusion_destinatarios (difusion_id) WHERE estado = 'pendiente';

-- ── Chat interno del equipo ────────────────────────────────────────────────

CREATE TABLE crm.equipo_conversaciones (
  conv_id          bigserial PRIMARY KEY,
  empresa_id       uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  tipo             text NOT NULL CHECK (tipo IN ('directo','grupo')),
  nombre           text,
  creado_por       uuid REFERENCES app.usuarios ON DELETE SET NULL,
  ultima_actividad timestamptz NOT NULL DEFAULT now(),
  creado_en        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm.equipo_participantes (
  conv_id         bigint NOT NULL REFERENCES crm.equipo_conversaciones ON DELETE CASCADE,
  usuario_id      uuid NOT NULL REFERENCES app.usuarios ON DELETE CASCADE,
  ultimo_leido_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conv_id, usuario_id)
);

CREATE TABLE crm.equipo_mensajes (
  id         bigserial PRIMARY KEY,
  conv_id    bigint NOT NULL REFERENCES crm.equipo_conversaciones ON DELETE CASCADE,
  empresa_id uuid NOT NULL,
  autor_id   uuid REFERENCES app.usuarios ON DELETE SET NULL,
  contenido  text NOT NULL,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_equipo_mensajes_conv ON crm.equipo_mensajes (conv_id, creado_en);
