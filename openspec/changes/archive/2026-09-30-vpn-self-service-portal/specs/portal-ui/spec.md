## Purpose

Define la interfaz web de una sola página del portal: el acceso con el token compartido y el dashboard donde el usuario solicita su llave, arma el comando de conexión y ve los dispositivos de la red.

## ADDED Requirements

### Requirement: Página única servida estáticamente
El sistema SHALL servir la interfaz como un único documento HTML en la ruta raíz `/`, con todo el estado de la interfaz (vistas, datos, estados de carga y errores) gestionado en el cliente. El token MUST mantenerse solo en memoria de la página: MUST NOT guardarse en `localStorage`, `sessionStorage`, cookies ni en la URL.

#### Scenario: Carga inicial
- **WHEN** el usuario abre `/`
- **THEN** ve la vista de acceso y ningún dato de la red

#### Scenario: Recarga de la página
- **WHEN** el usuario recarga la página tras haber iniciado sesión
- **THEN** vuelve a la vista de acceso y debe ingresar el token otra vez

### Requirement: Vista de acceso
La vista de acceso SHALL mostrar una tarjeta centrada con un campo de tipo contraseña rotulado "Token de Acceso Global" y un botón "Entrar". Al enviar el formulario, la interfaz MUST llamar a `/api/verify-token`; mientras la petición esté en curso, el botón MUST estar deshabilitado e indicar carga.

#### Scenario: Token correcto
- **WHEN** el usuario envía un token que el servidor acepta con `200`
- **THEN** la interfaz guarda el token en memoria, oculta la vista de acceso y muestra el dashboard

#### Scenario: Token incorrecto
- **WHEN** el servidor responde `401`
- **THEN** la interfaz muestra una alerta roja indicando que el token es inválido y permanece en la vista de acceso

#### Scenario: Demasiados intentos
- **WHEN** el servidor responde `429`
- **THEN** la interfaz muestra una alerta roja indicando que se debe esperar antes de reintentar

#### Scenario: Error de red
- **WHEN** la petición no puede completarse
- **THEN** la interfaz muestra una alerta roja de error de conexión

### Requirement: Cierre de sesión
El dashboard SHALL mostrar en la esquina superior derecha un botón "Cerrar sesión" que, al pulsarse, MUST borrar el token y todo el estado del dashboard (usuario, llave, hostname, nodos, mensajes) y volver a la vista de acceso.

#### Scenario: Cerrar sesión
- **WHEN** el usuario pulsa "Cerrar sesión"
- **THEN** la interfaz muestra la vista de acceso con todos los campos vacíos

#### Scenario: Token rechazado durante el uso
- **WHEN** cualquier llamada del dashboard recibe `401`
- **THEN** la interfaz cierra la sesión y muestra en la vista de acceso un mensaje de token inválido

### Requirement: Solicitud de llave temporal
El dashboard SHALL mostrar un campo "Correo Institucional" donde el usuario escribe solo la parte local, con el sufijo fijo `@espol.edu.ec` visible junto al campo. El botón primario "1. Enviar llave temporal a mi correo" MUST estar deshabilitado mientras el valor esté vacío, no cumpla la regla de validación de usuario de `device-invite` o haya una petición en curso. Al pulsarlo, la interfaz MUST llamar a `/api/invite` con `{ username, token }`.

#### Scenario: Usuario válido
- **WHEN** el usuario escribe `jperez`
- **THEN** el botón de envío se habilita

#### Scenario: Usuario vacío o inválido
- **WHEN** el campo está vacío o contiene `@`, espacios u otros caracteres no permitidos
- **THEN** el botón de envío permanece deshabilitado

#### Scenario: Envío exitoso
- **WHEN** el servidor responde `200` a `/api/invite`
- **THEN** la interfaz muestra un mensaje de éxito indicando que la llave fue enviada a `<usuario>@espol.edu.ec`, el asunto con el que llega ("Tu llave temporal para conectarte a la VPN"), el recordatorio de revisar la carpeta de spam y que expira en 5 minutos

#### Scenario: Envío fallido
- **WHEN** el servidor responde `400`, `429`, `502` o la red falla
- **THEN** la interfaz muestra un mensaje de error acorde y no muestra el mensaje de éxito

### Requirement: Comandos de conexión reactivos
El dashboard SHALL mostrar los campos "2. Pega la llave recibida aquí" y "Nombre de este dispositivo (opcional)", y dos bloques de código con fondo oscuro que se actualizan al escribir:
- Windows: `tailscale up --login-server=https://headscale.elpitagoras14.qzz.io --authkey=<LLAVE> --hostname=<NOMBRE>`
- Linux: `sudo tailscale up --login-server=https://headscale.elpitagoras14.qzz.io --authkey=<LLAVE> --hostname=<NOMBRE>`
La llave MUST usarse sin espacios al inicio ni al final. Si el nombre normalizado está vacío, el argumento `--hostname=` MUST omitirse por completo.

#### Scenario: Llave y nombre presentes
- **WHEN** el usuario pega la llave `abc123` y escribe el nombre `laptop`
- **THEN** el bloque de Linux muestra `sudo tailscale up --login-server=https://headscale.elpitagoras14.qzz.io --authkey=abc123 --hostname=laptop`

#### Scenario: Nombre vacío
- **WHEN** el usuario pega la llave y deja el nombre vacío
- **THEN** ambos comandos terminan en `--authkey=<LLAVE>` sin `--hostname=`

### Requirement: Normalización del hostname a kebab-case
El nombre del dispositivo usado en los comandos MUST normalizarse siempre a kebab-case: minúsculas, sin tildes ni diacríticos, con cualquier secuencia de caracteres no alfanuméricos reemplazada por un único `-`, y sin `-` al inicio ni al final. El campo SHALL mostrar al usuario el valor normalizado que se usará.

#### Scenario: Nombre con espacios, mayúsculas y símbolos
- **WHEN** el usuario escribe `Mi Laptop_Dell!`
- **THEN** los comandos usan `--hostname=mi-laptop-dell`

#### Scenario: Nombre con tildes
- **WHEN** el usuario escribe `Portátil de José`
- **THEN** los comandos usan `--hostname=portatil-de-jose`

#### Scenario: Nombre solo con símbolos
- **WHEN** el usuario escribe `!!!`
- **THEN** el nombre normalizado queda vacío y los comandos omiten `--hostname=`

### Requirement: Copiar comandos al portapapeles
Cada bloque de código SHALL tener un botón de icono (con `title` y `aria-label` "Copiar al portapapeles"), ubicado dentro del bloque en su esquina superior derecha, que copia el comando mostrado y confirma visualmente la copia. Si la copia falla, la interfaz MUST informar el error.

#### Scenario: Copia exitosa
- **WHEN** el usuario pulsa el botón de copiar del bloque de Windows
- **THEN** el portapapeles contiene exactamente el comando de Windows mostrado y el botón indica temporalmente que se copió

#### Scenario: Copia no disponible
- **WHEN** el navegador no permite escribir en el portapapeles
- **THEN** la interfaz muestra un mensaje de error de copia

### Requirement: Tabla de dispositivos de la red
El dashboard SHALL mostrar la sección "Dispositivos conectados" con un botón secundario "Actualizar tabla" (con icono de refrescar, sin emojis) y una tabla responsiva con las columnas Hostname, IP, Estado y Última conexión. La interfaz MUST llamar a `/api/nodes` automáticamente al mostrar el dashboard y cada vez que se pulse el botón; durante la carga, el botón MUST estar deshabilitado e indicar carga.
- IP SHALL ser la primera dirección de `ipAddresses`, o un guion si está vacío.
- Estado SHALL ser un indicador verde con "En línea" si `online` es verdadero y rojo con "Desconectado" en caso contrario.
- Última conexión SHALL mostrarse formateada en la zona horaria y el formato local del navegador, o "Nunca" si `lastSeen` es `null`.

#### Scenario: Carga automática
- **WHEN** el usuario entra al dashboard
- **THEN** la tabla se llena con los nodos sin pulsar el botón

#### Scenario: Refresco manual
- **WHEN** el usuario pulsa "Actualizar tabla"
- **THEN** la interfaz vuelve a consultar `/api/nodes` y reemplaza las filas

#### Scenario: Red vacía
- **WHEN** `/api/nodes` devuelve `[]`
- **THEN** la tabla muestra un mensaje indicando que no hay dispositivos

#### Scenario: Error al consultar
- **WHEN** `/api/nodes` responde `502` o la red falla
- **THEN** la interfaz muestra un mensaje de error en la sección y conserva las filas cargadas previamente

#### Scenario: Pantalla angosta
- **WHEN** el portal se ve en un ancho de teléfono
- **THEN** la tabla se puede desplazar horizontalmente dentro de su contenedor sin desbordar la página
