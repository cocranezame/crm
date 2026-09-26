# Integración con Kallpasoft — conector del CRM

El CRM es un **producto** gobernado por Kallpasoft (`kallpasoft-systems`), el sistema central de control
de acceso. Cumple la **ficha técnica de integración v2.1** (`kallpasoft-systems/docs/FICHA-TECNICA-INTEGRACION-KALLPASOFT.md`)
en **Nivel 2**. Referencia de comportamiento: `kallpasoft-systems/tools/producto_demo.py`.

```
KALLPASOFT ──(push /internal/v1: alta, módulos, estado, renovación, admin)──► CRM
KALLPASOFT ◄──(telemetría /api/v1/webhooks/eventos · tickets /api/v1/webhooks/tickets)── CRM
```

**Regla de oro:** el CRM autoriza a sus usuarios SOLO con su copia local (`app.tenant_config`). Nunca llama
al central en el camino de un request de usuario.

## Dónde vive cada pieza

| Pieza | Archivo |
|---|---|
| Caché del contrato (`tenant_config`) | `apps/api/migrations/002_conector_kallpasoft.sql` |
| Catálogo de ventanas y módulos técnicos (fuente única) | `apps/api/src/lib/catalogo.ts` |
| Rutas `/internal/v1/*` (auth `X-Internal-API-Key`, errores `{detail}`) | `apps/api/src/modules/kallpasoft/internal.router.ts` |
| Ciclo de vida del tenant (RUC ↔ empresa_id) | `apps/api/src/modules/kallpasoft/tenants.service.ts` |
| Gating por módulo (`403 Módulo 'X' no habilitado en este plan`) | `requireModulo` en `apps/api/src/middlewares/auth.ts` + `app.ts` |
| Suspensión (login y API bloqueados con el motivo) | `requireAuth` y `POST /auth/login` |
| `max_usuarios` | `limitesEmpresa` / `verificarLimite` en `apps/api/src/lib/planes.ts` |
| Telemetría (`tenant.stats` diaria, `tenant.limite_usuarios`) | `apps/api/src/lib/kallpasoft.ts`, `modules/kallpasoft/telemetria.ts` |
| Botón Soporte / tickets (§4.3) | `apps/api/src/modules/soporte/soporte.router.ts`, `apps/web/components/crm/soporte-modal.tsx` |
| Menú por plan y pantalla "no incluida en tu plan" | `ventanaPermitida` en `apps/web/hooks/datos.ts`, sidebar y `app/(app)/layout.tsx` |

## Identidad

- `tenant_id` = **RUC** (identidad en Kallpasoft). `empresa_id` = uuid (identidad interna del CRM).
- `app.tenant_config.tenant_id → empresa_id` es la traducción. Una empresa **sin fila** en `tenant_config`
  es **local** (p. ej. la demo): no tiene restricción de módulos ni aparece en el central.
- El cargo `admin` del contrato = rol `propietario` en el CRM.

## Módulos técnicos y ventanas

| Módulo técnico | Ventanas |
|---|---|
| `crm` | `/inicio`, `/inbox`, `/contactos`, `/pipelines`, `/plantillas`, `/config` |
| `difusiones` | `/difusiones` |
| `chat_equipo` | `/equipo` |

`["todos"]` = sin restricción. Ventana nueva → se agrega en `lib/catalogo.ts` con su módulo; la entrega
al instante todo plan que lo incluya (el central solo necesita re-sincronizar para **mostrarla**).

## Endpoints expuestos

| Método | Ruta | Notas |
|---|---|---|
| GET | `/health` | sin auth → `{status:"ok", version}` |
| GET | `/internal/v1/catalog` | autodescripción |
| POST | `/internal/v1/tenants` | 201 · 409 `{detail:{reason:"ruc_taken"|"slug_taken"}}` (el central lo trata como éxito) · siembra pipeline y etiquetas |
| PATCH | `/internal/v1/tenants/{ruc}/modulos` | reemplazo completo; `ventanas_habilitadas` null = todas las del módulo |
| PATCH | `/internal/v1/tenants/{ruc}/estado` | `activo` \| `suspendido` \| `cancelado` (+ `motivo_suspension`) |
| PATCH | `/internal/v1/tenants/{ruc}/renovar` | `fecha_fin`, `plan?` |
| GET | `/internal/v1/tenants/{ruc}/status` | estado, módulos, ventanas y `stats` |
| DELETE | `/internal/v1/tenants/{ruc}` | soft-delete: cancelado + `datos_retenidos_hasta` = hoy + 90 días |
| POST | `/internal/v1/tenants/{ruc}/admin` | idempotente: crea o actualiza la contraseña y lo deja como propietario |
| POST | `/internal/v1/tenants/{ruc}/admin/reset-password` | solo usuarios que pertenecen al tenant |

## Variables de entorno

| Variable | Uso |
|---|---|
| `INTERNAL_API_KEY` | valida los push del central y firma las llamadas salientes. Vacía → `/internal/v1` responde 403 |
| `KALLPASOFT_API_URL` | base del central. En Docker local: `http://host.docker.internal:8001` |
| `PERMITIR_NUEVA_EMPRESA` | `false` (por ahora): el menú muestra "Crear otra empresa · Próximamente" y `POST /auth/nueva-empresa` → 403 |

## Conectar en local (paso a paso)

1. `docker compose up -d --build api` en el CRM (aplica la migración 002 y carga las variables).
2. Levanta Kallpasoft (`iniciar.bat`).
3. Panel Kallpasoft → Catálogo → Productos → **+ Registrar producto**:
   `code: crm` · `url_app: http://localhost:3010` · `api_base_url: http://localhost:4000` ·
   `api_key: crm-dev-internal-key-cambiar` (la de `docker-compose.yml`) · estado `beta`.
4. **Probar conexión** (✓✓) → **Sync catálogo** (importa 8 ventanas y 3 módulos técnicos).
5. Módulo comercial **CRM** → módulos técnicos `crm, difusiones, chat_equipo` (o solo `crm` para un plan básico).
6. Paquete → Cliente (RUC) → **Nueva venta**. En el CRM aparece la empresa con su pipeline y el admin puede entrar.
7. Suspende desde el central → el login del CRM muestra el motivo.

## Producción

- `INTERNAL_API_KEY` distinta por entorno, en el secret del CRM **y** en el panel del central.
- El central llega al CRM por HTTPS (`api_base_url`). Timeout del central: 10 s — todo el conector es idempotente.
