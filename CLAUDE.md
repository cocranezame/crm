# CLAUDE.md — Kallpa CRM

Fuente de verdad para trabajar en este repo (humanos y agentes).

## Stack
- `apps/api`: Node 20 + Express + TypeScript (tsx), PostgreSQL 16 (`pg`), Socket.IO, zod. Sin ORM: SQL explícito y parametrizado.
- `apps/web`: Next.js 14 App Router, Tailwind, React Query, zustand, dnd-kit, Radix (dialog, dropdown, popover, tooltip), lucide-react, sonner, recharts.
- Local: `docker compose up -d --build` (db :5440, api :4000, web :3010).

## Reglas
1. **Multi-empresa siempre**: toda consulta de negocio filtra por `empresa_id` tomado de `ctx(req)`. Nunca de parámetros del cliente.
2. **Esquema**: cambios de BD solo con un archivo nuevo `apps/api/migrations/NNN_descripcion.sql` (nunca editar uno ya aplicado). Entregar también la consulta SQL para ejecutarla a mano.
3. **Envío a clientes** solo por `modules/canales/envio.service.ts`. **Mover negocios** solo por `modules/pipelines/negocios.service.ts` (`moverNegocio`, `crearNegocio`). Etiquetas con `etiquetas.service.ts` (respeta grupo exclusivo).
4. Campos personalizados en `valores jsonb`, validados con `modules/campos/valores.ts`. Nunca `SET ${columna}` dinámico.
5. Tokens de canales y secretos cifrados con `lib/crypto.ts` (AES-256-GCM). Nunca devolverlos al frontend.
6. Toda mutación relevante emite evento de tiempo real (`emitirEmpresa`) y el frontend invalida las queries (`hooks/realtime.ts`).
7. Frontend: usar el kit de `components/ui` (Button, Field, Input, Select, Modal, Drawer, Menu, Popover, Tooltip, PageHeader, Vacio, Cargando, confirmar). Todo cambio debe verse y probarse en pantalla; mantener el nivel visual profesional.
8. Textos de interfaz en español; contraseñas con `bcryptjs`.
9. La IA queda fuera de esta versión: no mezclar lógica de IA en `crm.*`; cuando se agregue irá en un esquema `ia` y consumirá los mismos servicios de dominio.
10. **Kallpasoft gobierna el acceso** (`docs/INTEGRACION-KALLPASOFT.md`). Ventanas y módulos técnicos solo en `apps/api/src/lib/catalogo.ts`; toda ruta de negocio nueva va detrás de `requireModulo(...)`. El conector `/internal/v1` es idempotente y responde `{detail}`. Nunca llamar al central en el request de un usuario.
11. **Reutilizar antes de crear**: si ya existe un componente/servicio con la misma función (modal, picker, service), se usa ese; se avisa qué se reutiliza.

## Verificación antes de entregar
- `cd apps/api && npx tsc --noEmit && npm test`
- `cd apps/web && npx tsc --noEmit`
- Recorrer la pantalla afectada (ver `COMO-PROBAR.md`).
