// Manul's agent: a pi-durable Harness on SQLite, so conversations, tool calls and their output survive a crash or quit.
// One durable conversation per project. Every view change goes through the AG-UI adapter to the renderer.
// Extensions:
//   coding   read / write / edit / bash in the project folder (bundled ffmpeg and ffprobe are on PATH)
//   editor   Manul's own tools: project state, probe, ffmpeg, propose a version, seek, resolve a note, ask the user
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import { Type } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { createRegistry, defineExtension, defineTool, Harness, section } from '@earendil-works/pi-durable'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { CodingTools } from '@earendil-works/pi-durable/tools'
import type { BaseEvent } from '@ag-ui/core'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { AguiAdapter } from './agui'
import type { Memory } from './memory'
import { FFMPEG, probe } from './media'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { duration as timelineDuration } from '../shared/timeline'
import type { ClipInfo, Project, Transcript } from '../shared/types'

type Any = Record<string, any>
const text = (t: unknown) => ({ content: [{ type: 'text' as const, text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] })
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** What the agent needs from the rest of the app. */
export type Bridge = {
  project(dir: string): Project | undefined
  proposeVersion(dir: string, absPath: string, title: string): Promise<string>
  resolveNote(dir: string, id: string, reply: string): Promise<void>
  seek(dir: string, t: number): void
  /** Makes the transcript if needed (may ask the user to download speech recognition). */
  transcript(dir: string, mediaRel: string): Promise<Transcript | null>
  saveClip(dir: string, id: string, title: string, html: string, dur: number): Promise<ClipInfo & { frames: number }>
  bakeClip(dir: string, id: string): Promise<ClipInfo & { frames: number }>
  insertClip(dir: string, id: string, at: number, title: string): Promise<string>
  rerenderTimeline(dir: string, title: string): Promise<string>
}

const MOTION_GUIDE = `Motion clips (footage you make yourself): HTML + GSAP rendered frame-exact into video.
- create_clip writes clips/<id>/clip.html. Write the body content and a <script> with GSAP; Manul adds the document, GSAP,
  its runtime, the Inter font (font-family: Inter, weights 100–900) and a fixed stage at the timeline size.
- Use normal GSAP: gsap.timeline() / gsap.to / from / fromTo, eases, staggers. Never pause it, never use setTimeout,
  setInterval or requestAnimationFrame for motion: Manul drives time. Plugins available by name: SplitText, DrawSVGPlugin,
  MorphSVGPlugin, MotionPathPlugin, TextPlugin, CustomEase. For canvas drawing use manul.onFrame(t => …).
- Give every element a person may want to move or change a data-manul-id ("title", "subtitle", "logo"…). Position
  elements absolutely in px on the stage (manul.width × manul.height).
- No network: no web fonts, CDNs or remote images. Use inline SVG, CSS shapes/gradients, or files already in the project
  (relative paths from the clip folder, e.g. ../../media/photo.jpg).
- Design like a motion designer: one idea per clip, generous margins, big type with tight tracking, two or three colours
  that suit the footage, purposeful easing (power3/expo out for entrances), motion that settles before the end, a clean
  last frame. Respect the duration you set; 2–5 s for titles and cards.
- You get the middle frame back as an image: look at it, and fix the clip (edit the file, then render_clip) if anything
  is off — overflow, clipping, contrast, alignment. Then insert_clip at the right time.`

/** A clip tool's answer: what was rendered, plus the middle frame so the model can see its design. */
async function clipResult(p: Project, c: ClipInfo & { frames: number }) {
  const poster = await readFile(join(p.dir, c.poster)).catch(() => null)
  return {
    content: [
      { type: 'text' as const, text: `Rendered clip "${c.id}" (${c.title}): ${c.duration} s, ${c.frames} frames → ${c.video}. Middle frame attached.` },
      ...(poster ? [{ type: 'image' as const, data: poster.toString('base64'), mimeType: 'image/jpeg' }] : []),
    ],
  }
}

function editorExtension(bridge: Bridge, dirOf: (convId: string) => string) {
  const proj = (api: Any) => {
    const dir = dirOf(api.conversationId)
    const p = bridge.project(dir)
    if (!p) throw new Error('This project is not open.')
    return p
  }
  const inProject = (p: Project, path: string) => {
    const abs = isAbsolute(path) ? path : resolve(p.dir, path)
    if (!abs.startsWith(p.dir)) throw new Error('Paths must stay inside the project folder.')
    return abs
  }
  return defineExtension({
    name: 'editor',
    sections: [section('manul', (input: Any) =>
      `You are Manul, an agentic video editor. The user drops in a video and tells you what they want; you do it.\n` +
      `The project folder is ${input.env?.cwd || 'the working directory'}: project.json (versions, notes, media info), media/ (imported files), ` +
      `renders/ (your outputs), notes/ (frame stills).\n` +
      `How to work:\n` +
      `- Start with project_state to see the versions, the current one, open notes and media details.\n` +
      `- Edit with the ffmpeg tool (bundled; also on PATH for bash). Read the current version, write new files to renders/. Never overwrite media/.\n` +
      `- For anything about speech (cut ums or pauses, remove a sentence, find a moment, captions) read the transcript tool first and cut on word times. ` +
      `To cut many pieces, build one ffmpeg command with trim/atrim + concat (or select/aselect) from the word times; keep ~0.05 s of air around cuts.\n` +
      `- Get it right in one render: plan every cut from the transcript first. Check a render at most once (e.g. the transcript of the output) ` +
      `and only when unsure; never re-render just to polish. The user will ask if they want more.\n` +
      `- When a cut is ready, call propose_version: the user sees it as a before/after and accepts or rejects it. One proposal per request.\n` +
      `- Notes arrive as "[note <id> @ start–end, box x,y,w,h]" plus a still of the frame with the box drawn on it. The box is in 0–1 fractions of the picture ` +
      `(x,y = top-left). Act on exactly that moment and region; when done, call resolve_note with a one-line reply. ` +
      `A note on "clip <id> element <name>" is about that element (data-manul-id) of clips/<id>/clip.html: edit only it (read + edit tools), ` +
      `then render_clip and rerender_timeline.\n` +
      `- Prefer one well-built ffmpeg command over many small ones. Keep codecs sensible: libx264 -crf 18 -preset veryfast, aac 192k, -movflags +faststart.\n` +
      `- When you need a decision from the user, call ask_user with 2–5 options and stop.\n` +
      `Write replies in short plain Markdown. Say what you did, not how.\n\n` + MOTION_GUIDE, { tag: false })],
    tools: [
      defineTool({
        name: 'project_state',
        description: 'The project: versions (which one is current, which is proposed), notes with their anchors, and media details (duration, size, fps, audio).',
        parameters: Type.Object({}),
        execute: async (_args: Any, api: Any) => {
          const p = proj(api)
          const cur = p.versions.find(v => v.id === p.current)
          return text({
            title: p.title, folder: p.dir,
            current: cur && { ...cur, ...p.media[cur.path] },
            proposal: p.proposal,
            timeline: p.timeline && { size: `${p.timeline.width}x${p.timeline.height}`, fps: p.timeline.fps, duration: timelineDuration(p.timeline),
              items: p.timeline.items.map(i => (i.kind === 'media' ? `media ${i.src} ${i.in}–${i.out}` : `clip ${i.clip} ${i.dur}s`)) },
            clips: Object.values(p.clips || {}).map(c => ({ id: c.id, title: c.title, duration: c.duration })),
            versions: p.versions.map(v => ({ id: v.id, title: v.title, path: v.path, by: v.by })),
            notes: p.notes.filter(n => n.status === 'open').map(n => ({ id: n.id, at: `${fmt(n.anchor.t0)}${n.anchor.t1 != null ? `–${fmt(n.anchor.t1)}` : ''}`, box: n.anchor.box, text: n.text })),
            media: p.media,
          })
        },
      }),
      defineTool({
        name: 'probe',
        description: 'Read a media file\'s details (duration, size, fps, codec, audio) with ffprobe. Path relative to the project folder.',
        parameters: Type.Object({ path: Type.String() }),
        execute: async (args: Any, api: Any) => text(await probe(inProject(proj(api), args.path))),
      }),
      defineTool({
        name: 'ffmpeg',
        description: 'Run the bundled ffmpeg in the project folder. Pass the arguments after "ffmpeg" (no shell quoting needed; -y is added). Paths are relative to the project folder; write outputs to renders/.',
        parameters: Type.Object({ args: Type.Array(Type.String(), { description: 'e.g. ["-i","media/a.mp4","-ss","5","-c:v","libx264","renders/cut.mp4"]' }) }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const out = await new Promise<string>((ok, fail) => {
            execFile(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args.args], { cwd: p.dir, maxBuffer: 1 << 24, signal: api.signal },
              (err, _o, stderr) => (err ? fail(new Error(`ffmpeg failed: ${stderr.slice(-3000) || err.message}`)) : ok(stderr.slice(-1500))))
          })
          return text(out || 'done')
        },
      }),
      defineTool({
        name: 'transcript',
        description: 'What is said in a media file, with word timings (seconds), fillers (um, uh) included. Made on first use; if no speech recognition is installed the user is asked to download it. ' +
          'Lines are "start–end  text" per sentence, then each word as word@start-end. Use t0/t1 to read part of a long file, search to find words.',
        parameters: Type.Object({
          media: Type.Optional(Type.String({ description: 'project-relative path; default the current version' })),
          t0: Type.Optional(Type.Number()), t1: Type.Optional(Type.Number()),
          search: Type.Optional(Type.String({ description: 'only sentences containing this (case-insensitive)' })),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const media = args.media || p.versions.find(v => v.id === p.current)!.path
          const t = await bridge.transcript(p.dir, media)
          if (!t) return text('No transcript: speech recognition is not installed.')
          const q = args.search?.toLowerCase()
          const segs = t.segments.filter(s => (args.t0 == null || s.e >= args.t0) && (args.t1 == null || s.s <= args.t1) && (!q || s.text.toLowerCase().includes(q)))
          const n = (x: number) => x.toFixed(2)
          return text(`${media} · ${t.language} · ${t.model} · ${t.segments.length} sentences\n` +
            segs.map(s => `${n(s.s)}–${n(s.e)}  ${s.text}\n  ${s.words.map(w => `${w.w}@${n(w.s)}-${n(w.e)}`).join(' ')}`).join('\n'))
        },
      }),
      defineTool({
        name: 'create_clip',
        description: 'Make a motion clip (title card, lower third, chart, kinetic text, explainer…) from HTML + GSAP and render it. Returns the middle frame as an image so you can check the design.',
        parameters: Type.Object({
          id: Type.String({ description: 'short kebab-case, e.g. "title-card"; reusing an id replaces that clip' }),
          title: Type.String({ description: 'what it is, e.g. "Opening title"' }),
          duration: Type.Number({ description: 'seconds' }),
          html: Type.String({ description: 'body markup + <style> + <script> using gsap (see the motion guide)' }),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const c = await bridge.saveClip(p.dir, args.id, args.title, args.html, args.duration)
          return clipResult(p, c)
        },
      }),
      defineTool({
        name: 'render_clip',
        description: 'Render clips/<id>/clip.html again after you edited it (read/edit tools). If the clip is in the timeline, also call rerender_timeline to propose the updated film.',
        parameters: Type.Object({ id: Type.String() }),
        execute: async (args: Any, api: Any) => { const p = proj(api); return clipResult(p, await bridge.bakeClip(p.dir, args.id)) },
      }),
      defineTool({
        name: 'insert_clip',
        description: 'Open a gap in the film at a time (seconds on the current timeline) and put a clip there; renders the film and proposes it (before/after). at = 0 for the start, at = the duration for the end.',
        parameters: Type.Object({ id: Type.String(), at: Type.Number(), title: Type.String({ description: 'the proposal title, e.g. "Opening title added"' }) }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const v = await bridge.insertClip(p.dir, args.id, args.at, args.title)
          const tl = bridge.project(p.dir)?.versions.find(x => x.id === v)?.timeline
          return text(`Proposed as version ${v}${tl ? `: the film is now ${timelineDuration(tl).toFixed(1)} s` : ''}.`)
        },
      }),
      defineTool({
        name: 'rerender_timeline',
        description: 'Render the current timeline again (after a clip in it changed) and propose it.',
        parameters: Type.Object({ title: Type.String() }),
        execute: async (args: Any, api: Any) => text(`Proposed as version ${await bridge.rerenderTimeline(proj(api).dir, args.title)}.`),
      }),
      defineTool({
        name: 'propose_version',
        description: 'Show a finished cut to the user as a before/after against the current version, with Accept / Reject.',
        parameters: Type.Object({ path: Type.String({ description: 'the rendered file, relative to the project folder' }), title: Type.String({ description: 'short, e.g. "Ums removed"' }) }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const abs = inProject(p, args.path)
          if (!existsSync(abs)) throw new Error(`${args.path} does not exist`)
          const id = await bridge.proposeVersion(p.dir, abs, args.title)
          return text(`Proposed as version ${id}. The user will accept or reject it.`)
        },
      }),
      defineTool({
        name: 'resolve_note',
        description: 'Mark a note as handled, with a one-line reply the user sees on the note.',
        parameters: Type.Object({ id: Type.String(), reply: Type.String() }),
        execute: async (args: Any, api: Any) => { await bridge.resolveNote(proj(api).dir, args.id, args.reply); return text('resolved') },
      }),
      defineTool({
        name: 'seek',
        description: 'Move the playhead (seconds) to show the user a moment.',
        parameters: Type.Object({ t: Type.Number() }),
        execute: async (args: Any, api: Any) => { bridge.seek(proj(api).dir, args.t); return text(`playhead → ${fmt(args.t)}`) },
      }),
      defineTool({
        name: 'ask_user',
        description: 'Ask the user to choose between options (shown as buttons). Ends your turn; the answer arrives as the next message.',
        parameters: Type.Object({
          question: Type.String(),
          options: Type.Array(Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) }), { minItems: 1, maxItems: 5 }),
        }),
        execute: async () => ({ content: [{ type: 'text' as const, text: 'The question is on screen; wait for the answer.' }], control: { terminate: true } }),
      }),
    ],
  })
}

function memoryExtension(memory: Memory) {
  return defineExtension({
    name: 'memory',
    sections: [section('memory', () => memory.prompt())],
    tools: [
      defineTool({
        name: 'remember',
        description: 'Save or update one long-term memory: a preference, rule, correction or fact the user taught you that should hold in future projects.',
        parameters: Type.Object({
          name: Type.String({ description: 'short kebab-case slug' }),
          description: Type.String({ description: 'one line, used to decide when it is relevant' }),
          body: Type.String({ description: 'the fact, then **Why:** and **How to apply:**' }),
        }),
        execute: async (args: Any) => text(`Saved memory "${memory.remember(args.name, args.description, args.body)}".`),
      }),
      defineTool({
        name: 'forget',
        description: 'Delete a long-term memory that turned out to be wrong or that the user asked you to drop.',
        parameters: Type.Object({ name: Type.String() }),
        execute: async (args: Any) => { memory.forget(args.name); return text(`Forgot "${args.name}".`) },
      }),
    ],
  })
}

// Preferred model per provider; the first provider with a key wins.
const PREFER: { provider: string; pick: RegExp[] }[] = [
  { provider: 'anthropic', pick: [/^claude-opus-5/, /^claude-sonnet-5/, /^claude-opus/] },
  { provider: 'google', pick: [/^gemini-3\.8-flash$/, /^gemini-3.*flash$/, /^gemini/] },
  { provider: 'openai', pick: [/^gpt-5\.5$/, /^gpt-5/] },
]

export type AgentHandle = Awaited<ReturnType<typeof startAgent>>

export async function startAgent(opts: { dbPath: string; bridge: Bridge; memory: Memory; onEvent: (dir: string, e: BaseEvent) => void }) {
  const models = createModels({ authContext: { env: async (n: string) => process.env[n], fileExists: async (p: string) => existsSync(p) } })
  for (const p of [anthropicProvider, googleProvider, openaiProvider]) models.setProvider(p())

  const convDir = new Map<string, string>() // conversation id → project dir
  const registry = createRegistry()
  for (const ext of [CodingTools, editorExtension(opts.bridge, id => convDir.get(String(id)) || ''), memoryExtension(opts.memory)]) registry.install(ext)

  const harness = await Harness.open(await openNodeSqliteStorage(opts.dbPath), {
    models, registry,
    env: ({ cwd }: Any) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }),
  } as any, ctx)
  harness.resume() // finish any run a crash or quit left unfinished

  let chosen: { provider: string; modelId: string } | undefined
  async function pickModel() {
    if (chosen) return chosen
    const list = (await models.getAvailable().catch(() => [])) as Any[]
    for (const pref of PREFER) {
      const mine = list.filter(m => m.provider === pref.provider)
      for (const re of pref.pick) {
        const m = mine.find(x => re.test(x.id))
        if (m) return { provider: m.provider, modelId: m.id }
      }
    }
    return undefined
  }

  const live = new Map<string, { conv: Any; off: () => void; view: Any; adapter: AguiAdapter }>()

  async function open(dir: string, convId?: string) {
    const l = live.get(dir)
    if (l) { l.adapter.replay(l.view.value); return l.conv.id as string }
    const model = await pickModel()
    let conv: Any | undefined = convId ? await harness.conversation(Number(convId) as any, ctx).catch(() => undefined) : undefined
    if (!conv) conv = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { ...(model ? { model } : {}), cwd: dir } } as any, ctx)
    else if (model) await conv.configure({ model, cwd: dir }, ctx)
    convDir.set(String(conv.id), dir)
    const view = await conv.viewState(ctx)
    const adapter = new AguiAdapter(String(conv.id), e => opts.onEvent(dir, e))
    const off = view.subscribe((v: Any) => adapter.update(v))
    live.set(dir, { conv, off, view, adapter })
    adapter.replay(view.value)
    return String(conv.id)
  }

  return {
    open,
    hasModel: async () => !!(await pickModel()),
    async model() { return pickModel() },
    keysChanged() { chosen = undefined },
    async send(dir: string, content: string | Any[]) {
      const l = live.get(dir)
      if (!l) throw new Error('This project is not open.')
      const model = await pickModel()
      if (!model) throw new Error('Add an API key first (Settings → Keys).')
      await l.conv.configure({ model, cwd: dir }, ctx)
      await l.conv.submit({ type: 'input', content, whenBusy: 'steer' }, ctx)
    },
    async stop(dir: string) { await live.get(dir)?.conv.abort(ctx) },
    close(dir: string) { const l = live.get(dir); if (l) { l.off(); l.view.dispose?.(); live.delete(dir) } },
    async shutdown() { for (const d of [...live.keys()]) this.close(d); await harness.close(ctx) },
  }
}

