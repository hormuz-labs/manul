// Signing in to Manul (Settings → Keys → Manul key): Clerk in the system browser (OAuth with PKCE, Manul being a public
// client), back to a one-shot server on 127.0.0.1, then Manul's account service swaps the sign-in for the person's
// Manul key (account/src/index.ts), kept in the keychain like any key. Who's signed in (their email) is in config.json.
import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { getConfig, setConfig } from './config'
import { MANUL_KEY } from './gateway'
import { setKey } from './keys'
import type { AccountStatus } from '../shared/types'

/** Clerk's Frontend API (the OAuth issuer), the "Manul desktop" OAuth app's client id (public, PKCE), and the account
 *  service. Clerk's development instance until the production one (clerk.manul.si) is set up. */
export const AUTH = {
  issuer: () => (process.env.MANUL_AUTH_ISSUER || 'https://good-wildcat-5360.clerk.accounts.dev').replace(/\/+$/, ''),
  clientId: () => process.env.MANUL_AUTH_CLIENT_ID ?? '5E3y3JppmCuVr1UD',
  account: () => (process.env.MANUL_ACCOUNT || 'https://account.manul.si').replace(/\/+$/, ''),
}
/** Registered in the Clerk OAuth app as the redirect URI. */
export const CALLBACK_PORT = 47619
const REDIRECT = `http://127.0.0.1:${CALLBACK_PORT}/oauth/callback`

export const accountStatus = (): AccountStatus => ({ email: getConfig().account?.email, available: !!AUTH.clientId() })

const b64url = (b: Buffer) => b.toString('base64url')
const PAGE = (msg: string) => `<!doctype html><meta charset="utf-8"><title>Manul</title><body style="font:15px system-ui;display:grid;place-items:center;height:90vh;color:#141413;background:#fbfbf9"><p>${msg}</p>`

let pending: { server: Server; cancel: () => void } | null = null

/** Sign in: opens the browser, waits for the way back, stores the key. Resolves with who signed in. */
export async function signIn(open: (url: string) => Promise<void> | void, timeoutMs = 5 * 60_000): Promise<AccountStatus> {
  if (!AUTH.clientId()) throw new Error('Signing in isn’t available in this build.')
  pending?.cancel()
  const verifier = b64url(randomBytes(32))
  const state = b64url(randomBytes(16))
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url || '/', REDIRECT)
      if (u.pathname !== '/oauth/callback') { res.writeHead(404).end(); return }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code')
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
        .end(PAGE(ok ? 'Signed in. You can close this tab and go back to Manul.' : 'Signing in didn’t finish. Go back to Manul and try again.'))
      if (!ok) return
      done(); resolve(u.searchParams.get('code')!)
    })
    const timer = setTimeout(() => { done(); reject(new Error('Signing in took too long. Try again.')) }, timeoutMs)
    const done = () => { clearTimeout(timer); server.close(); pending = null }
    pending = { server, cancel: () => { done(); reject(new Error('Signing in was cancelled.')) } }
    server.on('error', e => { done(); reject((e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? new Error(`Port ${CALLBACK_PORT} is busy: close what uses it and try again.`) : e) })
    server.listen(CALLBACK_PORT, '127.0.0.1', async () => {
      const q = new URLSearchParams({
        response_type: 'code', client_id: AUTH.clientId(), redirect_uri: REDIRECT, scope: 'openid email profile',
        state, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      })
      try { await open(`${AUTH.issuer()}/oauth/authorize?${q}`) } catch (e) { done(); reject(e) }
    })
  })

  const tok = await fetch(`${AUTH.issuer()}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: AUTH.clientId(), code_verifier: verifier }),
  })
  if (!tok.ok) throw new Error('Signing in didn’t finish. Try again.')
  const { access_token } = await tok.json() as { access_token: string }

  const got = await fetch(`${AUTH.account()}/v1/key`, { method: 'POST', headers: { authorization: `Bearer ${access_token}` } })
  const body = await got.json().catch(() => ({})) as { key?: string; email?: string; error?: string }
  if (!got.ok || !body.key) throw new Error(body.error || 'Could not get your Manul key. Try again in a moment.')
  setKey(MANUL_KEY, body.key)
  setConfig({ account: { email: body.email } })
  return accountStatus()
}

export function cancelSignIn() { pending?.cancel() }

/** Sign out on this computer: the key goes (it stays the person's: signing in again brings it back). */
export function signOut(): AccountStatus {
  setKey(MANUL_KEY, '')
  setConfig({ account: undefined })
  return accountStatus()
}
