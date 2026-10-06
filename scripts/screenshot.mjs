// The README screenshot: a demo project in a throwaway profile (a title film with a spoken line, its transcript, a
// request typed for the agent), captured at 2× and saved as docs/screenshot.png.
//   npm run build && node scripts/screenshot.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const bin = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
const tmp = mkdtempSync('/tmp/mshot-')
const font = join(root, 'resources', 'fonts', 'Inter-Bold.ttf')

// a spoken line with a few fillers (macOS say), over a warm gradient title
execFileSync('say', ['-v', 'Samantha', '-o', join(tmp, 'voice.aiff'),
  'So, um, the manul is a small wild cat from the steppes of Central Asia. Uh, it has round pupils, and the thickest fur of any cat. Honestly, it is, um, the grumpiest looking cat on Earth.'])
execFileSync(join(bin, 'ffmpeg'), ['-y', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'gradients=s=1920x1080:c0=0x2a1708:c1=0xf2a541:c2=0x6b3a1a:x0=0:y0=0:x1=1920:y1=1080:speed=0.004:r=30',
  '-i', join(tmp, 'voice.aiff'),
  '-vf', `drawtext=fontfile=${font}:text='The Pallas cat':fontsize=128:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-40,` +
    `drawtext=fontfile=${font}:text='a field guide':fontsize=44:fontcolor=white@0.75:x=(w-tw)/2:y=(h/2)+70`,
  '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'Pallas cat.mp4')])

const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
try {
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.isVisible()) || BrowserWindow.getAllWindows()[0]; w.setSize(1440, 860); w.center() })
  await win.waitForSelector('text=What are we making?')
  // a placeholder key so the agent's input shows (nothing is sent)
  await win.evaluate(() => window.manul.keys.set('GEMINI_API_KEY', 'screenshot-placeholder'))
  await win.reload()
  await win.waitForSelector('text=What are we making?')
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'Pallas cat.mp4'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('[title$="/pallas-cat"]', { timeout: 30_000 }).catch(() => {})
  await win.waitForSelector('text=fillers', { timeout: 120_000 }) // transcribed
  await win.evaluate(() => { const v = [...document.querySelectorAll('video')].find(v => v.checkVisibility()); v.currentTime = 4.2 })
  await win.waitForTimeout(800)
  const box = win.locator('textarea:visible').first()
  await box.fill('Cut the ums, then add a lower third that says “Otocolobus manul” when the cat is named')
  await win.mouse.move(5, 400)
  await win.waitForTimeout(500)
  await win.screenshot({ path: join(tmp, 'shot.png') })
  execFileSync('sips', ['-Z', '2400', join(tmp, 'shot.png'), '--out', join(root, 'docs', 'screenshot.png')], { stdio: 'ignore' })
  console.log('docs/screenshot.png')
} finally { await app.close() }
