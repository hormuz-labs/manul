import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, NEW_KEY, type Env } from '../account/src/index'

// The account service against fake Clerk (userinfo, users, metadata) and fake Bifrost (customers, virtual keys).
const env: Env = { CLERK_ISSUER: 'https://clerk.test', CLERK_SECRET_KEY: 'sk_clerk', BIFROST_URL: 'https://gw.test', BIFROST_AUTH: 'Basic YWRtaW46cHc=' }
let metadata: any
let keys: Record<string, { id: string; value: string; is_active: boolean }>
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
    if (url === 'https://api.clerk.com/v1/users/user_1/metadata' && method === 'PATCH') { metadata = body.private_metadata; return reply({}) }
    if (url === 'https://gw.test/api/governance/customers' && method === 'POST') return reply({ customer: { id: 'cus_1', name: body.name } })
    if (url === 'https://gw.test/api/governance/virtual-keys' && method === 'POST') {
      const id = `vk_${Object.keys(keys).length + 1}`
      keys[id] = { id, value: `sk-bf-${id}`, is_active: true }
      return reply({ virtual_key: keys[id] })
    }
    const vk = /^https:\/\/gw\.test\/api\/governance\/virtual-keys\/(.+)$/.exec(url)?.[1]
    if (vk) return keys[vk] ? reply({ virtual_key: keys[vk] }) : reply({ error: 'not found' }, 404)
    return reply({ error: `unexpected ${method} ${url}` }, 500)
  })
})
afterEach(() => vi.unstubAllGlobals())

const ask = (token?: string) => handle(new Request('https://account.test/v1/key', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} }), env)

describe('the account service', () => {
  it('turns away anyone Clerk does not vouch for', async () => {
    expect((await ask()).status).toBe(401)
    expect((await ask('forged')).status).toBe(401)
    expect(calls.some(c => c.url.startsWith('https://gw.test'))).toBe(false)
  })

  it('first sign-in: their own customer and key in the gateway, linked to the Clerk user', async () => {
    const res = await ask('good')
    expect(await res.json()).toEqual({ key: 'sk-bf-vk_1', email: 'ada@example.com' })
    const created = calls.find(c => c.url.endsWith('/virtual-keys') && c.method === 'POST')!
    expect(created.auth).toBe('Basic YWRtaW46cHc=')
    expect(created.body).toMatchObject({ ...NEW_KEY, name: 'user_1', description: 'ada@example.com', customer_id: 'cus_1', is_active: true })
    expect(calls.find(c => c.url.endsWith('/customers'))!.body).toEqual({ name: 'ada@example.com' })
    expect(metadata).toEqual({ bifrost: { customer_id: 'cus_1', virtual_key_id: 'vk_1' } })
    expect(calls.find(c => c.url.startsWith('https://api.clerk.com'))!.auth).toBe('Bearer sk_clerk')
  })

  it('later sign-ins (any device) get the same key, and nothing new is created', async () => {
    await ask('good')
    calls = []
    expect(await (await ask('good')).json()).toEqual({ key: 'sk-bf-vk_1', email: 'ada@example.com' })
    expect(calls.some(c => c.method === 'POST' && c.url.startsWith('https://gw.test'))).toBe(false)
  })

  it('a key turned off in the gateway stays off', async () => {
    await ask('good')
    keys.vk_1.is_active = false
    const res = await ask('good')
    expect(res.status).toBe(403)
    expect(Object.keys(keys)).toEqual(['vk_1'])
  })

  it('a key deleted in the gateway is replaced, under the same customer', async () => {
    await ask('good')
    delete keys.vk_1
    calls = []
    expect(await (await ask('good')).json()).toEqual({ key: 'sk-bf-vk_1', email: 'ada@example.com' })
    expect(calls.some(c => c.url.endsWith('/customers'))).toBe(false)
  })
})
