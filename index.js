import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Resend } from 'resend'
import { renderInviteEmail } from './email-template.js'

// ---------------------------------------------------------------- config (D2)
const REQUIRED = [
  'SHARED_INVITE_TOKEN',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'HEADSCALE_API_KEY',
  'HEADSCALE_FIXED_USER',
]
const missing = REQUIRED.filter((name) => !process.env[name])
const trustProxyRaw = process.env.TRUST_PROXY ?? '0'
if (!/^\d+$/.test(trustProxyRaw)) missing.push('TRUST_PROXY (entero >= 0)')
if (missing.length) {
  console.error(`Configuración inválida. Revisa: ${missing.join(', ')}`)
  process.exit(1)
}

const {
  SHARED_INVITE_TOKEN,
  RESEND_API_KEY,
  RESEND_FROM,
  HEADSCALE_API_KEY,
  HEADSCALE_FIXED_USER,
} = process.env
const PORT = Number(process.env.PORT) || 3000
const TRUST_PROXY = Number(trustProxyRaw)

const HEADSCALE_URL = 'https://headscale.elpitagoras14.qzz.io'
const EMAIL_DOMAIN = 'espol.edu.ec'
const KEY_TTL_MINUTES = 5
const USERNAME_RE = /^[a-z0-9]+([._-][a-z0-9]+)*$/

const resend = new Resend(RESEND_API_KEY)

// ------------------------------------------------------------------ errors (D7)
class UpstreamError extends Error {}

// ------------------------------------------------------------- token check (D3)
const sha256 = (value) => createHash('sha256').update(value).digest()
const expectedTokenHash = sha256(SHARED_INVITE_TOKEN)

export function tokenIsValid(token) {
  const candidate = typeof token === 'string' ? token : ''
  return timingSafeEqual(sha256(candidate), expectedTokenHash)
}

// ------------------------------------------------------------ client IP (D4)
export function resolveIp(forwardedFor, socketIp, trustProxy = TRUST_PROXY) {
  if (trustProxy === 0 || !forwardedFor) return socketIp
  const entries = forwardedFor.split(',').map((e) => e.trim())
  return entries[Math.max(entries.length - trustProxy, 0)] || socketIp
}

// ------------------------------------------------------- rate limiting (D4)
const MINUTE = 60_000
const FAILED_LIMIT = { max: 10, windowMs: 15 * MINUTE }
const INVITE_LIMIT = { max: 5, windowMs: 60 * MINUTE }
const failedAttempts = new Map()
const invitesSent = new Map()

function currentEntry(map, ip, { windowMs }) {
  const entry = map.get(ip)
  if (!entry || Date.now() - entry.windowStart >= windowMs) return null
  return entry
}

const isLimited = (map, ip, limit) => (currentEntry(map, ip, limit)?.count ?? 0) >= limit.max

function increment(map, ip, limit) {
  const entry = currentEntry(map, ip, limit)
  if (entry) entry.count++
  else map.set(ip, { count: 1, windowStart: Date.now() })
}

setInterval(() => {
  for (const [map, limit] of [[failedAttempts, FAILED_LIMIT], [invitesSent, INVITE_LIMIT]]) {
    for (const ip of map.keys()) if (!currentEntry(map, ip, limit)) map.delete(ip)
  }
}, 5 * MINUTE).unref()

// ------------------------------------------------------- headscale client (D5)
async function headscale(path, init = {}) {
  let res
  try {
    res = await fetch(HEADSCALE_URL + path, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${HEADSCALE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.error(`Headscale ${path}: ${err.name}`)
    throw new UpstreamError('Headscale no disponible')
  }
  if (!res.ok) {
    console.error(`Headscale ${path}: ${res.status}`)
    throw new UpstreamError(`Headscale respondió ${res.status}`)
  }
  try {
    return await res.json()
  } catch {
    console.error(`Headscale ${path}: respuesta no JSON`)
    throw new UpstreamError('Respuesta inválida de Headscale')
  }
}

// ----------------------------------------------------- fixed user id (D6)
let userIdPromise = null

function getFixedUserId() {
  if (!userIdPromise) {
    userIdPromise = headscale(`/api/v1/user?name=${encodeURIComponent(HEADSCALE_FIXED_USER)}`)
      .then((data) => {
        const user = Array.isArray(data?.users)
          ? data.users.find((u) => u.name === HEADSCALE_FIXED_USER)
          : null
        if (!user?.id) throw new UpstreamError('Usuario de Headscale no encontrado')
        return user.id
      })
      .catch((err) => {
        userIdPromise = null
        throw err
      })
  }
  return userIdPromise
}

// ------------------------------------------------------------------- app
const app = new Hono()

app.onError((err, c) => {
  console.error(`Error: ${err.message}`)
  if (err instanceof UpstreamError) {
    return c.json({ error: 'No se pudo completar la operación con un servicio externo. Intenta más tarde.' }, 502)
  }
  return c.json({ error: 'Error interno del servidor' }, 500)
})

// Middleware de /api/*: IP, bloqueo, cuerpo JSON y token (D4)
app.use('/api/*', async (c, next) => {
  const socketIp = getConnInfo(c).remote.address ?? 'unknown'
  const ip = resolveIp(c.req.header('x-forwarded-for'), socketIp)
  if (isLimited(failedAttempts, ip, FAILED_LIMIT)) {
    return c.json({ error: 'Demasiados intentos. Espera unos minutos.' }, 429)
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  if (body === null || typeof body !== 'object') body = {}

  if (!tokenIsValid(body.token)) {
    increment(failedAttempts, ip, FAILED_LIMIT)
    console.warn(`Token inválido desde ${ip}`)
    return c.json({ error: 'Token inválido' }, 401)
  }

  c.set('ip', ip)
  c.set('body', body)
  await next()
})

app.post('/api/verify-token', (c) => c.json({ success: true }))

app.post('/api/invite', async (c) => {
  const ip = c.get('ip')
  if (isLimited(invitesSent, ip, INVITE_LIMIT)) {
    return c.json({ error: 'Límite de invitaciones alcanzado. Intenta más tarde.' }, 429)
  }

  const raw = c.get('body').username
  const username = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (username.length < 1 || username.length > 64 || !USERNAME_RE.test(username)) {
    return c.json({ error: 'Usuario inválido' }, 400)
  }
  const to = `${username}@${EMAIL_DOMAIN}`

  const userId = await getFixedUserId()
  const expiresAt = new Date(Date.now() + KEY_TTL_MINUTES * MINUTE).toISOString()
  const data = await headscale('/api/v1/preauthkey', {
    method: 'POST',
    body: JSON.stringify({ user: userId, reusable: false, ephemeral: false, expiration: expiresAt }),
  })
  const key = data?.preAuthKey?.key
  if (!key) throw new UpstreamError('Headscale no devolvió la llave')

  const { subject, html, text } = renderInviteEmail({ key, expiresAt })
  const { error } = await resend.emails.send({ from: RESEND_FROM, to, subject, html, text })
  if (error) throw new UpstreamError(`Resend: ${error.name ?? 'error'}`)

  increment(invitesSent, ip, INVITE_LIMIT)
  return c.json({ success: true })
})

app.post('/api/nodes', async (c) => {
  const data = await headscale('/api/v1/node')
  if (!Array.isArray(data?.nodes)) throw new UpstreamError('Respuesta de nodos inválida')
  const nodes = data.nodes
    .filter((n) => n.user?.name === HEADSCALE_FIXED_USER)
    .map((n) => ({
      id: String(n.id),
      name: n.givenName || n.name,
      ipAddresses: n.ipAddresses ?? [],
      online: n.online === true,
      lastSeen: n.lastSeen ?? null,
    }))
  return c.json(nodes)
})

app.use('/*', serveStatic({ root: './public' }))

serve({ fetch: app.fetch, port: PORT }, ({ port }) => console.log(`Portal escuchando en :${port}`))
