# Kallpa CRM

CRM multi-empresa (SaaS) con bandeja multicanal —WhatsApp, Messenger y TikTok—, contactos, pipelines con *drag & drop*, plantillas de WhatsApp, difusiones y chat interno del equipo.

Nace de la extracción del CRM de ReparaTego (ver [`docs/informe-tecnico.md`](docs/informe-tecnico.md)). Esta primera versión corre **100 % en local con Docker** y **no incluye el agente IA** (queda preparado: `conversaciones.modo`, `autor_tipo='ia'`, `negocio_historial.actor_tipo`).

## Arranque rápido

Requisitos: **Docker Desktop** abierto.

```powershell
cd C:\Users\usuario\crm
docker compose up -d --build
```

| Servicio | URL | Notas |
|---|---|---|
| Web (Next.js 14) | http://localhost:3010 | hot reload |
| API (Express + TS) | http://localhost:4000/health | hot reload, migra y siembra al arrancar |
| PostgreSQL 16 | `localhost:5440` · usuario `postgres` / `postgres` · BD `crm` | volumen `crm_pgdata` |

Usuarios de demostración (contraseña `admin123`): `admin@demo.com` (superadmin + propietario), `ana@demo.com` (supervisora), `luis@demo.com` (agente).

La guía paso a paso para revisar cada pantalla está en [`COMO-PROBAR.md`](COMO-PROBAR.md).

## Qué incluye

| Módulo | Ruta | Resumen |
|---|---|---|
| Inicio | `/inicio` | KPIs, mensajes por día, embudo por pipeline, ranking del equipo |
| Bandeja | `/inbox` | Conversaciones en tiempo real (Socket.IO), asignación, tomar, estados, notas internas, respuestas rápidas con `/atajo`, emojis, adjuntos, plantillas fuera de ventana, avisos de ventana 24 h / 48 h |
| Contactos | `/contactos`, `/contactos/[id]` | Registro, ficha, identidades por canal, campos personalizados, etiquetas, notas, importar/exportar CSV, fusionar |
| Pipelines | `/pipelines/[id]` | Varios tableros; tarjetas arrastrables entre etapas y dentro de la columna; SLA por etapa; historial de movimientos |
| Plantillas | `/plantillas` | Plantillas WhatsApp con vista previa, variables mapeadas a contacto/campo/empresa/manual, envío a revisión y sincronización con Meta |
| Difusiones | `/difusiones` | Envío masivo por etiqueta con progreso en vivo (se reanuda si el API se reinicia) |
| Chat del equipo | `/equipo` | Directos y grupos en tiempo real |
| Configuración | `/config/*` | Pipelines y etapas (orden con *drag & drop*), etiquetas con grupo exclusivo, campos personalizados, respuestas rápidas, canales (+ simulador), equipo e invitaciones |
| Plataforma | `/admin` | Solo superadmin: empresas, planes y límites, credenciales de Meta/TikTok |

## Arquitectura

```
apps/
  api/                         Express + TypeScript (tsx en dev)
    migrations/001_base.sql    Esquema completo (app.* y crm.*)
    src/
      db/        pool, migrate, seed
      lib/       http (errores), crypto (AES-256-GCM), storage (archivos firmados), planes, realtime (Socket.IO)
      middlewares/auth.ts      JWT propio + roles (propietario > admin > supervisor > agente)
      modules/
        auth · equipo · contactos · campos · etiquetas · respuestas · pipelines
        conversaciones · canales · plantillas · difusiones · chat · metricas · admin · media
  web/                         Next.js 14 App Router + Tailwind + React Query + dnd-kit
    app/(auth)   login, registro, invitación
    app/(app)    pantallas del CRM
    components/ui    design system propio
    components/crm   canal, campos, negocio, picker
    components/inbox burbuja, composer, panel del contacto
```

### Decisiones para el entorno local (vs. el informe)

| Informe (producción) | Local (esta versión) | Cómo se migra |
|---|---|---|
| Supabase Auth | JWT propio + `app.usuarios` (bcryptjs) | Reemplazar `middlewares/auth.ts`; el resto usa `req.auth` |
| Supabase Realtime | Socket.IO en el API (salas por empresa y por usuario) | Cambiar `lib/realtime.ts` y `hooks/realtime.ts` |
| Supabase Storage / S3 | Volumen `crm_media` + URLs firmadas con HMAC | Cambiar `lib/storage.ts` (`guardar` / `urlPublica`) |
| RLS en Postgres | `empresa_id` en todas las tablas y filtro obligatorio en cada consulta | Agregar políticas RLS al migrar a Supabase |
| SQS + Lambda | No aplica (sin IA en esta versión) | — |

### Reglas del dominio implementadas

- **Multi-empresa**: toda tabla de negocio tiene `empresa_id`; el JWT lleva la empresa activa y un usuario puede pertenecer a varias.
- **Webhook único**: la empresa se resuelve por `crm.canales(tipo, externo_id)`, nunca por la URL. Idempotencia por `ux_mensaje_externo`.
- **Etapas por pipeline**: `orden` único por pipeline, reorden atómico (constraint `DEFERRABLE`); borrar una etapa con negocios exige destino.
- **Campos personalizados** en `valores jsonb` validados contra `crm.campos` (se eliminó el `UPDATE ... SET ${campo}` de ReparaTego).
- **Etiquetas excluyentes** por `grupo_exclusivo` en BD.
- **Envío unificado** (`canales/envio.service.ts`): el mensaje se guarda como `pendiente`, se envía y se actualiza; un envío humano pone `modo='humano'` y se asigna la conversación.
- **Límites por plan** (`lib/planes.ts`): usuarios, contactos, canales reales y difusiones por mes.

## Canales reales (Meta / TikTok)

1. Como superadmin, en **Plataforma → Plataforma** registra App ID/Secret de Meta (y Configuration ID para Embedded Signup) y de TikTok.
2. Expón el API con un túnel HTTPS (`ngrok http 4000` o `cloudflared`) y pon esa URL en `PUBLIC_API_URL` (servicio `api` de `docker-compose.yml`).
3. Webhooks: `https://<túnel>/webhooks/meta` (verify token en Plataforma) y `https://<túnel>/webhooks/tiktok`.
4. Conecta la cuenta en **Configuración → Canales**.

Sin nada de eso, usa los **canales de prueba** y el **simulador**: recorren el mismo adaptador y la misma ingesta que un webhook real.

## Comandos útiles

```powershell
docker compose logs -f api web          # ver logs
docker compose restart api              # reiniciar el API
docker compose down                     # apagar (los datos quedan en el volumen)
docker compose down -v                  # apagar y BORRAR la base y archivos (vuelve a sembrar al subir)
docker compose exec api npm test        # pruebas unitarias del API
docker compose exec db psql -U postgres crm
```

Sin Docker para el código (solo la BD en Docker): `docker compose up -d db`, luego en `apps/api` crear `.env` con `DATABASE_URL=postgresql://postgres:postgres@localhost:5440/crm` y `npm install && npm run migrate && npm run seed && npm run dev`; en `apps/web` `npm install && npm run dev`.
