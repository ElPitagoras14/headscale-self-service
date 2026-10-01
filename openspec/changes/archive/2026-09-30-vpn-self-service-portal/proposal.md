## Why

Hoy, sumar un dispositivo a la VPN Headscale requiere que un administrador genere manualmente una pre-auth key y se la entregue a cada persona. Un portal de autogestión permite que cualquier miembro de ESPOL con el token de invitación compartido obtenga por correo una llave temporal de un solo uso, conecte su dispositivo y vea el estado de la red, sin intervención del administrador.

## What Changes

- Nuevo proyecto Node.js stateless (Hono + `@hono/node-server`) que sirve `public/index.html` y expone 3 endpoints JSON.
- Configuración vía `node --env-file=.env` con las variables `SHARED_INVITE_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM` (remitente del dominio verificado `mail.elpitagoras14.qzz.io`), `HEADSCALE_API_KEY` y `HEADSCALE_FIXED_USER` (`kokoanet`).
- `POST /api/verify-token`: valida el token compartido (200 / 401) con comparación en tiempo constante y límite de intentos por IP.
- `POST /api/invite`: recibe `{ username, token }` (solo la parte local del correo); el backend valida y construye `username@espol.edu.ec`, crea en Headscale 0.29.3 una pre-auth key no reutilizable, no efímera y con expiración de 5 minutos para el usuario fijo, y la envía por correo con el SDK de Resend.
- Resolución del ID numérico del usuario fijo (`kokoanet`) contra la API de Headscale, cacheado de por vida del proceso (sin cachear fallos).
- `POST /api/nodes`: valida el token y devuelve los nodos del usuario fijo como `[{ id, name, ipAddresses, online, lastSeen }]`.
- Frontend de una sola página (Tailwind CDN + Alpine.js CDN, `x-data="vpnPortal()"`) con vista de acceso por token y dashboard: solicitud de llave, generación reactiva de comandos `tailscale up` para Windows y Linux con hostname normalizado a kebab-case, copia al portapapeles y tabla de dispositivos con refresco manual y automático.

## Capabilities

### New Capabilities
- `portal-access`: verificación del token de invitación compartido, comparación en tiempo constante y limitación de intentos.
- `device-invite`: validación del usuario institucional, resolución y cacheo del ID del usuario fijo, emisión de la pre-auth key temporal en Headscale y envío por correo vía Resend.
- `network-nodes`: consulta de nodos en Headscale, filtrado por el usuario fijo y normalización de la respuesta.
- `portal-ui`: vistas de acceso y dashboard en Alpine.js, estados de carga y error, construcción de comandos de conexión, normalización de hostname y tabla de dispositivos.

### Modified Capabilities
<!-- Ninguna: proyecto nuevo sin specs existentes. -->

## Impact

- **Código nuevo**: `index.js`, `public/index.html`, `package.json`, `.env.example`, `.gitignore`.
- **Dependencias**: `hono`, `@hono/node-server`, `resend`. Requiere Node.js ≥ 20.6 (soporte de `--env-file`); entorno actual Node 24.
- **Sistemas externos**: API REST de Headscale 0.29.3 en `https://headscale.elpitagoras14.qzz.io` (`/api/v1/user`, `/api/v1/preauthkey`, `/api/v1/node`) y API de Resend con el dominio verificado `mail.elpitagoras14.qzz.io`.
- **Seguridad**: el token compartido es el único control de acceso; las llaves emitidas son de un solo uso y expiran en 5 minutos, y solo se entregan a buzones `@espol.edu.ec`.
