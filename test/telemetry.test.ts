import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageTelemetry } from '../src/main/telemetry'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'manul-usage-'))
  dirs.push(dir)
  const file = join(dir, 'usage.json')
  let now = 0
  let enabled = true
  let focused = true
  let idle = 0
  const post = vi.fn(async () => ({ ok: true }) as Response)
  const create = () => new UsageTelemetry({ file, endpoint: 'https://example.test/', enabled: () => enabled,
    focused: () => focused, idleSeconds: () => idle, now: () => now, post: post as typeof fetch })
  return { create, post, advance: () => { now += 15_000 }, focus: (v: boolean) => { focused = v }, idle: (v: number) => { idle = v },
    enabled: (v: boolean) => { enabled = v }, state: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('anonymous usage telemetry', () => {
  it('starts with the default monotonic clock without a provided clock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-clock-'))
    dirs.push(dir)
    const usage = new UsageTelemetry({ file: join(dir, 'usage.json'),
      endpoint: '', enabled: () => false, focused: () => false, idleSeconds: () => 0 })
    expect(() => { usage.start(); usage.tick() }).not.toThrow()
  })

  it('counts foreground non-idle time, and persists it across restarts', async () => {
    const t = setup()
    const usage = t.create()
    t.advance(); usage.tick()
    t.focus(false); t.advance(); usage.tick()
    t.focus(true); t.idle(60); t.advance(); usage.tick()
    t.idle(0); t.advance(); usage.tick()
    expect(t.state().activeSeconds).toBe(30)
    const restored = t.create()
    t.advance(); restored.tick()
    t.advance(); restored.tick()
    await restored.flush()
    expect(t.post).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(t.post.mock.calls[0][1].body)
    expect(payload).toMatchObject({ activeSeconds: 60 })
    expect(Object.keys(payload).sort()).toEqual(['activeSeconds', 'eventId', 'installationId'])
  })

  it('retries the same event ID and does not count suspended hours', async () => {
    const t = setup()
    const usage = t.create()
    for (let i = 0; i < 4; i++) { t.advance(); usage.tick() }
    t.post.mockRejectedValueOnce(new Error('offline'))
    await usage.flush()
    expect(t.state().pending).toHaveLength(1)
    await usage.flush()
    expect(JSON.parse(t.post.mock.calls[0][1].body).eventId).toBe(JSON.parse(t.post.mock.calls[1][1].body).eventId)
    expect(t.state().pending).toHaveLength(0)
    for (let i = 0; i < 100; i++) t.advance()
    usage.tick()
    expect(t.state().activeSeconds).toBe(15)
  })

  it('discards queued data and rotates ID on opt-out', async () => {
    const t = setup()
    const usage = t.create()
    for (let i = 0; i < 4; i++) { t.advance(); usage.tick() }
    t.post.mockRejectedValueOnce(new Error('offline'))
    await usage.flush()
    const original = t.state().installationId
    t.enabled(false); usage.setEnabled(false)
    expect(t.state()).toMatchObject({ pending: [], activeSeconds: 0 })
    expect(t.state().installationId).not.toBe(original)
    await usage.flush()
    expect(t.post).toHaveBeenCalledTimes(1)
  })
})
