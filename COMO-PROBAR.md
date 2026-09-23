# Cómo levantar y probar el CRM en local

> Requisitos: **Docker Desktop abierto**. Todo se corre desde `C:\Users\usuario\crm`.

## 1. Levantar

```powershell
cd C:\Users\usuario\crm
docker compose up -d --build
docker compose logs -f api
```

Espera a ver en el log del API:

```
[migrate] ✔ 001_base.sql
[seed] ✔ listo — ingresa con admin@demo.com / admin123
[crm-api] escuchando en http://localhost:4000
```

La primera vez tarda unos minutos (descarga imágenes e instala dependencias). La web compila cada pantalla la primera vez que la abres (unos segundos).

Abre **http://localhost:3010** e ingresa con `admin@demo.com` / `admin123`.

> Si un puerto está ocupado (3010, 4000 o 5440), cambia el primer número del par `"3010:3010"` en `docker-compose.yml`.
> Si cambias el puerto del API, actualiza también `NEXT_PUBLIC_API_URL` (servicio web) y `PUBLIC_API_URL` del servicio `api`.

## 2. Recorrido de prueba (lo que debe verse en pantalla)

| # | Dónde | Qué hacer | Qué debe pasar |
|---|---|---|---|
| 1 | **Inicio** | Cambiar 7 / 30 / 90 días | KPIs, gráfico de mensajes, embudo y ranking se recalculan |
| 2 | **Configuración → Canales** | En el *Simulador*, elegir "WhatsApp Ventas", escribir un mensaje y enviar | Toast "Mensaje recibido"; el badge de **Bandeja** sube sin recargar |
| 3 | **Bandeja** | Abrir la conversación nueva y responder | El mensaje sale con ✓, luego ✓✓ y ✓✓ azul (acuses simulados); la conversación queda asignada a ti |
| 4 | **Bandeja** | Escribir `/` en el cuadro de texto | Aparecen las respuestas rápidas; Enter inserta el texto con `{nombre}` y `{empresa}` reemplazados |
| 5 | **Bandeja** | Pestaña *Nota interna* | La nota se ve en amarillo y no se envía al cliente |
| 6 | **Bandeja** | Adjuntar una imagen o PDF | Se sube y se muestra en la burbuja |
| 7 | **Bandeja** | Asignar a otra persona, marcar pendiente, resolver, reabrir | Cada acción deja un evento gris en el historial del chat |
| 8 | **Bandeja** (2 navegadores) | Entra como `luis@demo.com` en otra ventana (incógnito) y abre la misma conversación | Ves los mensajes del otro en vivo y el aviso "está escribiendo…" |
| 9 | **Pipelines** | Arrastrar una tarjeta a otra etapa / reordenar dentro de la columna | Se mueve al instante y queda guardado (recarga para comprobarlo) |
| 10 | **Pipelines** | Soltar en "Ganado" | Toast de felicitación; la tarjeta queda cerrada y cuenta en *Ganado en el período* |
| 11 | **Pipelines** | Clic en una tarjeta | Panel lateral: editar monto, responsable y campos; historial de etapas |
| 12 | **Configuración → Pipelines** | Crear un pipeline, agregar etapas y reordenarlas arrastrando | El tablero nuevo aparece como pestaña en Pipelines |
| 13 | **Configuración → Pipelines** | Borrar una etapa con negocios | Pide la etapa destino; ningún negocio queda huérfano |
| 14 | **Configuración → Campos** | Crear un campo tipo *Opción* para Contacto | Aparece en el alta de contacto, la ficha y el panel de la bandeja |
| 15 | **Configuración → Etiquetas** | Aplicar "Frío" y luego "Caliente" a un contacto | Solo queda "Caliente" (grupo exclusivo *temperatura*) |
| 16 | **Contactos** | Nuevo contacto con teléfono `987654321` | Se guarda como `+51 987 654 321`; si repites el número avisa duplicado |
| 17 | **Contactos** | Importar CSV (hay botón para descargar una plantilla) | Mapeo automático de columnas, resumen de creados / omitidos / errores |
| 18 | **Contactos → ficha** | *Fusionar* con otro contacto | Conversaciones, notas, etiquetas y negocios pasan al contacto que queda |
| 19 | **Contactos → ficha** | *Enviar WhatsApp* a un contacto manual | Abre la conversación; como el cliente no escribió, pide usar plantilla |
| 20 | **Plantillas** | Crear plantilla con `{{1}}` → *Enviar a revisión* | En el canal de prueba pasa a **Aprobada** a los ~3 s |
| 21 | **Difusiones** | Nueva difusión a la etiqueta "Caliente" → Iniciar | La barra de progreso avanza en vivo hasta *Completada* |
| 22 | **Chat del equipo** | Escribir en "Equipo de ventas" con dos usuarios | Llega en vivo; el badge del menú marca no leídos |
| 23 | **Configuración → Equipo** | Invitar `nuevo@demo.com` | Muestra el enlace; ábrelo en incógnito, crea la contraseña y entra |
| 24 | **Plataforma** (solo admin@demo.com) | Cambiar el plan de la empresa a *Prueba* | Los límites del plan se aplican (p. ej. máximo 3 usuarios) |
| 25 | Sesión de `luis@demo.com` (agente) | Recorrer Configuración y Difusiones | Acciones de administración ocultas o bloqueadas |

## 3. Probar un webhook "real" sin Meta

El API acepta el payload nativo de Meta firmado con `META_APP_SECRET`. En PowerShell:

```powershell
# 1) Pon un secreto en Plataforma → Plataforma → Meta · App Secret (ej. supersecreto)
# 2) ID externo del canal de prueba de WhatsApp
$ext  = (docker compose exec -T db psql -U postgres crm -tAc "select externo_id from crm.canales where tipo='whatsapp' and sandbox limit 1").Trim()
$body = '{"object":"whatsapp_business_account","entry":[{"id":"x","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"","phone_number_id":"' + $ext + '"},"contacts":[{"wa_id":"51911122233","profile":{"name":"Webhook"}}],"messages":[{"from":"51911122233","id":"wamid.prueba1","timestamp":"1700000000","type":"text","text":{"body":"hola"}}]}}]}]}'
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [Text.Encoding]::UTF8.GetBytes("supersecreto")
$sig  = -join ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)) | ForEach-Object { $_.ToString("x2") })
Invoke-RestMethod -Method Post -Uri http://localhost:4000/webhooks/meta -ContentType "application/json" -Headers @{ "x-hub-signature-256" = "sha256=$sig" } -Body $body
```

Repetir el mismo POST no duplica el mensaje (idempotencia por `externo_id`); una firma incorrecta responde 401.

## 4. Base de datos

- El esquema completo está en `apps/api/migrations/001_base.sql` y se aplica solo al arrancar el API (tabla `public.schema_migrations`). Si prefieres ejecutarlo tú: `docker compose exec -T db psql -U postgres crm < apps/api/migrations/001_base.sql`.
- Conexión desde DBeaver / DbSchema: host `localhost`, puerto `5440`, BD `crm`, usuario y contraseña `postgres`.
- Reiniciar desde cero (borra todo y vuelve a sembrar): `docker compose down -v` y luego `docker compose up -d`.

## 5. Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| La web dice "No se pudo conectar con el servidor" | El API no terminó de arrancar: `docker compose logs api` |
| Cambios de código no se reflejan | Hot reload por *polling*; espera 2–3 s o `docker compose restart web` |
| Imágenes de la bandeja no cargan | `PUBLIC_API_URL` debe ser la URL con la que el navegador llega al API |
| `limite_plan` al invitar o crear | Sube el plan de la empresa en **Plataforma** |
