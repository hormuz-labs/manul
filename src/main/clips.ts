// Motion clips: agent-made HTML + GSAP in clips/<id>/clip.html, rendered frame-exact into clips/<id>/clip.mp4.
// Rendering happens in an offscreen window on a separate, network-less session: for each frame Manul moves the clip's
// clock (__manulSeek), waits for the paint, captures the bitmap and pipes it to ffmpeg.
import { BrowserWindow, session } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { JobHandle } from './jobs'
import { FFMPEG } from './media'

export type ClipFormat = { duration: number; width: number; height: number; fps: number }
export type RenderResult = ClipFormat & { video: string; poster: string; frames: number }

export const clipUrl = (file: string) => `manul://media${pathToFileURL(file).pathname}`

/** The session clips run in: only manul:// (project files, Manul's libraries) and inline data; no network. */
let clipSession: Electron.Session | null = null
let handler: ((req: Request) => Response | Promise<Response>) | null = null
/** The manul:// handler (protocol handlers are per session, so the clip session needs it too). */
export const setClipProtocol = (h: typeof handler) => { handler = h }
export function clipsSession() {
  if (clipSession) return clipSession
  clipSession = session.fromPartition('manul-clips')
  if (handler) clipSession.protocol.handle('manul', handler)
  clipSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(manul|data|blob|devtools):/.test(d.url) }))
  clipSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  return clipSession
}

/** Render clips/<id>/clip.html to clips/<id>/clip.mp4 (+ poster.jpg). Paths returned are project-relative. */
export async function renderClip(projectDir: string, id: string, j?: JobHandle): Promise<RenderResult> {
  const dir = join(projectDir, 'clips', id)
  const html = join(dir, 'clip.html')
  if (!existsSync(html)) throw new Error(`No clip "${id}" (expected clips/${id}/clip.html).`)

  const win = new BrowserWindow({
    show: false, width: 1920, height: 1080, useContentSize: true, frame: false,
    webPreferences: { offscreen: true, session: clipsSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  const errors: string[] = []
  win.webContents.on('console-message', (e) => { if ((e as unknown as { level: string }).level === 'error') errors.push((e as unknown as { message: string }).message) })
  try {
    await win.loadURL(clipUrl(html))
    const fmt = (await win.webContents.executeJavaScript('window.__manulReady')) as ClipFormat | undefined
    if (!fmt) throw new Error('The clip did not load Manul\'s runtime (manul://lib/clip-runtime.js).')
    const { width, height, fps, duration } = fmt
    win.setContentSize(width, height)
    await win.webContents.executeJavaScript('window.__manulSeek(0)')

    const frames = Math.max(1, Math.round(duration * fps))
    const out = join(dir, 'clip.mp4')
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-',
      '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
    let ffErr = ''
    ff.stderr.on('data', d => { ffErr += d })
    const done = new Promise<void>((ok, fail) => ff.on('close', c => (c === 0 ? ok() : fail(new Error(`ffmpeg: ${ffErr.slice(-800)}`)))))

    let poster: Buffer | null = null
    for (let f = 0; f < frames; f++) {
      const t = f / fps
      await win.webContents.executeJavaScript(`window.__manulSeek(${t})`)
      let img = await win.webContents.capturePage()
      const size = img.getSize()
      if (size.width !== width || size.height !== height) img = img.resize({ width, height, quality: 'best' })
      if (f === Math.floor(frames / 2)) poster = img.toJPEG(85)
      if (!ff.stdin.write(img.toBitmap())) await new Promise(r => ff.stdin.once('drain', r))
      j?.progress((f + 1) / frames, `Frame ${f + 1} of ${frames}`)
    }
    ff.stdin.end()
    await done
    if (poster) await writeFile(join(dir, 'poster.jpg'), poster)
    if (errors.length) console.warn(`clip ${id}:`, errors.slice(0, 5).join(' | '))
    return { ...fmt, frames, video: join('clips', id, 'clip.mp4'), poster: join('clips', id, 'poster.jpg') }
  } finally {
    win.destroy()
  }
}
