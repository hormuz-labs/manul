// The timeline: the film's pieces in order, each with its frames, the overlays laid over it, the playhead and note pins,
// and a drag to select a range (the anchor for the next note, or what Delete cuts). Editing by hand: click a piece to
// select it, drag its edges to trim it, drag its name to move it. Every edit ripples: there are no gaps.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Maximize2, Sparkles, VolumeX } from 'lucide-react'
import { cn, mediaUrl, timecode } from '@/lib/utils'
import { Tip } from '@/components/ui/tooltip'
import { applyEdit, duration as lengthOf, itemAt, length, starts, type Edit, type Item, type Timeline } from '../../../shared/timeline'
import type { ClipInfo, Note } from '../../../shared/types'
import { Filmstrip } from './Filmstrip'
import { frameZoom } from '@/lib/timelineScale'
import { DRAG_FILE, dragKind } from './FilesPanel'

type Props = {
  dir: string
  /** changes when another version is on screen (the zoom resets) */
  revision: number
  fps: number
  duration: number
  time: number
  notes: Note[]
  range?: { t0: number; t1?: number }
  /** what the film is made of */
  track: Timeline
  clips: Record<string, ClipInfo>
  /** pieces can be trimmed and moved (not while a proposal waits) */
  editable: boolean
  selected: string | null
  /** the longest a piece can be (its file's or clip's length) */
  maxOf(it: Item): number | undefined
  /** buttons for the header (split, delete, undo…) and what to say on the right of it */
  tools?: ReactNode
  status?: ReactNode
  onSeek(t: number): void
  onRange(r: { t0: number; t1: number } | null): void
  onNote(n: Note): void
  onSelect(id: string | null): void
  onEdit(edits: Edit[]): void
  /** a motion clip (a piece or an overlay) clicked: edit it on the picture */
  onOpenClip(id: string, clip: string, start: number): void
  /** A file dragged from the Files tab dropped at t: footage goes in there, music under the film, subtitles with it. */
  onDropFile?(rel: string, t: number): void
}

const DROP_LABEL: Record<string, string> = { video: 'Insert here', audio: 'Use as the music', subtitles: 'Use as subtitles' }
type Trim = { id: string; edge: 'in' | 'out'; x0: number; pps: number; from: number; value: number }
type Move = { id: string; x0: number; moved: boolean; before: string | null }

export function Scrubber({ dir, revision, fps: rate, duration, time, notes, range, track, clips, editable, selected, maxOf, tools, status, onSeek, onRange, onNote, onSelect, onEdit, onOpenClip, onDropFile }: Props) {
  const bar = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState({ width: 1, left: 0 })
  const center = useRef<number | null>(null)
  const [drag, setDrag] = useState<{ start: number; moved: boolean } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ t: number; kind: string } | null>(null)
  const [trim, setTrim] = useState<Trim | null>(null)
  const [move, setMove] = useState<Move | null>(null)
  // while trimming, the pieces as they would be (what follows moves up or down)
  const trimEdit = (t: Trim): Edit => ({ op: 'trim', id: t.id, [t.edge]: t.value })
  const shown = trim ? applyEdit(track, trimEdit(trim), maxOf) : track
  const at0 = starts(shown)
  const d = (trim ? lengthOf(shown) : duration || lengthOf(track)) || 1
  const fps = rate || 30
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
  useLayoutEffect(() => { setZoom(1); if (viewport.current) viewport.current.scrollLeft = 0 }, [revision])
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
    if (d / ticks >= 0.1) return timecode(t, d / zoom < 10)
    return `${timecode(t, false)}:${Math.floor((t % 1) * fps + 1e-6).toString().padStart(2, '0')}`
  }

  // ---- trimming a piece by its edges
  const startTrim = (e: PointerEvent, it: Item, edge: 'in' | 'out') => {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const from = edge === 'in' ? (it.kind === 'media' ? it.in : 0) : it.kind === 'media' ? it.out : it.dur
    setTrim({ id: it.id, edge, x0: e.clientX, pps: bar.current!.getBoundingClientRect().width / d, from, value: from })
  }
  const trimTo = (e: PointerEvent) => { if (trim) setTrim({ ...trim, value: trim.from + (e.clientX - trim.x0) / trim.pps }) }
  const endTrim = () => {
    if (trim && Math.abs(trim.value - trim.from) > 1e-3) onEdit([trimEdit(trim)])
    setTrim(null)
  }

  // ---- moving a piece by its name
  /** the piece the dragged one would go before (null: the end), from the pointer's time */
  const gapAt = (t: number, id: string) => {
    for (let k = 0; k < shown.items.length; k++) {
      const it = shown.items[k]
      if (it.id !== id && t < at0[k] + length(it) / 2) return it.id
    }
    return null
  }
  const startMove = (e: PointerEvent, it: Item) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setMove({ id: it.id, x0: e.clientX, moved: false, before: null })
  }
  const moveTo = (e: PointerEvent) => {
    if (!move || !editable || shown.items.length < 2) return
    if (!move.moved && Math.abs(e.clientX - move.x0) < 4) return
    setMove({ ...move, moved: true, before: gapAt(at(e.clientX), move.id) })
  }
  const endMove = (it: Item, start: number) => {
    const m = move
    setMove(null)
    if (!m) return
    if (!m.moved) {
      // a click on the name: select it (a motion clip opens on the picture)
      onSelect(it.id)
      if (it.kind === 'clip') onOpenClip(it.id, it.clip, start)
      else onSeek(start)
      return
    }
    const k = shown.items.findIndex(x => x.id === m.id)
    const next = shown.items[k + 1]?.id ?? null
    if (m.before !== next && m.before !== m.id) onEdit([{ op: 'move', id: m.id, ...(m.before ? { before: m.before } : {}) }])
  }
  const gapX = move?.moved ? (move.before ? at0[shown.items.findIndex(x => x.id === move.before)] : d) : null

  const sel = shown.items.findIndex(x => x.id === selected)
  const selItem = sel >= 0 ? shown.items[sel] : undefined
  const trimmed = trim ? shown.items.find(x => x.id === trim.id) : undefined
  const overlays = shown.overlays || []

  return (
    <div className="relative shrink-0 select-none rounded-lg border border-line bg-panel px-2 pb-2">
      <div className="flex h-8 items-center gap-1 border-b border-line text-dim">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wider">Timeline</span>
        {tools}
        <span className="flex-1" />
        {status}
        <span className="mx-2 text-[10px] text-faint tabular" title="Source video frame rate">{fps} fps</span>
        <span data-testid="timeline-scale" className="mr-1 text-[10px] tabular" title="Pinch or hold Ctrl/⌘ and scroll to zoom">{zoom > 1 ? `${(d / zoom).toFixed(d / zoom < 1 ? 3 : 1)} s visible` : ''}{zoom > 1 && zoom >= maxZoom - 1e-6 ? ' · Frame view' : ''}</span>
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
        {Array.from({ length: lastTick - firstTick + 1 }, (_, index) => { const i = firstTick + index; return <div key={i} className="absolute inset-y-0 border-l border-line-strong" style={{ left: `${100 * i / ticks}%` }}><span className={cn('absolute whitespace-nowrap bg-panel pb-1', i === 0 ? 'left-0' : i === ticks ? 'right-0' : '-translate-x-1/2')}>{rulerTime(d * i / ticks)}</span></div> })}
      </div>
      {/* overlays: lower thirds, captions, callouts laid over the footage */}
      {overlays.length > 0 && (
        <div className="relative mb-1 h-5">
          {overlays.map(o => (
            <button key={o.id} onClick={() => onOpenClip(o.id, o.clip, o.start)} title={`${clips[o.clip]?.title || o.clip} (over the footage) · click to edit`}
              style={{ left: pct(o.start), width: pct(o.dur) }}
              className={cn('absolute inset-y-0 min-w-4 truncate rounded-sm border px-1 text-left text-[10px] font-medium', selected === o.id ? 'border-note bg-note/30 text-fg' : 'border-note/40 bg-note/15 text-note hover:border-note')}>
              {clips[o.clip]?.title || o.clip}
            </button>
          ))}
        </div>
      )}
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
        onPointerUp={() => {
          // a click: the piece under it is selected
          if (drag && !drag.moved) { onRange(null); onSelect(itemAt(shown, drag.start).item?.id ?? null) }
          setDrag(null)
        }}
        onPointerCancel={() => { setDrag(null); setHover(null) }}
        onPointerLeave={() => setHover(null)}
        onDragOver={e => {
          const kind = dragKind(e.dataTransfer.types)
          if (!onDropFile || !kind || !DROP_LABEL[kind]) return
          e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'
          setDrop({ t: at(e.clientX), kind })
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={e => {
          const rel = e.dataTransfer.getData(DRAG_FILE)
          setDrop(null)
          if (!rel || !onDropFile) return
          e.preventDefault(); e.stopPropagation()
          onDropFile(rel, at(e.clientX))
        }}
      >
        {/* the pieces */}
        {shown.items.map((it, k) => {
          const c = it.kind === 'clip' ? clips[it.clip] : undefined
          const name = it.kind === 'media' ? it.src.split('/').pop() : c?.title || it.clip
          return (
            <div key={it.id} data-piece={it.id} className={cn('absolute inset-y-0 overflow-hidden', k > 0 && 'border-l border-black/50', move?.moved && move.id === it.id && 'opacity-40')}
              style={{ left: pct(at0[k]), width: pct(length(it)), minWidth: 2 }}>
              {it.kind === 'media' ? (
                <Filmstrip dir={dir} src={it.src} revision={revision} from={it.in} to={it.out} fps={fps} viewport={viewport} />
              ) : (
                <div className="pointer-events-none absolute inset-0 bg-amber/15">
                  {c?.poster && <img src={`${mediaUrl(`${dir}/${c.poster}`)}?v=${c.updatedAt}`} alt="" draggable={false} className="absolute inset-0 size-full object-cover opacity-70" />}
                </div>
              )}
              <button
                type="button"
                data-grip
                title={it.kind === 'clip' ? `${name} · click to edit` : editable && shown.items.length > 1 ? `${name} · drag to move` : name}
                className={cn('absolute inset-x-0 bottom-0 flex items-center gap-1 truncate bg-panel/90 px-2 py-0.5 text-left text-[10px] font-medium text-fg', editable && shown.items.length > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
                onPointerDown={e => startMove(e, it)}
                onPointerMove={moveTo}
                onPointerUp={() => endMove(it, at0[k])}
                onPointerCancel={() => setMove(null)}
              >
                {it.kind === 'clip' && <Sparkles className="size-3 shrink-0 text-amber" />}
                <span className="truncate">{name}</span>
                {it.kind === 'media' && it.muted && <VolumeX className="size-3 shrink-0 text-amber" aria-label="muted" />}
                {it.kind === 'media' && !it.muted && !!it.db && <span className="shrink-0 tabular text-amber">{it.db > 0 ? '+' : ''}{it.db} dB</span>}
              </button>
            </div>
          )
        })}
        {/* resolved and open note ranges */}
        {notes.filter(n => n.anchor.t1 != null).map(n => (
          <div key={n.id} className={cn('pointer-events-none absolute inset-y-0 rounded-sm', n.status === 'open' ? 'bg-note/15' : 'bg-white/5')} style={{ left: pct(n.anchor.t0), width: pct(n.anchor.t1! - n.anchor.t0) }} />
        ))}
        {/* played part */}
        <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l bg-white/[0.04]" style={{ width: pct(time) }} />
        {/* the selected piece, with its edges to trim */}
        {selItem && (
          <div className="pointer-events-none absolute inset-y-0 z-[5] rounded-sm ring-2 ring-inset ring-fg" style={{ left: pct(at0[sel]), width: pct(length(selItem)) }} data-selected-piece={selItem.id}>
            {editable && (['in', 'out'] as const).map(edge => (
              <div key={edge} role="slider" aria-label={edge === 'in' ? 'Trim the start' : 'Trim the end'} aria-valuenow={edge === 'in' ? (selItem.kind === 'media' ? selItem.in : 0) : selItem.kind === 'media' ? selItem.out : selItem.dur}
                className={cn('pointer-events-auto absolute inset-y-0 w-2.5 cursor-ew-resize bg-fg/90 hover:bg-amber', edge === 'in' ? 'left-0 rounded-l-sm' : 'right-0 rounded-r-sm', selItem.kind === 'clip' && edge === 'in' && 'hidden')}
                onPointerDown={e => startTrim(e, selItem, edge)} onPointerMove={trimTo} onPointerUp={endTrim} onPointerCancel={() => setTrim(null)}>
                <span className="absolute inset-y-[30%] left-1/2 w-px -translate-x-1/2 bg-bg/70" />
              </div>
            ))}
          </div>
        )}
        {trim && trimmed && (
          <span className="pointer-events-none absolute -top-6 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-fg px-1.5 py-0.5 text-[10px] font-medium text-bg tabular"
            style={{ left: pct(at0[shown.items.indexOf(trimmed)] + (trim.edge === 'in' ? 0 : length(trimmed))) }}>
            {trim.edge === 'in' ? 'Starts at' : 'Ends at'} {timecode(trim.edge === 'in' ? (trimmed.kind === 'media' ? trimmed.in : 0) : trimmed.kind === 'media' ? trimmed.out : trimmed.dur, false)} · {length(trimmed).toFixed(1)} s
          </span>
        )}
        {/* where a moved piece would go */}
        {gapX != null && <div className="pointer-events-none absolute -inset-y-1 z-10 w-1 -translate-x-1/2 rounded bg-note" style={{ left: pct(gapX) }} />}
        {/* selection */}
        {range?.t1 != null && <div className="pointer-events-none absolute inset-y-0 border-x-2 border-amber bg-amber/20" style={{ left: pct(range.t0), width: pct(range.t1 - range.t0) }} />}
        {/* hover time */}
        {hover != null && !drag && !trim && !move && (
          <div className="pointer-events-none absolute inset-y-0 border-l border-fg/50" style={{ left: pct(hover) }}><span className="absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded bg-raised px-1.5 py-0.5 text-[10px] text-fg tabular">{rulerTime(hover)}</span></div>
        )}
        {/* where a dragged file would go */}
        {drop && (
          <div className="pointer-events-none absolute -inset-y-1 z-10 w-0.5 -translate-x-1/2 bg-note" style={{ left: pct(drop.kind === 'video' ? drop.t : 0) }}>
            <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-note px-1.5 py-0.5 text-[10px] font-medium text-bg">{DROP_LABEL[drop.kind]}{drop.kind === 'video' ? ` at ${rulerTime(drop.t)}` : ''}</span>
          </div>
        )}
        {/* playhead */}
        <div className="pointer-events-none absolute -inset-y-1 z-[6] w-0.5 -translate-x-1/2 bg-amber shadow-[0_0_3px_#000]" style={{ left: pct(Math.max(0, Math.min(time, d))) }}><span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-b-sm bg-amber" /></div>
      </div>
      </div>
      </div>
    </div>
  )
}
