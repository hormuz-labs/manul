// On-demand tools: downloaded only when first needed, after the user agrees, into <userData>/tools (never system-wide).
//   uv        Astral's Python manager (a single binary, pinned version, SHA-256 checked)
//   whisper   speech-to-text: faster-whisper in its own uv-managed Python, plus the "base" model
// Every install runs as a background job. One install at a time per tool.
import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { asJob, type JobHandle } from './jobs'
import type { OnDemandTool } from '../shared/types'

const run = promisify(execFile)

export const toolsRoot = () => process.env.MANUL_TOOLS || join(app.getPath('userData'), 'tools')
const dir = (id: string) => join(toolsRoot(), id)
const stamp = (id: string) => join(dir(id), '.installed.json')

// ---------------------------------------------------------------- pinned downloads
const UV_VERSION = '0.12.23'
const UV_BUILDS: Record<string, { target: string; sha256: string }> = {
  'darwin-arm64': { target: 'aarch64-apple-darwin', sha256: '50487ae565ccd96e499056b4674d438f4c53170202617b4c759defe0c6a1b544' },
  'darwin-x64': { target: 'x86_64-apple-darwin', sha256: '960da44cb4b73685206ddd250b19e0a117fa41095710c1038f081f5cb613efb4' },
  'linux-x64': { target: 'x86_64-unknown-linux-gnu', sha256: '9167d72b3319674b6303c4cbe071854bba13ebdf3d76b1a7cbdc175471fb66d6' },
  'linux-arm64': { target: 'aarch64-unknown-linux-gnu', sha256: '6524bd338177ed50d035d39354e12545e993bbeba2ecbddf0480c5b3a81d313f' },
}
const PYTHON = '3.12'
const FASTER_WHISPER = '1.2.1'
export const WHISPER_MODEL = 'base'

type Def = Omit<OnDemandTool, 'installed' | 'diskBytes' | 'version'> & { install(j: JobHandle): Promise<string> }

const DEFS: Def[] = [
  {
    id: 'uv', name: 'Python runtime (uv)', sizeMB: 40,
    description: 'Runs Manul\'s Python-based tools in their own sandboxed environments.',
    async install(j) {
      const build = UV_BUILDS[`${process.platform}-${process.arch}`]
      if (!build) throw new Error(`No uv build for ${process.platform}-${process.arch}`)
      const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${build.target}.tar.gz`
      const tgz = join(dir('uv'), 'uv.tar.gz')
      await download(url, tgz, build.sha256, j, 'Downloading uv')
      await run('tar', ['-xzf', tgz, '-C', dir('uv'), '--strip-components', '1'])
      await rm(tgz)
      return UV_VERSION
    },
  },
  {
    id: 'whisper', name: 'Speech recognition (Whisper)', sizeMB: 330, needs: ['uv'],
    description: 'Transcribes speech with word timings, so you (and Manul) can edit by text: cut the ums, remove a sentence, find a moment.',
    async install(j) {
      const env = pyEnv()
      j.progress(null, `Installing Python ${PYTHON}`)
      await sh(uvBin(), ['python', 'install', PYTHON], env)
      j.progress(0.2, 'Creating environment')
      await sh(uvBin(), ['venv', '--python', PYTHON, join(dir('whisper'), 'venv')], env)
      j.progress(0.3, 'Installing faster-whisper')
      await sh(uvBin(), ['pip', 'install', '--python', venvPython('whisper'), `faster-whisper==${FASTER_WHISPER}`], env)
      j.progress(0.7, `Downloading the "${WHISPER_MODEL}" model`)
      await sh(venvPython('whisper'), [scriptPath('transcribe.py'), '--download-only', '--model', WHISPER_MODEL], { ...env, HF_HOME: join(dir('whisper'), 'models') })
      return `faster-whisper ${FASTER_WHISPER} · ${WHISPER_MODEL}`
    },
  },
]

// ---------------------------------------------------------------- paths other modules use
export const uvBin = () => join(dir('uv'), process.platform === 'win32' ? 'uv.exe' : 'uv')
export const venvPython = (id: string) => join(dir(id), 'venv', 'bin', 'python')
export const whisperEnv = () => ({ ...pyEnv(), HF_HOME: join(dir('whisper'), 'models'), HF_HUB_OFFLINE: '1' })
/** Python scripts ship in resources/py (unpacked next to the app when packaged). */
export const scriptPath = (name: string) =>
  app.isPackaged ? join(process.resourcesPath, 'py', name) : join(import.meta.dirname, '../../resources/py', name)
const pyEnv = () => ({
  ...process.env,
  UV_PYTHON_INSTALL_DIR: join(toolsRoot(), 'python'),
  UV_CACHE_DIR: join(toolsRoot(), 'cache'),
  UV_NO_CONFIG: '1',
  PYTHONUNBUFFERED: '1',
})

// ---------------------------------------------------------------- status, install, remove
export function isInstalled(id: string) { return existsSync(stamp(id)) }

export async function listTools(): Promise<OnDemandTool[]> {
  return Promise.all(DEFS.map(async ({ install: _i, ...d }) => {
    const installed = isInstalled(d.id)
    let version: string | undefined, diskBytes: number | undefined
    if (installed) {
      try { version = JSON.parse(readFileSync(stamp(d.id), 'utf8')).version } catch { /* old stamp */ }
      diskBytes = await du(dir(d.id))
    }
    return { ...d, installed, version, diskBytes }
  }))
}

/** What installing `id` would download: the tool and any missing tools it needs. */
export function plan(id: string): Def[] {
  const out: Def[] = []
  const add = (t: string) => {
    const d = DEFS.find(x => x.id === t)
    if (!d) throw new Error(`unknown tool ${t}`)
    for (const n of d.needs || []) add(n)
    if (!isInstalled(t) && !out.includes(d)) out.push(d)
  }
  add(id)
  return out
}

const installing = new Map<string, Promise<void>>()

export function install(id: string): Promise<void> {
  const busy = installing.get(id)
  if (busy) return busy
  const p = (async () => {
    for (const d of plan(id)) {
      await rm(dir(d.id), { recursive: true, force: true })
      await mkdir(dir(d.id), { recursive: true })
      const version = await asJob(`Installing ${d.name}`, 'install', j => d.install(j), { doneTitle: `Installed ${d.name}` })
      writeFileSync(stamp(d.id), JSON.stringify({ version, at: Date.now() }))
    }
    if (isInstalled('uv')) await sh(uvBin(), ['cache', 'clean'], pyEnv()).catch(() => {}) // wheels are installed; the cache only takes space
  })().finally(() => installing.delete(id))
  installing.set(id, p)
  return p
}

export async function remove(id: string) {
  if (DEFS.some(d => d.needs?.includes(id) && isInstalled(d.id))) throw new Error(`Other tools need ${id}; remove them first.`)
  await rm(dir(id), { recursive: true, force: true })
}

/**
 * Make sure a tool is installed, asking the user first if it is not.
 * `ask` shows the consent card and resolves true when the user agrees.
 */
export async function ensure(id: string, ask: (title: string, body: string, sizeMB: number) => Promise<boolean>) {
  const todo = plan(id)
  if (!todo.length) return
  const main = DEFS.find(d => d.id === id)!
  const size = todo.reduce((s, d) => s + d.sizeMB, 0)
  const ok = await ask(`Download ${main.name}?`, main.description, size)
  if (!ok) throw new Error(`The user declined to download ${main.name}.`)
  await install(id)
}

// ---------------------------------------------------------------- helpers
async function download(url: string, to: string, sha256: string, j: JobHandle, label: string) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha256')
  const chunks: Uint8Array[] = []
  let got = 0
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
    hash.update(chunk)
    got += chunk.length
    j.progress(total ? got / total : null, `${label} · ${(got / 1e6).toFixed(1)} MB`)
  }
  const digest = hash.digest('hex')
  if (digest !== sha256) throw new Error(`Checksum mismatch for ${url}: the download was not what Manul expected, so it was discarded.`)
  await writeFile(to, Buffer.concat(chunks))
}

function sh(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { env })
    let out = '', err = ''
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { err += d })
    p.on('error', fail)
    p.on('close', code => (code === 0 ? ok(out) : fail(new Error(`${cmd.split('/').pop()} ${args[0]} failed: ${err.slice(-1500)}`))))
  })
}

async function du(path: string) {
  try {
    const { stdout } = await run('du', ['-sk', path])
    return Number(stdout.split(/\s/)[0]) * 1024
  } catch { return undefined }
}
