// Tools page: the cloud section lists Upscale as coming soon (off until worker.trypitch.co serves it).
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] || mkdtempSync(join(tmpdir(), 'manul-tools-e2e-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'manul-ud-'))}`] })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
await win.waitForSelector('text=What are we making?')
await win.click('button:has-text("Tools")')
await win.waitForSelector('text=In the cloud')
const row = win.locator('[data-cloud-tool="upscale"]')
const text = await row.innerText()
const disabled = await row.getAttribute('aria-disabled')
await row.scrollIntoViewIfNeeded()
await win.screenshot({ path: join(out, 'tools.png') })
await app.close()
if (!/Upscale/.test(text) || !/Coming soon/.test(text) || disabled !== 'true') throw new Error(`upscale row wrong: ${text}`)
console.log('tools e2e ok:', join(out, 'tools.png'))
