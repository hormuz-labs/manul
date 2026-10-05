import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captionCues, exportArgs, PRESETS, toSrt } from '../src/shared/export'
import { FFMPEG, probe } from '../src/main/media'
import type { Transcript } from '../src/shared/types'

const words = (text: string, start = 0, gap = 0.35) => text.split(' ').map((w, i) => ({ w, s: start + i * gap, e: start + i * gap + 0.3 }))
const tr = (segs: { text: string; start: number }[]): Transcript => ({ media: 'a.mp4', language: 'en', model: 'm', createdAt: 0,
  segments: segs.map(s => { const ws = words(s.text, s.start); return { s: ws[0].s, e: ws.at(-1)!.e, text: s.text, words: ws } }) })

describe('captions', () => {
  it('splits speech into short readable cues (≤ 42 chars a line, 2 lines, ≤ 6 s)', () => {
    const cues = captionCues(tr([{ text: 'This is a fairly long sentence that keeps going and going so that it has to be split into more than one caption for sure', start: 0 }]))
    expect(cues.length).toBeGreaterThan(1)
    for (const c of cues) {
      expect(c.lines.length).toBeLessThanOrEqual(2)
      for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(42)
      expect(c.e - c.s).toBeLessThanOrEqual(6)
    }
    expect(cues.flatMap(c => c.lines).join(' ')).toBe('This is a fairly long sentence that keeps going and going so that it has to be split into more than one caption for sure')
  })

  it('leaves fillers out of captions', () => {
    const cues = captionCues(tr([{ text: 'Um so uh this works', start: 0 }]))
    expect(cues.flatMap(c => c.lines).join(' ')).toBe('so this works')
  })

  it('starts a new cue at a new sentence', () => {
    const cues = captionCues(tr([{ text: 'Hello there.', start: 0 }, { text: 'Second one.', start: 2 }]))
    expect(cues.map(c => c.lines.join(' '))).toEqual(['Hello there.', 'Second one.'])
  })

  it('writes SRT', () => {
    expect(toSrt([{ s: 0, e: 1.5, lines: ['Hello'] }, { s: 61.25, e: 3725.004, lines: ['a', 'b'] }])).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:01:01,250 --> 01:02:05,004\na\nb\n')
  })
})

describe('export presets', () => {
  it('has the presets people ask for', () => {
    expect(PRESETS.map(p => p.id)).toEqual(['original', 'landscape', 'vertical', 'square'])
  })

  it('vertical: blurred fill behind the picture by default, or a centre crop', () => {
    const pad = exportArgs({ preset: 'vertical', input: 'in.mp4', out: 'out.mp4', source: { width: 1920, height: 1080 } })
    expect(pad.join(' ')).toMatch(/boxblur/)
    expect(pad.join(' ')).toContain('1080:1920')
    const crop = exportArgs({ preset: 'vertical', fit: 'crop', input: 'in.mp4', out: 'out.mp4', source: { width: 1920, height: 1080 } })
    expect(crop.join(' ')).toMatch(/crop=/)
  })

  it('burns captions with the subtitles filter when asked', () => {
    const a = exportArgs({ preset: 'original', input: 'in.mp4', out: 'out.mp4', source: { width: 1280, height: 720 }, burnCaptions: 'caps.srt' })
    expect(a.join(' ')).toMatch(/subtitles=caps\.srt/)
  })

  it('renders for real: a 9:16 export with burned captions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-export-'))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(dir, 'in.mp4')])
    writeFileSync(join(dir, 'caps.srt'), toSrt([{ s: 0.2, e: 1.8, lines: ['Hello from Manul'] }]))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...exportArgs({ preset: 'vertical', input: 'in.mp4', out: 'out.mp4', source: { width: 640, height: 360 }, burnCaptions: 'caps.srt' })], { cwd: dir })
    expect(await probe(join(dir, 'out.mp4'))).toMatchObject({ width: 1080, height: 1920, hasAudio: true })
  })
})

describe('burned captions look right', () => {
  /** rows (as fractions of the height) that contain white caption pixels, on a black video */
  async function captionRows(preset: 'original' | 'vertical', w: number, h: number) {
    const dir = mkdtempSync(join(tmpdir(), 'manul-cap-'))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:rate=25:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'in.mp4')])
    writeFileSync(join(dir, 'caps.srt'), toSrt([{ s: 0, e: 1, lines: ['Hello from Manul'] }]))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...exportArgs({ preset, fit: 'crop', input: 'in.mp4', out: 'out.mp4', source: { width: w, height: h }, burnCaptions: 'caps.srt',
      fontsDir: join(import.meta.dirname, '..', 'resources', 'lib', 'fonts') })], { cwd: dir })
    const info = await probe(join(dir, 'out.mp4'))
    const raw = execFileSync(FFMPEG, ['-loglevel', 'error', '-ss', '0.5', '-i', join(dir, 'out.mp4'), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 })
    const rows: number[] = []
    for (let y = 0; y < info.height; y++) {
      let white = 0
      for (let x = 0; x < info.width; x++) if (raw[y * info.width + x] > 200) white++
      if (white > 2) rows.push(y / info.height)
    }
    return rows
  }

  it('landscape: one line in the bottom fifth, about 4–8% of the height tall', async () => {
    const rows = await captionRows('original', 1280, 720)
    expect(Math.min(...rows)).toBeGreaterThan(0.8)
    expect(Math.max(...rows)).toBeLessThan(0.97)
    const tall = Math.max(...rows) - Math.min(...rows)
    expect(tall).toBeGreaterThan(0.03); expect(tall).toBeLessThan(0.09)
  })

  it('vertical: above the bottom UI area, readable but not huge', async () => {
    const rows = await captionRows('vertical', 1080, 1920)
    expect(Math.min(...rows)).toBeGreaterThan(0.6)
    expect(Math.max(...rows)).toBeLessThan(0.88) // clear of the platform's buttons and caption area
    const tall = Math.max(...rows) - Math.min(...rows)
    expect(tall).toBeGreaterThan(0.02); expect(tall).toBeLessThan(0.06)
  })
})
