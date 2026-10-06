// The scrubber: playhead, note pins, and a drag to select a range (the anchor for the next note).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { cn, timecode } from '@/lib/utils'
import { Tip } from '@/components/ui/tooltip'
import type { Note } from '../../../shared/types'
import { Filmstrip } from './Filmstrip'
import { frameZoom } from '@/lib/timelineScale'

type Props = {
  media: { dir: string; src: string; revision: number; fps: number }
  duration: number
  time: number
  notes: Note[]
  range?: { t0: number; t1?: number }
  onSeek(t: number): void
  onRange(r: { t0: number; t1: number } | null): void
  onNote(n: Note): void
}

export function Scrubber({ media, duration, time, notes, range, onSeek, onRange, onNote }: Props) {
  const bar = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState({ width: 1, left: 0 })
  const center = useRef<number | null>(null)
  const [drag, setDrag] = useState<{ start: number; moved: boolean } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const d = duration || 1
  const fps = media.fps || 30
  const maxZoom = frameZoom(view.width, d, fps)
  const changeZoom = (value: number) => {
    const el = viewport.current!
    center.current = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth
    setZoom(Math.max(1, Math.min(maxZoom, value)))
  }
  useLayoutEffect(() => {
    const el = viewport.current
    if (el && center.current != null) el.scrollLeft = center.current * el.scrollWidth - el.clientWidth / 2
    center.current = null
  }, [zoom])
  useLayoutEffect(() => { setZoom(1); if (viewport.current) viewport.current.scrollLeft = 0 }, [media.src, media.revision])
  useEffect(() => {
    const el = viewport.current!
    const measure = () => setView({ width: el.clientWidth, left: el.scrollLeft })
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => { observer.disconnect(); el.removeEventListener('scroll', measure) }
  }, [])
  useEffect(() => { setZoom(z => Math.min(z, maxZoom)) }, [maxZoom])
  useEffect(() => {
    const el = viewport.current!
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      changeZoom(zoom * Math.exp(-e.deltaY * 0.01))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [zoom, maxZoom])
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    const t = Math.min(d, Math.max(0, ((clientX - r.left) / r.width) * d))
    return Math.floor(t * fps + 1e-6) / fps
  }
  const pct = (t: number) => `${(t / d) * 100}%`
  const ticks = Math.ceil(zoom * 4)
  // Only render visible ruler marks; frame-level zoom can span hours of footage.
  const firstTick = Math.max(0, Math.floor(view.left / (view.width * zoom) * ticks) - 1)
  const lastTick = Math.min(ticks, Math.ceil((view.left + view.width) / (view.width * zoom) * ticks) + 1)
  const rulerTime = (t: number) => {
    if (duration / ticks >= 0.1) return timecode(t, duration / zoom < 10)
    const fps = media.fps || 30
    return `${timecode(t, false)}:${Math.floor((t % 1) * fps + 1e-6).toString().padStart(2, '0')}`
  }

  return (
    <div className="relative shrink-0 select-none rounded-lg border border-line bg-panel px-2 pb-2">
      <div className="flex h-8 items-center gap-1 border-b border-line text-dim">
        <span className="mr-auto text-[10px] font-medium uppercase tracking-wider">Timeline</span>
        <span className="mr-2 text-[10px] text-faint tabular" title="Source video frame rate">{fps} fps</span>
        <span data-testid="timeline-scale" className="mr-1 text-[10px] tabular" title="Pinch or hold Ctrl/⌘ and scroll to zoom">{zoom > 1 ? `${(duration / zoom).toFixed(duration / zoom < 1 ? 3 : 1)} s visible` : ''}{zoom > 1 && zoom >= maxZoom - 1e-6 ? ' · Frame view' : ''}</span>
        <button type="button" aria-label="Fit timeline" title="Fit entire video" onClick={() => changeZoom(1)} className="ml-1 rounded p-1 hover:bg-hover hover:text-fg"><Maximize2 className="size-3.5" /></button>
      </div>
      <div ref={viewport} data-testid="timeline-viewport" className="overflow-x-auto overflow-y-hidden">
      <div className="relative pt-5" style={{ width: `${zoom * 100}%` }}>
      {/* note pins */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-5">
        {notes.map(n => (
          <Tip key={n.id} label={<span>{timecode(n.anchor.t0)} · {n.text}{n.reply ? <><br /><span className="text-dim">↳ {n.reply}</span></> : null}</span>}>
            <button
              onClick={() => onNote(n)}
              className={cn('pointer-events-auto absolute top-1 size-3 -translate-x-1/2 rounded-full border-2 border-bg', n.status === 'open' ? 'bg-note' : 'bg-faint')}
              style={{ left: pct(n.anchor.t0) }}
            />
          </Tip>
        ))}
      </div>
      <div className="relative mb-1 h-5 border-b border-line text-[9px] text-dim tabular" aria-hidden="true">
        {Array.from({ length: lastTick - firstTick + 1 }, (_, index) => { const i = firstTick + index; return <div key={i} className="absolute inset-y-0 border-l border-line-strong" style={{ left: `${100 * i / ticks}%` }}><span className={cn('absolute whitespace-nowrap bg-panel pb-1', i === 0 ? 'left-0' : i === ticks ? 'right-0' : '-translate-x-1/2')}>{rulerTime(duration * i / ticks)}</span></div> })}
      </div>
      <div
        ref={bar}
        data-testid="timeline-scrubber"
        aria-label="Video timeline — click to seek, drag to select a range"
        className="relative h-[72px] touch-none cursor-crosshair rounded border border-amber/40 bg-raised shadow-sm"
        onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); const t = at(e.clientX); setDrag({ start: t, moved: false }); onSeek(t) }}
        onPointerMove={e => {
          const t = at(e.clientX)
          setHover(t)
          if (!drag) return
           if (Math.abs(t - drag.start) >= Math.max(1 / fps, d / zoom * 0.004)) { setDrag({ ...drag, moved: true }); onRange({ t0: Math.min(t, drag.start), t1: Math.max(t, drag.start) }) }
          onSeek(t)
        }}
        onPointerUp={() => { if (drag && !drag.moved) onRange(null); setDrag(null) }}
        onPointerCancel={() => { setDrag(null); setHover(null) }}
        onPointerLeave={() => setHover(null)}
      >
        <Filmstrip {...media} duration={duration} viewport={viewport} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate rounded-b bg-panel/90 px-2 py-0.5 text-[10px] font-medium text-fg">{media.src.split(/[\\/]/).pop()}</div>
        {/* resolved and open note ranges */}
        {notes.filter(n => n.anchor.t1 != null).map(n => (
          <div key={n.id} className={cn('absolute inset-y-0 rounded-sm', n.status === 'open' ? 'bg-note/15' : 'bg-white/5')} style={{ left: pct(n.anchor.t0), width: pct(n.anchor.t1! - n.anchor.t0) }} />
        ))}
        {/* played part */}
        <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l bg-white/[0.04]" style={{ width: pct(time) }} />
        {/* selection */}
        {range?.t1 != null && <div className="absolute inset-y-0 border-x-2 border-amber bg-amber/20" style={{ left: pct(range.t0), width: pct(range.t1 - range.t0) }} />}
        {/* hover time */}
        {hover != null && !drag && (
          <div className="pointer-events-none absolute inset-y-0 border-l border-fg/50" style={{ left: pct(hover) }}><span className="absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded bg-raised px-1.5 py-0.5 text-[10px] text-fg tabular">{rulerTime(hover)}</span></div>
        )}
        {/* playhead */}
        <div className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-amber shadow-[0_0_3px_#000]" style={{ left: pct(Math.max(0, Math.min(time, d))) }}><span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-b-sm bg-amber" /></div>
      </div>
      </div>
      </div>
    </div>
  )
}
