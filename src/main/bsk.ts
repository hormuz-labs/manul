// BrowserSkill (bsk) for the agent. By default Manul runs its own copy, fully private: the bundled CLI, a daemon in
// Manul's own home (never ~/.bsk) on a port other than bsk's default 52800, and the extension running inside Manul's
// embedded browser, preset to that port. A bsk extension the user installed in Chrome only knows 52800 and its own
// daemon, so it never sees Manul's daemon, and the agent's bsk calls never reach the user's Chrome.
// Settings → Browser can switch the agent to the user's own Chrome bsk instead (their logins), on purpose.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { BIN } from './media'

const run = promisify(execFile)

export const BSK_BIN = join(BIN, 'bsk')
/** bsk's own default WebSocket port: what every Chrome extension connects to unless told otherwise. */
export const DEFAULT_PORT = 52800
import type { BrowserMode, ChromeBsk } from '../shared/types'
export type { BrowserMode }

/** Manul's bsk home. macOS caps unix socket paths (~104 bytes), so a very long userData falls back to a short folder
 *  ~/.manul/bsk-<hash of userData> (one per Manul install, so two never share a daemon). */
export function privateHome(userData: string, home: string): string {
  const h = join(userData, 'bsk')
  return join(h, 'run', 'daemon.sock').length <= 100 ? h : join(home, '.manul', `bsk-${createHash('sha256').update(userData).digest('hex').slice(0, 8)}`)
}

/** A free loopback port, never bsk's default. */
export async function freePort(avoid: number[] = []): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const port = await new Promise<number>((ok, no) => {
      const s = createServer()
      s.once('error', no)
      s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)) })
    })
    if (port !== DEFAULT_PORT && !avoid.includes(port)) return port
  }
  throw new Error('No free port for the browser daemon.')
}

export function daemonArgs(port: number): string[] {
  if (port === DEFAULT_PORT) throw new Error(`Refusing bsk's default port ${DEFAULT_PORT}: the user's Chrome extension would connect to it.`)
  return ['daemon', 'start', '--foreground', '--port', String(port), '--daemon-idle', '8760h', '--session-idle', '30m']
}

/** chrome.storage.local preset for the extension inside Manul's browser. */
export const extensionStorage = (port: number) => ({ bsk_daemon_port: port, bh_label: 'Manul', bh_connection_enabled: true })

/** The user's own bsk CLI (the one their Chrome extension pairs with), never Manul's bundled copy. */
export function findUserBsk({ home, bundled, path = process.env.PATH || '' }: { home: string; bundled: string; path?: string }): string | null {
  const cands = [join(home, '.local/bin/bsk'), '/opt/homebrew/bin/bsk', '/usr/local/bin/bsk', ...path.split(delimiter).filter(Boolean).map(d => join(d, 'bsk'))]
  return cands.find(c => c !== bundled && dirname(c) !== dirname(bundled) && existsSync(c)) ?? null
}

/** Environment for every process the agent starts: which bsk CLI and which daemon its `bsk` commands reach. */
export function agentEnv(mode: BrowserMode, o: { bundledDir: string; privateHome: string; userHome: string; userBsk: string | null; path: string }) {
  if (mode === 'chrome') return { BSK_HOME: join(o.userHome, '.bsk'), BSK_AUTO_START: '1', PATH: `${o.userBsk ? dirname(o.userBsk) : o.bundledDir}:${o.path}` }
  return { BSK_HOME: o.privateHome, BSK_AUTO_START: '0', PATH: `${o.bundledDir}:${o.path}` }
}

/** Manul's private daemon: started on a fresh port, restarted if it dies, stopped with the app. */
export class BskDaemon {
  port: number | null = null
  private child: ChildProcess | null = null
  private stopping = false
  private restarts = 0

  constructor(private o: { bin: string; home: string; log?: (s: string) => void }) {}

  get home() { return this.o.home }
  get pid() { return this.child?.pid ?? null }
  get running() { return !!this.child && this.child.exitCode == null && !this.child.killed }
  get env() { return { ...process.env, BSK_HOME: this.o.home, BSK_AUTO_START: '0', BSK_BROWSER_WAIT_MS: '0' } }

  /** Run Manul's bsk CLI against the private daemon; JSON output is parsed. */
  async cli(args: string[]) {
    const { stdout } = await run(this.o.bin, args, { env: this.env, timeout: 30_000 })
    try { return JSON.parse(stdout) } catch { return stdout }
  }

  async start(): Promise<{ port: number }> {
    this.stopping = false
    mkdirSync(this.o.home, { recursive: true })
    await this.stopLeftover()
    this.port ??= await freePort()
    await this.spawn()
    return { port: this.port }
  }

  /** A daemon a crashed Manul left running in its home (it is ours: same private home). */
  private async stopLeftover() {
    let pid: number | undefined
    try { pid = JSON.parse(readFileSync(join(this.o.home, 'daemon.json'), 'utf8')).pid } catch { return }
    try { process.kill(pid!, 0) } catch { return } // not running
    await run(this.o.bin, ['daemon', 'stop'], { env: this.env, timeout: 10_000 }).catch(() => { try { process.kill(pid!, 'SIGTERM') } catch { /* gone */ } })
  }

  private async spawn() {
    const child = spawn(this.o.bin, daemonArgs(this.port!), { env: this.env, stdio: ['ignore', 'ignore', 'pipe'] })
    this.child = child
    child.stderr?.on('data', b => this.o.log?.(String(b)))
    child.once('exit', () => {
      if (this.child !== child || this.stopping) return
      const wait = Math.min(500 * 2 ** this.restarts++, 15_000)
      setTimeout(() => { if (!this.stopping) this.spawn().catch(e => this.o.log?.(String(e))) }, wait)
    })
    // ready when its daemon.json names our port and the CLI gets an answer
    const until = Date.now() + 10_000
    for (;;) {
      try {
        const info = JSON.parse(readFileSync(join(this.o.home, 'daemon.json'), 'utf8'))
        if (info.ws_port === this.port && info.pid === child.pid) { await this.cli(['status', '--json']); this.restarts = 0; return }
      } catch { /* not yet */ }
      if (child.exitCode != null) throw new Error('The browser daemon stopped while starting.')
      if (Date.now() > until) throw new Error('The browser daemon did not start.')
      await new Promise(r => setTimeout(r, 100))
    }
  }

  /** At quit, when there is no time to wait. */
  killNow() { this.stopping = true; try { this.child?.kill('SIGTERM') } catch { /* gone */ } }

  async stop() {
    this.stopping = true
    const c = this.child
    this.child = null
    if (!c || c.exitCode != null) return
    await new Promise<void>(ok => { c.once('exit', () => ok()); c.kill('SIGTERM'); setTimeout(() => { c.kill('SIGKILL') }, 3000) })
  }
}

/** The browser part of the agent's instructions, for the current setting. */
export function browserPrompt(mode: BrowserMode): string {
  const files = `For files from the web, run \`bsk download <ref> --out downloads/<name> --session <id>\` (a path in the project folder), ` +
    `then call import_media to add it to the project. Ask the user (ask_user) before downloading anything large or paid, and before ` +
    `publishing, posting, sending, buying or uploading anything.`
  if (mode === 'chrome') {
    return `Browser: the user chose to let you use their own Chrome. Your \`bsk\` commands drive the user's own Chrome through their bsk ` +
      `(their real, logged-in profile), so act only within what they asked. Several browsers can be online: run \`bsk browsers\` and pass ` +
      `\`--browser <id>\` to \`bsk session start\`; if it is unclear which one, ask_user. Never start, stop or restart their bsk daemon. ` +
      `For how to use bsk, read the browser-skill skill first. ${files}`
  }
  return `Browser: your \`bsk\` commands drive Manul's own browser (the Browser panel the user sees inside Manul), never the user's personal ` +
    `Chrome. It is the only browser bsk sees here: never pass \`--browser\`, and never change BSK_HOME or BSK_AUTO_START or start, stop or ` +
    `restart the bsk daemon (Manul runs it). Sign-ins the user made in Manul's browser are kept between sessions; when a page needs a sign-in, ` +
    `CAPTCHA or confirmation, use \`bsk request-help\` so the user does it in the panel. For how to use bsk, read the browser-skill skill first. ${files}`
}

/** An environment object whose values are read at each use (spread), so the agent's shell follows the setting live. */
export function liveEnv(get: () => Record<string, string>): Record<string, string> {
  const o = {}
  for (const k of Object.keys(get())) Object.defineProperty(o, k, { enumerable: true, get: () => get()[k] })
  return o as Record<string, string>
}

/** The user's own Chrome bsk, read-only: is their CLI installed, is their daemon up, which browsers are connected. Never starts anything. */
export async function chromeBsk(o: { userHome: string; bundled: string; path?: string }): Promise<ChromeBsk> {
  const cli = findUserBsk({ home: o.userHome, bundled: o.bundled, path: o.path })
  const env = { ...process.env, BSK_HOME: join(o.userHome, '.bsk'), BSK_AUTO_START: '0', BSK_BROWSER_WAIT_MS: '0' }
  try {
    const { stdout } = await run(cli || o.bundled, ['browsers', '--json'], { env, timeout: 5000 })
    const list = JSON.parse(stdout) as { instance_id?: string; id?: string; label?: string; browser_name?: string }[]
    return { cli, daemon: true, browsers: list.map(b => ({ id: b.instance_id || b.id || '', label: b.label || b.browser_name || 'Chrome' })) }
  } catch { return { cli, daemon: false, browsers: [] } }
}
