## Why

El portal ya funciona en local con `node --env-file=.env`, pero la tarea 8.2 de `vpn-self-service-portal` lo despliega en Dokploy, que construye y ejecuta contenedores. Sin un `Dockerfile` y un `.dockerignore` no hay forma reproducible de empaquetarlo, y un empaquetado ingenuo copiaría `node_modules` local y el `.env` con secretos reales dentro de la imagen.

## What Changes

- Nuevo `Dockerfile` basado en `node:22-alpine` que instala solo dependencias de producción y arranca el portal con `node index.js` (la configuración llega por variables de entorno inyectadas por Dokploy, no por archivo `.env`).
- Orden de capas pensado para el caché: `package.json` y `package-lock.json` primero, `npm ci --omit=dev` con limpieza de la caché de npm en la misma capa, y después el código (`index.js`, `email-template.js`, `public/`).
- Nuevo `.dockerignore` que deja fuera `node_modules`, `.env` y variantes (salvo `.env.example`), `.git`, `openspec`, `.claude`, `.zed` y logs.
- La imagen se ejecuta como el usuario no root `node`, con un proceso de init (`tini`) para que reciba `SIGTERM` correctamente, y con un `HEALTHCHECK` que consulta `/`.
- Sin cambios en el código de la aplicación ni en los scripts de `package.json`: `npm start` sigue usando `--env-file=.env` para desarrollo local.

## Capabilities

### New Capabilities
- `container-deployment`: contrato de la imagen del portal: contenido mínimo y sin secretos, arranque solo con variables de entorno, ejecución sin privilegios, apagado limpio y comprobación de salud.

### Modified Capabilities
<!-- Ninguna: no cambia el comportamiento HTTP del portal ni hay specs principales previas que modificar. -->

## Impact

- **Código nuevo**: `Dockerfile`, `.dockerignore`. No se modifica código existente.
- **Sistemas**: Dokploy construye la imagen desde el repositorio; las variables (`SHARED_INVITE_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM`, `HEADSCALE_API_KEY`, `HEADSCALE_FIXED_USER`, `PORT`, `TRUST_PROXY=2`) se configuran en su panel.
- **Relación**: desbloquea la tarea 8.2 de `vpn-self-service-portal` (despliegue detrás de Cloudflare y Traefik). La configuración de `forwardedHeaders.trustedIPs` en Traefik y el firewall siguen siendo parte de esa tarea, no de este change.
- **Seguridad**: se reduce el riesgo de filtrar `.env` en la imagen y se elimina la ejecución como root.
