## 1. Versión

- [x] 1.1 Crear `VERSION` en la raíz con `0.1.0` y un salto de línea final; verificar con `cat VERSION` que muestra exactamente `0.1.0` y que cumple `^[0-9]+\.[0-9]+\.[0-9]+$`
- [x] 1.2 Cambiar el campo `version` de `package.json` a `0.1.0`; verificar con `node -p "JSON.parse(require('fs').readFileSync('package.json')).version"` que devuelve `0.1.0`

## 2. Workflow

- [x] 2.1 Crear `.github/workflows/release.yml` con trigger solo `push` a `main`, `concurrency` en cola (D6) y permisos por job (D7); verificar que no contiene `pull_request` y que el YAML es válido (por ejemplo con `actionlint` o parseándolo)
- [x] 2.2 Implementar el job `version`: checkout con `fetch-depth: 0`, validación de formato y de coherencia con `package.json`, y cálculo de `should_release` y `version` con `sort -V` (D3, D4), con aviso en el resumen cuando no hay versión nueva; verificar localmente la lógica con los escenarios: sin tags, `0.1.0` vs `v0.1.0`, `0.10.0` vs `v0.9.0`, `0.1.0` vs `v0.2.0`
- [x] 2.3 Implementar el job `publish` (solo si `should_release`): `setup-buildx`, login en GHCR con `GITHUB_TOKEN`, `metadata-action` con los tags `X.Y.Z`, `X.Y` y `latest`, y `build-push-action` con el `Dockerfile` raíz y nombre en minúsculas (D5); verificar que el YAML referencia `needs: version` y la condición de `should_release`
- [x] 2.4 Implementar el job `release` (`needs: publish`): `gh release create vX.Y.Z --target $GITHUB_SHA --generate-notes` (D2); verificar que solo corre si `publish` terminó bien
- [x] 2.5 Añadir el job `deploy` (`needs: release`) que llama a `POST /api/compose.deploy` de `https://dokploy.elpitagoras14.qzz.io` con `DOKPLOY_API_KEY` y `DOKPLOY_COMPOSE_ID`, y falla si la respuesta es un error o falta alguno (D8); verificar que el YAML es válido, que `deploy` depende de `release` y que `curl` usa `--fail-with-body`

## 3. Puesta en marcha

- [ ] 3.1 Inicializar git en el proyecto con rama `main`, comprobar que `.gitignore` excluye `.env` y `node_modules`, y crear el repositorio remoto en GitHub; verificar con `git branch --show-current` que es `main` y con `git status` que `.env` no está en seguimiento
- [ ] 3.2 Configurar en el repositorio el secret `DOKPLOY_API_KEY` (API key generado en Dokploy) y la variable `DOKPLOY_COMPOSE_ID` con `nhBf2Cj__vwoxI7h8HnBt`; verificar con `gh secret list` y `gh variable list` que ambos existen
- [ ] 3.3 Preparar el servicio compose en Dokploy: `image: ghcr.io/elpitagoras14/headscale-self-service:<version>` (o `pull_policy: always` con `latest`), las variables de entorno del portal con `TRUST_PROXY=2`, y credenciales del registro GHCR (PAT `read:packages`) porque el paquete es privado; verificar con un `docker pull` desde el host de Dokploy usando esas credenciales
- [ ] 3.4 Hacer el primer push a `main`; verificar en Actions que se publica `0.1.0`: existe el tag `v0.1.0`, el Release `v0.1.0` y la imagen en GHCR con los tags `0.1.0`, `0.1` y `latest`; verificar además que se solicita el despliegue en Dokploy y que el servicio queda `healthy` en su dominio
- [ ] 3.5 Hacer un segundo push a `main` sin cambiar `VERSION`; verificar que el workflow termina en verde sin construir ni publicar y con el aviso de versión sin incrementar; verificar además que el job `deploy` no se ejecuta
- [ ] 3.6 Subir `VERSION` y `package.json` a `0.1.1` y hacer push; verificar que se publica `0.1.1` y que `latest` y `0.1` apuntan a ella; verificar además que Dokploy despliega la `0.1.1`
- [ ] 3.7 Ajustar la visibilidad del paquete en GHCR según cómo lo consuma Dokploy y verificar con `docker pull ghcr.io/<owner>/<repo>:0.1.1` desde un entorno sin sesión (si es público) o con credenciales (si es privado)
