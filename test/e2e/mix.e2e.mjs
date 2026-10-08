// The live mix: music under a spoken film dips while someone speaks (heard live), and Apply renders it.
// Recorded speech and its reference transcript keep this independent of local speech engines.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary, loadRecordedTranscript, recordedTranscriptEnv, speechFixture } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-mix-'))
// The opening "Welcome back" starts at 1 s, followed by digital silence (the fixture itself has a music bed).
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-ss', '2.5', '-t', '0.85', '-i', speechFixture, join(tmp, 'speech.wav')])
const words = JSON.parse(readFileSync(speechFixture.replace(/\.flac$/, '.reference.json'), 'utf8')).words.slice(0, 2).map(w => ({ ...w, s: w.s - 1.5, e: w.e - 1.5 }))
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=25:d=8', '-i', join(tmp, 'speech.wav'),
  '-filter_complex', '[1:a]adelay=1000:all=1,apad=whole_dur=8[a]', '-map', '0:v', '-map', '[a]', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'talk.mp4')])
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:d=3', join(tmp, 'song.mp3')])
const level = (file, a, b) => {
  const result = spawnSync(bundledBinary('ffmpeg'), ['-hide_banner', '-ss', String(a), '-t', String(b - a), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.error?.message || result.stderr)
  const match = /mean_volume: (-?[\d.]+|-inf) dB/.exec(result.stderr)
  assert.ok(match, 'ffmpeg reported a mean volume')
  return match[1] === '-inf' ? -Infinity : Number(match[1])
}

const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: recordedTranscriptEnv(tmp) })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'talk.mp4'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  const dir = await loadRecordedTranscript(win, words)
  await win.evaluate(([d, f]) => window.manul.project.import(d, f), [dir, join(tmp, 'song.mp3')])

  // choose the music in the Mix panel
  await win.click('button:has-text("Mix")')
  await win.selectOption('select:has(option:text-is("None"))', { label: 'song.mp3' })
  // live: play and sample the preview's gains during and after the speech
  await win.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.checkVisibility({ visibilityProperty: true }) && v.readyState >= 2))
  await win.evaluate(() => { const v = [...document.querySelectorAll('video')].find(v => v.checkVisibility({ visibilityProperty: true })); v.currentTime = 1.1; v.muted = false; return v.play() })
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
