## Purpose

Expone al portal la lista de dispositivos registrados en la VPN bajo el usuario fijo de Headscale, en un formato reducido y estable que no filtra datos internos del servidor.

## Requirements

### Requirement: Endpoint de nodos
El sistema SHALL exponer `POST /api/nodes`, que recibe un cuerpo JSON `{ "token": string }`. Tras validar el token (ver `portal-access`), MUST consultar `GET /api/v1/node` en `https://headscale.elpitagoras14.qzz.io` con `Authorization: Bearer <HEADSCALE_API_KEY>` y responder `200` con un arreglo JSON de nodos.

#### Scenario: Consulta exitosa
- **WHEN** el cliente envía un token válido y Headscale responde correctamente
- **THEN** el sistema responde `200` con un arreglo de nodos

#### Scenario: Token inválido
- **WHEN** el cliente envía un token inválido
- **THEN** el sistema responde `401` y no consulta Headscale

#### Scenario: Red sin dispositivos
- **WHEN** Headscale no devuelve nodos del usuario fijo
- **THEN** el sistema responde `200` con `[]`

### Requirement: Filtrado por usuario fijo
El arreglo devuelto MUST contener únicamente los nodos cuyo `user.name` sea igual a `HEADSCALE_FIXED_USER`.

#### Scenario: Nodos de otros usuarios
- **WHEN** Headscale devuelve nodos de `kokoanet` y de otros usuarios
- **THEN** la respuesta incluye solo los nodos de `kokoanet`

### Requirement: Forma normalizada de cada nodo
Cada elemento del arreglo MUST tener exactamente los campos `{ "id": string, "name": string, "ipAddresses": string[], "online": boolean, "lastSeen": string | null }`, donde:
- `name` SHALL ser el nombre asignado en Headscale (`givenName`) y, si está vacío, el hostname reportado (`name`);
- `ipAddresses` SHALL ser un arreglo, vacío si Headscale no reporta direcciones;
- `online` SHALL ser `false` si Headscale no reporta el campo;
- `lastSeen` SHALL ser una fecha ISO 8601 o `null` si Headscale no la reporta.
Ningún otro campo del nodo de Headscale (llaves, rutas, etiquetas, datos del usuario) MUST incluirse.

#### Scenario: Nodo completo
- **WHEN** Headscale devuelve un nodo con `givenName`, direcciones, `online: true` y `lastSeen`
- **THEN** el elemento contiene esos valores en `name`, `ipAddresses`, `online` y `lastSeen`

#### Scenario: Nodo sin datos opcionales
- **WHEN** Headscale devuelve un nodo sin `givenName`, sin direcciones, sin `online` y sin `lastSeen`
- **THEN** el elemento usa el hostname como `name`, `ipAddresses: []`, `online: false` y `lastSeen: null`

#### Scenario: Sin datos sensibles
- **WHEN** Headscale devuelve campos como `machineKey`, `nodeKey` o `discoKey`
- **THEN** esos campos no aparecen en la respuesta

### Requirement: Errores de Headscale en la consulta de nodos
Si la llamada a Headscale falla, devuelve un estado no exitoso o una respuesta sin arreglo de nodos, el sistema MUST responder `502` con un mensaje genérico en `{ "error": string }` sin exponer detalles internos.

#### Scenario: Headscale no disponible
- **WHEN** la conexión a Headscale falla o responde `5xx`
- **THEN** el sistema responde `502` con `{ "error": ... }`
