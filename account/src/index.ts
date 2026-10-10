// Manul accounts (served by server.mjs, in the cluster next to the gateway): who is signing in (Clerk), that person's
// Manul key (a Bifrost virtual key under their own Bifrost customer, so every request and every dollar in the gateway is
// theirs), and their credit (the key's budget: FREE_CREDIT when they first sign in, raised by every payment).
//
//   POST /v1/key            Bearer <Clerk OAuth access token>              → { key, key_id, email }
//   GET  /v1/balance        Bearer <Manul key>, X-Manul-Key-Id: <key_id>   → { credit, used, left }
//   POST /v1/checkout       same, body { amount? } (USD)                   → { url }  (Dodo Payments checkout)
//   POST /v1/dodo/webhook   Dodo Payments, signed (Standard Webhooks)      → payment.succeeded raises the budget
//   GET  /paid              where the checkout returns to
//
// Which key is whose, and which payments were already credited, live in the Clerk user's private metadata:
// { bifrost: { customer_id, virtual_key_id }, payments: { <payment_id>: <dollars> } }. The key's name is the Clerk user
// id. A key turned off in the gateway's dashboard stays off: signing in again doesn't make a new one.

export interface Env {
  /** Clerk's Frontend API, e.g. https://clerk.manul.si (the OAuth issuer) */
  CLERK_ISSUER: string
  /** Clerk Backend API secret (sk_…) */
  CLERK_SECRET_KEY: string
  /** the gateway's admin API, e.g. http://bifrost:8080 */
  BIFROST_URL: string
  /** the gateway's admin credential, as the Authorization header: "Basic base64(user:password)" */
  BIFROST_AUTH: string
  /** JSON: what a new key gets (rate_limit, provider_configs); default NEW_KEY below */
  NEW_KEY?: string
  /** USD a new person starts with; default 2 */
  FREE_CREDIT?: string
  /** Dodo Payments: https://test.dodopayments.com or https://live.dodopayments.com */
  DODO_API?: string
  DODO_API_KEY?: string
  /** the "Manul credit" product (one-time, Pay What You Want) */
  DODO_PRODUCT_ID?: string
  /** the webhook endpoint's signing secret (whsec_…) */
  DODO_WEBHOOK_SECRET?: string
  /** where the account service is reached, for the checkout's return page; default https://account.manul.si */
  PUBLIC_URL?: string
}

/** A budget that never resets: credit, used up and topped up. */
const FOREVER = '100Y'

/** A new person's key: a rate limit, and the models the gateway's `manul` routing rule may pick. */
export const NEW_KEY = {
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
const page = (msg: string) => new Response(`<!doctype html><meta charset="utf-8"><title>Manul</title><body style="font:15px system-ui;display:grid;place-items:center;height:90vh;color:#141413;background:#fbfbf9"><p>${msg}</p>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
const cents = (usd: number) => Math.round(usd * 100)

type Budget = { id: string; max_limit: number; current_usage?: number; reset_duration: string }
type VirtualKey = { id: string; name: string; description?: string; value: string; is_active: boolean; budgets?: Budget[] }
type Meta = { bifrost?: { customer_id: string; virtual_key_id: string }; payments?: Record<string, number> }

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url)
  const clerk = (path: string, init: RequestInit = {}) =>
    fetch(`${CLERK_API}${path}`, { ...init, headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}`, 'content-type': 'application/json', ...init.headers } })
  const bifrost = (path: string, init: RequestInit = {}) =>
    fetch(`${env.BIFROST_URL.replace(/\/+$/, '')}/api/governance${path}`, { ...init, headers: { authorization: env.BIFROST_AUTH, 'content-type': 'application/json', ...init.headers } })
  const getKey = async (id: string) => {
    const r = await bifrost(`/virtual-keys/${encodeURIComponent(id)}`)
    return r.ok ? ((await r.json()) as { virtual_key: VirtualKey }).virtual_key : r.status === 404 ? null : undefined
  }
  const meta = async (userId: string) => {
    const r = await clerk(`/users/${encodeURIComponent(userId)}`)
    return r.ok ? (((await r.json()) as { private_metadata?: Meta }).private_metadata || {}) : undefined
  }
  const saveMeta = (userId: string, m: Meta) =>
    clerk(`/users/${encodeURIComponent(userId)}/metadata`, { method: 'PATCH', body: JSON.stringify({ private_metadata: m }) })

  /** The caller's key, proven by its value (the app sends the Manul key and the key id it was given with it). */
  const caller = async (): Promise<VirtualKey | Response> => {
    const value = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')?.[1]
    const id = req.headers.get('x-manul-key-id')
    if (!value || !id) return fail(401, 'Sign in first.')
    const vk = await getKey(id)
    if (vk === undefined) return fail(502, 'Could not reach the gateway. Try again in a moment.')
    if (!vk || !same(vk.value, value)) return fail(401, 'Sign in again.')
    return vk
  }

  if (url.pathname === '/v1/key' && req.method === 'POST') return signIn()
  if (url.pathname === '/v1/balance' && req.method === 'GET') {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const b = vk.budgets?.[0]
    const credit = b?.max_limit ?? 0, used = b?.current_usage ?? 0
    return json({ credit, used, left: Math.max(0, credit - used) })
  }
  if (url.pathname === '/v1/checkout' && req.method === 'POST') return checkout()
  if (url.pathname === '/v1/dodo/webhook' && req.method === 'POST') return webhook()
  if (url.pathname === '/paid') return page('Payment received. Your credit is added in a moment: go back to Manul.')
  return fail(404, 'Not found.')

  async function signIn() {
    const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')?.[1]
    if (!token) return fail(401, 'Sign in first.')
    // who: Clerk checks its own token
    const who = await fetch(`${env.CLERK_ISSUER.replace(/\/+$/, '')}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}` } })
    if (!who.ok) return fail(401, 'Your sign-in has expired. Sign in again.')
    const { sub, email } = await who.json() as { sub: string; email?: string }
    if (!sub) return fail(401, 'Your sign-in has expired. Sign in again.')

    const m = await meta(sub)
    if (!m) return fail(502, 'Could not reach accounts. Try again in a moment.')
    const link = m.bifrost

    // a returning person: the same key
    if (link?.virtual_key_id) {
      const vk = await getKey(link.virtual_key_id)
      if (vk === undefined) return fail(502, 'Could not reach the gateway. Try again in a moment.')
      if (vk) {
        if (!vk.is_active) return fail(403, 'Your Manul key is turned off. Contact support.')
        return json({ key: vk.value, key_id: vk.id, email })
      }
      // the key was deleted in the gateway: make a new one below (credit starts again from what they paid)
    }

    // a new person: their customer, their key with the free credit, and the link from the Clerk user
    const name = email || sub
    let customerId = link?.customer_id
    if (!customerId) {
      const c = await bifrost('/customers', { method: 'POST', body: JSON.stringify({ name }) })
      if (!c.ok) return fail(502, 'Could not create your Manul key. Try again in a moment.')
      customerId = ((await c.json()) as { customer: { id: string } }).customer.id
    }
    const paid = Object.values(m.payments || {}).reduce((a, b) => a + b, 0)
    const credit = (link ? 0 : Number(env.FREE_CREDIT ?? 2)) + paid
    const v = await bifrost('/virtual-keys', {
      method: 'POST',
      body: JSON.stringify({
        ...(env.NEW_KEY ? JSON.parse(env.NEW_KEY) : NEW_KEY),
        budgets: [{ max_limit: credit, reset_duration: FOREVER }],
        name: sub, description: name, customer_id: customerId, is_active: true,
      }),
    })
    if (!v.ok) return fail(502, 'Could not create your Manul key. Try again in a moment.')
    const vk = ((await v.json()) as { virtual_key: VirtualKey }).virtual_key
    const saved = await saveMeta(sub, { bifrost: { customer_id: customerId, virtual_key_id: vk.id } })
    if (!saved.ok) return fail(502, 'Could not save your Manul key. Try again in a moment.')
    return json({ key: vk.value, key_id: vk.id, email })
  }

  async function checkout() {
    const vk = await caller()
    if (vk instanceof Response) return vk
    if (!env.DODO_API_KEY || !env.DODO_PRODUCT_ID) return fail(503, 'Adding credit isn’t available yet.')
    const body = await req.json().catch(() => ({})) as { amount?: number }
    const amount = body.amount != null ? Number(body.amount) : undefined
    if (amount != null && !(amount >= 1 && amount <= 1000)) return fail(400, 'Choose an amount between $1 and $1,000.')
    const r = await fetch(`${(env.DODO_API || 'https://test.dodopayments.com').replace(/\/+$/, '')}/checkouts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.DODO_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        product_cart: [{ product_id: env.DODO_PRODUCT_ID, quantity: 1, ...(amount != null ? { amount: cents(amount) } : {}) }],
        ...(vk.description?.includes('@') ? { customer: { email: vk.description } } : {}),
        return_url: `${(env.PUBLIC_URL || 'https://account.manul.si').replace(/\/+$/, '')}/paid`,
        metadata: { virtual_key_id: vk.id, user_id: vk.name },
      }),
    })
    const out = await r.json().catch(() => ({})) as { checkout_url?: string }
    if (!r.ok || !out.checkout_url) return fail(502, 'Could not start the payment. Try again in a moment.')
    return json({ url: out.checkout_url })
  }

  async function webhook() {
    const raw = await req.text()
    if (!env.DODO_WEBHOOK_SECRET || !(await verify(env.DODO_WEBHOOK_SECRET, req.headers, raw))) return fail(401, 'Bad signature.')
    const event = JSON.parse(raw) as { type: string; data: { payment_id: string; total_amount: number; tax?: number | null; currency: string; metadata?: Record<string, string> } }
    if (event.type !== 'payment.succeeded') return json({ ok: true })
    const { payment_id, metadata } = event.data
    const userId = metadata?.user_id, keyId = metadata?.virtual_key_id
    if (!userId || !keyId) return json({ ok: true, skipped: 'not a Manul credit payment' })
    if (event.data.currency !== 'USD') return fail(422, `Unexpected currency ${event.data.currency}.`)
    const dollars = (event.data.total_amount - (event.data.tax || 0)) / 100   // the price, before tax

    const m = await meta(userId)
    if (!m) return fail(502, 'Could not reach accounts.')                     // Dodo retries
    if (m.payments?.[payment_id] != null) return json({ ok: true, already: true })
    const vk = await getKey(keyId)
    if (!vk) return fail(502, 'Could not reach the gateway.')
    const b = vk.budgets?.[0]
    const budgets = [b ? { id: b.id, max_limit: b.max_limit + dollars, reset_duration: b.reset_duration } : { max_limit: dollars, reset_duration: FOREVER }]
    const up = await bifrost(`/virtual-keys/${encodeURIComponent(keyId)}`, { method: 'PUT', body: JSON.stringify({ budgets }) })
    if (!up.ok) return fail(502, 'Could not add the credit.')
    const saved = await saveMeta(userId, { payments: { ...(m.payments || {}), [payment_id]: dollars } })
    if (!saved.ok) return fail(502, 'Could not record the payment.')
    return json({ ok: true, credited: dollars })
  }
}

/** Standard Webhooks: base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)), key = base64 after "whsec_"; within 5 minutes. */
export async function verify(secret: string, headers: Headers, body: string, now = Date.now()) {
  const id = headers.get('webhook-id'), ts = headers.get('webhook-timestamp'), sigs = headers.get('webhook-signature')
  if (!id || !ts || !sigs || Math.abs(now / 1000 - Number(ts)) > 300) return false
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)))
  const want = btoa(String.fromCharCode(...mac))
  return sigs.split(' ').some(s => same(s.replace(/^v1,/, ''), want))
}

/** Equal strings, compared in constant time. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
