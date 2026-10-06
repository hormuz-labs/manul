// The picture: the current (or proposed) version, notes' boxes while their moment plays, and the box-drawing tool.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import type { Box, Note } from '../../../shared/types'

export type StageHandle = {
  video: HTMLVideoElement | null
  /** A JPEG of the frame on screen with the box drawn on it (for the agent). */
  still(box?: Box): string | undefined
}

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
  /** the <video> element (a new one each time the source changes) */
  onVideo?(v: HTMLVideoElement | null): void
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))

export const Stage = forwardRef<StageHandle, Props>(function Stage(p, ref) {
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ x: number; y: number; box: Box } | null>(null)

  useImperativeHandle(ref, () => ({
    get video() { return video.current },
    still(box) {
      const v = video.current
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
    const v = video.current!, r = frame.current!.getBoundingClientRect()
    const ar = (v.videoWidth || 16) / (v.videoHeight || 9)
    const w = Math.min(r.width, r.height * ar), h = w / ar
    const left = r.left + (r.width - w) / 2, top = r.top + (r.height - h) / 2
    return { x: clamp((e.clientX - left) / w), y: clamp((e.clientY - top) / h), rect: { left: (r.width - w) / 2, top: (r.height - h) / 2, w, h } }
  }

  const [rect, setRect] = useState({ left: 0, top: 0, w: 0, h: 0 })
  const measure = () => {
    const v = video.current, f = frame.current
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
        if (!p.drawing) { const v = video.current; if (v) v.paused ? v.play() : v.pause(); return }
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
      <video
        ref={el => { video.current = el; p.onVideo?.(el) }}
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
      {visible.map(n => (
        <div key={n.id} className={cn('pointer-events-none absolute rounded border-2', n.status === 'open' ? 'border-note' : 'border-faint/60')} style={boxStyle(n.anchor.box!)}>
          <span className={cn('absolute -top-6 left-0 max-w-[260px] truncate rounded px-1.5 py-0.5 text-[11px]', n.status === 'open' ? 'bg-note text-[#0b1424]' : 'bg-raised text-dim')}>
            {n.status === 'resolved' ? '✓ ' : ''}{n.text}
          </span>
        </div>
      ))}
      {shown && <div className="pointer-events-none absolute rounded border-2 border-amber bg-amber/10" style={boxStyle(shown)} />}
      {p.drawing && !shown && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-fg">Drag a box around what you want to change</div>
      )}
    </div>
  )
})
