// The live mix: music under a spoken film dips while someone speaks (heard live), and Apply renders it.
// Needs macOS `say` and a whisper engine; skipped otherwise.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const BIN = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
try { execFileSync('which', ['say']) } catch { console.log('mix e2e: skipped (no say)'); process.exit(0) }
const tmp = mkdtempSync(join(tmpdir(), 'manul-mix-'))
// speech from 0 to ~2.5 s, then 5 s of silence
execFileSync('say', ['-o', join(tmp, 's.aiff'), 'Hello there, this is the voice of the film.'])
execFileSync(join(BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=25:d=8', '-i', join(tmp, 's.aiff'),
  '-filter_complex', '[1:a]apad=whole_dur=8[a]', '-map', '0:v', '-map', '[a]', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'talk.mp4')])
execFileSync(join(BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:d=3', join(tmp, 'song.mp3')])
const level = (file, a, b) => Number(/mean_volume: (-?[\d.]+) dB/.exec(execFileSync('sh', ['-c', `"${join(BIN, 'ffmpeg')}" -hide_banner -ss ${a} -t ${b - a} -i "${file}" -af volumedetect -f null - 2>&1`], { encoding: 'utf8' }))?.[1] ?? -99)

const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'talk.mp4'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  if (!(await win.getByText(/Hello/).first().waitFor({ timeout: 60000 }).then(() => true, () => false))) { console.log('mix e2e: skipped (no speech recognition)'); process.exit(0) }
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))
  await win.evaluate(([d, f]) => window.manul.project.import(d, f), [dir, join(tmp, 'song.mp3')])

  // choose the music in the Mix panel
  await win.click('button:has-text("Mix")')
  await win.selectOption('select:has(option:text-is("None"))', { label: 'song.mp3' })
  // live: play and sample the preview's gains during and after the speech
  await win.evaluate(() => { const v = [...document.querySelectorAll('video')].find(v => v.checkVisibility({ visibilityProperty: true })); v.currentTime = 1.5; v.muted = false; return v.play() })
  await win.waitForTimeout(500)
  const during = await win.evaluate(() => window.__manulLiveMix)
  await win.evaluate(() => { const v = [...document.querySelectorAll('video')].find(v => v.checkVisibility({ visibilityProperty: true })); v.currentTime = 4.5 })
  await win.waitForTimeout(500)
  const after = await win.evaluate(() => window.__manulLiveMix)
  assert.ok(during.musicPlaying && after.musicPlaying, 'the music plays with the film')
  assert.ok(after.music > during.music * 2, `the music dips under speech (during ${during.music.toFixed(3)}, after ${after.music.toFixed(3)})`)

  // apply: a new version whose final file has the music where the film is silent
  await win.click('button:has-text("Apply")')
  let p
  for (let i = 0; i < 60; i++) { p = await win.evaluate(d => window.manul.project.open(d), dir); if (p.versions.length > 1) break; await win.waitForTimeout(500) }
  const v = p.versions.at(-1)
  assert.equal(p.current, v.id, 'the mix is applied')
  assert.ok(v.dry, 'the version keeps its dry film for the live mix')
  assert.ok(level(join(p.dir, v.path), 4.5, 6) > -45, `music is in the final mix (${level(join(p.dir, v.path), 4.5, 6)} dB)`)
  assert.ok(level(join(p.dir, v.dry), 4.5, 6) < -60, 'and not in the dry film')
  console.log('mix e2e: ok')
} finally {
  await app.close()
}
