import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module
import { renderCask } from '../scripts/homebrew-cask.mjs'

describe('Homebrew cask', () => {
  const cask = renderCask({ version: '0.3.0', arm64: 'a'.repeat(64), x64: 'b'.repeat(64) }) as string

  it('points each Mac at its own build, with checksums', () => {
    expect(cask).toContain('version "0.3.0"')
    expect(cask).toMatch(/on_arm do\s+sha256 "a{64}"\s+url "https:\/\/github\.com\/hormuz-labs\/manul\/releases\/download\/v#\{version\}\/Manul-#\{version\}-arm64\.dmg"/)
    expect(cask).toMatch(/on_intel do\s+sha256 "b{64}"\s+url "[^"]+Manul-#\{version\}-x64\.dmg"/)
  })

  it('lets the app update itself and needs macOS 12+', () => {
    expect(cask).toContain('auto_updates true')
    expect(cask).toContain('depends_on macos: :monterey')
    expect(cask).toContain('app "Manul.app"')
  })

  it('opens without a Gatekeeper block while builds are unsigned', () => {
    expect(cask).toMatch(/postflight_steps do\s+run "\/usr\/bin\/xattr",\s+args: +\["-dr", "com\.apple\.quarantine", "Manul\.app"\],\s+chdir: +"\{\{appdir\}\}"/)
  })

  it('cleans up on zap', () => {
    expect(cask).toContain('~/Library/Application Support/Manul')
    expect(cask).toMatch(/zap trash:/)
  })

  it('refuses bad input', () => {
    expect(() => renderCask({ version: 'x', arm64: 'a'.repeat(64), x64: 'b'.repeat(64) })).toThrow(/version/)
    expect(() => renderCask({ version: '1.0.0', arm64: 'nope', x64: 'b'.repeat(64) })).toThrow(/sha256/)
  })
})

describe('Linux package', () => {
  it('depends on ALSA, so the app starts on a clean Debian or Ubuntu', async () => {
    const { readFileSync } = await import('node:fs')
    const yml = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
    expect(yml).toMatch(/depends: \[[^\]]*"libasound2t64 \| libasound2"/)
    expect(yml).toMatch(/depends: \[[^\]]*libnss3/)
  })
})
