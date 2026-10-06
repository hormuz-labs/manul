import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module
import { mergeMacFeeds } from '../scripts/merge-mac-feed.mjs'

const arm = `version: 0.1.0
files:
  - url: Manul-0.1.0-arm64-mac.zip
    sha512: AAA
    size: 1
  - url: Manul-0.1.0-arm64.dmg
    sha512: BBB
    size: 2
path: Manul-0.1.0-arm64-mac.zip
sha512: AAA
releaseDate: '2026-10-06T16:17:00.000Z'
`
const x64 = `version: 0.1.0
files:
  - url: Manul-0.1.0-mac.zip
    sha512: CCC
    size: 3
  - url: Manul-0.1.0-x64.dmg
    sha512: DDD
    size: 4
path: Manul-0.1.0-mac.zip
sha512: CCC
releaseDate: '2026-10-06T16:19:45.583Z'
`

describe('mac update feed', () => {
  it('lists both architectures, so each Mac updates to its own build', () => {
    const out = mergeMacFeeds([arm, x64]) as string
    for (const f of ['Manul-0.1.0-arm64-mac.zip', 'Manul-0.1.0-arm64.dmg', 'Manul-0.1.0-mac.zip', 'Manul-0.1.0-x64.dmg']) expect(out).toContain(`  - url: ${f}\n`)
    expect(out).toMatch(/^version: 0\.1\.0\n/)
    expect(out).toContain('    sha512: DDD\n    size: 4\n')
    // the legacy single-file fields point at the Intel zip; arm64 Macs pick theirs from the list
    expect(out).toContain('path: Manul-0.1.0-mac.zip\nsha512: CCC\n')
    expect(out).toContain("releaseDate: '2026-10-06T16:19:45.583Z'")
  })

  it('refuses feeds for different versions', () => {
    expect(() => mergeMacFeeds([arm, x64.replace(/0\.1\.0/g, '0.2.0')])).toThrow(/version/)
  })
})
