import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, NEW_KEY, verify, type Env } from '../account/src/index'

// The account service against fake Clerk (userinfo, users, metadata), fake Bifrost (customers, virtual keys) and fake
// Dodo Payments (checkouts).
const SECRET = 'whsec_' + Buffer.from('dodo-signing-key').toString('base64')
const env: Env = {
  CLERK_ISSUER: 'https://clerk.test', CLERK_SECRET_KEY: 'sk_clerk', BIFROST_URL: 'https://gw.test', BIFROST_AUTH: 'Basic YWRtaW46cHc=',
  DODO_API: 'https://dodo.test', DODO_API_KEY: 'dodo_key', DODO_PRODUCT_ID: 'pdt_credit', DODO_WEBHOOK_SECRET: SECRET,
}
let metadata: any
let keys: Record<string, any>
let calls: { method: string; url: string; auth?: string; body?: any }[]

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  metadata = {}
  keys = {}
  calls = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method || 'GET'
    const auth = new Headers(init.headers).get('authorization') || undefined
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, auth, body })
    if (url === 'https://clerk.test/oauth/userinfo') return auth === 'Bearer good' ? reply({ sub: 'user_1', email: 'ada@example.com' }) : reply({}, 401)
    if (url === 'https://api.clerk.com/v1/users/user_1' && method === 'GET') return reply({ id: 'user_1', private_metadata: metadata })
    if (url === 'https://api.clerk.com/v1/users/user_1/metadata' && method === 'PATCH') { metadata = { ...metadata, ...body.private_metadata }; return reply({}) }
    if (url === 'https://gw.test/api/governance/customers' && method === 'POST') return reply({ customer: { id: 'cus_1', name: body.name } })
    if (url === 'https://gw.test/api/governance/virtual-keys' && method === 'POST') {
      const id = `vk_${Object.keys(keys).length + 1}`
      keys[id] = { id, name: body.name, description: body.description, value: `sk-bf-${id}`, is_active: true, budgets: body.budgets.map((b: any, i: number) => ({ ...b, id: `b${i}`, current_usage: 0 })) }
      return reply({ virtual_key: keys[id] })
    }
    const vk = /^https:\/\/gw\.test\/api\/governance\/virtual-keys\/(.+)$/.exec(url)?.[1]
    if (vk && method === 'PUT') {
      for (const b of body.budgets) Object.assign(keys[vk].budgets.find((x: any) => x.id === b.id), b)   // in place: usage kept
      return reply({ virtual_key: keys[vk] })
    }
    if (vk) return keys[vk] ? reply({ virtual_key: keys[vk] }) : reply({ error: 'not found' }, 404)
    if (url === 'https://dodo.test/checkouts' && method === 'POST') return auth === 'Bearer dodo_key' ? reply({ session_id: 'cks_1', checkout_url: 'https://checkout.dodo.test/cks_1' }) : reply({}, 401)
    return reply({ error: `unexpected ${method} ${url}` }, 500)
  })
})
afterEach(() => vi.unstubAllGlobals())

const call = (path: string, init: RequestInit = {}) => handle(new Request(`https://account.test${path}`, init), env)
const ask = (token?: string) => call('/v1/key', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} })
const asKey = (key: string, id: string) => ({ authorization: `Bearer ${key}`, 'x-manul-key-id': id })
const signed = (body: object, at = Math.floor(Date.now() / 1000), secret = SECRET) => {
  const raw = JSON.stringify(body)
  const sig = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`msg_1.${at}.${raw}`).digest('base64')
  return { method: 'POST', body: raw, headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': String(at), 'webhook-signature': `v1,${sig}` } }
}
const paid = (payment_id: string, total_amount: number, tax = 0, meta: object = { virtual_key_id: 'vk_1', user_id: 'user_1' }) =>
  ({ business_id: 'bus_1', type: 'payment.succeeded', timestamp: new Date().toISOString(), data: { payment_id, total_amount, tax, currency: 'USD', metadata: meta } })

describe('the account service: signing in', () => {
  it('turns away anyone Clerk does not vouch for', async () => {
    expect((await ask()).status).toBe(401)
    expect((await ask('forged')).status).toBe(401)
    expect(calls.some(c => c.url.startsWith('https://gw.test'))).toBe(false)
  })

  it('first sign-in: their own customer and key with $2 of credit that never resets, linked to the Clerk user', async () => {
    expect(await (await ask('good')).json()).toEqual({ key: 'sk-bf-vk_1', key_id: 'vk_1', email: 'ada@example.com' })
    const created = calls.find(c => c.url.endsWith('/virtual-keys') && c.method === 'POST')!
    expect(created.auth).toBe('Basic YWRtaW46cHc=')
    expect(created.body).toMatchObject({ ...NEW_KEY, budgets: [{ max_limit: 2, reset_duration: '100Y' }], name: 'user_1', description: 'ada@example.com', customer_id: 'cus_1', is_active: true })
    expect(metadata.bifrost).toEqual({ customer_id: 'cus_1', virtual_key_id: 'vk_1' })
  })

  it('later sign-ins (any device) get the same key: no second free credit', async () => {
    await ask('good')
    calls = []
    expect(await (await ask('good')).json()).toEqual({ key: 'sk-bf-vk_1', key_id: 'vk_1', email: 'ada@example.com' })
    expect(calls.some(c => c.method === 'POST' && c.url.startsWith('https://gw.test'))).toBe(false)
  })

  it('a key turned off in the gateway stays off', async () => {
    await ask('good')
    keys.vk_1.is_active = false
    expect((await ask('good')).status).toBe(403)
  })

  it('a key deleted in the gateway is replaced with what they paid, not a new free credit', async () => {
    await ask('good')
    metadata.payments = { pay_1: 10 }
    delete keys.vk_1
    await ask('good')
    expect(keys.vk_1.budgets[0].max_limit).toBe(10)
  })
})

describe('the account service: credit and payments', () => {
  it('shows what is left, only to the key itself', async () => {
    await ask('good')
    keys.vk_1.budgets[0].current_usage = 0.5
    expect(await (await call('/v1/balance', { headers: asKey('sk-bf-vk_1', 'vk_1') })).json()).toEqual({ credit: 2, used: 0.5, left: 1.5 })
    expect((await call('/v1/balance', { headers: asKey('sk-bf-wrong', 'vk_1') })).status).toBe(401)
    expect((await call('/v1/balance')).status).toBe(401)
  })

  it('starts a Dodo checkout for the Manul credit product, tagged with whose key it tops up', async () => {
    await ask('good')
    const res = await call('/v1/checkout', { method: 'POST', headers: asKey('sk-bf-vk_1', 'vk_1'), body: JSON.stringify({ amount: 10 }) })
    expect(await res.json()).toEqual({ url: 'https://checkout.dodo.test/cks_1' })
    expect(calls.find(c => c.url === 'https://dodo.test/checkouts')!.body).toEqual({
      product_cart: [{ product_id: 'pdt_credit', quantity: 1, amount: 1000 }],
      customer: { email: 'ada@example.com' },
      return_url: 'https://account.manul.si/paid',
      metadata: { virtual_key_id: 'vk_1', user_id: 'user_1' },
    })
    expect((await call('/v1/checkout', { method: 'POST', headers: asKey('sk-bf-vk_1', 'vk_1'), body: JSON.stringify({ amount: 0.2 }) })).status).toBe(400)
  })

  it('a paid checkout raises the budget by the price before tax, keeping what was used, once per payment', async () => {
    await ask('good')
    keys.vk_1.budgets[0].current_usage = 1.75
    const hook = (body: object) => call('/v1/dodo/webhook', signed(body))
    expect(await (await hook(paid('pay_1', 1080, 80))).json()).toEqual({ ok: true, credited: 10 })
    expect(keys.vk_1.budgets[0]).toMatchObject({ id: 'b0', max_limit: 12, current_usage: 1.75, reset_duration: '100Y' })
    expect(metadata.payments).toEqual({ pay_1: 10 })
    expect(await (await hook(paid('pay_1', 1080, 80))).json()).toEqual({ ok: true, already: true })   // Dodo retried
    expect(keys.vk_1.budgets[0].max_limit).toBe(12)
    await hook(paid('pay_2', 500))
    expect(keys.vk_1.budgets[0].max_limit).toBe(17)
  })

  it('ignores forged, stale and unrelated webhooks', async () => {
    await ask('good')
    expect((await call('/v1/dodo/webhook', signed(paid('pay_x', 99900), undefined, 'whsec_' + Buffer.from('not-ours').toString('base64')))).status).toBe(401)
    expect((await call('/v1/dodo/webhook', signed(paid('pay_x', 99900), Math.floor(Date.now() / 1000) - 3600))).status).toBe(401)
    expect(await (await call('/v1/dodo/webhook', signed(paid('pay_y', 500, 0, {})))).json()).toMatchObject({ skipped: expect.any(String) })
    expect(keys.vk_1.budgets[0].max_limit).toBe(2)
  })

  it('verifies Standard Webhooks signatures with several signatures in the header', async () => {
    const { headers, body } = signed({ a: 1 })
    const h = new Headers(headers as Record<string, string>)
    h.set('webhook-signature', `v1,bm90LWl0 ${h.get('webhook-signature')}`)
    expect(await verify(SECRET, h, body as string)).toBe(true)
  })
})
