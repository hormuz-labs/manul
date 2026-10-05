// Manul's main process: the window, the media protocol, projects, keys, and the agent (pi-durable → AG-UI → renderer).
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { startAgent, type AgentHandle } from './agent'
import { renderClip, setClipProtocol } from './clips'
import { buildMenu } from './menu'
import { startUpdates } from './updates'
import { keyStatus, loadKeys, setKey } from './keys'
import { asJob, listJobs, onJobs } from './jobs'
import { toolPath, toolStatus } from './media'
import * as Tools from './tools'
import * as Whisper from './whisper'
import { Memory } from './memory'
import { History } from './history'
import { Skills } from './skills'
import * as Projects from './projects'
import { addOverlay, composeArgs, duration as timelineDuration, insertAt } from '../shared/timeline'
import { moveElement, prepareClipHtml } from '../shared/clip-html'
import { captionCues, exportArgs, toSrt, type ExportOptions } from '../shared/export'
import { spawn } from 'node:child_process'
import { FFMPEG } from './media'
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import type { Anchor, ClipInfo, ConsentRequest, Project, Transcript } from '../shared/types'
import type { Timeline } from '../shared/timeline'

app.setName('Manul')
process.env.PATH = toolPath() // the agent's bash and tools find the bundled ffmpeg / ffprobe first

protocol.registerSchemesAsPrivileged([{ scheme: 'manul', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }])

let win: BrowserWindow | null = null
let agent: AgentHandle | null = null
let memory: Memory
let skills: Skills
let updates: ReturnType<typeof startUpdates> | null = null
const open = new Map<string, Project>() // dir → project

const send = (ch: string, ...args: unknown[]) => win?.webContents.send(ch, ...args)
const projectOf = (dir: string) => {
  const p = open.get(dir)
  if (!p) throw new Error('This project is not open.')
  return p
}
const publish = async (p: Project) => { await Projects.save(p); send('project', p) }
/** Save, show, and make this a point in the project's history. */
const checkpoint = async (p: Project, message: string) => {
  await publish(p)
  await new History(p.dir).record(message).catch(e => console.warn('history', e))
}

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
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' }

// Libraries motion clips may load: manul://lib/<file> (GSAP, the clip runtime)
const LIB = app.isPackaged ? join(process.resourcesPath, 'lib') : join(import.meta.dirname, '../../resources/lib')
// Clip pages may only reach manul:// and inline data: no network, no other origins.
const CLIP_CSP = "default-src manul: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src manul: data: blob:"

function serveMedia(req: Request): Response {
  const url = new URL(req.url)
  const path = decodeURIComponent(url.pathname)
  const file = url.host === 'lib' ? join(LIB, path.replace(/^\/+/, '')) : resolve(path)
  const roots = url.host === 'lib' ? [LIB] : [Projects.projectsRoot(), ...[...open.keys()]]
  if (!roots.some(root => file.startsWith(root + sep)) || !existsSync(file)) return new Response('not found', { status: 404 })
  const size = statSync(file).size
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
  if (type.startsWith('text/html')) {
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { 'content-type': type, 'content-security-policy': CLIP_CSP, 'access-control-allow-origin': '*' } })
  }
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
    if (conv !== p.conversation || !p.conversations?.some(c => c.id === conv)) { useConversation(p, conv); await Projects.save(p) }
  }
  return p
}

/** Make a conversation the project's current one (recording it if new). */
function useConversation(p: Project, id: string) {
  p.conversation = id
  if (!p.conversations?.some(c => c.id === id)) p.conversations = [...(p.conversations || []), { id, title: 'New conversation', createdAt: Date.now() }]
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
  if (p.media[mediaRel] && !p.media[mediaRel].hasAudio) opts = { ask: false } // silent: transcribe() returns an empty transcript without an engine
  else if (!(await Whisper.resolveEngine())) {
    if (!opts.ask) return null
    await Tools.ensure(Whisper.toolToInstall(), askTool(p.dir))
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

// ---------------------------------------------------------------- motion clips and timeline renders
/** Write (or replace) clips/<id>/clip.html and render it. */
async function saveClip(p: Project, id: string, title: string, html: string, dur: number, overlay = false): Promise<ClipInfo & { frames: number }> {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new Error('Clip ids are short kebab-case, e.g. "title-card".')
  const tl = p.timeline!
  await mkdir(join(p.dir, 'clips', id), { recursive: true })
  await writeFile(join(p.dir, 'clips', id, 'clip.html'), prepareClipHtml(html, tl, dur, overlay))
  p.clips = { ...p.clips, [id]: { ...(p.clips?.[id] || { id, title, duration: dur, video: '', poster: '', updatedAt: 0 }), title, overlay } }
  const r = await bakeClip(p, id, title)
  await checkpoint(p, `Made clip “${title}”`)
  return r
}

/** Render a clip's HTML to MP4 + poster and record it on the project. */
async function bakeClip(p: Project, id: string, title?: string) {
  const overlay = !!p.clips?.[id]?.overlay
  const r = await asJob(`Rendering clip ${id}`, 'render', j => renderClip(p.dir, id, j, overlay), { project: p.dir, doneTitle: `Rendered clip ${id}` })
  const info: ClipInfo = { id, title: title || p.clips?.[id]?.title || id, duration: r.duration, video: r.video, poster: r.poster, updatedAt: Date.now(), overlay }
  p.clips = { ...p.clips, [id]: info }
  // the clip's length may have changed: keep every timeline item and overlay that uses it in step
  if (p.timeline) {
    p.timeline.items = p.timeline.items.map(it => (it.kind === 'clip' && it.clip === id ? { ...it, dur: r.duration } : it))
    p.timeline.overlays = p.timeline.overlays?.map(o => (o.clip === id ? { ...o, dur: Math.min(o.dur, r.duration) || r.duration } : o))
  }
  await publish(p)
  return { ...info, frames: r.frames }
}

/** Render a timeline into renders/ and propose it as a version (or, for the user's own edits, make it current). */
async function proposeTimeline(p: Project, tl: Timeline, title: string, by: 'agent' | 'user' = 'agent') {
  const n = p.versions.length + 1
  const out = join('renders', `timeline-${n}.mp4`)
  const rendered = (id: string) => p.clips?.[id]?.video && existsSync(join(p.dir, p.clips[id].video))
  for (const id of new Set([...tl.items.flatMap(it => (it.kind === 'clip' ? [it.clip] : [])), ...(tl.overlays || []).map(o => o.clip)])) if (!rendered(id)) await bakeClip(p, id)
  const args = composeArgs(tl, {
    inputOf: it => (it.kind === 'media' ? it.src : p.clips![it.clip].video),
    hasAudio: it => it.kind === 'media' && !!p.media[it.src]?.hasAudio,
    overlayOf: o => p.clips![o.clip].video,
    out,
  })
  await asJob(`Rendering “${title}”`, 'render', j => new Promise<void>((ok, fail) => {
    j.progress(null, `${timelineDuration(tl).toFixed(1)} s`)
    execFile(FFMPEG, ['-y', '-loglevel', 'error', ...args], { cwd: p.dir, maxBuffer: 1 << 24 }, (err, _o, stderr) => (err ? fail(new Error(stderr.slice(-1500) || err.message)) : ok()))
  }), { project: p.dir, doneTitle: `Rendered “${title}”` })
  if (by === 'agent' && p.proposal) p.versions = p.versions.filter(v => v.id !== p.proposal)
  const v = await Projects.addVersion(p, join(p.dir, out), title, by, tl)
  if (by === 'user') Projects.accept(p, v.id)
  else p.proposal = v.id
  await checkpoint(p, by === 'user' ? title : `Proposed “${title}”`)
  return v.id
}

// ---------------------------------------------------------------- export
export type ExportRequest = { preset: ExportOptions['preset']; fit?: 'pad' | 'crop'; captions: 'none' | 'burn' | 'srt'; captionColor?: string }

/** Export the version on screen to outAbs (and an .srt next to it when asked). */
async function exportFilm(p: Project, req: ExportRequest, outAbs: string) {
  const v = p.versions.find(x => x.id === p.current)!
  const info = p.media[v.path]
  return asJob(`Exporting ${outAbs.split('/').pop()}`, 'render', async j => {
    let srt: string | undefined
    if (req.captions !== 'none') {
      j.progress(null, 'Captions')
      const t = await transcriptOf(p, v.path, { ask: true })
      srt = outAbs.replace(/\.[^.]+$/, '.srt')
      await writeFile(srt, toSrt(t ? captionCues(t) : []))
    }
    const tmpSrt = req.captions === 'burn' && srt ? join(p.dir, '.manul-captions.srt') : undefined
    if (tmpSrt) await writeFile(tmpSrt, await readFile(srt!, 'utf8'))
    const args = exportArgs({ preset: req.preset, fit: req.fit, input: join(p.dir, v.path), out: outAbs, source: info,
      burnCaptions: tmpSrt ? '.manul-captions.srt' : undefined, fontsDir: join(LIB, 'fonts'), captionColor: req.captionColor })
    await new Promise<void>((ok, fail) => {
      const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args], { cwd: p.dir })
      let err = ''
      ff.stdout.on('data', d => { const m = /out_time_ms=(\d+)/.exec(String(d)); if (m && info.duration) j.progress(Math.min(1, Number(m[1]) / 1e6 / info.duration)) })
      ff.stderr.on('data', d => { err += d })
      ff.on('close', c => (c === 0 ? ok() : fail(new Error(err.slice(-1500)))))
    })
    if (tmpSrt) await rm(tmpSrt, { force: true })
    if (req.captions === 'burn' && srt) await rm(srt, { force: true })
    return { file: outAbs, srt: req.captions === 'srt' ? srt : undefined }
  }, { project: p.dir, doneTitle: `Exported ${outAbs.split('/').pop()}` })
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const describe = (a: Anchor) =>
  `@ ${fmt(a.t0)}${a.t1 != null ? `–${fmt(a.t1)}` : ''}${a.box ? `, box ${[a.box.x, a.box.y, a.box.w, a.box.h].map(n => n.toFixed(3)).join(',')}` : ''}` +
  (a.clip ? `, clip ${a.clip.id}${a.clip.element ? ` element ${a.clip.element}` : ''}` : '')

// ---------------------------------------------------------------- IPC
function wire() {
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, projectsRoot: Projects.projectsRoot() }))
  ipcMain.handle('update:state', () => updates?.state())
  ipcMain.handle('update:check', () => updates?.check())
  ipcMain.handle('update:install', () => updates?.install())
  ipcMain.handle('app:notices', () => shell.openPath(app.isPackaged ? join(process.resourcesPath, 'THIRD_PARTY_NOTICES.md') : join(import.meta.dirname, '../../THIRD_PARTY_NOTICES.md')))
  ipcMain.handle('tools:status', () => toolStatus())
  ipcMain.handle('tools:list', () => Tools.listTools())
  ipcMain.handle('tools:install', (_e, id: string) => Tools.install(id))
  ipcMain.handle('tools:remove', (_e, id: string) => Tools.remove(id))
  ipcMain.handle('jobs:list', () => listJobs())
  const skillState = () => ({ skills: skills.list(), enabled: skills.enabled().map(k => k.id), profile: skills.profile(), profiles: skills.profiles() })
  ipcMain.handle('skills:state', () => skillState())
  ipcMain.handle('skills:enable', (_e, id: string, on: boolean) => { skills.setEnabled(id, on); return skillState() })
  ipcMain.handle('skills:profile', (_e, id: string) => { skills.useProfile(id); return skillState() })
  ipcMain.handle('skills:newProfile', (_e, name: string) => { const p = skills.createProfile(name); skills.useProfile(p.id); return skillState() })
  ipcMain.handle('skills:edit', async (_e, id: string) => { const k = skills.fork(id); await shell.openPath(k.path); return skillState() })
  ipcMain.handle('skills:folder', () => shell.openPath(join(app.getPath('userData'), 'skills')))
  ipcMain.handle('memory:list', () => memory.list())
  ipcMain.handle('memory:save', (_e, name: string, description: string, body: string) => { memory.remember(name, description, body); return memory.list() })
  ipcMain.handle('memory:forget', (_e, name: string) => { memory.forget(name); return memory.list() })
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
    await checkpoint(p, `Imported ${file.split('/').pop()}`)
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
    if (accept) Projects.accept(p, p.proposal)
    else p.versions = p.versions.filter(x => x.id !== p.proposal)
    p.proposal = undefined
    if (v && !accept) p.notes.forEach(n => { if (n.status === 'resolved' && n.reply) n.reply += ` (rejected: ${v.title})` })
    await checkpoint(p, `${accept ? 'Accepted' : 'Rejected'} “${v?.title}”`)
    return p
  })
  ipcMain.handle('project:current', async (_e, dir: string, id: string) => {
    const p = projectOf(dir)
    Projects.accept(p, id)
    await checkpoint(p, `Switched to “${p.versions.find(v => v.id === id)?.title}”`)
    return p
  })
  ipcMain.handle('export:run', async (_e, dir: string, req: ExportRequest) => {
    const p = projectOf(dir)
    const suffix = { original: '', landscape: '-16x9', vertical: '-9x16', square: '-1x1' }[req.preset]
    const r = await dialog.showSaveDialog(win!, { title: 'Export', defaultPath: join(app.getPath('videos'), `${p.title}${suffix}.mp4`), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
    if (r.canceled || !r.filePath) return null
    return exportFilm(p, req, r.filePath)
  })
  ipcMain.handle('export:reveal', (_e, file: string) => shell.showItemInFolder(file))
  ipcMain.handle('history:log', (_e, dir: string) => new History(projectOf(dir).dir).log())
  ipcMain.handle('history:restore', async (_e, dir: string, id: string) => {
    const { clips } = await new History(dir).restore(id)
    const p = await Projects.load(dir)
    open.set(dir, p)
    for (const c of clips) if (p.clips?.[c]) await bakeClip(p, c)
    await publish(p)
    return p
  })

  // A message to the agent, optionally anchored (time / range / box) with a frame still (JPEG data URL).
  ipcMain.handle('agent:send', async (_e, dir: string, msg: { text: string; anchor?: Anchor; still?: string }) => {
    const p = projectOf(dir)
    let content: string | Record<string, unknown>[] = msg.text
    if (msg.anchor) {
      const jpeg = msg.still ? Buffer.from(msg.still.split(',')[1], 'base64') : undefined
      const n = await Projects.addNote(p, { anchor: msg.anchor, text: msg.text }, jpeg)
      await checkpoint(p, `Note: ${msg.text.slice(0, 60)}`)
      content = [{ type: 'text', text: `[note ${n.id} ${describe(msg.anchor)}] ${msg.text}` }]
      if (jpeg) content.push({ type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
    }
    // a new conversation is named after its first message
    const rec = p.conversations?.find(c => c.id === p.conversation)
    if (rec && rec.title === 'New conversation') { rec.title = msg.text.replace(/\s+/g, ' ').trim().slice(0, 48) || rec.title; await publish(p) }
    await agent!.send(dir, content)
  })
  ipcMain.handle('clip:save', (_e, dir: string, id: string, title: string, html: string, dur: number, overlay?: boolean) => saveClip(projectOf(dir), id, title, html, dur, !!overlay))
  ipcMain.handle('clip:overlay', (_e, dir: string, id: string, at: number, title: string) => {
    const p = projectOf(dir)
    return proposeTimeline(p, addOverlay(p.timeline!, { clip: id, start: at, dur: p.clips![id].duration }), title)
  })
  ipcMain.handle('clip:insert', async (_e, dir: string, id: string, at: number, title: string) => {
    const p = projectOf(dir)
    const c = p.clips?.[id]
    if (!c) throw new Error(`No clip "${id}".`)
    return proposeTimeline(p, insertAt(p.timeline!, at, { kind: 'clip', clip: id, dur: c.duration }).timeline, title)
  })
  // The user dragged an element of a clip: write it into the HTML, re-render the clip and the film (their edit, applied).
  ipcMain.handle('clip:move', async (_e, dir: string, id: string, element: string, dx: number, dy: number) => {
    const p = projectOf(dir)
    const file = join(p.dir, 'clips', id, 'clip.html')
    await writeFile(file, moveElement(await readFile(file, 'utf8'), element, dx, dy))
    await bakeClip(p, id)
    if (p.timeline?.items.some(i => i.kind === 'clip' && i.clip === id) || p.timeline?.overlays?.some(o => o.clip === id)) await proposeTimeline(p, p.timeline, `Moved ${element} in ${id}`, 'user')
    return p
  })
  ipcMain.handle('clip:render', (_e, dir: string, id: string) =>
    asJob(`Rendering clip ${id}`, 'render', j => renderClip(projectOf(dir).dir, id, j), { project: dir, doneTitle: `Rendered clip ${id}` }))
  ipcMain.handle('agent:models', async (_e, dir?: string) => ({ models: (await agent?.models()) || [], current: (await agent?.model(dir)) || null }))
  ipcMain.handle('agent:setModel', async (_e, dir: string, model: { provider: string; modelId: string } | null) => {
    const p = projectOf(dir)
    p.model = model || undefined
    await publish(p)
    return agent?.model(dir)
  })
  ipcMain.handle('agent:newConversation', async (_e, dir: string) => { const p = projectOf(dir); useConversation(p, await agent!.newConversation(dir)); await publish(p); return p })
  ipcMain.handle('agent:switch', async (_e, dir: string, id: string) => { const p = projectOf(dir); useConversation(p, await agent!.open(dir, id)); await publish(p); return p })
  ipcMain.handle('agent:rename', async (_e, dir: string, id: string, title: string) => {
    const p = projectOf(dir)
    p.conversations = p.conversations?.map(c => (c.id === id ? { ...c, title: title.trim() || c.title } : c))
    await publish(p)
    return p
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
  setClipProtocol(serveMedia)
  loadKeys()
  memory = new Memory(join(app.getPath('userData'), 'memory'))
  skills = new Skills({
    bundled: app.isPackaged ? join(process.resourcesPath, 'skills') : join(import.meta.dirname, '../../resources/skills'),
    user: join(app.getPath('userData'), 'skills'),
    profiles: join(app.getPath('userData'), 'profiles'),
  })
  wire()
  buildMenu(() => win)
  updates = startUpdates(st => send('update', st))
  onJobs(jobs => send('jobs', jobs))
  createWindow()
  try {
    agent = await startAgent({
      dbPath: join(app.getPath('userData'), 'agent.sqlite'),
      memory,
      skills,
      onEvent: (dir, e) => send('agui', dir, e),
      bridge: {
        project: dir => open.get(dir),
        async proposeVersion(dir, abs, title) {
          const p = projectOf(dir)
          if (p.proposal) p.versions = p.versions.filter(v => v.id !== p.proposal) // a new proposal replaces an undecided one
          const v = await Projects.addVersion(p, abs, title, 'agent')
          p.proposal = v.id
          await checkpoint(p, `Proposed “${title}”`)
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
        saveClip: (dir, id, title, html, dur, overlay) => saveClip(projectOf(dir), id, title, html, dur, overlay),
        async overlayClip(dir, id, at, dur, title) {
          const p = projectOf(dir)
          const c = p.clips?.[id]
          if (!c) throw new Error(`No clip "${id}". Create it with create_clip (overlay: true) first.`)
          if (!c.overlay) throw new Error(`Clip "${id}" is full-frame; make it with overlay: true to lay it over the footage, or use insert_clip.`)
          return proposeTimeline(p, addOverlay(p.timeline!, { clip: id, start: at, dur: dur ?? c.duration }), title)
        },
        bakeClip: (dir, id) => bakeClip(projectOf(dir), id),
        async insertClip(dir, id, at, title) {
          const p = projectOf(dir)
          const c = p.clips?.[id]
          if (!c) throw new Error(`No clip "${id}". Create it with create_clip first.`)
          const { timeline } = insertAt(p.timeline!, at, { kind: 'clip', clip: id, dur: c.duration })
          return proposeTimeline(p, timeline, title)
        },
        async exportFilm(dir, req) {
          const p = projectOf(dir)
          await mkdir(join(p.dir, 'exports'), { recursive: true })
          const suffix = { original: '', landscape: '-16x9', vertical: '-9x16', square: '-1x1' }[req.preset]
          return exportFilm(p, req, join(p.dir, 'exports', `${p.title}${suffix}.mp4`))
        },
        rerenderTimeline: (dir, title) => { const p = projectOf(dir); return proposeTimeline(p, p.timeline!, title) },
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
