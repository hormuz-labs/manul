import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

process.env.MANUL_TOOLS = mkdtempSync(join(tmpdir(), 'manul-tools-'))
const Tools = await import('../src/main/tools')
const mark = (id: string) => { mkdirSync(join(process.env.MANUL_TOOLS!, id), { recursive: true }); writeFileSync(join(process.env.MANUL_TOOLS!, id, '.installed.json'), '{"version":"t"}') }

describe('on-demand tools', () => {
  beforeEach(async () => { for (const t of ['whisper', 'uv']) await Tools.remove(t).catch(() => {}) })

  it('plans dependencies first', () => {
    expect(Tools.plan('whisper').map(d => d.id)).toEqual(['uv', 'whisper'])
  })

  it('skips what is already installed', () => {
    mark('uv')
    expect(Tools.plan('whisper').map(d => d.id)).toEqual(['whisper'])
    mark('whisper')
    expect(Tools.plan('whisper')).toEqual([])
  })

  it('asks once with the total size, and does nothing when declined', async () => {
    const asked: number[] = []
    await expect(Tools.ensure('whisper', async (_t, _b, size) => { asked.push(size); return false })).rejects.toThrow(/declined/)
    expect(asked).toEqual([370])
    expect(Tools.isInstalled('whisper')).toBe(false)
  })

  it('does not ask when installed', async () => {
    mark('uv'); mark('whisper')
    let asked = false
    await Tools.ensure('whisper', async () => { asked = true; return true })
    expect(asked).toBe(false)
  })

  it('refuses to remove a tool another one needs', async () => {
    mark('uv'); mark('whisper')
    await expect(Tools.remove('uv')).rejects.toThrow(/need/)
  })

  it('lists tools with install state', async () => {
    mark('uv')
    const list = await Tools.listTools()
    expect(list.find(t => t.id === 'uv')).toMatchObject({ installed: true, version: 't' })
    expect(list.find(t => t.id === 'whisper')).toMatchObject({ installed: false, needs: ['uv'] })
  })

  it('rejects unknown tools', () => expect(() => Tools.plan('nope')).toThrow(/unknown/))
})
