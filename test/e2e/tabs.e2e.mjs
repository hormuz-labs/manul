// Several projects open as tabs: each keeps its own playhead, tabs close, and they come back after a relaunch.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-tabs-'))
for (const [name, color] of [['alpha', 'red'], ['beta', 'blue'], ['gamma', 'green']])
  execFileSync(join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:d=6`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, `${name}.mp4`)])
const launch = () => electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
const menu = (app, label) => app.evaluate(({ Menu }, l) => {
  const find = items => { for (const it of items) { if (it.label === l) return it; const s = it.submenu && find(it.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click()
}, label)

let app = await launch()
try {
  let win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  const openFile = async name => {
    await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, `${name}.mp4`))
    await win.click('text=Drop a video here')
    await win.locator('button:has(svg.lucide-arrow-up)').click()
    await win.waitForSelector(`[title$="/${name}"]`)
  }
  await openFile('alpha')
  await win.evaluate(() => { const v = [...document.querySelectorAll('video')].find(v => v.checkVisibility({ visibilityProperty: true })); v.currentTime = 2 })
  await menu(app, 'New Project')
  await win.waitForSelector('text=What are we making?')
  await openFile('beta')
  await win.evaluate(() => { const v = [...document.querySelectorAll('video')].find(v => v.checkVisibility({ visibilityProperty: true })); v.currentTime = 4 })
  await menu(app, 'New Project'); await openFile('gamma')
  assert.equal(await win.locator('[draggable="true"][title]').count(), 3, 'three tabs')

  // each tab keeps its own playhead
  await win.click('[title$="/alpha"]')
  await win.waitForTimeout(300)
  const t = await win.evaluate(() => [...document.querySelectorAll('video')].find(v => v.checkVisibility({ visibilityProperty: true })).currentTime)
  assert.ok(Math.abs(t - 2) < 0.2, `alpha's playhead stayed at 2 s (got ${t})`)
  await menu(app, 'Next Tab')
  await win.waitForTimeout(300)
  assert.match(await win.locator('[draggable="true"].bg-raised').getAttribute('title'), /beta$/, 'Next Tab goes to beta')

  // close beta (⌘W) → gamma (the right neighbour) is on screen
  await menu(app, 'Close Tab')
  await win.waitForTimeout(300)
  assert.equal(await win.locator('[draggable="true"][title]').count(), 2)
  assert.match(await win.locator('[draggable="true"].bg-raised').getAttribute('title'), /gamma$/)
  await win.waitForTimeout(500) // tabs are saved
  await app.close()

  // relaunch: alpha and gamma come back, gamma on screen
  app = await launch()
  win = await app.firstWindow()
  await win.waitForSelector('[title$="/gamma"]')
  assert.equal(await win.locator('[draggable="true"][title]').count(), 2)
  assert.match(await win.locator('[draggable="true"].bg-raised').getAttribute('title'), /gamma$/)
  console.log('tabs e2e: ok')
} finally {
  await app.close()
}
