## Context

Motivación en `proposal.md` → Why; comportamiento exigido en `specs/container-deployment/spec.md`. Estado actual y restricciones:

- Proyecto ESM sin build: `index.js`, `email-template.js` y `public/index.html`. Dependencias de producción: `hono`, `@hono/node-server`, `resend`; hay `package-lock.json`.
- `npm start` ejecuta `node --env-file=.env index.js`, que falla si el archivo no existe. En Dokploy las variables se inyectan por entorno, así que el contenedor no puede usar ese script.
- `index.js` ya valida la configuración al cargar y termina con código 1 mostrando solo nombres de variables. Escucha en `PORT` (por defecto 3000).
- `/` sirve `public/index.html` de forma estática, por lo que sirve como endpoint de salud sin añadir código.
- Desarrollo local en Node 24; el `package.json` no fija `engines`. Node ≥ 20.6 es el mínimo por la dependencia de `--env-file` en local.

## Goals / Non-Goals

**Goals:**
- Imagen pequeña, reproducible y sin secretos.
- Reconstrucciones rápidas cuando solo cambia el código.
- Cero cambios en el código de la aplicación.

**Non-Goals:**
- Configurar Traefik (`forwardedHeaders.trustedIPs`), Cloudflare ni el firewall: siguen en la tarea 8.2 de `vpn-self-service-portal`.
- Orquestación (Compose, Kubernetes) y publicación en un registro.
- Cambiar `npm start` o `npm run dev`.

## Decisions

### D1 - Imagen base `node:22-alpine`
Alpine reduce el tamaño frente a `node:22` (Debian completo). Node 22 es LTS y cumple el mínimo de 20.6. *Alternativa descartada*: `node:24-alpine` para igualar el entorno local; se mantiene 22 por pedido explícito y por ser LTS. Se asume que ninguna dependencia requiere Node 24.

### D2 - Construcción en dos etapas y capas ordenadas para el caché
```
FROM node:22-alpine AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:22-alpine
COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.js email-template.js ./
COPY public ./public
```
La etapa `deps` instala; la final solo recibe `node_modules` y el código. `package*.json` se copia antes del código: editar HTML o JS no invalida la capa de dependencias. Se copian archivos concretos y no `COPY . .`, de modo que un archivo nuevo nunca entra a la imagen por accidente, aunque el `.dockerignore` falle. `package.json` también va a la etapa final porque `"type": "module"` es necesario en ejecución.
No hay paso de compilación, así que la ganancia de las dos etapas es modesta: dejar fuera la caché de npm y poder retirar `npm`, `npx`, `corepack` y `yarn` de la imagen final (D3). *Alternativa descartada*: una sola etapa; funciona, pero deja `npm` y su caché en la imagen.

### D3 - `npm ci --omit=dev`, caché fuera de las capas y sin gestores de paquetes en runtime
`npm ci` respeta el lockfile y falla si no coincide con `package.json`; `--omit=dev` deja fuera herramientas de desarrollo futuras. En lugar de `npm cache clean --force`, la caché de npm usa un *cache mount* de BuildKit: no se graba en ninguna capa y acelera las reconstrucciones. En la etapa final se eliminan `npm`, `npx`, `corepack` y `yarn`, porque el contenedor arranca con `node index.js`; reduce tamaño y superficie de ataque. Consecuencia: dentro del contenedor no hay `npm`.

### D4 - `.dockerignore` como defensa en profundidad
Excluye `node_modules`, `.env`, `.env.*` con la excepción `!.env.example`, `.git`, `openspec`, `.claude`, `.zed`, `*.log`, `Dockerfile` y `.dockerignore`. Reduce el contexto enviado al daemon y evita copiar binarios de Windows o secretos. Complementa a D2: aunque se cambiara a `COPY . .`, el `.env` no entraría.

### D5 - Arranque con `node index.js`
`CMD ["node", "index.js"]` en forma exec. La configuración viene del entorno; si falta una variable, `index.js` ya termina con código 1 y el orquestador lo muestra como fallo de arranque, no como contenedor "sano pero roto". `ENV NODE_ENV=production` y `ENV PORT=3000` como valores por defecto; Dokploy puede sobrescribirlos.

### D6 - Usuario no root
`USER node` (existe en la imagen oficial), con `COPY --chown=node:node` y `WORKDIR` propiedad de `node`. El portal solo necesita leer sus archivos y abrir un puerto > 1024.

### D7 - `tini` como PID 1
Node como PID 1 no instala un manejador por defecto de `SIGTERM`: el kernel lo ignora y `docker stop` espera su tiempo de gracia (10 s) antes de matarlo. Se instala `tini` (`apk add --no-cache tini`) y `ENTRYPOINT ["/sbin/tini", "--"]`. *Alternativa descartada*: añadir `process.on('SIGTERM', ...)` en `index.js`, porque cambiaría el código de la aplicación, que este change evita. *Alternativa descartada*: depender de `docker run --init`, porque no se controla cómo Dokploy lanza el contenedor.

### D8 - `HEALTHCHECK` con `wget` de BusyBox
Alpine incluye `wget`, no `curl`. Se usa la forma de shell para leer `PORT`:
`HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/ || exit 1`.
Consulta `/` (estático, no toca Headscale ni Resend), de modo que la salud del contenedor no depende de servicios externos.

## Risks / Trade-offs

- [Dokploy construye sin BuildKit y `--mount=type=cache` falla] → Dokploy usa BuildKit por defecto; si no, se reemplaza el mount por `npm ci --omit=dev && npm cache clean --force`.
- [`HEALTHCHECK` usa `127.0.0.1` y el servidor solo escucha en IPv6 o en otra interfaz] → `@hono/node-server` escucha sin host explícito (dual-stack); se verifica con `docker run` y el estado `healthy` antes de dar la tarea por cerrada.
- [Dokploy ignora el `HEALTHCHECK` de la imagen o usa el suyo] → es inocuo; la declaración sigue sirviendo para `docker ps` y otros orquestadores.
- [`apk add tini` requiere red durante la construcción y añade una capa] → coste pequeño y aceptado; la imagen oficial de Node no trae `tini`.
- [Node 22 en la imagen y 24 en local pueden diferir en comportamiento] → el código usa solo APIs estables (`fetch`, `AbortSignal.timeout`, `crypto`, `Intl`); se prueba el contenedor antes de desplegar.
- [Los límites de tasa y el caché del ID viven en memoria] → siguen siendo de un único proceso; Dokploy debe ejecutar una sola réplica (misma restricción del change original).
- [Un `.dockerignore` mal escrito podría dejar fuera un archivo necesario, como `public/`] → se comprueba que la imagen contiene `index.js`, `email-template.js` y `public/index.html` y que `/` responde.

## Migration Plan

1. Construir y probar en local con `docker build` y `docker run --env-file .env -p 3000:3000`.
2. En Dokploy, crear la aplicación desde el repositorio con build tipo Dockerfile, definir las variables de entorno (incluido `TRUST_PROXY=2`) y el puerto de la aplicación.
3. Continuar con el resto de la tarea 8.2 de `vpn-self-service-portal`: HTTPS, `forwardedHeaders.trustedIPs` y verificación de IPs en los logs.

Rollback: volver a la imagen o commit anterior desde Dokploy; no hay datos persistentes.
