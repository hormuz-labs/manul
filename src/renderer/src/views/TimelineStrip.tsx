// What the film is made of: media segments and motion clips (with their poster), proportional to time.
import { Sparkles } from 'lucide-react'
import { cn, mediaUrl } from '@/lib/utils'
import { length, type Item, type Overlay, type Timeline } from '../../../shared/timeline'
import type { ClipInfo } from '../../../shared/types'

type Props = { dir: string; timeline: Timeline; clips: Record<string, ClipInfo>; selected?: string; onSelect(item: Item, start: number): void; onSelectOverlay(o: Overlay): void }

export function TimelineStrip({ dir, timeline, clips, selected, onSelect, onSelectOverlay }: Props) {
  const total = timeline.items.reduce((s, i) => s + length(i), 0) || 1
  let start = 0
  const overlays = timeline.overlays || []
  return (
    <div className="space-y-1">
    {overlays.length > 0 && (
      <div className="relative mx-1 h-5">
        {overlays.map(o => (
          <button key={o.id} onClick={() => onSelectOverlay(o)} title={`${clips[o.clip]?.title || o.clip} (over the footage) · click to edit`}
            style={{ left: `${(o.start / total) * 100}%`, width: `${(o.dur / total) * 100}%` }}
            className={cn('absolute inset-y-0 min-w-4 truncate rounded-sm border px-1 text-left text-[10px] font-medium', selected === o.id ? 'border-note bg-note/30 text-fg' : 'border-note/40 bg-note/15 text-note hover:border-note')}>
            {clips[o.clip]?.title || o.clip}
          </button>
        ))}
      </div>
    )}
    <div className="mx-1 flex h-9 gap-px overflow-hidden rounded-md">
      {timeline.items.map(it => {
        const s = start
        start += length(it)
        const w = `${(length(it) / total) * 100}%`
        if (it.kind === 'media') return <div key={it.id} style={{ width: w }} className="h-full bg-raised/80" title={`${it.src.split('/').pop()} · ${it.in.toFixed(1)}–${it.out.toFixed(1)} s`} />
        const c = clips[it.clip]
        return (
          <button key={it.id} style={{ width: w }} onClick={() => onSelect(it, s)} title={`${c?.title || it.clip} · click to edit`}
            className={cn('relative h-full min-w-6 overflow-hidden rounded-sm border bg-amber/15 text-left', selected === it.id ? 'border-amber' : 'border-amber/30 hover:border-amber/70')}>
            {c?.poster && <img src={`${mediaUrl(`${dir}/${c.poster}`)}?v=${c.updatedAt}`} className="absolute inset-0 size-full object-cover opacity-60" draggable={false} />}
            <span className="relative flex items-center gap-1 truncate px-1.5 text-[10.5px] font-medium text-fg"><Sparkles className="size-3 shrink-0 text-amber" />{c?.title || it.clip}</span>
          </button>
        )
      })}
    </div>
    </div>
  )
}
