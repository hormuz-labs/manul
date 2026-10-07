// Who speaks when: speaker turns from manul-speakers (sherpa-onnx diarization: pyannote segmentation + a speaker
// embedding + clustering), named A, B, C… in order of appearance, joined into turns and, when a transcript exists,
// given the sentences spoken in them. For cutting to the speaker, cropping to the speaker, lower thirds and clips.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { FFMPEG, MODELS_DIR, SPEAKERS } from './media'
import type { Transcript } from '../shared/types'

/** Distance threshold for clustering when the number of speakers isn't given (calibrated on sherpa-onnx's labelled samples). */
const THRESHOLD = 0.75

export type Turn = { speaker: string; s: number; e: number; text?: string }
export type SpeakerInfo = { id: string; talk: number; turns: number; share: number; minor: boolean }
export type Speakers = { duration: number; speakers: SpeakerInfo[]; turns: Turn[] }

const r2 = (n: number) => Math.round(n * 100) / 100
const label = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `S${i + 1}`)

/** From the runner's segments to named speakers and turns (pure, tested). */
export function toTurns(raw: { duration: number; segments: [number, number, number, number][] }, gap = 1): Speakers {
  const order: number[] = []
  for (const [, , k] of raw.segments) if (!order.includes(k)) order.push(k)
  const name = (k: number) => label(order.indexOf(k))
  const turns: Turn[] = []
  for (const [s, e, k] of [...raw.segments].sort((a, b) => a[0] - b[0])) {
    const last = turns[turns.length - 1]
    if (last && last.speaker === name(k) && s - last.e <= gap) last.e = Math.max(last.e, e)
    else turns.push({ speaker: name(k), s, e })
  }
  const total = turns.reduce((t, x) => t + x.e - x.s, 0) || 1
  const speakers = order.map(k => {
    const mine = turns.filter(t => t.speaker === name(k))
    const talk = mine.reduce((t, x) => t + x.e - x.s, 0)
    // a sliver of talk is usually the same person mis-clustered, a laugh, or someone off-mic
    return { id: name(k), talk: r2(talk), turns: mine.length, share: Math.round((talk / total) * 100), minor: talk / total < 0.04 && talk < 5 }
  })
  return { duration: r2(raw.duration), speakers, turns: turns.map(t => ({ ...t, s: r2(t.s), e: r2(t.e) })) }
}

/** Give each turn the transcript sentences mostly inside it. */
export function withSentences(sp: Speakers, t: Transcript): Speakers {
  const turns = sp.turns.map(x => ({ ...x }))
  for (const seg of t.segments) {
    let best: Turn | undefined, most = 0
    for (const x of turns) {
      const overlap = Math.min(x.e, seg.e) - Math.max(x.s, seg.s)
      if (overlap > most) { most = overlap; best = x }
    }
    if (best) best.text = best.text ? `${best.text} ${seg.text.trim()}` : seg.text.trim()
  }
  return { ...sp, turns }
}

const ts = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** What the agent reads. Long recordings list the first turns; the file has them all. */
export function speakersReport(sp: Speakers, rel: string, file: string, max = 120) {
  const main = sp.speakers.filter(s => !s.minor)
  const lines = [
    `${rel} · ${main.length} speaker${main.length === 1 ? '' : 's'}${sp.speakers.length > main.length ? ` (+${sp.speakers.length - main.length} minor)` : ''} · ${sp.turns.length} turns`,
    ...sp.speakers.map(s => `${s.id}: ${mmss(s.talk)} of talk (${s.share} %), ${s.turns} turns${s.minor ? ' — minor: probably another speaker mis-split, a laugh or someone off-mic; pass speakers=N if you know the count' : ''}`),
    '',
    'Turns (start–end speaker: what they say):',
    ...sp.turns.slice(0, max).map(t => `${ts(t.s)}–${ts(t.e)} ${t.speaker}${t.text ? `: ${t.text.length > 140 ? `${t.text.slice(0, 137)}…` : t.text}` : ''}`),
  ]
  if (sp.turns.length > max) lines.push(`… ${sp.turns.length - max} more turns in ${file}`)
  else lines.push('', `All turns: ${file}`)
  lines.push('Speaker letters are the order people first speak in, not names; find who is who with look (their faces) or the transcript.')
  return lines.join('\n')
}

const run = (bin: string, args: string[], signal?: AbortSignal) =>
  new Promise<string>((ok, fail) => execFile(bin, args, { maxBuffer: 1 << 26, signal }, (err, out, stderr) =>
    (err ? fail(new Error(`${basename(bin)} failed: ${String(stderr).split('\n').filter(l => !l.startsWith('progress')).join('\n').slice(-1500) || err.message}`)) : ok(String(out)))))

/** Diarize a file's sound (cached in <project>/.cache/speakers per file and speaker count). */
export async function analyzeSpeakers(projectDir: string, file: string, o: { speakers?: number; signal?: AbortSignal } = {}): Promise<{ result: Speakers; file: string }> {
  const st = await stat(file)
  const key = createHash('sha256').update(`${file}:${st.size}:${st.mtimeMs}:${o.speakers || 0}:v1`).digest('hex').slice(0, 16)
  const dir = join(projectDir, '.cache', 'speakers')
  const out = join(dir, `${basename(file).replace(/\.[^.]+$/, '')}-${key}.json`)
  try { return { result: JSON.parse(await readFile(out, 'utf8')), file: out } } catch { /* run it */ }
  const tmp = await mkdtemp(join(tmpdir(), 'manul-speakers-'))
  try {
    const wav = join(tmp, 'a.wav')
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], o.signal)
      .catch(() => { throw new Error('This file has no sound to analyse.') })
    const args = ['--segmentation', join(MODELS_DIR, 'speaker-segmentation.onnx'), '--embedding', join(MODELS_DIR, 'speaker-embedding.onnx'),
      ...(o.speakers && o.speakers > 0 ? ['--speakers', String(Math.round(o.speakers))] : ['--threshold', String(THRESHOLD)]), wav]
    const result = toTurns(JSON.parse(await run(SPEAKERS, args, o.signal)))
    await mkdir(dir, { recursive: true })
    await writeFile(out, JSON.stringify(result))
    return { result, file: out }
  } finally { await rm(tmp, { recursive: true, force: true }) }
}
