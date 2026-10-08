// The subtitles of the video on screen, line by line in sync with it, beside the transcript. Which file goes with the
// video (by name, or chosen here), whether it matches what's said (the transcript), and a one-click fix when its times
// are off. Click a line to jump there; drag across lines to select a range for the next request.
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, timecode } from '@/lib/utils'
import type { SubtitlesState } from '../../../preload'
import type { Project } from '../../../shared/types'

type Props = { project: Project; media: string; time: number; query: string; onSeek(t: number): void; onRange(r: { t0: number; t1: number }): void }

/** The line on screen at t, or the last one before it. */
export function cueAt(cues: { s: number; e: number }[], t: number) {
  let lo = 0, hi = cues.length - 1, ans = -1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].s <= t) { ans = m; lo = m + 1 } else hi = m - 1 }
  return ans
}

export function SubtitlesView({ project, media, time, query, onSeek, onRange }: Props) {
  const [st, setSt] = useState<SubtitlesState | null>(null)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const dragging = useRef<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const link = project.subtitles?.[media]
  const files = Object.keys(project.files || {}).filter(f => project.files![f].kind === 'subtitles').join('|')

  useEffect(() => { window.manul.subtitles.get(project.dir, media).then(setSt).catch(() => setSt(null)) }, [project.dir, media, JSON.stringify(link), files, project.transcripts?.[media]]) // eslint-disable-line react-hooks/exhaustive-deps

  const cues = st?.cues || []
  const current = cueAt(cues, time)
  useEffect(() => {
    const el = list.current?.querySelector(`[data-cue="${current}"]`) as HTMLElement | null
    if (el && list.current && dragging.current == null) {
      const r = el.getBoundingClientRect(), box = list.current.getBoundingClientRect()
      if (r.top < box.top + 40 || r.bottom > box.bottom - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [current])

  const act = async (fn: () => Promise<SubtitlesState>) => { setBusy(true); try { setSt(await fn()) } catch (e) { alert((e as Error).message) } finally { setBusy(false) } }
  const choose = (file: string | null) => act(() => window.manul.subtitles.link(project.dir, media, file))
  if (!st) return <div className="flex flex-1 items-center justify-center"><Loader2 className="size-4 animate-spin text-faint" /></div>

  if (!st.link) {
    return (
      <div className="flex flex-1 flex-col gap-2 px-4 py-6">
        <p className="text-dim">Which subtitles go with this video?</p>
        {st.candidates.map(f => (
          <button key={f} disabled={busy} onClick={() => choose(f)} className="truncate rounded-md bg-raised px-3 py-2 text-left text-xs hover:bg-hover" title={project.files?.[f]?.summary}>
            {f.replace(/^media\//, '')}
            <span className="block truncate text-faint">{project.files?.[f]?.summary}</span>
          </button>
        ))}
      </div>
    )
  }

  const { match, offset } = st.link
  const q = query.trim().toLowerCase()
  const lo = sel ? Math.min(sel.a, sel.b) : -1, hi = sel ? Math.max(sel.a, sel.b) : -1
  return (
    <>
      <div className="mx-3 mb-1 space-y-1.5 rounded-md bg-raised px-2.5 py-2 text-xs">
        <select value={st.link.file} disabled={busy} onChange={e => choose(e.target.value || null)} title={st.link.file}
          className="h-6 w-full truncate rounded border border-line bg-bg px-1 text-[11px] text-dim outline-none" aria-label="Choose subtitles">
          {st.candidates.map(f => <option key={f} value={f}>{f.replace(/^media\//, '')}</option>)}
          <option value="">No subtitles for this video</option>
        </select>
        {match === undefined ? (
          <p className="text-faint">Transcribe the video to check these match what's said.</p>
        ) : match < 0.2 ? (
          <p className="flex gap-1.5 text-bad"><TriangleAlert className="mt-px size-3.5 shrink-0" />These don't match what's said in this video: subtitles of another video, or a translation.</p>
        ) : match < 0.5 ? (
          <p className="flex gap-1.5 text-amber"><TriangleAlert className="mt-px size-3.5 shrink-0" />Only {Math.round(match * 100)} % of the lines are heard in the video: another cut of it, perhaps.</p>
        ) : offset ? (
          <div className="flex items-center gap-2 text-amber">
            <TriangleAlert className="size-3.5 shrink-0" /><span className="flex-1">They match, but come {Math.abs(offset)} s {offset > 0 ? 'late' : 'early'}.</span>
            <Button size="sm" variant="secondary" className="h-6 text-[11px]" disabled={busy} onClick={() => act(() => window.manul.subtitles.shift(project.dir, media))}>Fix the timing</Button>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-ok"><Check className="size-3.5" />They match what's said ({Math.round(match * 100)} % of lines).</p>
        )}
      </div>
      <div
        ref={list}
        className="flex-1 space-y-1 overflow-y-auto px-3 py-2 leading-[1.6]"
        onMouseUp={() => {
          if (dragging.current != null && sel && sel.a !== sel.b) onRange({ t0: cues[Math.min(sel.a, sel.b)].s, t1: cues[Math.max(sel.a, sel.b)].e })
          dragging.current = null
        }}
      >
        {cues.map((c, i) => (
          <div
            key={i}
            data-cue={i}
            onMouseDown={e => { e.preventDefault(); dragging.current = i; setSel({ a: i, b: i }) }}
            onMouseEnter={() => { if (dragging.current != null) setSel({ a: dragging.current, b: i }) }}
            onClick={() => { if (!sel || sel.a === sel.b) { setSel(null); onSeek(c.s) } }}
            className={cn('flex cursor-pointer gap-2 rounded px-1 py-0.5',
              i === current && time <= c.e ? 'bg-fg/90 text-bg' : i < current ? 'text-fg/90' : 'text-dim',
              i >= lo && i <= hi && 'bg-amber/30 text-fg',
              q && c.text.toLowerCase().includes(q) && 'outline outline-1 outline-note')}
          >
            <span className="mt-[2px] w-9 shrink-0 text-right text-[10.5px] tabular opacity-60">{timecode(c.s, false)}</span>
            <span className="flex-1 whitespace-pre-line text-[13px]">{c.text}</span>
          </div>
        ))}
      </div>
    </>
  )
}
