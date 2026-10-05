import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('scripts/ico.mjs', () => {
  it('packs PNGs into a valid .ico directory', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'ico-')), 'x.ico')
    execFileSync('node', ['scripts/ico.mjs', out, 'build/icons/256x256.png', 'build/icons/16x16.png'])
    const b = readFileSync(out)
    expect([b.readUInt16LE(0), b.readUInt16LE(2), b.readUInt16LE(4)]).toEqual([0, 1, 2])
    expect(b.readUInt8(6)).toBe(0) // 256 is stored as 0
    expect(b.readUInt8(6 + 16)).toBe(16)
    const off = b.readUInt32LE(6 + 12)
    expect(b.subarray(off, off + 4).toString('hex')).toBe('89504e47') // PNG signature
  })
})
