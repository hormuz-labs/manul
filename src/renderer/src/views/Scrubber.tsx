// The scrubber: playhead, note pins, and a drag to select a range (the anchor for the next note).
import { useRef, useState } from 'react'
import { cn, timecode } from '@/lib/utils'
import { Tip } from '@/components/ui/tooltip'
import type { Note } from '../../../shared/types'

type Props = {
  duration: number
  time: number
  notes: Note[]
  range?: { t0: number; t1?: number }
  onSeek(t: number): void
  onRange(r: { t0: number; t1: number } | null): void
  onNote(n: Note): void
}

export function Scrubber({ duration, time, notes, range, onSeek, onRange, onNote }: Props) {
  const bar = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ start: number; moved: boolean } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const d = duration || 1
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    return Math.min(d, Math.max(0, ((clientX - r.left) / r.width) * d))
  }
  const pct = (t: number) => `${(t / d) * 100}%`

  return (
    <div className="relative select-none px-1 pt-5">
      {/* note pins */}
      <div className="pointer-events-none absolute inset-x-1 top-0 h-5">
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
      <div
        ref={bar}
        className="relative h-8 cursor-pointer rounded-md bg-raised"
        onPointerDown={e => { (e.target as Element).setPointerCapture(e.pointerId); const t = at(e.clientX); setDrag({ start: t, moved: false }); onSeek(t) }}
        onPointerMove={e => {
          const t = at(e.clientX)
          setHover(t)
          if (!drag) return
          if (Math.abs(t - drag.start) > d * 0.004) { setDrag({ ...drag, moved: true }); onRange({ t0: Math.min(t, drag.start), t1: Math.max(t, drag.start) }) }
          onSeek(t)
        }}
        onPointerUp={() => { if (drag && !drag.moved) onRange(null); setDrag(null) }}
        onPointerLeave={() => setHover(null)}
      >
        {/* resolved and open note ranges */}
        {notes.filter(n => n.anchor.t1 != null).map(n => (
          <div key={n.id} className={cn('absolute inset-y-0 rounded-sm', n.status === 'open' ? 'bg-note/15' : 'bg-white/5')} style={{ left: pct(n.anchor.t0), width: pct(n.anchor.t1! - n.anchor.t0) }} />
        ))}
        {/* played part */}
        <div className="absolute inset-y-0 left-0 rounded-l-md bg-white/[0.06]" style={{ width: pct(time) }} />
        {/* selection */}
        {range?.t1 != null && <div className="absolute inset-y-0 border-x-2 border-amber bg-amber/20" style={{ left: pct(range.t0), width: pct(range.t1 - range.t0) }} />}
        {/* hover time */}
        {hover != null && !drag && (
          <div className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-raised px-1.5 py-0.5 text-[10px] text-dim tabular" style={{ left: pct(hover) }}>{timecode(hover)}</div>
        )}
        {/* playhead */}
        <div className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded bg-fg" style={{ left: pct(time) }} />
      </div>
    </div>
  )
}
