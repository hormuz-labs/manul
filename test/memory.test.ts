import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Memory } from '../src/main/memory'

const mem = () => new Memory(mkdtempSync(join(tmpdir(), 'manul-mem-')))

describe('long-term memory', () => {
  it('saves one fact per file with an index line', () => {
    const m = mem()
    m.remember('Captions Style', 'User wants yellow captions', 'Always yellow, bottom third.\n**Why:** brand.')
    expect(readFileSync(join(m.dir, 'captions-style.md'), 'utf8')).toBe('---\nname: captions-style\ndescription: User wants yellow captions\n---\n\nAlways yellow, bottom third.\n**Why:** brand.\n')
    expect(m.index()).toEqual(['- [captions-style](captions-style.md) — User wants yellow captions'])
  })

  it('updates instead of duplicating', () => {
    const m = mem()
    m.remember('captions-style', 'old', 'a')
    m.remember('Captions style', 'new', 'b')
    expect(m.index()).toEqual(['- [captions-style](captions-style.md) — new'])
    expect(m.list()).toEqual([{ name: 'captions-style', description: 'new', body: 'b' }])
  })

  it('forgets', () => {
    const m = mem()
    m.remember('a', 'x', 'y'); m.remember('b', 'x', 'y')
    m.forget('a')
    expect(m.list().map(x => x.name)).toEqual(['b'])
    m.forget('missing') // no throw
  })

  it('renders the prompt section with the index', () => {
    const m = mem()
    expect(m.prompt()).toContain('(empty)')
    m.remember('pace', 'Cuts on the beat', 'z')
    expect(m.prompt()).toContain('- [pace](pace.md) — Cuts on the beat')
    expect(m.prompt()).toContain(m.dir)
  })

  it('rejects names that are not names', () => {
    expect(() => mem().remember('!!!', 'd', 'b')).toThrow()
  })
})
