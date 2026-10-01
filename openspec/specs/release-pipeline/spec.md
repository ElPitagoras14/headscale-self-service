# release-pipeline Specification

## Purpose
Define cómo se versiona el portal y cuándo se publica una nueva imagen en GHCR, de modo que cada versión publicada sea única, trazable por tag y reproducible tras un fallo.

## Requirements

### Requirement: La versión tiene una única fuente
El archivo `VERSION` en la raíz SHALL contener la versión en formato `MAJOR.MINOR.PATCH` sin prefijo ni sufijos, y SHALL ser la fuente de verdad. El campo `version` de `package.json` MUST coincidir con `VERSION`.

#### Scenario: Versión válida y coherente
- **WHEN** `VERSION` contiene `0.1.0` y `package.json` declara `0.1.0`
- **THEN** la validación de versión pasa y el pipeline continúa

#### Scenario: package.json desalineado
- **WHEN** `VERSION` contiene `0.2.0` y `package.json` declara `0.1.0`
- **THEN** el pipeline falla sin publicar nada y el mensaje indica ambas versiones

#### Scenario: Formato inválido
- **WHEN** `VERSION` contiene `v0.1` o `0.1.0-beta`
- **THEN** el pipeline falla sin publicar nada

### Requirement: El pipeline solo actúa sobre main
El pipeline SHALL ejecutarse únicamente con un `push` a la rama `main`. En un pull request o en cualquier otra rama MUST NOT ejecutarse ni construir ni publicar nada.

#### Scenario: Push a main
- **WHEN** se hace push a `main`
- **THEN** el pipeline se ejecuta

#### Scenario: Pull request
- **WHEN** se abre o actualiza un pull request
- **THEN** el pipeline no se ejecuta

### Requirement: Publicación condicionada al incremento de versión
El pipeline SHALL publicar solo si no existe ningún tag `v*` o si la versión de `VERSION` es mayor, comparada como semver numérico, que la del tag `v*` más alto. En cualquier otro caso MUST NOT construir ni publicar.

#### Scenario: Primera publicación sin tags
- **WHEN** no existe ningún tag `v*` y `VERSION` es `0.1.0`
- **THEN** el pipeline publica la versión `0.1.0`

#### Scenario: Versión incrementada
- **WHEN** el último tag es `v0.1.0` y `VERSION` es `0.2.0`
- **THEN** el pipeline publica la versión `0.2.0`

#### Scenario: Comparación numérica y no de texto
- **WHEN** el último tag es `v0.9.0` y `VERSION` es `0.10.0`
- **THEN** el pipeline publica la versión `0.10.0`

#### Scenario: Versión sin incrementar
- **WHEN** el último tag es `v0.1.0` y `VERSION` es `0.1.0`
- **THEN** el pipeline termina con éxito, no publica nada y deja un aviso de que no hay versión nueva

#### Scenario: Versión menor que el último tag
- **WHEN** el último tag es `v0.2.0` y `VERSION` es `0.1.0`
- **THEN** el pipeline termina con éxito, no publica nada y deja un aviso

### Requirement: Imagen publicada en GHCR
Al publicar, el pipeline SHALL construir la imagen con el `Dockerfile` del repositorio y subirla a `ghcr.io/<owner>/<repo>` en minúsculas con los tags `X.Y.Z`, `X.Y` y `latest`.

#### Scenario: Tags de la imagen
- **WHEN** se publica la versión `0.1.0`
- **THEN** la imagen está disponible en GHCR con los tags `0.1.0`, `0.1` y `latest`

### Requirement: Tag y release como último paso
Tras publicar la imagen, el pipeline SHALL crear el tag `vX.Y.Z` sobre el commit construido y un GitHub Release con ese tag. El tag MUST NOT crearse antes de que la imagen se haya publicado correctamente.

#### Scenario: Publicación completa
- **WHEN** la imagen `0.1.0` se publica correctamente
- **THEN** existen el tag `v0.1.0` sobre el commit construido y un GitHub Release `v0.1.0`

#### Scenario: Fallo al publicar la imagen
- **WHEN** la construcción o el push de la imagen fallan
- **THEN** no se crea ningún tag ni release, y relanzar el pipeline sobre el mismo commit vuelve a intentar la publicación de la misma versión

### Requirement: Despliegue en Dokploy tras el release
Después de crear el release, el pipeline SHALL solicitar a Dokploy el despliegue del servicio compose configurado. La solicitud MUST autenticarse con un API key guardado como secreto y MUST NOT ejecutarse si no hubo publicación. Si Dokploy rechaza la solicitud o no está configurado, el pipeline SHALL fallar en ese paso sin deshacer la imagen, el tag ni el release.

#### Scenario: Despliegue tras una publicación
- **WHEN** se publica la versión `0.1.0` y se crea el release `v0.1.0`
- **THEN** el pipeline solicita a Dokploy el despliegue del servicio, con un título que incluye `v0.1.0`

#### Scenario: Sin versión nueva
- **WHEN** el pipeline termina sin publicar porque la versión no se incrementó
- **THEN** no se solicita ningún despliegue

#### Scenario: Dokploy rechaza la solicitud
- **WHEN** Dokploy responde con un error HTTP o faltan el secreto o el identificador del servicio
- **THEN** el pipeline falla en el paso de despliegue, la imagen, el tag y el release permanecen, y relanzar solo ese paso reintenta el despliegue

### Requirement: Ejecuciones concurrentes serializadas
El pipeline SHALL serializar sus ejecuciones sobre `main` para que dos pushes seguidos no publiquen la misma versión a la vez.

#### Scenario: Dos pushes consecutivos
- **WHEN** se hacen dos pushes a `main` con la misma `VERSION` sin tag previo
- **THEN** la segunda ejecución espera a la primera y, al ver el tag creado, termina sin publicar
