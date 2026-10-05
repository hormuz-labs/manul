// Bundled media tools (ffmpeg, ffprobe) and what they report about a file.
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import type { MediaInfo, ToolStatus } from '../shared/types'

const run = promisify(execFile)
const require = createRequire(import.meta.url)

// In a packaged app the binaries are unpacked next to app.asar; in development they come from node_modules.
const unpacked = (p: string) => (app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p)

export const FFMPEG: string = unpacked(require('ffmpeg-static') as string)
export const FFPROBE: string = unpacked((require('@ffprobe-installer/ffprobe') as { path: string }).path)

/** PATH with the bundled tools first, for every process the agent starts. */
export const toolPath = () => [dirname(FFMPEG), dirname(FFPROBE), process.env.PATH].join(':')

export async function probe(file: string): Promise<MediaInfo> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  const j = JSON.parse(stdout) as { format: { duration?: string }; streams: Record<string, string | number>[] }
  const v = j.streams.find(s => s.codec_type === 'video')
  const [n, d] = String(v?.avg_frame_rate || '0/1').split('/').map(Number)
  return {
    duration: Number(j.format.duration || v?.duration || 0),
    width: Number(v?.width || 0),
    height: Number(v?.height || 0),
    fps: d ? Math.round((n / d) * 100) / 100 : 0,
    hasAudio: j.streams.some(s => s.codec_type === 'audio'),
    codec: String(v?.codec_name || 'none'),
  }
}

export async function toolStatus(): Promise<ToolStatus[]> {
  const version = async (bin: string) => {
    try {
      const { stdout } = await run(bin, ['-version'])
      return /version (\S+)/.exec(stdout)?.[1]
    } catch { return undefined }
  }
  return Promise.all([
    { name: 'ffmpeg', path: FFMPEG },
    { name: 'ffprobe', path: FFPROBE },
  ].map(async t => {
    const v = existsSync(t.path) ? await version(t.path) : undefined
    return { ...t, bundled: true, version: v, ok: !!v }
  }))
}
