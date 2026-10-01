# syntax=docker/dockerfile:1

# ---- Etapa 1: dependencias de produccion --------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# Dependencias primero: editar el codigo no invalida esta capa
COPY package.json package-lock.json ./
# La cache de npm vive en un cache mount: no queda en ninguna capa
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---- Etapa 2: imagen final ----------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000

# tini: Node como PID 1 ignora SIGTERM y `docker stop` tardaria 10 s.
# npm/npx/corepack no se usan en runtime (se arranca con `node index.js`).
RUN apk add --no-cache tini \
    && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
              /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app
RUN chown node:node /app
USER node

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node index.js email-template.js ./
COPY --chown=node:node public ./public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
