// The bundled ffmpeg/ffprobe (fetched by scripts/fetch-ffmpeg.mjs): present, same version, and able to do what Manul needs.
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { FFMPEG, FFPROBE } from '../src/main/media'

const out = (bin: string, ...args: string[]) => execFileSync(bin, ['-hide_banner', ...args], { encoding: 'utf8' })

describe('bundled ffmpeg', () => {
  it('comes from resources/bin for this platform', () => {
    expect(FFMPEG).toMatch(new RegExp(`resources/bin/${process.platform}-${process.arch}/ffmpeg$`))
    expect(FFPROBE).toMatch(new RegExp(`resources/bin/${process.platform}-${process.arch}/ffprobe$`))
  })

  it('ffmpeg and ffprobe are the same release', () => {
    const v = (bin: string) => /version (\d+\.\d+(\.\d+)?)/.exec(execFileSync(bin, ['-version'], { encoding: 'utf8' }))?.[1]
    expect(v(FFMPEG)).toBe('9.0.2')
    expect(v(FFPROBE)).toBe(v(FFMPEG))
  })

  it('has the encoders Manul uses', () => {
    const enc = out(FFMPEG, '-encoders')
    for (const e of ['libx264', 'aac', 'libopus', 'png', 'mjpeg']) expect(enc).toMatch(new RegExp(`\\s${e}\\s`))
    if (process.platform === 'darwin') expect(enc).toMatch(/\sh264_videotoolbox\s/)
  })

  it('has the filters Manul uses', () => {
    const f = out(FFMPEG, '-filters')
    for (const x of ['subtitles', 'drawtext', 'boxblur', 'loudnorm', 'afade', 'fade', 'concat', 'trim', 'atrim', 'overlay', 'scale', 'crop', 'sidechaincompress'])
      expect(f).toMatch(new RegExp(`\\s${x}\\s`))
  })

  it('has what analysis and repair need (vid.stab and Rubber Band come from Manul\'s own build)', () => {
    const f = out(FFMPEG, '-filters')
    for (const x of ['vidstabdetect', 'vidstabtransform', 'rubberband', 'scdet', 'signalstats', 'blackdetect', 'freezedetect', 'ebur128', 'silencedetect', 'tile', 'minterpolate', 'eq', 'colorbalance', 'curves'])
      expect(f, x).toMatch(new RegExp(`\\s${x}\\s`))
  })
})

describe('pinned builds', async () => {
  const { BUILDS, VERSION } = await import('../scripts/fetch-ffmpeg.mjs')
  it('covers every platform Manul ships for, with SHA-256 for both tools', () => {
    expect(Object.keys(BUILDS).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
    for (const b of Object.values(BUILDS) as { path: string; ffmpeg: string; ffprobe: string }[]) {
      expect(b.ffmpeg).toMatch(/^[0-9a-f]{64}$/)
      expect(b.ffprobe).toMatch(/^[0-9a-f]{64}$/)
      expect(b.path.endsWith(`_${VERSION}`)).toBe(true)
    }
  })
})
