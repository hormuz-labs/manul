// Bundled media tools (ffmpeg, ffprobe) and what they report about a file.
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { MediaInfo, ToolStatus } from '../shared/types'

const run = promisify(execFile)
// Manul's own pinned ffmpeg/ffprobe (scripts/fetch-ffmpeg.mjs): resources/bin/<platform>-<arch>/ in development,
// <app>/Contents/Resources/bin/ when packaged (electron-builder extraResources).
const BIN = app.isPackaged
  ? join(process.resourcesPath, 'bin')
  : join(import.meta.dirname, '../../resources/bin', `${process.platform}-${process.arch}`)

export const FFMPEG = join(BIN, 'ffmpeg')
export const FFPROBE = join(BIN, 'ffprobe')
/** Manul's own whisper.cpp (scripts/build-whisper.sh); its model is downloaded on demand. */
export const WHISPER_CLI = join(BIN, 'whisper-cli')

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
