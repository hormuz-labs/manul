// The native menu and the ⌘K palette drive the same commands.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-menu-'))
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'm.mp4')])
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
const click = label => app.evaluate(({ Menu }, l) => {
  const find = items => { for (const it of items) { if (it.label === l) return it; const s = it.submenu && find(it.submenu.items); if (s) return s } }
  const it = find(Menu.getApplicationMenu().items)
  if (!it) throw new Error(`no menu item ${l}`)
  it.click()
}, label)
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  const closeDialog = async () => {
    const dialog = win.getByRole('dialog')
    await dialog.locator('button:has(svg.lucide-x)').click()
    await dialog.waitFor({ state: 'detached' })
  }
  // menu → settings section
  await click('Keys…')
  await win.waitForSelector('[role="dialog"] h2:text-is("Keys")')
  await closeDialog()
  // open a project, then the palette from the menu, search, run
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'm.mp4'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  await click('Command Palette…')
  const search = win.getByPlaceholder('Type a command, or ask Manul…')
  await search.fill('vertical')
  const first = await win.locator('[role="dialog"] button').first().textContent()
  assert.match(first, /Export/, `'vertical' finds Export by keyword (got ${first})`)
  await search.press('Enter')
  await win.waitForSelector('[role="dialog"] h2:text-is("Export")')
  await closeDialog()
  // menu → export directly, and transcript toggle
  await click('Export…')
  await win.waitForSelector('[role="dialog"] h2:text-is("Export")')
  await closeDialog()
  // View → Transcript folds the transcript into its rail and back; so do its own collapse button and the rail
  const open = () => win.locator('[aria-label="Collapse the transcript"]').count()
  const was = await open()
  await click('Transcript')
  await win.waitForTimeout(300)
  assert.equal(await open(), was ? 0 : 1, 'View → Transcript toggles it')
  if (!(await open())) await win.click('[aria-label="Show the transcript"]')
  await win.click('[aria-label="Collapse the transcript"]')
  await win.waitForSelector('[aria-label="Show the transcript"]')
  assert.equal(await open(), 0, 'the collapse button folds it to the rail')
  await win.click('[aria-label="Show the transcript"]')
  await win.waitForSelector('[aria-label="Collapse the transcript"]')
  console.log('menu e2e: ok')
} finally {
  await app.close()
}
