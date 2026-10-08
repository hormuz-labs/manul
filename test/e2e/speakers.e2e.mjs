// Who speaks, and subtitles, in the transcript panel: a two-person conversation is transcribed, its voices found in the
// background and shown on the sentences; naming a voice names it everywhere (and two voices with one name are one
// person). Subtitles made 2 s late are found to match but late, and Fix the timing lines them up; another film's
// subtitles are said not to match. Needs a whisper engine; skipped otherwise. MANUL_E2E_SHOTS=<folder> saves screenshots.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const BIN = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
const tmp = mkdtempSync(join(tmpdir(), 'manul-speakers-'))
const shots = process.env.MANUL_E2E_SHOTS
execFileSync(join(BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x334455:s=640x360:r=25:d=30.6', '-i', join(root, 'test/fixtures/speech/two-voices.flac'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(tmp, 'talk.mp4')])
const stamp = t => { const ms = Math.max(0, Math.round(t * 1000)); return `00:${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}` }

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$/.test(k)))
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...env, MANUL_PROJECTS: join(tmp, 'p') } })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 860 })
  await win.waitForSelector('text=What are we making?')
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'talk.mp4'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  if (!(await win.locator('[data-i="0"]').waitFor({ timeout: 90_000 }).then(() => true, () => false))) { console.log('speakers e2e: skipped (no speech recognition)'); process.exit(0) }
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))

  // the voices are found in the background and shown where the speaker changes
  await win.locator('button[title="Name this speaker"]', { hasText: 'Speaker A' }).first().waitFor({ timeout: 60_000 })
  await win.locator('button[title="Name this speaker"]', { hasText: 'Speaker B' }).first().waitFor()
  assert.ok(await win.locator('button[title="Name this speaker"]').count() >= 4, 'a chip at each change of speaker')

  // name them in the Speakers list
  await win.locator('button[title="Name this speaker"]').first().click()
  await win.locator('input[aria-label="Name for speaker A"]').fill('Samantha')
  await win.keyboard.press('Enter')
  await win.locator('input[aria-label="Name for speaker B"]').fill('Daniel')
  await win.keyboard.press('Enter')
  if (shots) await win.screenshot({ path: join(shots, 'speakers-list.png') })
  await win.keyboard.press('Escape')
  await win.locator('button[title="Name this speaker"]', { hasText: 'Samantha' }).first().waitFor()
  await win.locator('button[title="Name this speaker"]', { hasText: 'Daniel' }).first().waitFor()
  assert.equal(await win.locator('button[title="Name this speaker"]', { hasText: /^Speaker [AB]$/ }).count(), 0)
  let project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.deepEqual(project.speakerNames['media/talk.mp4'], { A: 'Samantha', B: 'Daniel' })
  if (shots) await win.screenshot({ path: join(shots, 'speakers-transcript.png') })

  // subtitles of this conversation, 2 s late: they match, the timing is fixed with one click
  const t = JSON.parse(readFileSync(join(dir, project.transcripts['media/talk.mp4']), 'utf8'))
  writeFileSync(join(tmp, 'talk.srt'), t.segments.map((s, i) => `${i + 1}\n${stamp(s.s + 2)} --> ${stamp(s.e + 2)}\n${s.text.trim()}\n`).join('\n'))
  await win.evaluate(([d, f]) => window.manul.project.import(d, f), [dir, join(tmp, 'talk.srt')])
  await win.click('button[role="tab"]:has-text("subtitles")')
  await win.waitForSelector('text=They match, but come 2 s late.')
  if (shots) await win.screenshot({ path: join(shots, 'subtitles-late.png') })
  await win.click('button:has-text("Fix the timing")')
  await win.waitForSelector("text=They match what's said")
  project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.equal(project.subtitles['media/talk.mp4'].offset, 0)
  assert.match(readFileSync(join(dir, 'media/talk.srt'), 'utf8'), new RegExp(stamp(t.segments[0].s).slice(0, 8)), 'the times moved 2 s earlier')
  // clicking a line jumps there
  await win.locator('[data-cue="1"]').click()
  const at = await win.evaluate(() => [...document.querySelectorAll('video')].find(v => v.checkVisibility({ visibilityProperty: true })).currentTime)
  assert.ok(Math.abs(at - t.segments[1].s) < 0.3, `jumped to the line (${at})`)

  // another film's subtitles don't match
  writeFileSync(join(tmp, 'other.srt'), '1\n00:00:01,000 --> 00:00:03,000\nDo you recognise what this is?\n\n2\n00:00:05,000 --> 00:00:07,000\nChangqing, the emperor is waiting for you.\n')
  await win.evaluate(([d, f]) => window.manul.project.import(d, f), [dir, join(tmp, 'other.srt')])
  await win.selectOption('select[aria-label="Choose subtitles"]', { label: 'other.srt' })
  await win.waitForSelector("text=These don't match what's said in this video")
  if (shots) await win.screenshot({ path: join(shots, 'subtitles-wrong.png') })
  console.log('speakers e2e: ok')
} finally {
  await app.close()
}
