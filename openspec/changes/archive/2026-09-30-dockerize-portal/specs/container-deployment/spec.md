## Purpose

Define cómo se empaqueta y ejecuta el portal VPN como contenedor: qué contiene la imagen, cómo se configura, con qué privilegios corre y cómo se comprueba su salud, para desplegarlo en Dokploy sin filtrar secretos.

## ADDED Requirements

### Requirement: Imagen sin secretos ni archivos de desarrollo
La imagen construida MUST NOT contener el archivo `.env` ni ninguna variante (`.env.*`, salvo la plantilla `.env.example`), la carpeta `node_modules` del equipo que la construye, el historial de git ni los directorios de herramientas de desarrollo (`openspec`, `.claude`, `.zed`). El contexto de construcción SHALL excluir esos elementos mediante un `.dockerignore`.

#### Scenario: Construcción con un `.env` local presente
- **WHEN** se construye la imagen en un directorio que contiene un `.env` con valores reales
- **THEN** la imagen resultante no contiene ningún archivo `.env` en el sistema de archivos

#### Scenario: Construcción con `node_modules` local
- **WHEN** se construye la imagen en un directorio que ya tiene `node_modules`
- **THEN** las dependencias de la imagen provienen de una instalación limpia según `package-lock.json` y no de la copia local

### Requirement: Solo dependencias de producción
La imagen SHALL instalar las dependencias exactamente como lo fija `package-lock.json` e incluir únicamente las dependencias de producción. La instalación MUST fallar si `package.json` y `package-lock.json` no coinciden.

#### Scenario: Dependencias instaladas
- **WHEN** se inspecciona `node_modules` de la imagen
- **THEN** contiene `hono`, `@hono/node-server` y `resend`, y ninguna dependencia de desarrollo declarada en `package.json`

### Requirement: Configuración solo por variables de entorno
El contenedor SHALL arrancar el portal leyendo su configuración exclusivamente de las variables de entorno del proceso, sin requerir un archivo `.env`. Si falta alguna variable obligatoria, el contenedor MUST terminar con un código distinto de cero y mostrar solo los nombres faltantes, como hace el portal fuera de contenedor. El contenedor MUST escuchar en el puerto indicado por `PORT` y, si no se define, en el `3000`.

#### Scenario: Arranque con variables inyectadas
- **WHEN** se ejecuta el contenedor con todas las variables obligatorias definidas y sin ningún archivo `.env`
- **THEN** el portal queda escuchando en el puerto `PORT` y responde `200` en `/`

#### Scenario: Variable obligatoria ausente
- **WHEN** se ejecuta el contenedor sin `SHARED_INVITE_TOKEN`
- **THEN** el contenedor termina con código distinto de cero y el log menciona el nombre `SHARED_INVITE_TOKEN` sin ningún valor

### Requirement: Ejecución sin privilegios de administrador
El proceso del portal MUST ejecutarse con un usuario sin privilegios (no `root`) y los archivos de la aplicación SHALL pertenecer a ese usuario.

#### Scenario: Usuario del proceso
- **WHEN** se consulta el usuario con el que corre el proceso del contenedor
- **THEN** es un usuario distinto de `root`

### Requirement: Apagado limpio
Al recibir `SIGTERM`, el contenedor MUST terminar de inmediato, sin esperar al tiempo de gracia de la plataforma antes de ser detenido a la fuerza.

#### Scenario: Detención del contenedor
- **WHEN** se detiene el contenedor con `docker stop`
- **THEN** el contenedor termina en menos de 5 segundos

### Requirement: Comprobación de salud
La imagen SHALL declarar una comprobación de salud que considere sano al contenedor cuando `GET /` responda con éxito en el puerto configurado, y no sano si el portal no responde.

#### Scenario: Portal operativo
- **WHEN** el portal está escuchando y responde en `/`
- **THEN** el estado de salud del contenedor pasa a `healthy`

#### Scenario: Portal caído
- **WHEN** el proceso del portal no responde en el puerto configurado
- **THEN** el estado de salud del contenedor pasa a `unhealthy`
