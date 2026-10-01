## Context

Ver `proposal.md` (Why). El repositorio no está inicializado en git todavía, el `Dockerfile` existe (change `dockerize-portal`) y la app es Node 22 sin tests. No hay CI previo. Requisitos en `specs/release-pipeline/spec.md`.

## Goals / Non-Goals

**Goals:**
- Un único workflow, legible y sin dependencias externas más allá de acciones oficiales.
- Reintentos seguros: un fallo a mitad no deja una versión "quemada".

**Non-Goals:**
- Tests, lint o escaneo de vulnerabilidades en el pipeline.
- Imágenes multi-arquitectura, prereleases o ramas de mantenimiento.
- Desplegar en Dokploy (sigue en la tarea 4.2 de `dockerize-portal`).

## Decisions

**D1. Un workflow con tres jobs encadenados: `version` → `publish` → `release`.**
`version` valida el formato, la coherencia con `package.json` y decide `should_release`. `publish` construye y sube la imagen. `release` crea tag y Release. Separarlos hace visible en la UI en qué paso falló y deja `publish` y `release` con permisos mínimos propios. Alternativa: un solo job con `if` por paso; más corto pero con permisos de escritura en todos los pasos.

**D2. El tag se crea al final, vía `gh release create`.**
Crear el Release con `--target $GITHUB_SHA` crea el tag atómicamente. Si la imagen falla no hay tag, y el gate vuelve a decir "publicar" al relanzar. Si falla `release` tras publicar la imagen, relanzar reconstruye y sobreescribe los mismos tags de imagen (mismo commit) y reintenta el release. Alternativa: tag primero; un fallo posterior quemaría la versión.

**D3. Comparación con `sort -V` sobre tags `v[0-9]*`.**
`git tag -l 'v[0-9]*' | sort -V | tail -1` da el último; la versión actual es mayor si, al ordenar ambas, la actual queda última y son distintas. Sin tags, se publica. Evita dependencias y compara numéricamente (`0.10.0` > `0.9.0`). Requiere `fetch-depth: 0` y tags en el checkout. Alternativa: acción de semver de terceros; innecesaria para tres números.

**D4. Formato de `VERSION` estricto: `^[0-9]+\.[0-9]+\.[0-9]+$`.**
Sin prefijo `v` ni prerelease, así `sort -V` no tiene casos ambiguos y los tags de la imagen (`X.Y.Z`, `X.Y`) se derivan sin parsing frágil.

**D5. Tags de imagen con `docker/metadata-action`** (`type=raw` para `X.Y.Z`, `X.Y` y `latest`) y build con `docker/build-push-action` + `docker/setup-buildx-action` (el `Dockerfile` usa cache mount de BuildKit). Login en GHCR con `GITHUB_TOKEN`. El nombre de imagen usa `github.repository` en minúsculas porque GHCR rechaza mayúsculas. `latest` siempre se mueve porque el gate garantiza que la versión es la mayor.

**D6. Trigger `push` a `main` únicamente, sin `paths`, más `concurrency`** con grupo fijo y `cancel-in-progress: false`. Sin filtro de rutas, un push que no toca `VERSION` simplemente cae en "sin versión nueva". La concurrencia en cola evita la carrera entre dos pushes con la misma versión.

**D7. Permisos por job**: `version` con `contents: read`; `publish` con `contents: read` y `packages: write`; `release` con `contents: write`.

**D8. Despliegue con un job `deploy` (`needs: release`) que llama a `POST /api/compose.deploy`** de Dokploy con `x-api-key` y `composeId`, siguiendo el workflow de `aniseek`. Va después del release para que un fallo de Dokploy no queme la versión y se resuelva con "Re-run failed jobs". Usa `curl --fail-with-body`, de modo que un error HTTP falla el job de forma visible (el workflow de referencia lo silencia con `continue-on-error`). El host es fijo en el workflow (no es secreto); el API key es un secret y el `composeId` una variable del repositorio. Alternativa: webhook de auto-deploy de Dokploy; no permite encadenar el deploy tras el release ni ver el resultado en Actions.

## Risks / Trade-offs

- [Sin build en PR, un `Dockerfile` roto se descubre tras el merge] → El fallo no quema versión (D2); se corrige y se relanza.
- [Un push a `main` sin subir `VERSION` no publica nada y puede pasar desapercibido] → El job `version` deja un aviso visible en el resumen de la ejecución.
- [Tags de imagen sobreescritos al relanzar] → Solo ocurre sobre el mismo commit, por lo que el contenido es equivalente.
- [Paquete GHCR nuevo es privado por defecto] → Hay que enlazarlo al repositorio o hacerlo público desde la UI tras la primera publicación, según cómo lo consuma Dokploy.
- [`compose.deploy` solo hace `docker compose up`: con `image: ...:latest` Docker no vuelve a descargar si ya existe una `latest` local] → El compose del servicio debe referenciar la versión concreta o declarar `pull_policy: always`.
- [Con el repo y el paquete privados, Dokploy no puede descargar la imagen sin credenciales] → Configurar un registro (GHCR) con un PAT `read:packages` en Dokploy, o hacer público el paquete.
- [El servicio de Dokploy es de tipo compose, mientras `dockerize-portal` 4.2 asume build tipo Dockerfile] → El compose pasa a referenciar la imagen de GHCR; la tarea 4.2 de ese change debe ajustarse en consecuencia.
- [El directorio aún no es repositorio] → El pipeline no se puede ejecutar hasta inicializar git y crear el remoto con rama `main` (ver tareas).
