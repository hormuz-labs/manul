// The timeline: what the film is made of, in order. Media segments (a range of an imported or rendered file) and
// motion clips (agent-made HTML, rendered frame-exact). Pure functions, shared by the main process and the UI;
// a render turns a timeline into one MP4 (composeArgs).

export type MediaItem = { id: string; kind: 'media'; src: string; in: number; out: number }
export type ClipItem = { id: string; kind: 'clip'; clip: string; dur: number }
export type Item = MediaItem | ClipItem
export type Format = { width: number; height: number; fps: number }
/** A clip laid over the film (transparent background) from start for dur seconds: lower thirds, captions, callouts. */
export type Overlay = { id: string; clip: string; start: number; dur: number }
export type Timeline = Format & { items: Item[]; overlays?: Overlay[]; /** film level, music and ducking (see mix.ts) */ mix?: { filmDb: number; music?: { src: string; db: number; duckDb: number } } }

let seq = 0
const newId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`
const round = (t: number) => Math.round(t * 1000) / 1000

export const length = (i: Item) => (i.kind === 'media' ? i.out - i.in : i.dur)
export const duration = (tl: Timeline) => round(tl.items.reduce((s, i) => s + length(i), 0))

/** A timeline that is just one file, start to end. */
export const fromMedia = (src: string, dur: number, format: Format): Timeline => ({ ...format, items: [{ id: newId(), kind: 'media', src, in: 0, out: round(dur) }] })

/** The item playing at time t (the last one past the end), with its start time on the timeline. */
export function itemAt(tl: Timeline, t: number) {
  let start = 0
  for (let index = 0; index < tl.items.length; index++) {
    const len = length(tl.items[index])
    if (t < start + len || index === tl.items.length - 1) return { index, item: tl.items[index], start }
    start += len
  }
  return { index: -1, item: undefined, start: 0 }
}

/** Cut the media item under t in two. Edges and clips are left alone (clips are never cut). */
export function splitAt(tl: Timeline, t: number): Timeline {
  const { index, item, start } = itemAt(tl, t)
  if (!item || item.kind !== 'media') return tl
  const at = round(item.in + (t - start))
  if (at <= item.in + 1e-3 || at >= item.out - 1e-3) return tl
  const items = [...tl.items]
  items.splice(index, 1, { ...item, out: at }, { ...item, id: newId(), in: at })
  return { ...tl, items }
}

/** Open a gap at t and put an item there. Inside a clip, the new item goes right after it. */
export function insertAt(tl: Timeline, t: number, add: Omit<MediaItem, 'id'> | Omit<ClipItem, 'id'>) {
  const split = splitAt(tl, t)
  let start = 0, index = split.items.length
  for (let i = 0; i < split.items.length; i++) {
    const it = split.items[i], len = length(it)
    if (t <= start + 1e-3) { index = i; break }
    if (t < start + len - 1e-3) { index = i + 1; break } // inside an uncut item (a clip): after it
    start += len
  }
  const items = [...split.items]
  items.splice(index, 0, { ...add, id: newId() } as Item)
  return { timeline: { ...split, items }, index }
}

export const removeItem = (tl: Timeline, id: string): Timeline => ({ ...tl, items: tl.items.filter(i => i.id !== id) })

/** Lay a clip over the film from start for dur seconds (kept inside the film). */
export function addOverlay(tl: Timeline, o: Omit<Overlay, 'id'>): Timeline {
  const total = duration(tl)
  const start = round(Math.min(Math.max(0, o.start), total))
  const dur = round(Math.max(0, Math.min(o.dur, total - start)))
  return { ...tl, overlays: [...(tl.overlays || []), { ...o, id: newId(), start, dur }] }
}

export const removeOverlay = (tl: Timeline, id: string): Timeline => ({ ...tl, overlays: (tl.overlays || []).filter(o => o.id !== id) })

/**
 * One ffmpeg command for the whole timeline: every item scaled/padded to the timeline's size and rate, with a stereo
 * 48 kHz track (silence for items without audio), then concatenated. Paths are as the caller gives them (usually
 * project-relative, run with cwd = project folder).
 */
export function composeArgs(tl: Timeline, o: { inputOf(i: Item): string; hasAudio(i: Item): boolean; overlayOf?(ov: Overlay): string; out: string }): string[] {
  const { width: W, height: H, fps } = tl
  const inputs: string[] = []
  const inputIndex = (path: string) => { let k = inputs.indexOf(path); if (k < 0) { inputs.push(path); k = inputs.length - 1 } return k }
  const parts: string[] = []
  const norm = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`
  const aNorm = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
  tl.items.forEach((it, n) => {
    const k = inputIndex(o.inputOf(it))
    const len = round(length(it))
    const [a, b] = it.kind === 'media' ? [it.in, it.out] : [0, it.dur]
    parts.push(`[${k}:v]trim=start=${round(a)}:end=${round(b)},setpts=PTS-STARTPTS,${norm}[v${n}]`)
    parts.push(o.hasAudio(it)
      ? `[${k}:a]atrim=start=${round(a)}:end=${round(b)},asetpts=PTS-STARTPTS,${aNorm}[a${n}]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${len},${aNorm}[a${n}]`)
  })
  parts.push(`${tl.items.map((_, n) => `[v${n}][a${n}]`).join('')}concat=n=${tl.items.length}:v=1:a=1[v][a]`)
  // overlays on top, each shifted to its start and shown only during its time; the footage shows through transparency
  let video = 'v'
  ;(tl.overlays || []).forEach((ov, n) => {
    if (!o.overlayOf) return
    const k = inputIndex(o.overlayOf(ov))
    parts.push(`[${k}:v]scale=${W}:${H},format=yuva420p,setpts=PTS-STARTPTS+${round(ov.start)}/TB[ov${n}]`)
    parts.push(`[${video}][ov${n}]overlay=eof_action=pass:enable='between(t,${round(ov.start)},${round(ov.start + ov.dur)})',format=yuv420p[vo${n + 1}]`)
    video = `vo${n + 1}`
  })
  return [
    ...inputs.flatMap(p => ['-i', p]),
    '-filter_complex', parts.join(';'),
    '-map', `[${video}]`, '-map', '[a]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    o.out,
  ]
}
