## Why

El portal ya tiene `Dockerfile`, pero no hay forma de versionarlo ni publicarlo: cada despliegue depende de construir desde el repositorio y no existe una versión que identifique qué imagen corre en producción. Un pipeline que publique en GHCR solo cuando la versión sube da imágenes inmutables y trazables que Dokploy puede consumir.

## What Changes

- Nuevo archivo `VERSION` en la raíz con `0.1.0` como única fuente de verdad de la versión.
- `package.json` pasa de `1.0.0` a `0.1.0`; el pipeline falla si ambos difieren.
- Nuevo workflow de GitHub Actions que se ejecuta solo con `push` a `main` (no hay trigger de `pull_request`: en PR no se hace nada).
- El workflow compara `VERSION` con el último tag `v*`: si no hay tag, o `VERSION` es mayor (semver), construye la imagen, la publica en `ghcr.io` con los tags `X.Y.Z`, `X.Y` y `latest`, y después crea el tag `vX.Y.Z` y el GitHub Release.
- Tras el release, un job despliega en Dokploy llamando a la API (`compose.deploy`) del servicio compose en `https://dokploy.elpitagoras14.qzz.io`, con el API key y el `composeId` guardados en GitHub (secret y variable).
- Si `VERSION` es menor o igual que el último tag, el workflow termina con éxito sin publicar nada y deja un aviso.
- Sin cambios en el código de la aplicación ni en el `Dockerfile`.

## Capabilities

### New Capabilities
- `release-pipeline`: contrato del versionado y la publicación: fuente de la versión, condición para publicar, artefactos publicados (imagen, tag, release) y comportamiento ante fallos y versiones no incrementadas.

### Modified Capabilities
<!-- Ninguna: no hay specs principales previas. -->

## Impact

- **Código nuevo**: `VERSION`, `.github/workflows/release.yml`. Se modifica el campo `version` de `package.json`.
- **Sistemas**: Dokploy (`https://dokploy.elpitagoras14.qzz.io`), servicio de tipo compose; GitHub Actions y GHCR (`ghcr.io/<owner>/<repo>`), con permisos `contents: write` y `packages: write` vía `GITHUB_TOKEN`.
- **Prerrequisito**: el directorio aún no es un repositorio git; hace falta inicializarlo y crear el remoto en GitHub con rama `main` antes de que el pipeline pueda ejecutarse.
- **Configuración en GitHub**: secret `DOKPLOY_API_KEY` y variable `DOKPLOY_COMPOSE_ID`.
- **Relación**: `dockerize-portal` (el `Dockerfile` que se publica) y la tarea 4.2 de ese change, donde Dokploy podría desplegar desde GHCR en vez de construir.
