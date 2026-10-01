## Context

Proyecto nuevo, sin código previo (motivación en `proposal.md` → Why; comportamiento en `specs/`). Restricciones que moldean el diseño:

- Node.js 24 disponible; configuración por `node --env-file=.env`, sin librería de configuración.
- Stack fijado: Hono + `@hono/node-server` + SDK `resend` en el backend; un único `public/index.html` con Tailwind (CDN) y Alpine.js (CDN), sin build.
- Headscale **0.29.3**: la creación de pre-auth keys exige el **ID numérico** del usuario, no su nombre. El usuario `kokoanet` lo crea el administrador y es el único usado por el portal.
- Resend envía desde el dominio verificado `mail.elpitagoras14.qzz.io`.
- Arquitectura stateless: sin base de datos ni sesiones; el cliente reenvía el token en cada llamada.

## Goals / Non-Goals

**Goals:**
- Un solo proceso, con el backend en `index.js` legible de arriba a abajo; solo la plantilla del correo vive aparte (D10).
- Fallar al arrancar si falta configuración, en lugar de fallar en la primera petición.
- Ninguna llave ni secreto en respuestas HTTP o logs.
- Toda la lógica de UI en una función `vpnPortal()` al final del HTML.

**Non-Goals:**
- Escalado horizontal: los contadores de rate limit y el caché del ID viven en memoria de un proceso.
- Cuentas individuales, auditoría por persona o revocación de nodos desde el portal.
- Tests automatizados de extremo a extremo contra Headscale/Resend reales (se valida manualmente).
- Internacionalización: la UI es solo en español.

## Decisions

### D1 - Estructura del proyecto
```
index.js            app Hono: config, helpers, middleware, 3 rutas, serveStatic
email-template.js   renderInviteEmail(): asunto, HTML y texto del correo (D10)
public/index.html   UI completa + <script> con vpnPortal()
package.json        "type": "module"; scripts start / dev
.env.example        plantilla sin secretos
.gitignore          .env, node_modules
```
`start`: `node --env-file=.env index.js`; `dev`: igual con `--watch`. ESM (`"type": "module"`) porque Hono y Resend son ESM-first.
*Alternativa descartada*: separar en `src/routes`, `src/services`. Con 3 endpoints añade indirección sin beneficio.

### D2 - Validación de configuración al arrancar
Al cargar el módulo se leen `SHARED_INVITE_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM`, `HEADSCALE_API_KEY`, `HEADSCALE_FIXED_USER` (y opcionales `PORT`, por defecto `3000`, y `TRUST_PROXY`, entero ≥ 0, por defecto `0`; ver D4). Si falta alguna obligatoria o `TRUST_PROXY` no es un entero ≥ 0, se escribe el nombre (nunca el valor) y se termina con `process.exit(1)`. La URL de Headscale y el dominio `espol.edu.ec` son constantes en el código, igual que `KEY_TTL_MINUTES = 5`.

### D3 - Comparación del token en tiempo constante
Se calcula SHA-256 del token recibido y del configurado y se comparan con `crypto.timingSafeEqual`. Hashear primero iguala las longitudes (requisito de `timingSafeEqual`) y evita filtrar la longitud del token real. Un `token` ausente o no string se trata como cadena vacía y falla la comparación.
*Alternativa descartada*: `===`, vulnerable a timing.

### D4 - Rate limiting en memoria con ventana fija
Dos `Map` en memoria, clave = IP:
- `failedAttempts`: 10 fallos / 15 min → `429` en toda la API.
- `invitesSent`: 5 invitaciones exitosas / 1 h → `429` en `/api/invite`.

Cada entrada guarda `{ count, windowStart }`; se reinicia al expirar la ventana. Un `setInterval(...).unref()` purga entradas vencidas cada pocos minutos para acotar la memoria.

Un middleware en `/api/*` hace, en orden: (1) resolver IP, (2) si la IP está bloqueada → `429`, (3) parsear JSON (cuerpo inválido → `{}`), (4) validar token → si falla, incrementar contador, registrar en el log la IP resuelta (nunca el token) y `401`. Los handlers solo ejecutan lógica de negocio.

**IP de origen**: `TRUST_PROXY` es el **número de proxies de confianza** delante de la app.
- `TRUST_PROXY=0` (por defecto, desarrollo local sin proxy): se usa la dirección del socket (`getConnInfo` de `@hono/node-server/conninfo`) y se ignora `X-Forwarded-For`.
- `TRUST_PROXY=N > 0`: se separa `X-Forwarded-For` por comas y se toma la entrada `len - N` contando desde la izquierda, es decir, la N-ésima desde la derecha. Si la cabecera tiene menos de N entradas, se usa la primera; si no existe, la IP del socket.

Se cuenta desde la derecha porque cada proxy **añade** al final la IP de quien le habló; las entradas de la izquierda las puede escribir el cliente. Tomar la primera (como en un borrador previo) permitía falsificar la IP y evadir el límite.

Producción (Cloudflare → Traefik de Dokploy → app), `TRUST_PROXY=2`:
```
X-Forwarded-For: <basura del cliente>, <IP real>, <IP de Cloudflare>
                                       ^ len-2      ^ len-1 (añadida por Traefik)
```
Esto presupone que Traefik conserva la cabecera recibida de Cloudflare (ver Risks y Migration Plan).
*Alternativa descartada*: librería externa de rate limit. Para dos contadores simples no justifica otra dependencia.

### D5 - Cliente de Headscale con `fetch` nativo
Helper `headscale(path, init)` que antepone la URL base, agrega `Authorization: Bearer` y `AbortSignal.timeout(10_000)`, y lanza un `UpstreamError` si la conexión falla, hay timeout o el estado no es 2xx. El log registra ruta y estado, nunca el cuerpo (puede contener la llave).
*Alternativa descartada*: SDK/cliente gRPC de Headscale. La API REST es suficiente y evita dependencias.

### D6 - Caché del ID del usuario fijo como promesa
Variable de módulo `userIdPromise`. `getFixedUserId()`:
1. Si existe, la devuelve.
2. Si no, crea la promesa: `GET /api/v1/user?name=<HEADSCALE_FIXED_USER>`, busca en `users` el elemento con `name` **exactamente** igual (no se confía en que el filtro sea exacto) y devuelve su `id`.
3. Si la promesa rechaza, se asigna `userIdPromise = null` antes de propagar el error.

Cachear la promesa (no el valor) hace que peticiones concurrentes compartan una sola consulta. El `id` se envía tal como lo devuelve Headscale (grpc-gateway serializa `uint64` como string y acepta string o número al recibir).
*Riesgo asociado*: ver Risks (usuario recreado).

### D7 - Flujo de `/api/invite`
```
middleware(token OK) -> check invitesSent(IP) -> validar username
  -> getFixedUserId() -> POST /api/v1/preauthkey -> resend.emails.send
  -> incrementar invitesSent(IP) -> { success: true }
```
El contador de invitaciones solo se incrementa tras el envío exitoso, para no penalizar fallos del servidor. La expiración es `new Date(Date.now() + KEY_TTL_MINUTES * 60_000).toISOString()`.

El SDK de Resend no lanza en errores de API: devuelve `{ data, error }`, así que se revisa `error` explícitamente y se convierte en `UpstreamError`. El contenido del correo se define en D10.

Un `app.onError` único traduce `UpstreamError` → `502 { error: "..." }` y cualquier otra excepción → `500` genérico.

### D8 - Normalización de nodos
`/api/nodes` hace `GET /api/v1/node`, filtra `node.user?.name === HEADSCALE_FIXED_USER` y mapea a `{ id, name: givenName || name, ipAddresses: ipAddresses ?? [], online: online === true, lastSeen: lastSeen ?? null }`. El mapeo explícito (lista blanca) garantiza que no se filtran llaves ni rutas aunque Headscale agregue campos en el futuro. Si `nodes` no es un arreglo → `UpstreamError`.

### D9 - Frontend: Alpine sin build
- `<script defer src="alpinejs">` en `<head>` y `<script>function vpnPortal(){...}</script>` al final del `<body>`. Como `defer` ejecuta tras parsear el documento, `vpnPortal` ya existe cuando Alpine inicializa.
- Estado: `view` (`'login' | 'dashboard'`), `token`, `username`, `authKey`, `rawHostname`, `nodes`, y por sección `{ loading, error, success }`.
- Getters derivados: `usernameValid` (misma regex que el backend), `hostname` (normalizado), `windowsCmd`, `linuxCmd`. Los comandos se construyen desde un arreglo de partes y se omite `--hostname=` si `hostname` está vacío.
- Normalización de hostname: `toLowerCase()` → `normalize('NFD')` → quitar `\p{M}` → reemplazar `[^a-z0-9]+` por `-` → quitar `-` en los extremos. Se muestra debajo del campo: "Se usará: `<hostname>`". El usuario escribe libremente y el campo no se reescribe mientras escribe, para no mover el cursor.
- Helper `api(path, body)`: hace `fetch` POST con JSON, en errores de red lanza un mensaje de conexión, y mapea `401` → `logout()` + mensaje en la vista de acceso, `429` → "Demasiados intentos, espera unos minutos", otros → `error` del cuerpo o mensaje genérico.
- `logout()` reasigna todo el estado a sus valores iniciales desde una función `initialState()`, y así se evita olvidar campos.
- Al entrar al dashboard, `$nextTick` → `loadNodes()`.
- Copiar: `navigator.clipboard.writeText`, con estado `copied` de ~2 s por bloque; en `catch` → mensaje de error.

### D10 - Contenido y plantilla del correo
La plantilla vive en el código, en `email-template.js`, que exporta `renderInviteEmail({ key, expiresAt })` y devuelve `{ subject, html, text }`. `index.js` la invoca y pasa el resultado a `resend.emails.send({ from: RESEND_FROM, to, subject, html, text })`.

- **Remitente**: `RESEND_FROM=Kokoanet VPN <vpn@mail.elpitagoras14.qzz.io>` (el nombre visible va en la variable, no en el código).
- **Asunto**: "Tu llave temporal para conectarte a la VPN".
- **Contenido** (igual en HTML y texto): saludo, la llave destacada, "Expira a las HH:MM (hora de Ecuador)", "Sirve para un solo dispositivo y un solo uso", instrucción de pegarla en el paso "2. Pega la llave recibida aquí" del portal, y aviso de ignorar el correo si no se solicitó. Sin enlace al portal.
- **Hora**: `Intl.DateTimeFormat('es-EC', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false })` con la constante `TIMEZONE = 'America/Guayaquil'`. Se usa el mismo `expiresAt` enviado a Headscale, así la hora del correo coincide con la expiración real.
- **HTML compatible con clientes de correo**: layout con `<table role="presentation">`, estilos inline, ancho máximo ~560 px, tipografía de sistema, sin CSS externo, sin Tailwind, sin imágenes ni JavaScript. La llave en un bloque monoespaciado grande con `user-select: all` para seleccionarla de un clic.
- **Escape**: todo valor interpolado en el HTML pasa por un `escapeHtml()` (`& < > " '`), aunque hoy la llave sea alfanumérica.
- **Texto plano**: siempre se envía `text` junto con `html` para clientes sin HTML y para mejorar la entregabilidad.

*Alternativas descartadas*: plantillas alojadas en Resend (`template: { id, variables }`), porque la plantilla quedaría fuera del repositorio, el código dependería de un ID que debe existir en el panel y no se podría probar en local sin la cuenta; React Email (`react`), porque agrega React y un paso de JSX ajenos al stack.

## Risks / Trade-offs

- [El token compartido se filtra y cualquiera obtiene llaves] → las llaves solo llegan a buzones `@espol.edu.ec`, son de un uso y duran 5 min; mitigación operativa: rotar `SHARED_INVITE_TOKEN` y reiniciar.
- [Correo-bombing a direcciones `@espol.edu.ec` con el token] → límite de 5 invitaciones/IP/hora; no protege frente a muchas IPs, aceptado para este alcance.
- [`kokoanet` se borra y se recrea, cambiando su ID] → el caché queda obsoleto y Headscale rechaza la emisión (`502`); se documenta que hay que reiniciar el proceso tras recrear el usuario.
- [`TRUST_PROXY` menor que los proxies reales] → la IP resuelta es la de Cloudflare o Traefik, muchos usuarios comparten contador y un atacante puede bloquearlos a todos; se documenta en `.env.example` y se verifica al desplegar. [`TRUST_PROXY` mayor que los proxies reales] → se toma una entrada que escribe el cliente y se puede evadir el límite.
- [Traefik descarta el `X-Forwarded-For` de Cloudflare] → por defecto Traefik no confía en cabeceras reenviadas de IPs desconocidas y las reemplaza; la cabecera llegaría solo con la IP de Cloudflare y todos los usuarios colapsarían en las IPs de Cloudflare. Mitigación: configurar en el entrypoint de Traefik de Dokploy `forwardedHeaders.trustedIPs` con los rangos de Cloudflare y verificar en los logs la IP resuelta.
- [Acceso directo al origen saltándose Cloudflare] → la entrada `len-2` la controla el cliente; mitigación: firewall del servidor que solo acepte 80/443 desde rangos de Cloudflare.
- [Rate limit y caché se pierden al reiniciar] → aceptado; es coherente con "stateless" y un proceso único.
- [`navigator.clipboard` exige contexto seguro (HTTPS o localhost)] → en HTTP plano la copia falla y se muestra el error; el portal debe servirse por HTTPS en producción.
- [Tailwind Play CDN no está pensado para producción y ambos CDN son dependencias de terceros en runtime] → aceptado por requisito de stack; se fijan versiones mayores en las URLs.
- [Ventana de 5 min puede ser corta si el correo tarda] → el usuario solicita otra llave; `KEY_TTL_MINUTES` es una constante fácil de ajustar.
- [Hostnames muy largos] → Tailscale limita a 63 caracteres; el portal no trunca y `tailscale up` mostrará el error. Aceptado por simplicidad.

## Migration Plan

Despliegue inicial, sin datos que migrar:
1. En Headscale: `headscale users create kokoanet` y `headscale apikeys create` → `HEADSCALE_API_KEY`.
2. En Resend: dominio `mail.elpitagoras14.qzz.io` verificado (SPF/DKIM) y API key → `RESEND_API_KEY`.
3. Copiar `.env.example` a `.env`, completar valores, `npm install`, `npm start`.
4. Local: dejar `TRUST_PROXY` sin definir (`0`).
5. Producción en Dokploy detrás de Cloudflare: `TRUST_PROXY=2`; configurar `forwardedHeaders.trustedIPs` de Traefik con los rangos de Cloudflare; publicar por HTTPS.
6. Verificar: enviar un token inválido desde dos redes distintas y confirmar en los logs que se registran dos IPs públicas diferentes (no IPs de Cloudflare ni de Docker).

Rollback: detener el proceso. Las llaves ya emitidas expiran solas en 5 minutos; los nodos registrados se gestionan desde Headscale.
