// Real speech → real whisper.cpp. Runs where `say` (macOS) and whisper-cli + a ggml model exist; skipped elsewhere.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setConfig } from '../src/main/config'
import { FFMPEG } from '../src/main/media'
import { findBinaries, findModels, transcribe } from '../src/main/whisper'

const has = (cmd: string) => { try { execFileSync('which', [cmd]); return true } catch { return false } }
const bins = has('say') ? await findBinaries() : []
const model = findModels(bins).find(m => /base/.test(m))
const ready = !!bins[0] && !!model

describe.skipIf(!ready)('transcription with whisper.cpp', () => {
  it('returns sentences with word timings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-stt-'))
    execFileSync('say', ['-o', join(dir, 'speech.aiff'), 'Hello there. Today we are testing the Manul video editor.'])
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=6', '-i', join(dir, 'speech.aiff'),
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'clip.mp4')])
    setConfig({ whisper: { engine: 'system', mode: 'custom', binary: bins[0], model } })

    const t = await transcribe(join(dir, 'clip.mp4'), join(dir, 'transcripts', 'clip.json'), 'Transcribing clip.mp4')
    const text = t.segments.map(s => s.text).join(' ').toLowerCase()
    expect(text).toContain('hello')
    expect(text).toMatch(/video editor/)
    expect(t.segments.length).toBeGreaterThanOrEqual(2) // split after "there."
    const words = t.segments.flatMap(s => s.words)
    for (const w of words) expect(w.e).toBeGreaterThanOrEqual(w.s)
    expect(words.every((w, i) => i === 0 || w.s >= words[i - 1].s)).toBe(true) // in time order
    expect(existsSync(join(dir, 'transcripts', 'clip.json'))).toBe(true)
    expect(existsSync(join(dir, 'transcripts', '.clip.wav'))).toBe(false) // temp audio cleaned up
  }, 120_000)
})
