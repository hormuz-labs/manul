// The picture: the current (or proposed) version, or the edit playing from its pieces (with the overlays laid over it
// live), notes' boxes while their moment plays, and the box-drawing tool.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { EditPlayer, type Piece, type PlayerLike } from '@/lib/editPlayer'
import type { MixSource } from '@/lib/liveMix'
import type { Box, Note } from '../../../shared/types'

export type StageHandle = {
  /** what plays: the <video>, or the edit player */
  video: PlayerLike | null
  /** A JPEG of the frame on screen with the box drawn on it (for the agent). */
  still(box?: Box): string | undefined
}

/** An overlay clip laid over the edit while it plays from its pieces: its HTML, live, seeked to the film's time. */
export type LiveOverlay = { id: string; url: string; start: number; dur: number }
/** The edit to play from its pieces (instead of a rendered file). */
export type LiveEdit = { pieces: Piece[]; fps: number; width: number; height: number; overlays: LiveOverlay[] }

type Props = {
  src: string
  notes: Note[]
  time: number
  drawing: boolean
  box?: Box
  working: boolean
  onBox(b: Box): void
  onTime(t: number): void
  onDuration(d: number): void
  onPlaying(p: boolean): void
  /** play this edit from its pieces instead of src */
  edit?: LiveEdit | null
  /** what plays, for the live mix (a new one each time the source changes) */
  onSource?(s: MixSource | null): void
  /** a message box to show at the box drawn on the picture (under it, or over it near the bottom) */
  ask?: ReactNode
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))

const sources = new WeakMap<HTMLVideoElement, MixSource>()
const sourceOf = (el: HTMLVideoElement) => { let s = sources.get(el); if (!s) { s = { clock: el, elements: [el] }; sources.set(el, s) } return s }

export const Stage = forwardRef<StageHandle, Props>(function Stage(p, ref) {
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const a = useRef<HTMLVideoElement>(null), b = useRef<HTMLVideoElement>(null)
  const [player, setPlayer] = useState<EditPlayer | null>(null)
  const playerRef = useRef<EditPlayer | null>(null)
  playerRef.current = player
  const live = !!p.edit
  const [drag, setDrag] = useState<{ x: number; y: number; box: Box } | null>(null)
  /** the element showing the picture */
  const picture = () => (playerRef.current ? playerRef.current.element : video.current)
  const latest = useRef(p)
  latest.current = p

  // the edit, from its pieces: one player while the edit is on screen
  useEffect(() => {
    if (!live || !a.current || !b.current) return
    const pl = new EditPlayer([a.current, b.current], latest.current.edit!.fps)
    const on = (type: string, fn: () => void) => pl.addEventListener(type, fn)
    on('timeupdate', () => latest.current.onTime(pl.currentTime))
    on('seeked', () => latest.current.onTime(pl.currentTime))
    on('durationchange', () => latest.current.onDuration(pl.duration))
    on('play', () => latest.current.onPlaying(true))
    on('pause', () => latest.current.onPlaying(false))
    pl.setPieces(latest.current.edit!.pieces, latest.current.time)
    playerRef.current = pl
    setPlayer(pl)
    latest.current.onSource?.({ clock: pl, elements: pl.elements, gainOf: el => pl.gainOf(el) })
    return () => { latest.current.onSource?.(null); pl.dispose(); playerRef.current = null; setPlayer(null); latest.current.onPlaying(false) }
  }, [live])
  const piecesKey = JSON.stringify(p.edit?.pieces)
  useEffect(() => { if (player && p.edit) player.setPieces(p.edit.pieces) }, [player, piecesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    get video() { return player || video.current },
    still(box) {
      const v = picture()
      if (!v || !v.videoWidth) return undefined
      const scale = Math.min(1, 1280 / v.videoWidth)
      const c = document.createElement('canvas')
      c.width = Math.round(v.videoWidth * scale)
      c.height = Math.round(v.videoHeight * scale)
      const g = c.getContext('2d')!
      g.drawImage(v, 0, 0, c.width, c.height)
      if (box) {
        g.strokeStyle = '#f2a541'
        g.lineWidth = Math.max(3, c.width / 300)
        g.strokeRect(box.x * c.width, box.y * c.height, box.w * c.width, box.h * c.height)
      }
      try { return c.toDataURL('image/jpeg', 0.85) } catch { return undefined }
    },
  }))

  // the picture's rectangle inside the letterboxed frame, as 0–1 fractions
  const toPicture = (e: PointerEvent) => {
    const v = picture()!, r = frame.current!.getBoundingClientRect()
    const ar = (v.videoWidth || 16) / (v.videoHeight || 9)
    const w = Math.min(r.width, r.height * ar), h = w / ar
    const left = r.left + (r.width - w) / 2, top = r.top + (r.height - h) / 2
    return { x: clamp((e.clientX - left) / w), y: clamp((e.clientY - top) / h), rect: { left: (r.width - w) / 2, top: (r.height - h) / 2, w, h } }
  }

  const [rect, setRect] = useState({ left: 0, top: 0, w: 0, h: 0 })
  const measure = () => {
    const v = picture(), f = frame.current
    if (!v || !f) return
    const r = f.getBoundingClientRect(), ar = (v.videoWidth || 16) / (v.videoHeight || 9)
    const w = Math.min(r.width, r.height * ar), h = w / ar
    setRect({ left: (r.width - w) / 2, top: (r.height - h) / 2, w, h })
  }

  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (frame.current) ro.observe(frame.current)
    return () => ro.disconnect()
  }, [])

  const visible = p.notes.filter(n => n.anchor.box && p.time >= n.anchor.t0 - 0.05 && p.time <= (n.anchor.t1 ?? n.anchor.t0 + 2))
  const boxStyle = (b: Box) => ({ left: rect.left + b.x * rect.w, top: rect.top + b.y * rect.h, width: b.w * rect.w, height: b.h * rect.h })
  const shown = drag?.box || p.box

  return (
    <div
      ref={frame}
      className={cn('relative h-full w-full overflow-hidden rounded-xl bg-black', p.working && 'beam', p.drawing && 'cursor-crosshair')}
      onPointerDown={e => {
        if (!p.drawing) { const v = player || video.current; if (v) v.paused ? v.play() : v.pause(); return }
        const { x, y } = toPicture(e)
        ;(e.target as Element).setPointerCapture(e.pointerId)
        setDrag({ x, y, box: { x, y, w: 0, h: 0 } })
      }}
      onPointerMove={e => {
        if (!drag) return
        const { x, y } = toPicture(e)
        setDrag({ ...drag, box: { x: Math.min(x, drag.x), y: Math.min(y, drag.y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) } })
      }}
      onPointerUp={() => {
        if (drag && drag.box.w > 0.01 && drag.box.h > 0.01) p.onBox(drag.box)
        setDrag(null)
      }}
    >
      {live ? (
        <>
          {[a, b].map((r, k) => (
            <video key={`edit-${k}`} ref={r} crossOrigin="anonymous" playsInline preload="auto" className="absolute inset-0 size-full object-contain" style={{ visibility: k ? 'hidden' : 'visible' }}
              onLoadedMetadata={measure} data-edit-player={k} />
          ))}
          {player && p.edit!.overlays.length > 0 && <Overlays player={player} edit={p.edit!} rect={rect} />}
        </>
      ) : (
        <video
          ref={el => { video.current = el; p.onSource?.(el ? sourceOf(el) : null) }}
          key={p.src}
          src={p.src}
          crossOrigin="anonymous"
          className="size-full object-contain"
          onLoadedMetadata={e => { const v = e.currentTarget; p.onDuration(v.duration); if (p.time) v.currentTime = Math.min(p.time, v.duration); measure() }}
          onTimeUpdate={e => p.onTime(e.currentTarget.currentTime)}
          onSeeked={e => p.onTime(e.currentTarget.currentTime)}
          onPlay={() => p.onPlaying(true)}
          onPause={() => p.onPlaying(false)}
        />
      )}
      {visible.map(n => (
        <div key={n.id} className={cn('pointer-events-none absolute rounded border-2', n.status === 'open' ? 'border-note' : 'border-faint/60')} style={boxStyle(n.anchor.box!)}>
          <span className={cn('absolute -top-6 left-0 max-w-[260px] truncate rounded px-1.5 py-0.5 text-[11px]', n.status === 'open' ? 'bg-note text-[#0b1424]' : 'bg-raised text-dim')}>
            {n.status === 'resolved' ? '✓ ' : ''}{n.text}
          </span>
        </div>
      ))}
      {shown && <div className="pointer-events-none absolute rounded border-2 border-amber bg-amber/10" style={boxStyle(shown)} />}
      {p.ask && p.box && !drag && (() => {
        // under the box if it fits, else over it; kept inside the frame
        const b = boxStyle(p.box), fw = rect.left * 2 + rect.w, fh = rect.top * 2 + rect.h, W = Math.min(320, fw - 16)
        const below = b.top + b.height + 8 + 130 <= fh
        const left = Math.max(8, Math.min(fw - W - 8, b.left + b.width / 2 - W / 2))
        return <div className="absolute z-20" style={below ? { left, top: b.top + b.height + 8, width: W } : { left, bottom: Math.max(8, fh - b.top + 8), width: W }}>{p.ask}</div>
      })()}
      {p.drawing && !shown && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-fg">Drag a box around what you want to change</div>
      )}
    </div>
  )
})

/** Overlay clips over the edit while it plays from its pieces: each clip's HTML (transparent), seeked to the film's
 *  time every frame and shown only during its time; the render lays the same clips over the same moments. */
function Overlays({ player, edit, rect }: { player: EditPlayer; edit: LiveEdit; rect: { left: number; top: number; w: number; h: number } }) {
  const frames = useRef<(HTMLIFrameElement | null)[]>([])
  useEffect(() => {
    let raf = 0, last = -1
    const tick = () => {
      const t = player.currentTime
      if (t !== last) {
        last = t
        edit.overlays.forEach((o, i) => {
          const f = frames.current[i]
          if (!f) return
          const on = t >= o.start && t < o.start + o.dur
          f.style.visibility = on ? 'visible' : 'hidden'
          if (on) f.contentWindow?.postMessage({ manul: 'seek', t: t - o.start }, '*')
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [player, edit.overlays])
  const scale = rect.w / edit.width
  return (
    <div className="pointer-events-none absolute overflow-hidden" style={{ left: rect.left, top: rect.top, width: rect.w, height: rect.h }}>
      {edit.overlays.map((o, i) => (
        <iframe key={o.id} ref={el => { frames.current[i] = el }} src={o.url} sandbox="allow-scripts" title={o.id} data-overlay={o.id}
          style={{ width: edit.width, height: edit.height, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, visibility: 'hidden', background: 'transparent', colorScheme: 'normal' }}
          className="absolute left-0 top-0" />
      ))}
    </div>
  )
}
