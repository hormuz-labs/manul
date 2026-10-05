// End to end in the real app: render a GSAP clip frame-exact and check pixels at known times.
// Run: npm run build && node test/e2e/clips.e2e.mjs
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
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
  // a bare snippet becomes a clip in the film: save → insert at 1 s → proposal of 2 + 1.5 s → accept keeps the clip
  const snippet = `<div data-manul-id="title" style="position:absolute;left:0;top:0;width:640px;height:360px;background:#0f0"></div>
    <script>gsap.from('[data-manul-id=title]', { opacity: 0, duration: 0.3 })</script>`
  const saved = await win.evaluate(([dir, html]) => window.manul.clips.save(dir, 'card', 'Card', html, 1.5), [p.dir, snippet])
  assert.equal(saved.frames, 45)
  const vid = await win.evaluate(dir => window.manul.clips.insert(dir, 'card', 1, 'Card added'), p.dir)
  const after = await win.evaluate(dir => window.manul.project.open(dir), p.dir)
  const prop = after.versions.find(v => v.id === vid)
  assert.equal(after.proposal, vid)
  assert.deepEqual(prop.timeline.items.map(i => i.kind), ['media', 'clip', 'media'])
  const film = join(p.dir, prop.path)
  const filmInfo = JSON.parse(execFileSync(join(BIN, 'ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', film], { encoding: 'utf8' }))
  assert.ok(Math.abs(Number(filmInfo.format.duration) - 3.5) < 0.1, `film ${filmInfo.format.duration}`)
  assert.ok(pixel(film, 0.5, 320, 180)[2] > 180, 'before the clip: the blue source') // blue
  assert.ok(pixel(film, 2.0, 320, 180)[1] > 180, 'inside the clip: green card')
  assert.ok(pixel(film, 3.0, 320, 180)[2] > 180, 'after the clip: the source again')
  const accepted = await win.evaluate(dir => window.manul.project.decide(dir, true), p.dir)
  assert.deepEqual(accepted.timeline.items.map(i => i.kind), ['media', 'clip', 'media'])
  // the clip editor: open the project, select the clip on the timeline strip, drag its element, click it
  await win.reload()
  await win.waitForSelector('text=Recent')
  await win.locator('button:has-text("src")').first().click()
  await win.waitForSelector('button[title="Card · click to edit"]')
  await win.click('button[title="Card · click to edit"]')
  const handle = win.locator('div.cursor-move:has(span:text-is("title"))')
  await handle.waitFor({ timeout: 10000 })
  const b = await handle.boundingBox()
  const versionsBefore = (await win.evaluate(dir => window.manul.project.open(dir), p.dir)).versions.length
  await win.mouse.move(b.x + 20, b.y + 20)
  await win.mouse.down()
  await win.mouse.move(b.x + 80, b.y + 20, { steps: 6 })
  await win.mouse.up()
  let html = ''
  for (let i = 0; i < 60 && !/translate:/.test(html); i++) { await win.waitForTimeout(250); html = readFileSync(join(p.dir, 'clips', 'card', 'clip.html'), 'utf8') }
  assert.match(html, /data-manul-id="title"[^>]*translate: \d+px 0px/, 'the drag is written into the clip')
  let moved
  for (let i = 0; i < 80; i++) { moved = await win.evaluate(dir => window.manul.project.open(dir), p.dir); if (moved.versions.length > versionsBefore) break; await win.waitForTimeout(250) }
  assert.equal(moved.versions.length, versionsBefore + 1, 'the film was re-rendered')
  assert.equal(moved.current, moved.versions.at(-1).id, 'the user\'s own edit is applied, not proposed')
  await win.screenshot({ path: join(tmp, 'editor.png') })
  // a click (no drag) picks the element for a note
  const b2 = await handle.boundingBox()
  await win.mouse.click(b2.x + 30, b2.y + 30)
  await win.waitForSelector('div.cursor-move.border-note:has(span:text-is("title"))', { timeout: 5000 }) // picked for the next note
  console.log('editor screenshot:', join(tmp, 'editor.png'))
  console.log('clips e2e: ok')
} finally {
  await app.close()
}
