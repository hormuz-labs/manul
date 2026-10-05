// The packaged app (dist/), not the dev build: everything that moves into the bundle must still be found —
// ffmpeg/ffprobe in Resources/bin, the clip runtime and fonts in Resources/lib, bundled skills, captions.
// Run: npm run package:dir && node test/e2e/packaged.e2e.mjs
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const exe = process.platform === 'darwin'
  ? join(root, 'dist', `mac-${process.arch}`, 'Manul.app', 'Contents', 'MacOS', 'Manul')
  : join(root, 'dist', 'linux-unpacked', 'manul')
if (!existsSync(exe)) { console.log(`packaged e2e: skipped (no ${exe}; run npm run package:dir)`); process.exit(0) }
const BIN = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
const tmp = mkdtempSync(join(tmpdir(), 'manul-pkg-'))
execFileSync(join(BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=duration=3',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(tmp, 'src.mp4')])

const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'projects') } })
try {
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true)
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  // bundled tools answer from Resources/bin
  const tools = await win.evaluate(() => window.manul.tools.bundled())
  for (const t of tools) { assert.ok(t.ok, `${t.name} works`); assert.match(t.path, /Contents\/Resources\/bin\/|resources\/bin\//) }
  // import (ffprobe + thumbnail)
  const p = await win.evaluate(f => window.manul.project.create(f), join(tmp, 'src.mp4'))
  assert.equal(p.media['media/src.mp4'].width, 640)
  // a motion clip renders with the bundled runtime and GSAP
  cpSync(join(root, 'test', 'fixtures', 'clips', 'slide'), join(p.dir, 'clips', 'slide'), { recursive: true })
  const r = await win.evaluate(dir => window.manul.clips.render(dir, 'slide'), p.dir)
  assert.equal(r.frames, 60)
  // bundled skills are listed
  const skills = await win.evaluate(() => window.manul.skills.state())
  assert.ok(skills.skills.some(k => k.id === 'motion-design' && k.source === 'bundled'), 'bundled skills found')
  // export with the bundled fonts (captions .srt, even if empty without speech)
  await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }) }, join(tmp, 'out.mp4'))
  const ex = await win.evaluate(dir => window.manul.export.run(dir, { preset: 'square', captions: 'none' }), p.dir)
  assert.ok(existsSync(ex.file))
  console.log('packaged e2e: ok')
} finally {
  await app.close()
}
