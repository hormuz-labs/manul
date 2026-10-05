import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { FFMPEG } from '../src/main/media'

const root = mkdtempSync(join(tmpdir(), 'manul-proj-'))
process.env.MANUL_PROJECTS = join(root, 'projects')
const Projects = await import('../src/main/projects')
const clip = join(root, 'My Clip.mp4')

beforeAll(() => {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip])
})

describe('projects', () => {
  it('creates a self-contained project from a file', async () => {
    const p = await Projects.createFromFile(clip)
    expect(p.dir).toBe(join(process.env.MANUL_PROJECTS!, 'my-clip'))
    expect(p.versions).toHaveLength(1)
    expect(existsSync(join(p.dir, 'media', 'My Clip.mp4'))).toBe(true)
    expect(existsSync(join(p.dir, 'thumb.jpg'))).toBe(true)
    expect(p.media['media/My Clip.mp4']).toMatchObject({ width: 320, height: 240, fps: 25, hasAudio: true, codec: 'h264' })
    expect(p.media['media/My Clip.mp4'].duration).toBeCloseTo(2, 0)
  })

  it('never overwrites: a second project from the same file gets its own folder', async () => {
    const p = await Projects.createFromFile(clip)
    expect(p.dir.endsWith('my-clip-2')).toBe(true)
  })

  it('imports media under a free name and remembers notes with stills', async () => {
    const p = await Projects.createFromFile(clip)
    expect(await Projects.importMedia(p, clip)).toBe('media/My Clip-2.mp4')
    const n = await Projects.addNote(p, { anchor: { t0: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }, text: 'blur' }, Buffer.from('jpeg'))
    expect(n.status).toBe('open')
    expect(readFileSync(join(p.dir, n.still!), 'utf8')).toBe('jpeg')
    const again = await Projects.load(p.dir)
    expect(again.notes[0].text).toBe('blur')
    expect(Projects.recent()[0].dir).toBe(p.dir)
  })
})
