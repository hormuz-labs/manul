// End to end in the real app: render a GSAP clip frame-exact and check pixels at known times.
// Run: npm run build && node test/e2e/clips.e2e.mjs
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const BIN = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
const tmp = mkdtempSync(join(tmpdir(), 'manul-e2e-'))
const video = join(tmp, 'src.mp4')
execFileSync(join(BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])

/** RGB of one pixel of the frame at time t. */
const pixel = (file, t, x, y) => {
  const raw = execFileSync(join(BIN, 'ffmpeg'), ['-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
    '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return [...raw.subarray(0, 3)]
}
const red = ([r, g, b]) => r > 180 && g < 70 && b < 70
const black = ([r, g, b]) => r < 40 && g < 40 && b < 40

const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'projects') } })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  const p = await win.evaluate(f => window.manul.project.create(f), video)
  cpSync(join(root, 'test', 'fixtures', 'clips', 'slide'), join(p.dir, 'clips', 'slide'), { recursive: true })

  const t0 = Date.now()
  const r = await win.evaluate(dir => window.manul.clips.render(dir, 'slide'), p.dir)
  console.log(`rendered ${r.frames} frames in ${Date.now() - t0} ms`)
  const out = join(p.dir, r.video)
  const info = JSON.parse(execFileSync(join(BIN, 'ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', out], { encoding: 'utf8' }))
  const v = info.streams.find(s => s.codec_type === 'video')

  assert.equal(r.frames, 60, '2 s at 30 fps')
  assert.equal(v.width, 640); assert.equal(v.height, 360)
  assert.ok(Math.abs(Number(info.format.duration) - 2) < 0.05, `duration ${info.format.duration}`)
  // t = 0: the box covers x 0–200
  assert.ok(red(pixel(out, 0, 100, 180)), `start: box at left ${pixel(out, 0, 100, 180)}`)
  assert.ok(black(pixel(out, 0, 540, 180)), 'start: right is empty')
  // t = 1 s: exactly halfway, x 220–420 (linear ease)
  assert.ok(red(pixel(out, 1, 320, 180)), `middle: ${pixel(out, 1, 320, 180)}`)
  assert.ok(black(pixel(out, 1, 100, 180)) && black(pixel(out, 1, 540, 180)), 'middle: both sides empty')
  // last frame (t = 59/30): box almost at the right end
  assert.ok(red(pixel(out, 1.95, 540, 180)), `end: ${pixel(out, 1.95, 540, 180)}`)
  assert.ok(black(pixel(out, 1.95, 100, 180)), 'end: left is empty')
  // a poster for the timeline
  assert.ok(r.poster.endsWith('.jpg'))
  // a clip cannot reach the network
  cpSync(join(root, 'test', 'fixtures', 'clips', 'net'), join(p.dir, 'clips', 'net'), { recursive: true })
  const n = await win.evaluate(dir => window.manul.clips.render(dir, 'net'), p.dir)
  const px = pixel(join(p.dir, n.video), 0.1, 32, 32)
  assert.ok(px[1] > 200 && px[0] < 60, `network must be blocked (green), got ${px}`)
  console.log('clips e2e: ok')
} finally {
  await app.close()
}
