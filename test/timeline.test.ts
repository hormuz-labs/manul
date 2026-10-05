import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composeArgs, duration, fromMedia, insertAt, itemAt, removeItem, splitAt, type Timeline } from '../src/shared/timeline'
import { FFMPEG, probe } from '../src/main/media'

const base = (): Timeline => fromMedia('media/a.mp4', 10, { width: 1280, height: 720, fps: 30 })
const clip = (dur: number) => ({ kind: 'clip' as const, clip: 'title', dur })

describe('timeline', () => {
  it('starts as the whole imported file', () => {
    const tl = base()
    expect(tl.items).toEqual([{ id: expect.any(String), kind: 'media', src: 'media/a.mp4', in: 0, out: 10 }])
    expect(duration(tl)).toBe(10)
  })

  it('finds the item under a time', () => {
    const tl = insertAt(base(), 4, clip(2)).timeline
    expect(itemAt(tl, 1)).toMatchObject({ index: 0, start: 0 })
    expect(itemAt(tl, 5)).toMatchObject({ index: 1, start: 4 })
    expect(itemAt(tl, 7)).toMatchObject({ index: 2, start: 6 })
    expect(itemAt(tl, 99)).toMatchObject({ index: 2 })
  })

  it('splits a media item at a time without changing the total', () => {
    const tl = splitAt(base(), 4)
    expect(tl.items.map(i => i.kind === 'media' && [i.in, i.out])).toEqual([[0, 4], [4, 10]])
    expect(duration(tl)).toBe(10)
    expect(new Set(tl.items.map(i => i.id)).size).toBe(2)
  })

  it('does not split at an edge', () => {
    expect(splitAt(base(), 0).items).toHaveLength(1)
    expect(splitAt(base(), 10).items).toHaveLength(1)
  })

  it('opens a gap and inserts a clip in between', () => {
    const { timeline, index } = insertAt(base(), 4, clip(3))
    expect(index).toBe(1)
    expect(timeline.items.map(i => i.kind)).toEqual(['media', 'clip', 'media'])
    expect(duration(timeline)).toBe(13)
  })

  it('inserts at the start and at the end', () => {
    expect(insertAt(base(), 0, clip(2)).timeline.items.map(i => i.kind)).toEqual(['clip', 'media'])
    expect(insertAt(base(), 10, clip(2)).timeline.items.map(i => i.kind)).toEqual(['media', 'clip'])
  })

  it('inserting inside a clip goes after it (clips are never cut)', () => {
    const one = insertAt(base(), 4, clip(4)).timeline
    const two = insertAt(one, 5, { kind: 'clip', clip: 'second', dur: 1 })
    expect(two.timeline.items.map(i => (i.kind === 'clip' ? i.clip : 'media'))).toEqual(['media', 'title', 'second', 'media'])
  })

  it('removes an item', () => {
    const { timeline } = insertAt(base(), 4, clip(3))
    const c = timeline.items[1]
    expect(duration(removeItem(timeline, c.id))).toBe(10)
  })
})

describe('compose', () => {
  it('builds one ffmpeg command: normalised video + audio per item, then concat', () => {
    const { timeline } = insertAt(base(), 4, clip(2))
    const args = composeArgs(timeline, {
      inputOf: it => (it.kind === 'media' ? it.src : `clips/${it.clip}/clip.mp4`),
      hasAudio: it => it.kind === 'media',
      out: 'renders/out.mp4',
    })
    // the same file is opened once even when two items use it
    expect(args.filter(a => a === '-i')).toHaveLength(2)
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('trim=start=0:end=4')
    expect(fc).toContain('trim=start=4:end=10')
    expect(fc).toContain('scale=1280:720:force_original_aspect_ratio=decrease')
    expect(fc).toContain('anullsrc') // the silent clip gets a silent track
    expect(fc).toContain('concat=n=3:v=1:a=1[v][a]')
    expect(args.slice(-1)).toEqual(['renders/out.mp4'])
  })

  it('renders for real: 4 s + 2 s clip + 6 s = 12 s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-tl-'))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=duration=10',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(dir, 'a.mp4')])
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=1280x720:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'clip.mp4')])
    const tl = insertAt(fromMedia('a.mp4', 10, { width: 1280, height: 720, fps: 30 }), 4, clip(2)).timeline
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...composeArgs(tl, {
      inputOf: it => (it.kind === 'media' ? it.src : 'clip.mp4'), hasAudio: it => it.kind === 'media', out: 'out.mp4',
    })], { cwd: dir })
    const info = await probe(join(dir, 'out.mp4'))
    expect(info).toMatchObject({ width: 1280, height: 720, fps: 30, hasAudio: true })
    expect(info.duration).toBeCloseTo(12, 0)
  })
})
