// Manul's main process: the window, the media protocol, projects, keys, and the agent (pi-durable → AG-UI → renderer).
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { startAgent, type AgentHandle } from './agent'
import { keyStatus, loadKeys, setKey } from './keys'
import { listJobs, onJobs } from './jobs'
import { toolPath, toolStatus } from './media'
import * as Tools from './tools'
import * as Whisper from './whisper'
import * as Projects from './projects'
import type { Anchor, ConsentRequest, Project, Transcript } from '../shared/types'

app.setName('Manul')
process.env.PATH = toolPath() // the agent's bash and tools find the bundled ffmpeg / ffprobe first

protocol.registerSchemesAsPrivileged([{ scheme: 'manul', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }])

let win: BrowserWindow | null = null
let agent: AgentHandle | null = null
const open = new Map<string, Project>() // dir → project

const send = (ch: string, ...args: unknown[]) => win?.webContents.send(ch, ...args)
const projectOf = (dir: string) => {
  const p = open.get(dir)
  if (!p) throw new Error('This project is not open.')
  return p
}
const publish = async (p: Project) => { await Projects.save(p); send('project', p) }

// ---------------------------------------------------------------- consent cards: the caller waits until the user answers
const consents = new Map<string, { req: ConsentRequest; answer: (ok: boolean) => void }>()
let consentSeq = 0
export function askConsent(req: Omit<ConsentRequest, 'id'>): Promise<boolean> {
  const id = `c${++consentSeq}`
  return new Promise(answer => {
    consents.set(id, { req: { ...req, id }, answer })
    send('consent', [...consents.values()].map(c => c.req))
  })
}
const askTool = (project?: string) => (title: string, body: string, sizeMB: number) =>
  askConsent({ project, title, body, sizeMB, confirm: `Download ${sizeMB >= 1000 ? (sizeMB / 1000).toFixed(1) + ' GB' : sizeMB + ' MB'}` })

// ---------------------------------------------------------------- media protocol: manul://media/<abs path>, with Range for scrubbing
const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' }

function serveMedia(req: Request): Response {
  const file = resolve(decodeURIComponent(new URL(req.url).pathname))
  const allowed = [Projects.projectsRoot(), ...[...open.keys()]].some(root => file.startsWith(root + sep))
  if (!allowed || !existsSync(file)) return new Response('not found', { status: 404 })
  const size = statSync(file).size
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '')
  if (!range) {
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' } })
  }
  const start = range[1] ? Number(range[1]) : size - Number(range[2])
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: 206,
    headers: { 'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' },
  })
}

// ---------------------------------------------------------------- projects
async function openProject(dir: string) {
  const p = open.get(dir) || (await Projects.load(dir))
  open.set(dir, p)
  if (agent) {
    const conv = await agent.open(dir, p.conversation)
    if (conv !== p.conversation) { p.conversation = conv; await Projects.save(p) }
  }
  return p
}

// ---------------------------------------------------------------- transcripts
const inflight = new Map<string, Promise<Transcript>>()

/** The transcript of a project's media file: read it if made, else make it (asking to download an engine if none). */
async function transcriptOf(p: Project, mediaRel: string, opts: { ask: boolean }): Promise<Transcript | null> {
  const rel = p.transcripts?.[mediaRel]
  if (rel && existsSync(join(p.dir, rel))) return JSON.parse(await readFile(join(p.dir, rel), 'utf8')) as Transcript
  const key = `${p.dir}|${mediaRel}`
  const busy = inflight.get(key)
  if (busy) return busy
  if (!(await Whisper.resolveEngine())) {
    if (!opts.ask) return null
    await Tools.ensure('whisper', askTool(p.dir))
  }
  const out = Whisper.transcriptPathFor(mediaRel)
  const job = Whisper.transcribe(join(p.dir, mediaRel), join(p.dir, out), `Transcribing ${mediaRel.split('/').pop()}`, p.dir)
    .then(async t => {
      p.transcripts = { ...p.transcripts, [mediaRel]: out }
      await publish(p)
      return t
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

/** After an import: transcribe in the background when an engine is ready (never asks to download on its own). */
const autoTranscribe = (p: Project, mediaRel: string) => {
  const info = p.media[mediaRel]
  if (info?.hasAudio) transcriptOf(p, mediaRel, { ask: false }).catch(e => console.warn('transcription failed', e))
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const describe = (a: Anchor) =>
  `@ ${fmt(a.t0)}${a.t1 != null ? `–${fmt(a.t1)}` : ''}${a.box ? `, box ${[a.box.x, a.box.y, a.box.w, a.box.h].map(n => n.toFixed(3)).join(',')}` : ''}`

// ---------------------------------------------------------------- IPC
function wire() {
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, projectsRoot: Projects.projectsRoot() }))
  ipcMain.handle('tools:status', () => toolStatus())
  ipcMain.handle('tools:list', () => Tools.listTools())
  ipcMain.handle('tools:install', (_e, id: string) => Tools.install(id))
  ipcMain.handle('tools:remove', (_e, id: string) => Tools.remove(id))
  ipcMain.handle('jobs:list', () => listJobs())
  ipcMain.handle('whisper:status', () => Whisper.whisperStatus())
  ipcMain.handle('whisper:set', (_e, c) => Whisper.setWhisper(c))
  ipcMain.handle('whisper:pick', async (_e, what: 'binary' | 'model') => {
    const r = await dialog.showOpenDialog(win!, what === 'model'
      ? { title: 'Choose a whisper.cpp model', properties: ['openFile'], filters: [{ name: 'ggml model', extensions: ['bin'] }] }
      : { title: 'Choose the whisper-cli program', properties: ['openFile'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('transcript:get', async (_e, dir: string, mediaRel: string, make: boolean) => transcriptOf(projectOf(dir), mediaRel, { ask: make }))
  ipcMain.handle('consent:list', () => [...consents.values()].map(c => c.req))
  ipcMain.handle('consent:answer', (_e, id: string, ok: boolean) => {
    const c = consents.get(id)
    consents.delete(id)
    c?.answer(ok)
    send('consent', [...consents.values()].map(x => x.req))
  })
  ipcMain.handle('keys:list', () => keyStatus())
  ipcMain.handle('keys:set', (_e, name: string, value: string) => { setKey(name, value); agent?.keysChanged(); return keyStatus() })
  ipcMain.handle('agent:ready', async () => !!agent && (await agent.hasModel()))

  ipcMain.handle('project:recent', () => Projects.recent())
  ipcMain.handle('project:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('project:create', async (_e, file: string) => {
    const p = await openProject((await Projects.createFromFile(file)).dir)
    autoTranscribe(p, p.versions[0].path)
    return p
  })
  ipcMain.handle('project:open', (_e, dir: string) => openProject(dir))
  ipcMain.handle('project:close', (_e, dir: string) => { agent?.close(dir); open.delete(dir) })
  ipcMain.handle('project:reveal', (_e, dir: string) => shell.openPath(dir))
  ipcMain.handle('project:import', async (_e, dir: string, file: string) => { const p = projectOf(dir); const rel = await Projects.importMedia(p, file); send('project', p); autoTranscribe(p, rel); return rel })
  ipcMain.handle('project:decide', async (_e, dir: string, accept: boolean) => {
    const p = projectOf(dir)
    if (!p.proposal) return p
    const v = p.versions.find(x => x.id === p.proposal)
    if (accept) p.current = p.proposal
    else p.versions = p.versions.filter(x => x.id !== p.proposal)
    p.proposal = undefined
    if (v && !accept) p.notes.forEach(n => { if (n.status === 'resolved' && n.reply) n.reply += ` (rejected: ${v.title})` })
    await publish(p)
    return p
  })
  ipcMain.handle('project:current', async (_e, dir: string, id: string) => { const p = projectOf(dir); p.current = id; await publish(p); return p })

  // A message to the agent, optionally anchored (time / range / box) with a frame still (JPEG data URL).
  ipcMain.handle('agent:send', async (_e, dir: string, msg: { text: string; anchor?: Anchor; still?: string }) => {
    const p = projectOf(dir)
    let content: string | Record<string, unknown>[] = msg.text
    if (msg.anchor) {
      const jpeg = msg.still ? Buffer.from(msg.still.split(',')[1], 'base64') : undefined
      const n = await Projects.addNote(p, { anchor: msg.anchor, text: msg.text }, jpeg)
      send('project', p)
      content = [{ type: 'text', text: `[note ${n.id} ${describe(msg.anchor)}] ${msg.text}` }]
      if (jpeg) content.push({ type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
    }
    await agent!.send(dir, content)
  })
  ipcMain.handle('agent:stop', (_e, dir: string) => agent?.stop(dir))
  ipcMain.handle('agent:attach', async (_e, dir: string) => { await openProject(dir) })
}

// ---------------------------------------------------------------- window
// The app icon. Packaged builds get it from build/ through electron-builder; in development set it by hand.
const ICON = join(import.meta.dirname, '../../build/icon.png')

function createWindow() {
  win = new BrowserWindow({
    ...(process.platform === 'linux' && existsSync(ICON) ? { icon: ICON } : {}),
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#0d0c0b',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  win.on('closed', () => { win = null })
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && !app.isPackaged && existsSync(ICON)) app.dock?.setIcon(ICON)
  protocol.handle('manul', serveMedia)
  loadKeys()
  wire()
  onJobs(jobs => send('jobs', jobs))
  createWindow()
  try {
    agent = await startAgent({
      dbPath: join(app.getPath('userData'), 'agent.sqlite'),
      onEvent: (dir, e) => send('agui', dir, e),
      bridge: {
        project: dir => open.get(dir),
        async proposeVersion(dir, abs, title) {
          const p = projectOf(dir)
          if (p.proposal) p.versions = p.versions.filter(v => v.id !== p.proposal) // a new proposal replaces an undecided one
          const v = await Projects.addVersion(p, abs, title, 'agent')
          p.proposal = v.id
          await publish(p)
          return v.id
        },
        async resolveNote(dir, id, reply) {
          const p = projectOf(dir)
          const n = p.notes.find(x => x.id === id)
          if (n) { n.status = 'resolved'; n.reply = reply }
          await publish(p)
        },
        seek: (dir, t) => send('seek', dir, t),
        transcript: (dir, mediaRel) => transcriptOf(projectOf(dir), mediaRel, { ask: true }),
      },
    })
    send('agent:ready')
  } catch (err) {
    console.error('agent failed to start', err)
    send('notice', `The agent could not start: ${(err as Error).message}`)
  }
})

app.on('window-all-closed', async () => { await agent?.shutdown().catch(() => {}); app.quit() })
app.on('activate', () => { if (!win) createWindow() })
