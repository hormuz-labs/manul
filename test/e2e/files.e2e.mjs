// Files besides the film: the side panel's Files tab → Add brings in subtitles, a note and a folder; the list says what
// each is; they ride on the next message as chips, and the sent message shows them. Dragged from the list, footage goes
// into the edit where it's dropped on the timeline (at once, no render), music under it, subtitles with the video.
// Deleting sends files to the Trash, never the ones the film uses. Run after npm run build. The agent gets a fake key, so
// the message fails at the model (no real call is ever paid for); what's checked is what the user sees.
// MANUL_E2E_SHOTS=<folder> saves screenshots there.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const BIN = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
const tmp = mkdtempSync(join(tmpdir(), 'manul-files-'))
const shots = process.env.MANUL_E2E_SHOTS
execFileSync(join(BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:r=25:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'film.mp4')])
writeFileSync(join(tmp, 'film.srt'), '1\n00:00:00,500 --> 00:00:02,000\nHello there\n\n2\n00:00:02,200 --> 00:00:03,500\nGoodbye\n')
writeFileSync(join(tmp, 'notes.md'), 'Colours: keep it warm.\n')
mkdirSync(join(tmp, 'Brand Kit'))
writeFileSync(join(tmp, 'Brand Kit', 'colours.txt'), 'Orange #F2A541\n')
copyFileSync(join(root, 'resources', 'fonts', 'Inter-Bold.ttf'), join(tmp, 'Brand Kit', 'Brand-Bold.ttf'))
execFileSync(join(BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'b.mp4')])
execFileSync(join(BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=duration=3', join(tmp, 'song.mp3')])

// no real keys reach the app: a fake one makes the agent "ready" without ever reaching a paid model
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$/.test(k)))
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...env, ANTHROPIC_API_KEY: 'sk-ant-e2e-not-a-real-key', MANUL_PROJECTS: join(tmp, 'p') } })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 860 })
  await win.waitForSelector('text=What are we making?')
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'film.mp4'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))

  // Files → Add (the dialog answered with three things: subtitles, a note, a folder)
  await app.evaluate(({ ipcMain }, fs) => { ipcMain.removeHandler('project:pickFiles'); ipcMain.handle('project:pickFiles', () => fs) },
    [join(tmp, 'film.srt'), join(tmp, 'notes.md'), join(tmp, 'Brand Kit')])
  await win.click('button[role="tab"]:has-text("Files")')
  await win.click('button:text-is("Add")')
  const composer = win.locator('textarea[placeholder="What should Manul do with these?"]')
  await composer.waitFor()
  for (const chip of ['film.srt', 'notes.md', 'Brand Kit/colours.txt', 'Brand Kit/Brand-Bold.ttf']) await win.locator(`span:has(> span.truncate:text-is("${chip}"))`).first().waitFor()

  // the list says what each file is
  await win.waitForSelector('text=SRT subtitles: 2 cues, 0:01–0:04, 3 words; starts “Hello there”')
  await win.waitForSelector('text=font “Inter” Bold (Inter Bold)')
  if (shots) await win.screenshot({ path: join(shots, 'files-list.png') })
  const project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.deepEqual(Object.fromEntries(Object.entries(project.files).map(([k, f]) => [k, f.kind])), {
    'media/film.mp4': 'video', 'media/film.srt': 'subtitles', 'media/notes.md': 'text',
    'media/Brand Kit/colours.txt': 'text', 'media/Brand Kit/Brand-Bold.ttf': 'font',
  })
  await win.keyboard.press('Escape')

  // removing a chip leaves the file in the project; the message carries the rest
  await win.locator('button[aria-label="Remove notes.md"]').click()
  await composer.fill('Burn these subtitles in with my font')
  if (shots) await win.screenshot({ path: join(shots, 'files-composer.png') })
  await composer.press('Enter')
  const bubble = win.locator('div.ml-6:has-text("Burn these subtitles in with my font")')
  await bubble.waitFor()
  for (const chip of ['film.srt', 'Brand Kit/colours.txt', 'Brand Kit/Brand-Bold.ttf']) await bubble.locator(`span.truncate:text-is("${chip}")`).waitFor()
  assert.equal(await bubble.locator('text=[attached files]').count(), 0, 'the raw list is not shown')
  assert.equal(await bubble.locator('span.truncate:text-is("notes.md")').count(), 0, 'a removed chip is not sent')
  assert.equal(await win.locator('textarea[placeholder="What should Manul do with these?"]').count(), 0, 'the input has no chips after sending')
  if (shots) await win.screenshot({ path: join(shots, 'files-sent.png') })

  // drag from the Files tab (HTML drag events, as the list makes them)
  for (const f of ['b.mp4', 'song.mp3']) await win.evaluate(([d, f]) => window.manul.project.import(d, f), [dir, join(tmp, f)])
  const dragged = await win.evaluate(() => {
    const row = [...document.querySelectorAll('button[draggable="true"]')].find(b => b.textContent.includes('b.mp4'))
    const dt = new DataTransfer()
    row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }))
    return [dt.getData('manul/file'), [...dt.types].sort()]
  })
  assert.deepEqual(dragged, ['media/b.mp4', ['manul/file', 'manul/kind-video']])
  const drop = (rel, kind, selector, x = 0.5) => win.evaluate(([rel, kind, selector, x]) => {
    const el = [...document.querySelectorAll(selector)].find(e => e.checkVisibility())
    const r = el.getBoundingClientRect(), dt = new DataTransfer()
    dt.setData('manul/file', rel); dt.setData(`manul/kind-${kind}`, '1')
    const o = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + r.width * x, clientY: r.top + r.height / 2 }
    el.dispatchEvent(new DragEvent('dragover', o)); el.dispatchEvent(new DragEvent('drop', o))
  }, [rel, kind, selector, x])
  // footage at the middle of the timeline: in the edit at once (no render), playing from its pieces
  await drop('media/b.mp4', 'video', '[data-testid="timeline-scrubber"]')
  await win.waitForSelector('[data-edited]')
  let now = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.deepEqual(now.timeline.items.map(i => [i.src, i.in, i.out]), [['media/film.mp4', 0, 2], ['media/b.mp4', 0, 2], ['media/film.mp4', 2, 4]])
  assert.equal(now.versions.length, 1, 'nothing rendered')
  assert.equal(await win.locator('[data-testid="timeline-scrubber"] [data-piece]').count(), 3)
  await win.waitForFunction(() => document.querySelectorAll('video[data-edit-player]').length === 2)
  if (shots) await win.screenshot({ path: join(shots, 'files-inserted.png') })
  // music onto the video: it plays under the film (Mix shows a change to apply)
  await drop('media/song.mp3', 'audio', 'video')
  await win.locator('button:has-text("Mix") span.rounded-full').waitFor()
  // subtitles onto the video: they go with it, and the Subtitles tab opens
  await drop('media/film.srt', 'subtitles', 'video')
  await win.waitForSelector('button[role="tab"][aria-selected="true"]:has-text("Subtitles")')
  now = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.equal(now.subtitles[now.versions.find(v => v.id === now.current).path].file, 'media/film.srt')
  if (shots) await win.screenshot({ path: join(shots, 'files-subtitles-tab.png') })

  // delete from the Files tab (the Trash is stubbed: nothing of the test lands in yours)
  await app.evaluate(({ shell }) => { globalThis.__trashed = []; shell.trashItem = async p => { globalThis.__trashed.push(p) } })
  await win.click('button[role="tab"]:has-text("Files")')
  const srtRow = win.locator('li:has(span.truncate:text-is("film.srt"))')
  await srtRow.hover()
  await srtRow.locator('button[aria-label="Delete film.srt"]').click()
  await srtRow.locator('button:text-is("Delete")').click()
  await srtRow.waitFor({ state: 'detached' })
  // the film's own video stays, saying why
  const filmRow = win.locator('li:has(span.truncate:text-is("film.mp4"))')
  await filmRow.hover()
  await filmRow.locator('button[aria-label="Delete film.mp4"]').click()
  await filmRow.locator('button:text-is("Delete")').click()
  await win.waitForSelector("text=Can't delete: it is the version “Original”.")
  if (shots) await win.screenshot({ path: join(shots, 'files-delete.png') })
  // a whole folder at once
  const kitRow = win.locator('li:has(span.truncate:text-is("Brand Kit"))')
  await kitRow.hover()
  await kitRow.locator('button[aria-label="Delete the folder Brand Kit"]').click()
  await kitRow.locator('button:text-is("Delete")').click()
  await kitRow.waitFor({ state: 'detached' })
  const trashed = await app.evaluate(() => globalThis.__trashed)
  assert.deepEqual(trashed.map(t => t.slice(dir.length + 1)), ['media/film.srt', 'media/Brand Kit'])
  const after = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.deepEqual(Object.keys(after.files).sort(), ['media/b.mp4', 'media/film.mp4', 'media/notes.md', 'media/song.mp3'])
  console.log('files e2e: ok')
} finally {
  await app.close()
}
