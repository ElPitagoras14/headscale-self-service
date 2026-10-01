## 1. Contexto de construcción

- [x] 1.1 Crear `.dockerignore` con `node_modules`, `.env`, `.env.*` con la excepción `!.env.example`, `.git`, `openspec`, `.claude`, `.zed`, `*.log`, `Dockerfile` y `.dockerignore` (D4); verificar que el archivo existe y que `docker build` no envía `.env` (se confirma en 3.1)

## 2. Imagen

- [x] 2.1 Crear el `Dockerfile` en dos etapas: `deps` (`node:22-alpine`, `COPY package.json package-lock.json`, `npm ci --omit=dev` con cache mount) y la etapa final (`node:22-alpine`, `COPY --from=deps` de `node_modules`, y `COPY` de `package.json`, `index.js`, `email-template.js` y `public`) (D1–D3); verificar con `docker build -t vpn-portal .` que la construcción termina sin errores
- [x] 2.2 Añadir `ENV NODE_ENV=production` y `ENV PORT=3000`, `USER node` con `COPY --chown=node:node`, `apk add --no-cache tini` con `ENTRYPOINT ["/sbin/tini", "--"]`, `CMD ["node", "index.js"]` y el retiro de `npm`, `npx`, `corepack` y `yarn` de la imagen final (D3, D5–D7); verificar con `docker run --rm --entrypoint id vpn-portal` que el usuario no es `root` y que `docker run --rm --entrypoint sh vpn-portal -c "command -v npm"` no encuentra `npm`
- [x] 2.3 Añadir el `HEALTHCHECK` con `wget` que consulta `http://127.0.0.1:${PORT}/` (D8); verificar con `docker inspect --format '{{json .Config.Healthcheck}}' vpn-portal` que está declarado

## 3. Verificación de la imagen

- [x] 3.1 Comprobar el contenido: `docker run --rm --entrypoint sh vpn-portal -c "ls -A /app; ls /app/node_modules | head"` debe mostrar `index.js`, `email-template.js`, `public`, `package.json` y `node_modules` con `hono`, `@hono/node-server` y `resend`, y ningún `.env`; verificar también que `/app/node_modules` no contiene paquetes de desarrollo
- [x] 3.2 Arrancar con `docker run --rm -p 3000:3000 --env-file .env vpn-portal` y verificar que `curl http://localhost:3000/` devuelve `200` y que `POST /api/verify-token` con el token correcto devuelve `200`
- [x] 3.3 Arrancar sin `SHARED_INVITE_TOKEN` y verificar que el contenedor termina con código distinto de cero y que el log muestra solo el nombre de la variable
- [x] 3.4 Comprobar la salud y el apagado: verificar que `docker ps` pasa a `healthy` tras unos segundos y que `docker stop` termina en menos de 5 segundos

## 4. Despliegue

- [x] 4.1 Documentar en `.env.example` o en el README las variables que Dokploy debe configurar y que el contenedor no lee `.env`; verificar que la lista coincide con la del `index.js`
- [ ] 4.2 Desplegar en Dokploy con build tipo Dockerfile, las variables de entorno (con `TRUST_PROXY=2`) y una sola réplica; verificar que la aplicación aparece como `healthy` y responde por su dominio (el resto de la tarea 8.2 de `vpn-self-service-portal` sigue en ese change)
