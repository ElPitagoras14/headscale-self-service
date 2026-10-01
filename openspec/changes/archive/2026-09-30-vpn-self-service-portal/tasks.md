## 1. Inicialización del proyecto

- [x] 1.1 Crear `package.json` con `npm init -y`, fijar `"type": "module"` y los scripts `start` (`node --env-file=.env index.js`) y `dev` (igual con `--watch`) (D1); verificar con `npm pkg get type scripts`
- [x] 1.2 Instalar `hono`, `@hono/node-server` y `resend` con `npm install`; verificar que aparecen en `dependencies` y que `npm ls --depth=0` no reporta errores
- [x] 1.3 Crear `.gitignore` con `.env` y `node_modules`, y la carpeta `public/`; verificar que existen
- [x] 1.4 Crear `.env.example` con todas las variables (`SHARED_INVITE_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM=Kokoanet VPN <vpn@mail.elpitagoras14.qzz.io>`, `HEADSCALE_API_KEY`, `HEADSCALE_FIXED_USER=kokoanet`, `PORT`, `TRUST_PROXY`) y comentarios sobre `TRUST_PROXY` (`0` local, `2` en Cloudflare + Dokploy) sin secretos reales; verificar que no contiene valores de llaves

## 2. Backend: base y configuración

- [x] 2.1 Crear `index.js` con la lectura y validación de configuración al arrancar (D2): obligatorias presentes, `TRUST_PROXY` entero ≥ 0, `PORT` por defecto 3000, y las constantes `HEADSCALE_URL`, `EMAIL_DOMAIN`, `KEY_TTL_MINUTES`, `TIMEZONE`; verificar que `node index.js` sin `.env` termina con código 1 y muestra solo los nombres de las variables faltantes
- [x] 2.2 Montar la app Hono con `serveStatic` sobre `./public` en `/` y arrancar con `serve` en `PORT`; verificar con un `public/index.html` provisional que `curl http://localhost:3000/` devuelve el HTML
- [x] 2.3 Implementar `UpstreamError` y `app.onError` (D7): `UpstreamError` → `502 { error }` genérico y cualquier otro error → `500 { error }` genérico, registrando en el log solo el mensaje interno; verificar forzando ambos errores en una ruta temporal

## 3. Backend: control de acceso (`portal-access`)

- [x] 3.1 Implementar la comparación del token con SHA-256 y `crypto.timingSafeEqual`, tratando un token ausente o no string como vacío (D3); verificar con `node -e` que el token correcto da `true` y que un token vacío, distinto o de otra longitud da `false`
- [x] 3.2 Implementar la resolución de IP según `TRUST_PROXY` (D4): socket con `0`, y con N > 0 la entrada `len - N` de `X-Forwarded-For`, la primera si hay menos de N entradas, o el socket si falta la cabecera; verificar con `node -e` los casos `0`, `2` con 3 entradas, `2` con 1 entrada y sin cabecera
- [x] 3.3 Implementar los contadores en memoria `failedAttempts` (10 / 15 min) e `invitesSent` (5 / 1 h) con ventana fija y purga periódica con `setInterval(...).unref()` (D4); verificar que el proceso termina limpio con Ctrl+C sin quedar colgado por el intervalo
- [x] 3.4 Implementar el middleware de `/api/*`: IP bloqueada → `429`, JSON inválido → `{}`, token inválido → incrementar contador, registrar la IP resuelta (nunca el token) y responder `401` (D4); verificar con `curl` que un cuerpo mal formado devuelve `401` y que el log muestra la IP sin el token
- [x] 3.5 Implementar `POST /api/verify-token` (200 con token correcto); verificar con `curl` el `200` y el `401`, y que el undécimo intento fallido dentro de 15 min devuelve `429` incluso con el token correcto

## 4. Backend: cliente de Headscale y usuario fijo

- [x] 4.1 Implementar el helper `headscale(path, init)` con `fetch`, `Authorization: Bearer`, `AbortSignal.timeout(10_000)` y `UpstreamError` en fallos de red, timeout o estados no 2xx, registrando solo la ruta y el estado (D5); verificar con una `HEADSCALE_API_KEY` inválida que se lanza `UpstreamError` y que el log no contiene cuerpos
- [x] 4.2 Implementar `getFixedUserId()` con la promesa cacheada, la coincidencia exacta por `name` y el reinicio de la caché si falla (D6); verificar contra Headscale que dos llamadas concurrentes generan una sola petición a `/api/v1/user` y que con un usuario inexistente la llamada siguiente reintenta

## 5. Backend: invitación (`device-invite`)

- [x] 5.1 Crear `email-template.js` con `escapeHtml()` y `renderInviteEmail({ key, expiresAt })`, que devuelve `{ subject, html, text }` con el HTML en tablas y estilos inline, la llave en un bloque monoespaciado, la hora en `America/Guayaquil` en formato de 24 h, el aviso de un solo uso y sin enlaces (D10); verificar con `node -e` que un `expiresAt` de `00:03Z` produce "19:03" en `html` y `text`, y que `<script>` como llave sale escapado en el HTML
- [x] 5.2 Implementar la normalización y validación de `username` (recortar espacios, minúsculas, 1–64 caracteres, regex `^[a-z0-9]+([._-][a-z0-9]+)*$`) y la construcción de `<username>@espol.edu.ec` en el servidor; verificar con `curl` que `"  JPerez "` es aceptado y que `"jperez@gmail.com"`, `""`, `"j perez"` y `".jperez"` devuelven `400`
- [x] 5.3 Implementar `POST /api/invite` según el flujo de D7: comprobar `invitesSent`, validar el usuario, llamar a `getFixedUserId()`, crear la pre-auth key (`reusable: false`, `ephemeral: false`, expiración de 5 min en ISO) y comprobar que hay `preAuthKey.key`; verificar con `headscale preauthkeys list --user kokoanet` que la llave existe con esos parámetros
- [x] 5.4 Enviar el correo con `resend.emails.send({ from: RESEND_FROM, to, subject, html, text })`, revisando `error` explícitamente y convirtiéndolo en `UpstreamError`, e incrementar `invitesSent` solo si el envío tuvo éxito; verificar que llega un correo real con remitente "Kokoanet VPN", la llave y la hora correcta, y que la respuesta es `{ "success": true }`
- [x] 5.5 Verificar el límite de invitaciones: la sexta invitación exitosa de una IP dentro de una hora devuelve `429`, y ni la respuesta ni los logs contienen el valor de la llave en ningún caso

## 6. Backend: nodos (`network-nodes`)

- [x] 6.1 Implementar `POST /api/nodes` con `GET /api/v1/node`, el filtro por `user.name === HEADSCALE_FIXED_USER`, el mapeo explícito `{ id, name: givenName || name, ipAddresses ?? [], online === true, lastSeen ?? null }` y `UpstreamError` si `nodes` no es un arreglo (D8); verificar con `curl` que la respuesta solo trae esos 5 campos por nodo, sin `machineKey`, `nodeKey` ni `discoKey`, y solo nodos de `kokoanet`

## 7. Frontend (`portal-ui`)

- [x] 7.1 Crear el esqueleto de `public/index.html`: idioma `es`, Tailwind CDN, Alpine CDN con `defer` en `<head>`, raíz `x-data="vpnPortal()"` y el `<script>` con `vpnPortal()`, `initialState()` y el helper `api()` (mapeo de errores de red, `401` → `logout()`, `429` y otros) al final del `<body>` (D9); verificar que la página carga sin errores en la consola
- [x] 7.2 Implementar la vista de acceso: tarjeta centrada, campo de contraseña "Token de Acceso Global", botón "Entrar" con estado de carga y alertas rojas para `401`, `429` y error de red; verificar en el navegador cada caso y que el token no aparece en `localStorage`, `sessionStorage`, cookies ni la URL
- [x] 7.3 Implementar la cabecera del dashboard con "Cerrar sesión" (vuelve a `initialState()`) y la carga automática de nodos al entrar; verificar que al cerrar sesión todos los campos quedan vacíos y que recargar la página vuelve a pedir el token
- [x] 7.4 Implementar la sección "Nuevo Usuario": campo de usuario con el sufijo fijo `@espol.edu.ec`, `usernameValid` con la misma regex del backend, el botón "1. Enviar llave temporal a mi correo" deshabilitado si el usuario es inválido o hay una petición en curso, y los mensajes de éxito y error; verificar que el botón se habilita con `jperez`, se deshabilita con `j@p` o vacío, y que un envío real muestra el mensaje de éxito
- [x] 7.5 Implementar los campos de llave y hostname, la normalización a kebab-case con "Se usará: …" y los getters `windowsCmd` y `linuxCmd`, que omiten `--hostname=` cuando queda vacío (D9); verificar que `Mi Laptop_Dell!` da `mi-laptop-dell`, `Portátil de José` da `portatil-de-jose`, `!!!` omite `--hostname=` y que la llave se recorta
- [x] 7.6 Implementar los bloques de código oscuros con un botón de icono "Copiar al portapapeles" dentro del bloque, con ajuste de línea para ver el comando completo, la confirmación de unos 2 s y el mensaje de error si la copia falla; verificar que se pega exactamente el comando mostrado en cada sistema
- [x] 7.7 Implementar la sección "Dispositivos conectados": botón "Actualizar tabla" (con icono de refrescar, sin emojis) con estado de carga y tabla con desplazamiento horizontal propio (Hostname, primera IP o "—", indicador verde "En línea" o rojo "Desconectado", y `lastSeen` en formato local o "Nunca"), con mensaje si la tabla está vacía y error que conserva las filas previas; verificar con datos reales y a 375 px de ancho que la página no se desborda

## 8. Verificación integral y despliegue

- [ ] 8.1 Recorrer en local el flujo completo: entrar con el token, pedir la llave, recibir el correo, ejecutar `tailscale up` con el comando generado en un dispositivo real y verlo "En línea" tras pulsar "Actualizar Tabla"; verificar también que un `401` durante el uso del dashboard cierra la sesión (se ejecutará en producción junto con 8.2; el comando `tailscale up` ya fue validado manualmente por el usuario)
- [ ] 8.2 Desplegar en Dokploy detrás de Cloudflare con `TRUST_PROXY=2`, configurar `forwardedHeaders.trustedIPs` de Traefik con los rangos de Cloudflare y servir por HTTPS; verificar enviando un token inválido desde dos redes distintas que los logs registran dos IPs públicas diferentes, que no son de Cloudflare ni de Docker
