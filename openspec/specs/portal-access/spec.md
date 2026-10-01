## Purpose

Controla el acceso al portal mediante un único token de invitación compartido, sin sesiones en el servidor, y protege ese token frente a ataques de fuerza bruta.

## Requirements

### Requirement: Verificación del token compartido
El sistema SHALL exponer `POST /api/verify-token`, que recibe un cuerpo JSON `{ "token": string }` y responde `200` cuando el token coincide exactamente con el valor configurado en `SHARED_INVITE_TOKEN`, y `401` con cuerpo `{ "error": string }` en cualquier otro caso. El sistema MUST NOT crear sesiones, cookies ni estado persistente al verificar el token.

#### Scenario: Token correcto
- **WHEN** el cliente envía `{ "token": "<valor igual a SHARED_INVITE_TOKEN>" }`
- **THEN** el sistema responde `200`

#### Scenario: Token incorrecto
- **WHEN** el cliente envía un token distinto al configurado
- **THEN** el sistema responde `401` con un cuerpo `{ "error": ... }`

#### Scenario: Token ausente o cuerpo inválido
- **WHEN** el cliente envía un cuerpo sin campo `token`, con `token` no string, o un JSON mal formado
- **THEN** el sistema responde `401` sin revelar el motivo exacto

### Requirement: Validación del token en todos los endpoints protegidos
Todo endpoint de la API distinto de `/api/verify-token` que opere sobre Headscale o Resend MUST validar el `token` recibido en el cuerpo con la misma regla que `/api/verify-token` antes de realizar cualquier llamada externa, y MUST responder `401` si no es válido.

#### Scenario: Endpoint protegido con token inválido
- **WHEN** el cliente llama a `/api/invite` o `/api/nodes` con un token inválido
- **THEN** el sistema responde `401` y no realiza ninguna llamada a Headscale ni a Resend

### Requirement: Comparación en tiempo constante
La comparación entre el token recibido y `SHARED_INVITE_TOKEN` MUST ejecutarse en tiempo constante respecto del contenido, de modo que el tiempo de respuesta no revele cuántos caracteres coinciden.

#### Scenario: Tokens con prefijo común
- **WHEN** se envían tokens que comparten un prefijo largo con el valor real y tokens que no comparten ninguno
- **THEN** ambos se rechazan con `401` sin diferencia de tiempo atribuible al número de caracteres coincidentes

### Requirement: Limitación de intentos fallidos por IP
El sistema SHALL contar los intentos con token inválido por dirección IP de origen en todos los endpoints de la API. Cuando una IP acumule 10 intentos fallidos dentro de una ventana de 15 minutos, el sistema MUST responder `429` con cuerpo `{ "error": string }` a cualquier petición de esa IP a la API hasta que la ventana expire, sin evaluar el token. El contador MAY residir solo en memoria y reiniciarse al reiniciar el proceso.

#### Scenario: Bloqueo tras exceder el umbral
- **WHEN** una IP envía 10 tokens inválidos dentro de 15 minutos y luego envía una nueva petición
- **THEN** el sistema responde `429`, incluso si el nuevo token es correcto

#### Scenario: Recuperación tras la ventana
- **WHEN** han pasado 15 minutos desde el inicio de la ventana de una IP bloqueada
- **THEN** el sistema vuelve a evaluar normalmente los tokens de esa IP

#### Scenario: Intentos correctos no penalizan
- **WHEN** una IP envía únicamente tokens válidos
- **THEN** el sistema nunca responde `429` por esta regla a esa IP
