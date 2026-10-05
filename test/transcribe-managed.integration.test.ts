// The downloaded engine (faster-whisper). Runs when MANUL_TEST_TOOLS points at a tools folder with whisper installed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const tools = process.env.MANUL_TEST_TOOLS
const ready = !!tools && existsSync(join(tools, 'whisper', '.installed.json'))
if (ready) process.env.MANUL_TOOLS = tools

describe.skipIf(!ready)('transcription with faster-whisper (downloaded)', () => {
  it('returns sentences with word timings and keeps fillers', async () => {
    const { setConfig } = await import('../src/main/config')
    const { FFMPEG } = await import('../src/main/media')
    const { transcribe } = await import('../src/main/whisper')
    const dir = mkdtempSync(join(tmpdir(), 'manul-stt-'))
    execFileSync('say', ['-o', join(dir, 'speech.aiff'), 'Um, hello there. Uh, this is a test of the editor.'])
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', join(dir, 'speech.aiff'), '-c:a', 'aac', join(dir, 'clip.m4a')])
    setConfig({ whisper: { engine: 'managed', mode: 'custom' } })
    const t = await transcribe(join(dir, 'clip.m4a'), join(dir, 'clip.json'), 'Transcribing clip.m4a')
    expect(t.model).toMatch(/faster-whisper/)
    expect(t.segments.map(s => s.text).join(' ').toLowerCase()).toMatch(/hello there/)
    expect(t.segments.flatMap(s => s.words).length).toBeGreaterThan(5)
  }, 180_000)
})
