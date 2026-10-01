## Purpose

Permite que un miembro de ESPOL con el token compartido reciba en su correo institucional una pre-auth key de Headscale temporal y de un solo uso para registrar un dispositivo bajo el usuario fijo de la VPN.

## Requirements

### Requirement: Endpoint de invitación
El sistema SHALL exponer `POST /api/invite`, que recibe un cuerpo JSON `{ "username": string, "token": string }`. Tras validar el token (ver `portal-access`), validar el usuario, emitir la llave y enviar el correo con éxito, MUST responder `200` con `{ "success": true }`.

#### Scenario: Invitación exitosa
- **WHEN** el cliente envía un token válido y `username: "jperez"`
- **THEN** el sistema emite una pre-auth key, la envía a `jperez@espol.edu.ec` y responde `200` con `{ "success": true }`

#### Scenario: Token inválido
- **WHEN** el cliente envía un token inválido
- **THEN** el sistema responde `401` y no valida el usuario, no emite llave ni envía correo

### Requirement: Validación del usuario institucional
El campo `username` MUST contener solo la parte local del correo. El sistema SHALL normalizarlo recortando espacios y convirtiéndolo a minúsculas, y MUST aceptarlo solo si tiene entre 1 y 64 caracteres y cumple `^[a-z0-9]+([._-][a-z0-9]+)*$`. El destinatario SHALL construirse siempre en el servidor como `<username>@espol.edu.ec`; el dominio MUST NOT provenir del cliente. Si la validación falla, el sistema MUST responder `400` con `{ "error": string }` sin emitir llave ni enviar correo.

#### Scenario: Usuario con mayúsculas y espacios
- **WHEN** el cliente envía `username: "  JPerez "`
- **THEN** el sistema usa `jperez@espol.edu.ec` como destinatario

#### Scenario: Usuario con arroba o dominio
- **WHEN** el cliente envía `username: "jperez@gmail.com"` o `username: "a@b"`
- **THEN** el sistema responde `400`

#### Scenario: Usuario vacío o con caracteres inválidos
- **WHEN** el cliente envía `username: ""`, `username: "j perez"`, `username: ".jperez"` o no envía `username`
- **THEN** el sistema responde `400`

### Requirement: Resolución del usuario fijo de Headscale
El sistema SHALL identificar al usuario de Headscale por el nombre configurado en `HEADSCALE_FIXED_USER` y obtener su ID numérico desde la API de Headscale. Una vez obtenido, el ID MUST reutilizarse durante toda la vida del proceso sin volver a consultarlo. Si la resolución falla o el usuario no existe, el fallo MUST NOT memorizarse: la siguiente invitación SHALL reintentar la resolución. Peticiones concurrentes antes de la primera resolución MUST compartir una única consulta a Headscale.

#### Scenario: Primera invitación del proceso
- **WHEN** llega la primera invitación válida desde que arrancó el proceso
- **THEN** el sistema consulta a Headscale el ID del usuario `HEADSCALE_FIXED_USER` y lo usa para emitir la llave

#### Scenario: Invitaciones posteriores
- **WHEN** llegan invitaciones válidas después de una resolución exitosa
- **THEN** el sistema no vuelve a consultar el ID del usuario

#### Scenario: Usuario inexistente o Headscale no disponible al resolver
- **WHEN** la consulta del usuario falla o no devuelve un usuario con ese nombre
- **THEN** el sistema responde `502` con `{ "error": string }` y la siguiente invitación vuelve a intentar la resolución

### Requirement: Emisión de la pre-auth key
El sistema SHALL crear la llave con `POST /api/v1/preauthkey` en `https://headscale.elpitagoras14.qzz.io`, autenticándose con `Authorization: Bearer <HEADSCALE_API_KEY>` y enviando `{ "user": <ID numérico>, "reusable": false, "ephemeral": false, "expiration": <instante actual + 5 minutos en ISO 8601 UTC> }`. La llave usada SHALL ser `preAuthKey.key` de la respuesta.

#### Scenario: Parámetros de la llave
- **WHEN** el sistema emite una llave
- **THEN** la llave pertenece al usuario fijo, no es reutilizable, no es efímera y expira 5 minutos después de su emisión

#### Scenario: Headscale rechaza o no responde
- **WHEN** la llamada a Headscale devuelve un estado no exitoso, una respuesta sin `preAuthKey.key` o falla la conexión
- **THEN** el sistema responde `502` con un mensaje genérico en `{ "error": string }`, no envía correo y no expone al cliente detalles internos de Headscale

### Requirement: Envío del correo con la llave
El sistema SHALL enviar la llave mediante Resend desde el remitente configurado en `RESEND_FROM` al destinatario `<username>@espol.edu.ec`. El correo MUST incluir la llave, la hora exacta de expiración expresada en la zona horaria `America/Guayaquil` (formato de 24 horas), y el aviso de que la llave es de un solo uso. El correo MUST enviarse con una versión HTML y una versión de texto plano con el mismo contenido, y MUST NOT incluir enlaces. La llave MUST NOT incluirse en la respuesta HTTP ni en los logs del servidor.

#### Scenario: Contenido del correo
- **WHEN** se envía una invitación exitosa
- **THEN** el destinatario recibe un correo desde `RESEND_FROM` con la llave, la hora de expiración y el aviso de un solo uso

#### Scenario: Hora de expiración en hora de Ecuador
- **WHEN** se emite una llave a las 23:58 UTC
- **THEN** el correo indica que expira a las 19:03 (hora de Ecuador), coincidiendo con la expiración registrada en Headscale

#### Scenario: Versión de texto plano
- **WHEN** el cliente de correo del destinatario no muestra HTML
- **THEN** la versión de texto plano contiene la llave, la hora de expiración y el aviso de un solo uso

#### Scenario: Fallo de Resend
- **WHEN** Resend rechaza el envío o no responde
- **THEN** el sistema responde `502` con un mensaje genérico en `{ "error": string }`

#### Scenario: La llave no se filtra
- **WHEN** una invitación termina con éxito o con error
- **THEN** ni el cuerpo de la respuesta HTTP ni los logs contienen el valor de la llave

### Requirement: Limitación de invitaciones por IP
El sistema SHALL limitar a 5 las invitaciones exitosas por dirección IP de origen dentro de una ventana de 1 hora. Al exceder el límite MUST responder `429` con `{ "error": string }` sin emitir llave ni enviar correo. El contador MAY residir solo en memoria.

#### Scenario: Exceso de invitaciones
- **WHEN** una IP ya obtuvo 5 invitaciones exitosas en la última hora y solicita otra con token y usuario válidos
- **THEN** el sistema responde `429` y no emite llave
