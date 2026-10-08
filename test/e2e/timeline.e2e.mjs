// Editing by hand on the timeline: split at the playhead, delete a piece, undo and redo (the Edit menu's too), cut a
// selected range with Backspace, a piece's volume and mute, moving a piece by its name, trimming one by its edge. The
// edit plays straight from its pieces, across its cuts, and nothing renders until it's saved as a version (fast:
// copying the picture between keyframes).
// Run after npm run build. MANUL_E2E_SHOTS=<folder> saves screenshots there.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const BIN = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
const tmp = mkdtempSync(join(tmpdir(), 'manul-timeline-'))
const shots = process.env.MANUL_E2E_SHOTS
// a keyframe every 2 s: saving the edit copies the picture between them and encodes only the frames at the cuts
execFileSync(join(BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:r=25:d=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '50', '-c:a', 'aac', '-shortest', join(tmp, 'film.mp4')])
const clock = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$/.test(k)))
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...env, MANUL_PROJECTS: join(tmp, 'p') } })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 860 })
  await win.waitForSelector('text=What are we making?')
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'film.mp4'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))
  // (read again if caught mid-write)
  const project = () => { for (;;) { try { return JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) } catch { /* being written */ } } }
  const pieces = () => project().timeline.items.map(i => [i.in, i.out])
  const until = async (ok, what) => { for (let i = 0; i < 150; i++) { if (ok()) return; await new Promise(r => setTimeout(r, 100)) } throw new Error(`timed out: ${what}; pieces ${JSON.stringify(pieces())}`) }
  const total = () => project().timeline.items.reduce((s, i) => s + i.out - i.in, 0)
  // to Manul's window (not the hidden one hosting its browser), as the main process sends
  const send = (...args) => app.evaluate(({ BrowserWindow }, args) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('index.html')).webContents.send(...args), args)
  // the playhead goes where the app is told (as the agent's seek does), in the file or the edit alike
  const seekTo = async t => {
    await send('seek', dir, t)
    await win.waitForSelector(`text=${clock(t)} /`)
  }
  const bar = win.getByTestId('timeline-scrubber')
  const x = async (t, d) => { const b = await bar.boundingBox(); return { x: b.x + b.width * t / d, y: b.y + b.height * 0.35 } }
  const menu = id => send('menu', id)

  // split at the playhead: two pieces, the edit now plays from them (nothing rendered)
  await seekTo(4)
  await win.click('button[aria-label="Split at the playhead"]')
  await until(() => pieces().length === 2, 'split')
  assert.deepEqual(pieces(), [[0, 4], [4, 10]])
  await win.waitForSelector('[data-edited]')
  await win.waitForFunction(() => document.querySelectorAll('video[data-edit-player]').length === 2)
  assert.equal(await bar.locator('[data-piece]').count(), 2)
  assert.equal(project().versions.length, 1, 'nothing rendered')

  // click the second piece and delete it: a 4 s film
  let p = await x(7, 10)
  await win.mouse.click(p.x, p.y)
  await win.waitForSelector('[data-selected-piece]')
  await win.click('button[aria-label="Delete the selected piece"]')
  await until(() => pieces().length === 1, 'delete')
  await win.locator('span.text-faint', { hasText: '/ 0:04.0' }).waitFor()
  // undo (the button), redo and undo again (Edit menu: no text field has the focus, so the timeline's)
  await win.click('button[aria-label="Undo"]')
  await until(() => pieces().length === 2, 'undo')
  await menu('redo')
  await until(() => pieces().length === 1, 'redo')
  await menu('undo')
  await until(() => pieces().length === 2, 'undo from the menu')
  await win.locator('span.text-faint', { hasText: '/ 0:10.0' }).waitFor()

  // select 1–2 s by dragging across the timeline, Backspace cuts it out
  const a = await x(1, 10), b = await x(2, 10)
  await win.mouse.move(a.x, a.y); await win.mouse.down(); await win.mouse.move(b.x, b.y, { steps: 6 }); await win.mouse.up()
  await win.waitForSelector('button[aria-label="Cut the selected range out"]:not([disabled])')
  await win.keyboard.press('Backspace')
  await until(() => pieces().length === 3, 'range cut')
  const [first, second] = pieces()
  assert.ok(near(first[1], 1, 0.08) && near(second[0], 2, 0.08), `cut 1–2 s: ${JSON.stringify(pieces())}`)
  assert.ok(near(total(), 9, 0.1))
  if (shots) await win.screenshot({ path: join(shots, 'timeline-cut.png') })

  // it plays across the cut: past 1 s of the film, the picture is the file after 2 s
  await seekTo(0.5)
  await win.evaluate(() => document.activeElement?.blur())
  await win.keyboard.press('Space')
  await win.waitForFunction(() => (window.__manulLiveMix?.t ?? 0) > 1.4, null, { timeout: 10_000 })
  const shown = await win.evaluate(() => [...document.querySelectorAll('video[data-edit-player]')].find(v => v.checkVisibility({ visibilityProperty: true })).currentTime)
  await win.keyboard.press('Space')
  assert.ok(shown > 2.3, `the file plays from after the cut (${shown})`)

  // the first piece's volume: -6 dB, then muted
  p = await x(0.5, total())
  await win.mouse.click(p.x, p.y)
  await win.click('button[aria-label="Volume of the selected piece"]')
  await win.evaluate(() => {
    const el = document.querySelector('input[aria-label="Volume in dB"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '-6')
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await until(() => project().timeline.items[0].db === -6, 'volume')
  await win.click('button:has-text("Mute")')
  await until(() => project().timeline.items[0].muted === true, 'mute')
  await win.keyboard.press('Escape')
  await bar.locator('[data-piece] [aria-label="muted"]').first().waitFor()

  // move the last piece (4–10 s of the file) to the start by its name
  const grip = bar.locator('[data-piece]').nth(2).locator('[data-grip]')
  const g = await grip.boundingBox(), to = await x(0.2, total())
  await win.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await win.mouse.down()
  await win.mouse.move(to.x, g.y + g.height / 2, { steps: 8 }); await win.mouse.up()
  await until(() => pieces()[0][0] === 4, 'move')
  assert.deepEqual(pieces()[0], [4, 10])

  // trim its end by dragging the edge 1 s to the left
  p = await x(3, total())
  await win.mouse.click(p.x, p.y)
  const edge = bar.locator('[aria-label="Trim the end"]')
  const e = await edge.boundingBox(), oneSecond = (await bar.boundingBox()).width / total()
  await win.mouse.move(e.x + e.width / 2, e.y + e.height / 2); await win.mouse.down()
  await win.mouse.move(e.x + e.width / 2 - oneSecond, e.y + e.height / 2, { steps: 6 }); await win.mouse.up()
  await until(() => pieces()[0][1] < 9.5, 'trim')
  assert.ok(near(pieces()[0][1], 9, 0.1), `trimmed to 9 s: ${JSON.stringify(pieces())}`)
  assert.ok(near(total(), 8, 0.15), `the film is 8 s (${total()})`)
  if (shots) await win.screenshot({ path: join(shots, 'timeline-edited.png') })

  // save it as a version: rendered once, on screen, the edit no longer "edited"
  await win.click('button:has-text("Save as version")')
  await until(() => project().versions.length === 2 && project().current === project().versions[1].id, 'saved as a version')
  await win.locator('[data-edited]').waitFor({ state: 'detached' })
  await win.waitForFunction(() => document.querySelectorAll('video[data-edit-player]').length === 0)
  const v = project().versions[1]
  assert.equal(v.by, 'user')
  assert.equal(v.title, 'Split at 0:04, Cut 0:01–0:02 and 4 more edits', 'the undone delete is not in the title')
  assert.ok(near(project().media[v.path].duration, total(), 0.15), `the render is the edit's length (${project().media[v.path].duration} vs ${total()})`)
  assert.deepEqual(v.timeline.items.map(i => [i.in, i.out, i.db, i.muted]), project().timeline.items.map(i => [i.in, i.out, i.db, i.muted]))
  // each piece shows its own frames, and the version's words are its pieces' (not transcribed again)
  await win.waitForFunction(() => [...document.querySelectorAll('[data-testid="timeline-filmstrip"]')].every(s => s.querySelector('img')), null, { timeout: 20_000 })
  assert.ok(!project().transcripts?.[v.path], 'the render is not transcribed')
  if (shots) await win.screenshot({ path: join(shots, 'timeline-saved.png') })

  // saved fast (most of the picture copied as it was), and it plays right across the joins: of pieces 4–9 s, 0–1 s and
  // 2–4 s of the file (a keyframe every 2 s), 0–4 s and 6–8 s are copied, 4–6 s encoded. At each moment (on a frame;
  // the first frames after the joins among them) the picture is the frame ffmpeg decodes there, not the one either side.
  const jobs = await win.evaluate(() => window.manul.jobs.list())
  assert.ok(jobs.some(j => /^Copied \d+% of the picture as it was$/.test(j.detail || '')), `rendered fast: ${JSON.stringify(jobs.map(j => [j.title, j.detail]))}`)
  const still = t => execFileSync(join(BIN, 'ffmpeg'), ['-v', 'error', '-ss', t.toFixed(2), '-i', join(dir, v.path), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 })
  const mse = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s / a.length }
  for (const t of [2, 3.96, 4, 4.6, 5.4, 5.96, 6, 7]) {
    await seekTo(t)
    await win.waitForFunction(() => { const el = document.querySelector('video:not([data-edit-player])'); return el && !el.seeking && el.readyState >= 2 })
    const shown = Buffer.from(await win.evaluate(() => {
      const el = document.querySelector('video:not([data-edit-player])')
      const c = document.createElement('canvas')
      c.width = el.videoWidth; c.height = el.videoHeight
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(el, 0, 0)
      return [...g.getImageData(0, 0, c.width, c.height).data].filter((_, i) => i % 4 !== 3)
    }))
    const [before, here, after] = [t - 0.04, t, t + 0.04].map(x => mse(shown, still(x)))
    assert.ok(here < Math.min(before, after) / 3, `the picture at ${t} s is the file's frame there (${here.toFixed(0)}; either side ${before.toFixed(0)}, ${after.toFixed(0)})`)
  }
  console.log('timeline e2e: ok')
} finally {
  await app.close()
}
