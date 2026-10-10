// Manul accounts (served by server.mjs, in the cluster next to the gateway): who is signing in (Clerk), and that person's Manul key (a Bifrost virtual key
// under their own Bifrost customer, so every request and every dollar in the gateway is theirs).
//
//   POST /v1/key   Authorization: Bearer <Clerk OAuth access token>   →   { key, email }
//
// The first sign-in creates the customer and the key; later ones (any device) return the same key. Which key is whose
// lives in the Clerk user's private metadata: { bifrost: { customer_id, virtual_key_id } }. A key turned off in the
// gateway's dashboard stays off: signing in again doesn't make a new one.

export interface Env {
  /** Clerk's Frontend API, e.g. https://clerk.manul.si (the OAuth issuer) */
  CLERK_ISSUER: string
  /** Clerk Backend API secret (sk_…) */
  CLERK_SECRET_KEY: string
  /** the gateway, e.g. https://gateway.manul.si */
  BIFROST_URL: string
  /** the gateway's admin credential, as the Authorization header: "Basic base64(user:password)" */
  BIFROST_AUTH: string
  /** JSON: what a new key gets (budgets, rate_limit, provider_configs); default NEW_KEY below */
  NEW_KEY?: string
}

/** A new user's key: a small monthly budget, a rate limit, and the models the `manul` routing rule may pick. */
export const NEW_KEY = {
  budgets: [{ max_limit: 1, reset_duration: '1M' }],
  rate_limit: { request_max_limit: 300, request_reset_duration: '1h' },
  provider_configs: [
    { provider: 'anthropic', allowed_models: ['claude-opus-5-5', 'claude-sonnet-5-5'], key_ids: ['*'], weight: 1 },
    { provider: 'gemini', allowed_models: ['gemini-3.8-flash', 'gemini-3.1-pro-preview'], key_ids: ['*'], weight: 1 },
    { provider: 'openai', allowed_models: ['gpt-5.5'], key_ids: ['*'], weight: 1 },
  ],
}

const CLERK_API = 'https://api.clerk.com/v1'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fail = (status: number, error: string) => json({ error }, status)

type Link = { customer_id: string; virtual_key_id: string }

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url)
  if (url.pathname !== '/v1/key') return fail(404, 'Not found.')
  if (req.method !== 'POST') return fail(405, 'Use POST.')
  const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')?.[1]
  if (!token) return fail(401, 'Sign in first.')

  // who: Clerk checks its own token
  const who = await fetch(`${env.CLERK_ISSUER.replace(/\/+$/, '')}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}` } })
  if (!who.ok) return fail(401, 'Your sign-in has expired. Sign in again.')
  const { sub, email } = await who.json() as { sub: string; email?: string }
  if (!sub) return fail(401, 'Your sign-in has expired. Sign in again.')

  const clerk = (path: string, init: RequestInit = {}) =>
    fetch(`${CLERK_API}${path}`, { ...init, headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}`, 'content-type': 'application/json', ...init.headers } })
  const bifrost = (path: string, init: RequestInit = {}) =>
    fetch(`${env.BIFROST_URL.replace(/\/+$/, '')}/api/governance${path}`, { ...init, headers: { authorization: env.BIFROST_AUTH, 'content-type': 'application/json', ...init.headers } })

  const user = await clerk(`/users/${encodeURIComponent(sub)}`)
  if (!user.ok) return fail(502, 'Could not reach accounts. Try again in a moment.')
  const link = ((await user.json()) as { private_metadata?: { bifrost?: Link } }).private_metadata?.bifrost

  // a returning user: the same key
  if (link?.virtual_key_id) {
    const got = await bifrost(`/virtual-keys/${encodeURIComponent(link.virtual_key_id)}`)
    if (got.ok) {
      const vk = ((await got.json()) as { virtual_key: { value: string; is_active: boolean } }).virtual_key
      if (!vk.is_active) return fail(403, 'Your Manul key is turned off. Contact support.')
      return json({ key: vk.value, email })
    }
    if (got.status !== 404) return fail(502, 'Could not reach the gateway. Try again in a moment.')
    // the key was deleted in the gateway: make a new one below
  }

  // a new user: their customer, their key, and the link between them and the Clerk user
  const name = email || sub
  let customerId = link?.customer_id
  if (!customerId) {
    const c = await bifrost('/customers', { method: 'POST', body: JSON.stringify({ name }) })
    if (!c.ok) return fail(502, 'Could not create your Manul key. Try again in a moment.')
    customerId = ((await c.json()) as { customer: { id: string } }).customer.id
  }
  const v = await bifrost('/virtual-keys', {
    method: 'POST',
    body: JSON.stringify({ ...(env.NEW_KEY ? JSON.parse(env.NEW_KEY) : NEW_KEY), name: sub, description: name, customer_id: customerId, is_active: true }),
  })
  if (!v.ok) return fail(502, 'Could not create your Manul key. Try again in a moment.')
  const vk = ((await v.json()) as { virtual_key: { id: string; value: string } }).virtual_key
  const saved = await clerk(`/users/${encodeURIComponent(sub)}/metadata`, {
    method: 'PATCH', body: JSON.stringify({ private_metadata: { bifrost: { customer_id: customerId, virtual_key_id: vk.id } } }),
  })
  if (!saved.ok) return fail(502, 'Could not save your Manul key. Try again in a moment.')
  return json({ key: vk.value, email })
}

