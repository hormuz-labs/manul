import { describe, expect, it } from 'vitest'
import { keyStatus, loadKeys, setKey } from '../src/main/keys'

describe('keys', () => {
  it('stores encrypted, exports to env, reports set/not set only', () => {
    setKey('GEMINI_API_KEY', 'secret-1')
    expect(process.env.GEMINI_API_KEY).toBe('secret-1')
    const s = keyStatus().find(k => k.env === 'GEMINI_API_KEY')!
    expect(s.set).toBe(true)
    expect(JSON.stringify(keyStatus())).not.toContain('secret-1')
  })
  it('survives a reload and can be removed', () => {
    delete process.env.GEMINI_API_KEY
    loadKeys()
    expect(process.env.GEMINI_API_KEY).toBe('secret-1')
    setKey('GEMINI_API_KEY', '')
    expect(process.env.GEMINI_API_KEY).toBeUndefined()
  })
  it('rejects unknown keys', () => expect(() => setKey('NOPE', 'x')).toThrow())
})
