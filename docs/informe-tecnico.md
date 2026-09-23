# Informe técnico — Extracción del CRM de ReparaTego a un producto independiente

**Fecha:** 2026-09-23 · **Origen:** `REPARATE_WEB_LAMBDA` (rama leída: `feat/conciliacion-ventas`)
**Decisiones tomadas:** SaaS multi-empresa · proyecto Supabase nuevo · canales WhatsApp + Messenger + TikTok desde la v1

---

## 1. Resumen ejecutivo

- El CRM actual **no se puede "copiar y pegar"**: está atado a ReparaTego en 5 puntos duros (leads con columnas de reparación, respuestas rápidas colgadas del catálogo, usuarios de `seguridad.usuario`, tenancy por `sucursal_id`, conversión escrita desde `servicios`).
- **Lo que pediste y hoy NO existe** en el código:
  - Crear kanbans: no hay `POST /kanbans` (los 5 kanbans K0-K4 son datos sembrados).
  - Ordenar etapas: no hay endpoint de reorden, y al crear una etapa el `numero` se calcula **global** (`MAX(numero)+1` sobre todas las etapas, no por kanban) — bug.
  - Arrastrar leads entre etapas: `/crm/kanban` no tiene drag & drop.
  - Campos personalizados reales: `guardar_dato` hace `UPDATE crm.leads SET ${campo}` → un campo creado desde la UI sin columna física **rompe** al guardarse.
- **El agente IA hoy sí bloquea al humano**: el webhook ejecuta a Nico en línea (`await ejecutarAgente` con timeout de 18 s dentro de la request de Meta), y las tools de Nico conocen claves fijas (`k0`…`k4`). En el producto nuevo la IA pasa a ser un **consumidor asíncrono** del mismo flujo que usa el humano.
- **Reutilizable casi tal cual (~40 % del código):** capa de canales (`canales/*`: adaptadores WA/Messenger/TikTok, `envio.service`), embedded signup, plantillas WA con IA, difusiones, adjuntos/media, mensajería interna.
- **Estimación:** 6 fases, ~7-9 semanas de trabajo efectivo para una v1 vendible.

---

## 2. Inventario del CRM actual (medido)

| Capa | Tamaño | Detalle |
|---|---|---|
| Backend | **13 907 líneas** TS en `apps/api/src/modules/crm` | `crm.service.ts` 1121 · `crm.controller.ts` 1242 · `difusion.service` 788 · `wa-cuentas.service` 630 · `webhook.router` 618 |
| Endpoints | **~150** | 89 en `crm.routes.ts` + agentes (17) + difusión (13) + plantillas (12) + embedded signup (7) + mensajería interna (7) + webhooks |
| Frontend | **11 730 líneas** TSX | `crm/page.tsx` (bandeja) 1502 · `configuracion-chat` 1525 · `plantillas` 1887 · `agente` 1007 · `DifusionPlantillas` 1055 |
| BD | **~50 tablas** en schema `crm` | Sin DDL base versionado: solo migraciones sueltas en `apps/api/migrations/crm_*.sql` y `database/migrations/015-016` |
| Tiempo real | Polling | Bandeja refresca cada 8 s / 15 s / 30 s (`refetchInterval`) |

### Tablas por dominio

| Dominio | Tablas actuales |
|---|---|
| Contactos / leads | `leads`, `lead_etiquetas`, `notas`, `notas_nico` |
| Mensajería con clientes | `conversaciones`, `mensajes` (enums `tipo_mensaje`, `direccion_mensaje`, `canal`) |
| Pipelines | `kanbans`, `etapas`, `etapa_campos`, `etapa_etiquetas`, `etapa_mensajes` |
| Etiquetas / campos | `etiquetas`, `campos` |
| Respuestas rápidas | `respuesta_rapida`, `criterio` |
| Canales | `integraciones_meta`, `meta_apps`, `integraciones_config`, `wa_cuentas` (+ legacy) |
| Plantillas / difusión | `plantilla_definicion`, `plantilla_variables`, `difusion`, `difusion_destinatario` |
| Equipo interno | `mensajeria_conversaciones`, `mensajeria_participantes`, `mensajeria_mensajes` |
| Agente IA | `agentes`, `agente_perfil`, `agente_pautas`, `agente_tools`, `agente_config`, `agente_kb`, `agente_mejoras`, `acciones_agente`, `categoria_agente_activa`, `chat_conversaciones`, `chat_mensajes`, `negocio_config` |
| KB específica de reparación | `kb_falla`, `kb_falla_componente`, `kb_falla_copy`, `kb_falla_video`, `kb_video*`, `kb_copy` |
| Legacy sin uso | `canales_whatsapp_backup`, `bots`, `bot_pasos`, `plantillas_mensaje`, columnas `wa_cuenta_id` |

---

## 3. Acoplamientos con ReparaTego que hay que cortar

| # | Acoplamiento (dónde) | Qué hace hoy | Resolución en el CRM independiente |
|---|---|---|---|
| A1 | `crm.leads` con columnas `categoria_equipo, marca_equipo, modelo_equipo, falla_descrita, repuesto_solicitado, modalidad_revision, distrito, fecha_visita, precio_referencial…` | El lead **es** una orden de reparación en potencia | Contacto genérico + **campos personalizados** por empresa (`valores jsonb`) |
| A2 | `respuesta_rapida.categoria_id / componente_id` → `catalogo.categoria / componente` | Guiones segmentados por equipo/componente | Carpetas propias + atajo `/texto` + variables |
| A3 | `seguridad.usuario`, `seguridad.cargo`, `seguridad.sucursal` (9+3+3 referencias) | Usuarios, roles y sucursales del ERP | `app.usuarios` + `app.miembros(empresa_id, rol)` sobre Supabase Auth |
| A4 | `sucursal_id` en 78 lugares (service+controller); `etiquetas`, `campos`, `kanbans` **sin** dueño | Tenancy parcial | `empresa_id` NOT NULL en todas las tablas + RLS |
| A5 | `servicios.service.ts:524` escribe `crm.leads.convertido_en`; `mof.service.ts` lo lee | Conversión = crear servicio | Evento genérico "ganado" al llegar a una etapa `tipo='ganado'` + webhook saliente opcional |
| A6 | Difusión / plantillas leen `clientes.cliente`, `servicios.servicio`, `servicios.instancia` (origen de variable `servicio_*`) | Variables de la orden | Origen `contacto` / `campo` / `empresa` / `manual`; `servicio` se va |
| A7 | Tool `consultar_disponibilidad_domicilio` lee `domicilio.visita` + técnicos `cargo_id=2` | Agenda de visitas | Se descarta del núcleo (posible módulo "Citas" futuro) |
| A8 | KB de fallas (`kb_falla*`, `kb_video*`) y contexto de catálogo en `agentes.context-builders.ts` | Conocimiento de reparación | Base de conocimiento genérica (artículos + documentos) |
| A9 | Tools de Nico con claves fijas `k0..k4`, `listo_para_nico`, `escalamiento`; `GRUPOS_EXCLUSIVOS` hardcodeado en `etiquetas.helpers.ts` | Flujo K0-K4 de ReparaTego | Tools reciben IDs de pipeline/etapa del catálogo de la empresa; exclusividad = columna `grupo_exclusivo` en BD |
| A10 | `shared/s3.service`, `config/db`, auth middleware | Infra compartida | Supabase Storage + pool propio |

---

## 4. Brechas contra lo pedido

| Requisito | Estado actual | Qué falta |
|---|---|---|
| Registro de clientes | Lead nace solo por mensaje entrante; no hay alta manual ni ficha de contacto | ABM de contactos, importación CSV, deduplicación por teléfono/email, fusión de identidades multicanal |
| Mensajería | Bandeja funcional (WA/Messenger/TikTok, adjuntos, emojis, ventana 24 h) | Asignación a agente humano, filtros por pipeline/etiqueta/asignado, tiempo real (hoy polling) |
| Kanbans múltiples | 5 fijos, solo lectura | CRUD de pipelines, cada uno con sus etapas |
| Etapas ordenables | `numero` global, sin reorden | `orden` por pipeline, endpoint de reorden atómico, drag & drop |
| Mover leads | Solo desde el panel del lead | Drag & drop de tarjetas entre etapas |
| Respuestas rápidas | Existen, atadas a catálogo | Genéricas, atajo `/`, variables, adjuntos |
| Etiquetas | Existen, globales, exclusividad en código | Por empresa, color, grupo exclusivo en BD |
| Agente IA aparte | Mezclado en webhook y en la configuración del chat | Sección `/ia` propia; el CRM funciona 100 % con la IA apagada |

---

## 5. Arquitectura destino

### Stack (se mantiene el conocido, cambia la infraestructura de datos)

| Pieza | Elección | Motivo |
|---|---|---|
| API | Node + Express + TS → AWS Lambda | Reutiliza el código de canales tal cual |
| Web | Next.js 14 App Router → Vercel | Reutiliza componentes (`BurbujaMensaje`, `AdjuntarArchivo`, `SelectorEmojis`, `CanalBadge`, `NuevaCuentaModal`…) |
| BD | **Supabase nuevo**, PostgreSQL, pooler :6543 | Decisión tomada |
| Auth | Supabase Auth (email + contraseña, invitaciones) | Reemplaza `seguridad.usuario` |
| Archivos | Supabase Storage (bucket privado por empresa) | Reemplaza S3 compartido |
| Tiempo real | **Supabase Realtime** sobre `mensajes` y `leads` | Elimina el polling de 8 s |
| Cola IA | **AWS SQS** → Lambda `ia-worker` | Saca la IA del webhook (ver §7) |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Ordenar etapas y mover tarjetas |

### Módulos y rutas del producto

| Sección | Ruta | Contenido |
|---|---|---|
| Bandeja | `/inbox` | Conversaciones de todos los canales, asignación, respuestas rápidas, notas internas |
| Contactos | `/contactos`, `/contactos/[id]` | Registro, ficha, identidades por canal, historial, campos, etiquetas, importar CSV |
| Pipelines | `/pipelines/[id]` | Tablero con drag & drop, selector de pipeline |
| Configuración | `/config/pipelines` · `/config/etiquetas` · `/config/campos` · `/config/respuestas` · `/config/canales` · `/config/equipo` | Todo lo que administra el negocio |
| Plantillas y difusión | `/plantillas`, `/difusiones` | Portado de lo actual |
| Equipo | `/equipo/chat` | Mensajería interna (portado de `mensajeria/`) |
| **Agente IA** | `/ia` → Agentes · Perfil · Pautas · Conocimiento · Tools · Asignación · Registro de acciones · Mejoras | Sección separada; se puede apagar por empresa, por canal, por pipeline o por conversación |
| Plataforma | `/admin` (solo superadmin) | Empresas, planes, límites |

---

## 6. Modelo de datos (Supabase nuevo)

Esquemas: `app` (empresas, usuarios), `crm` (núcleo), `ia` (agente). Toda tabla de negocio lleva `empresa_id` y RLS.

```sql
-- ── Tenancy ──────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS ia;

CREATE TABLE app.empresas (
  empresa_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       text NOT NULL,
  slug         text UNIQUE NOT NULL,
  plan         text NOT NULL DEFAULT 'trial',
  zona_horaria text NOT NULL DEFAULT 'America/Lima',
  creado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.miembros (
  empresa_id uuid REFERENCES app.empresas ON DELETE CASCADE,
  usuario_id uuid REFERENCES auth.users  ON DELETE CASCADE,
  rol        text NOT NULL CHECK (rol IN ('propietario','admin','supervisor','agente')),
  nombre     text NOT NULL,
  activo     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (empresa_id, usuario_id)
);

-- ── Contactos (registro de clientes) ─────────────────────────────────
CREATE TABLE crm.contactos (
  contacto_id bigserial PRIMARY KEY,
  empresa_id  uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  nombre      text,
  telefono    text,               -- E.164
  email       text,
  documento   text,
  valores     jsonb NOT NULL DEFAULT '{}',   -- campos personalizados {clave: valor}
  origen      text,               -- manual | whatsapp | messenger | tiktok | importacion
  creado_por  uuid,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  eliminado_en timestamptz
);
CREATE UNIQUE INDEX ux_contacto_tel ON crm.contactos(empresa_id, telefono) WHERE telefono IS NOT NULL AND eliminado_en IS NULL;

CREATE TABLE crm.identidades (      -- una persona, varios canales
  identidad_id bigserial PRIMARY KEY,
  empresa_id   uuid NOT NULL,
  contacto_id  bigint NOT NULL REFERENCES crm.contactos ON DELETE CASCADE,
  canal        text NOT NULL CHECK (canal IN ('whatsapp','messenger','instagram','tiktok')),
  externo_id   text NOT NULL,     -- wa_id / PSID / open_id
  nombre_canal text,
  UNIQUE (empresa_id, canal, externo_id)
);

-- ── Pipelines (kanbans) y etapas ordenables ──────────────────────────
CREATE TABLE crm.pipelines (
  pipeline_id bigserial PRIMARY KEY,
  empresa_id  uuid NOT NULL REFERENCES app.empresas ON DELETE CASCADE,
  nombre      text NOT NULL,
  color       text,
  orden       int  NOT NULL DEFAULT 0,
  es_entrada  boolean NOT NULL DEFAULT false,  -- donde caen los contactos nuevos
  activo      boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_pipeline_entrada ON crm.pipelines(empresa_id) WHERE es_entrada;

CREATE TABLE crm.etapas (
  etapa_id    bigserial PRIMARY KEY,
  empresa_id  uuid NOT NULL,
  pipeline_id bigint NOT NULL REFERENCES crm.pipelines ON DELETE CASCADE,
  nombre      text NOT NULL,
  color       text,
  orden       int  NOT NULL,
  tipo        text NOT NULL DEFAULT 'abierta' CHECK (tipo IN ('abierta','ganado','perdido')),
  sla_horas   int,
  UNIQUE (pipeline_id, orden) DEFERRABLE INITIALLY DEFERRED   -- permite reordenar en una transacción
);

CREATE TABLE crm.negocios (          -- la tarjeta del kanban
  negocio_id   bigserial PRIMARY KEY,
  empresa_id   uuid NOT NULL,
  contacto_id  bigint NOT NULL REFERENCES crm.contactos ON DELETE CASCADE,
  pipeline_id  bigint NOT NULL REFERENCES crm.pipelines,
  etapa_id     bigint NOT NULL REFERENCES crm.etapas,
  titulo       text,
  monto        numeric(12,2),
  asignado_a   uuid,
  posicion     numeric NOT NULL DEFAULT 0,  -- orden dentro de la columna (drag & drop)
  valores      jsonb NOT NULL DEFAULT '{}',
  cerrado_en   timestamptz,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_negocio_abierto ON crm.negocios(contacto_id, pipeline_id) WHERE cerrado_en IS NULL;

CREATE TABLE crm.negocio_historial (  -- auditoría de movimientos (humano o IA)
  id bigserial PRIMARY KEY, empresa_id uuid NOT NULL,
  negocio_id bigint NOT NULL REFERENCES crm.negocios ON DELETE CASCADE,
  de_etapa bigint, a_etapa bigint,
  actor_tipo text NOT NULL CHECK (actor_tipo IN ('humano','ia','sistema')),
  actor_id uuid, creado_en timestamptz NOT NULL DEFAULT now()
);

-- ── Etiquetas y campos personalizados ────────────────────────────────
CREATE TABLE crm.etiquetas (
  etiqueta_id bigserial PRIMARY KEY, empresa_id uuid NOT NULL,
  nombre text NOT NULL, color text,
  grupo_exclusivo text,          -- reemplaza GRUPOS_EXCLUSIVOS hardcodeado
  UNIQUE (empresa_id, nombre)
);
CREATE TABLE crm.contacto_etiquetas (
  contacto_id bigint REFERENCES crm.contactos ON DELETE CASCADE,
  etiqueta_id bigint REFERENCES crm.etiquetas ON DELETE CASCADE,
  aplicada_por text NOT NULL DEFAULT 'humano',
  PRIMARY KEY (contacto_id, etiqueta_id)
);
CREATE TABLE crm.campos (
  campo_id bigserial PRIMARY KEY, empresa_id uuid NOT NULL,
  entidad text NOT NULL CHECK (entidad IN ('contacto','negocio')),
  clave text NOT NULL, nombre text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('texto','numero','fecha','opcion','multi','telefono','email','booleano')),
  opciones jsonb, obligatorio boolean NOT NULL DEFAULT false, orden int NOT NULL DEFAULT 0,
  UNIQUE (empresa_id, entidad, clave)
);

-- ── Mensajería ───────────────────────────────────────────────────────
CREATE TABLE crm.canales (            -- ex integraciones_meta + tiktok
  canal_id bigserial PRIMARY KEY, empresa_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('whatsapp','messenger','instagram','tiktok')),
  externo_id text NOT NULL,          -- phone_number_id / page_id / open_id
  waba_id text, nombre text,
  token_enc text NOT NULL,           -- cifrado AES-GCM (igual que hoy)
  activo boolean NOT NULL DEFAULT true,
  UNIQUE (tipo, externo_id)          -- global: el webhook resuelve la empresa desde aquí
);

CREATE TABLE crm.conversaciones (
  conversacion_id bigserial PRIMARY KEY, empresa_id uuid NOT NULL,
  contacto_id bigint NOT NULL REFERENCES crm.contactos,
  canal_id bigint NOT NULL REFERENCES crm.canales,
  asignado_a uuid,
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','pendiente','resuelta')),
  modo text NOT NULL DEFAULT 'ia' CHECK (modo IN ('ia','humano')),  -- ver §7
  ultimo_entrante_en timestamptz, ultima_actividad timestamptz
);

CREATE TABLE crm.mensajes (
  mensaje_id bigserial PRIMARY KEY, empresa_id uuid NOT NULL,
  conversacion_id bigint NOT NULL REFERENCES crm.conversaciones ON DELETE CASCADE,
  direccion text NOT NULL CHECK (direccion IN ('entrante','saliente','nota')),
  autor_tipo text NOT NULL CHECK (autor_tipo IN ('contacto','humano','ia','sistema')),
  autor_id uuid,
  tipo text NOT NULL,                -- texto|imagen|audio|video|documento|ubicacion|plantilla|sistema
  contenido text, media_url text, externo_id text,
  estado_envio text, leido_en timestamptz,
  enviado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_mensaje_externo ON crm.mensajes(empresa_id, externo_id) WHERE externo_id IS NOT NULL;

-- ── Respuestas rápidas ───────────────────────────────────────────────
CREATE TABLE crm.respuestas_rapidas (
  respuesta_id bigserial PRIMARY KEY, empresa_id uuid NOT NULL,
  atajo text NOT NULL,               -- se usa como "/atajo" en el compositor
  titulo text NOT NULL, contenido text NOT NULL,   -- admite {nombre}, {campo.clave}
  carpeta text, media_url text,
  visible_para text NOT NULL DEFAULT 'todos',       -- todos | solo_yo
  creado_por uuid,
  UNIQUE (empresa_id, atajo)
);
```

> Nota `mensajes`: la idempotencia la da `ux_mensaje_externo` (índice parcial), que reemplaza al `wa_message_id` actual.

**RLS** (patrón para todas las tablas con `empresa_id`):

```sql
CREATE FUNCTION app.mis_empresas() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT empresa_id FROM app.miembros WHERE usuario_id = auth.uid() AND activo $$;

ALTER TABLE crm.contactos ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_empresa ON crm.contactos USING (empresa_id IN (SELECT app.mis_empresas()));
-- repetir por tabla
```

La API Lambda usa la conexión de servicio y **además** filtra por `empresa_id` tomado del JWT (defensa en profundidad); RLS protege Realtime y cualquier lectura directa desde el frontend.

### Esquema `ia` (separado del núcleo)

| Tabla | Viene de | Cambio |
|---|---|---|
| `ia.agentes` | `crm.agentes` | + `empresa_id`, `activo`, `modelo` |
| `ia.perfil`, `ia.pautas`, `ia.conocimiento` | `agente_perfil`, `agente_pautas`, `agente_kb` | Genéricos, sin categorías de reparación |
| `ia.tools_habilitadas` | `agente_tools` | Catálogo de tools genéricas (§7) |
| `ia.asignacion` | nuevo | Qué canales / pipelines / etapas atiende cada agente |
| `ia.acciones`, `ia.mejoras` | `acciones_agente`, `agente_mejoras` | Registro auditable de todo lo que hizo la IA |
| `ia.trabajos` | nuevo | Estado de cada ejecución (encolado, corriendo, ok, error, cancelado) |

`crm.*` **nunca** referencia a `ia.*`. Si se borra el esquema `ia`, el CRM sigue funcionando.

---

## 7. Regla central: la IA no bloquea a los humanos

### Flujo del mensaje entrante (nuevo)

```
Meta / TikTok ──► webhook Lambda
                    1. valida firma
                    2. resuelve empresa por crm.canales(tipo, externo_id)
                    3. upsert contacto + identidad + conversación
                    4. INSERT mensaje (idempotente)
                    5. si conversación.modo='ia' y hay agente asignado → SQS.send
                    6. responde 200  (≤ 1 s, sin IA)
                                   │
                                   ▼
                    ia-worker Lambda (SQS)
                    - relee conversación: si modo pasó a 'humano' → cancela
                    - llama al modelo con tools
                    - antes de ENVIAR vuelve a verificar modo → si cambió, descarta
                    - todo envío pasa por envio.service (el mismo que usa el humano)
```

Hoy (`webhook.router.ts:436-446`, `:607-611`) el paso de IA ocurre dentro de la request de Meta con 18 s de timeout: si Claude tarda, Meta reintenta y el mensaje llega duplicado a la cola del humano.

### Reglas

1. **Humano manda siempre.** Cualquier acción humana en la conversación (enviar mensaje, tomar, asignarse) pone `modo='humano'` en la misma transacción. El worker lo lee dos veces (al empezar y antes de enviar).
2. **La IA usa los mismos endpoints de dominio** que la UI (`moverNegocio`, `aplicarEtiqueta`, `guardarCampo`, `enviarMensaje`). No hay SQL propio de la IA → no hay rutas que el humano no tenga.
3. **Tools genéricas** con IDs del catálogo de la empresa, nunca claves fijas:

| Tool | Reemplaza a |
|---|---|
| `mover_etapa(pipeline_id, etapa_id)` | `mover_etapa` + `cambiar_kanban` (`k0..k4`) |
| `guardar_campo(clave, valor)` | `guardar_dato` (`UPDATE crm.leads SET ${campo}`) |
| `aplicar_etiqueta(etiqueta_id)` | lógica de `GRUPOS_EXCLUSIVOS` |
| `derivar_humano(motivo)` | `derivar_humano` |
| `enviar_respuesta_rapida(atajo)` | nuevo |
| `buscar_conocimiento(consulta)` | contexto de KB inyectado |
| `proponer_mejora` | igual |

4. **Interruptores en 4 niveles:** empresa · canal · pipeline/etapa · conversación. Botón "Pausar IA" visible en la bandeja.
5. **Trazabilidad:** todo movimiento o mensaje de la IA queda con `autor_tipo='ia'` en `mensajes` y `negocio_historial`; la UI lo marca con un distintivo.
6. **Sin IA configurada el producto está completo.** Es criterio de aceptación de la Fase 2.

---

## 8. API (núcleo)

| Recurso | Endpoints |
|---|---|
| Contactos | `GET/POST /contactos` · `GET/PATCH/DELETE /contactos/:id` · `POST /contactos/importar` · `POST /contactos/:id/fusionar` |
| Pipelines | `GET/POST /pipelines` · `PATCH/DELETE /pipelines/:id` · `PUT /pipelines/orden` |
| Etapas | `POST /pipelines/:id/etapas` · `PATCH/DELETE /etapas/:id` · **`PUT /pipelines/:id/etapas/orden`** body `{ etapa_ids: [..] }` (una transacción, constraint diferido) |
| Negocios | `GET /pipelines/:id/tablero` · `POST /negocios` · **`PATCH /negocios/:id/mover`** `{ etapa_id, posicion }` · `PATCH /negocios/:id` |
| Conversaciones | `GET /conversaciones?estado&canal&asignado&etiqueta` · `POST /conversaciones/:id/mensajes` · `POST /conversaciones/:id/tomar` · `PATCH /conversaciones/:id` (estado, asignado, modo) |
| Etiquetas / Campos / Respuestas | CRUD estándar por empresa |
| Canales | Portado: embedded signup WA, páginas Messenger, OAuth TikTok, suscripción de webhook |
| IA | `/ia/agentes`, `/ia/agentes/:id/{perfil,pautas,conocimiento,tools,asignacion}`, `/ia/acciones`, `/ia/mejoras`, `POST /ia/probar` (chat de prueba) |

Borrar una etapa con negocios exige `destino_etapa_id` (no se deja huérfano ningún negocio).

---

## 9. Qué se porta, qué se reescribe, qué se descarta

| Origen | Destino | Acción |
|---|---|---|
| `canales/tipos.ts`, `registry.ts`, `whatsapp/*`, `messenger/*`, `tiktok/*` | `canales/` | **Portar** — solo cambiar la resolución de cuenta a `crm.canales` + `empresa_id` |
| `canales/envio.service.ts` | igual | Portar; agregar `autor_tipo` y chequeo de `modo` |
| `whatsapp/signature.middleware`, `tiktok/signature.middleware` | igual | Portar sin cambios |
| `whatsapp/embedded-signup.router`, `wa-cuentas.service`, `meta-apps.service`, `username.service` | `canales/whatsapp/` | Portar; `meta_apps` queda a nivel plataforma (una App de Meta para todos los tenants) |
| `whatsapp/plantillas*.ts` (IA, WABA, media, envío) | `plantillas/` | Portar; quitar origen `servicio` |
| `whatsapp/difusion.*` | `difusiones/` | Portar; destinatarios desde contactos/etiquetas, no desde `clientes.cliente` |
| `media/*` | `media/` | Portar a Supabase Storage |
| `mensajeria/*` (chat interno) | `equipo/` | Portar; usuarios de `app.miembros` |
| `webhook.router.ts` | `webhook/` | **Reescribir** el paso 5 (encolar en vez de ejecutar) |
| `crm.service.ts`, `crm.controller.ts` | `contactos/`, `pipelines/`, `conversaciones/`, `etiquetas/`, `campos/`, `respuestas/` | **Reescribir** partido por dominio (hoy 2 363 líneas en 2 archivos) |
| `agentes/agentes.engine.ts`, `prompt-builder`, `tool-registry` | `ia/` | Portar la mecánica; reescribir tools |
| `agentes/tools/nico.tools.ts`, `registrador.tools.ts`, `supervisor.tools.ts` | `ia/tools/` | **Reescribir** genéricas (§7) |
| `agentes/derivacion/*` (horario, reglas) | `ia/derivacion/` | Portar; horario por empresa |
| `agente/` (singular, versión vieja) | — | **Descartar** (duplicado de `agentes/`) |
| `kb_falla*`, `kb_video*`, `consultar_disponibilidad_domicilio`, `context-builders` de catálogo | — | **Descartar** del núcleo |
| Legacy (`bots`, `bot_pasos`, `plantillas_mensaje`, `canales_whatsapp_backup`, `wa_cuenta_id`) | — | **No migrar** |
| Web: `BurbujaMensaje`, `AdjuntarArchivo`, `SelectorEmojis`, `CanalBadge`, `CuentaWaCard`, `NuevaCuentaModal`, `PaginasMessenger`, `CuentasTiktok`, `MetaAppsManager`, `wa-status-shared` | `components/` | Portar |
| Web: `crm/page.tsx` (1502), `configuracion-chat` (1525), `kanban` (284), `LeadPanel` | nuevas pantallas | Reescribir (tablero con dnd-kit, ficha de contacto, bandeja con Realtime) |
| Web: `plantillas/page.tsx`, `DifusionPlantillas`, `agente/page.tsx` | `/plantillas`, `/difusiones`, `/ia` | Portar y dividir en subcomponentes |

---

## 10. Plan por fases

| Fase | Contenido | Criterio de "hecho" (visible en pantalla) | Est. |
|---|---|---|---|
| **0 — Base** | Repo nuevo, Supabase, Auth, empresas/miembros/roles, RLS, layout y design system | Crear empresa, invitar usuario, entrar | 1 sem |
| **1 — Contactos + Pipelines** | Contactos (alta, ficha, importar CSV), campos personalizados, etiquetas, pipelines CRUD, etapas con reorden drag & drop, tablero con tarjetas arrastrables | Crear 2 pipelines con etapas distintas, reordenarlas y mover tarjetas | 1,5-2 sem |
| **2 — Mensajería** | Canales WA + Messenger + TikTok portados, webhook, bandeja con Realtime, asignación, notas internas, respuestas rápidas `/atajo`, adjuntos | Recibir y responder en los 3 canales **sin ningún agente IA creado** | 2 sem |
| **3 — Plantillas y difusión** | Plantillas WA con IA, envío de prueba, difusiones por etiqueta | Enviar una difusión a una etiqueta | 1 sem |
| **4 — Agente IA** | Esquema `ia`, SQS + worker, tools genéricas, sección `/ia`, pausar IA, registro de acciones | Humano toma la conversación a mitad de una respuesta de la IA y la IA no envía nada | 1,5-2 sem |
| **5 — SaaS** | Onboarding, límites por plan, panel superadmin, equipo interno, métricas básicas (conversión por etapa) | Alta de empresa nueva de punta a punta | 1 sem |

Total: **~7-9 semanas**.

### Migración de datos de ReparaTego (opcional)

Si ReparaTego pasa a usar el CRM nuevo como un tenant más: script de ETL `crm.leads → contactos + negocios` (columnas de equipo → `valores jsonb`), K0-K4 → 5 pipelines, `mensajes` conservando `externo_id`. Se hace **después** de la Fase 2, con ReparaTego apuntando al CRM por API.

---

## 11. Riesgos y temas abiertos

| Tema | Riesgo | Mitigación |
|---|---|---|
| App Review de Meta | Messenger `pages_messaging` Advanced Access sigue pendiente (deuda #5 actual). Para un SaaS se necesita **Tech Provider** + App Review de `whatsapp_business_management` y `pages_messaging` | Iniciar el trámite en la Fase 0; sin eso solo funciona con cuentas de prueba |
| TikTok | Integración en fase A en ReparaTego; API de mensajería con acceso restringido | Mantener detrás de feature flag por empresa |
| Webhook único multi-tenant | Una sola URL de Meta para todas las empresas | `crm.canales UNIQUE(tipo, externo_id)` resuelve la empresa; nunca confiar en parámetros de la URL |
| Costos de IA | Cada empresa consume tokens | Contador por empresa en `ia.trabajos` + límite por plan |
| Lambda + Realtime | Lambda no sostiene sockets | Realtime lo sirve Supabase directo al navegador (con RLS) |
| Nombre del producto / dominio | No definido | Pendiente de decisión |

---

## 12. Hallazgos en ReparaTego (fuera de este alcance, se reportan igual)

1. `crm.service.ts:281` — alta de etapa calcula `numero` global (`MAX(numero)+1` de todas las etapas); la etapa nueva queda con número fuera de su kanban.
2. `nico.tools.ts:214` — `UPDATE crm.leads SET ${campo}` con la clave del campo: un campo creado desde `/crm/configuracion-chat` sin columna física hace fallar `guardar_dato`.
3. `webhook.router.ts:607` — IA ejecutada dentro de la request del webhook con timeout de 18 s; riesgo de reintentos de Meta y duplicados.
4. `crm.etiquetas`, `crm.campos`, `crm.kanbans` no tienen `sucursal_id`: si ReparaTego abre otra sucursal, comparten configuración.
