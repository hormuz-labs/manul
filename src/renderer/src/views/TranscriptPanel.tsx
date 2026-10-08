// What is said, word by word, in sync with the film. Click a word to jump there; drag across words to select a range
// (it becomes the anchor of the next request, e.g. "cut this"). Fillers are marked so "cut the ums" is visible.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Loader2, Search } from 'lucide-react'
import { speakerOfSegments, type Speakers } from '../../../shared/speakers'
import { SpeakerChip, SpeakersPanel } from './SpeakersPanel'
import { Button } from '@/components/ui/button'
import { useJobs } from '@/components/JobsTray'
import { flatWords, isFiller, rangeOfSelection, wordIndexAt } from '@/lib/transcript'
import { cn, timecode } from '@/lib/utils'
import type { Project, Transcript } from '../../../shared/types'

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 300)

type Props = { project: Project; media: string; time: number; onSeek(t: number): void; onRange(r: { t0: number; t1: number }): void }

/** The side panel's Transcript tab. */
export function TranscriptPanel({ project, media, time, onSeek, onRange }: Props) {
  const [t, setT] = useState<Transcript | null>(null)
  const [state, setState] = useState<'loading' | 'none' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const [query, setQuery] = useState('')
  const dragging = useRef<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const allJobs = useJobs()
  const jobs = allJobs.filter(j => j.kind === 'transcribe' && j.project === project.dir && j.status === 'running')
  const finding = allJobs.find(j => j.kind === 'speakers' && j.project === project.dir && j.status === 'running' && j.title.endsWith(media.split('/').pop()!))
  const known = project.transcripts?.[media]
  // who speaks when (worked out in the background once there is a transcript) and the names given
  const [sp, setSp] = useState<Speakers | null>(null)
  const [naming, setNaming] = useState(false)
  const names = project.speakerNames?.[media] || {}

  // load (and make, when an engine is ready) the transcript of the media on screen
  useEffect(() => {
    let live = true
    setState('loading')
    window.manul.transcript(project.dir, media, false)
      .then(tr => { if (live) { setT(tr); setState(tr ? 'ready' : 'none') } })
      .catch(e => { if (live) { setError(clean(e)); setState('error') } })
    return () => { live = false }
  }, [project.dir, media, known])

  useEffect(() => {
    let live = true
    setSp(null)
    if (!t?.segments.length) return
    // make it now if it was never made (projects transcribed before speakers existed); it runs as a job
    window.manul.speakers.get(project.dir, media, true).then(r => { if (live) setSp(r) }).catch(() => {})
    return () => { live = false }
  }, [project.dir, media, t, project.speakers?.[media]])
  const who = useMemo(() => (t && sp ? speakerOfSegments(t.segments, sp.turns) : []), [t, sp])
  // a speaker chip above each sentence where the speaker changes
  const turnStarts = useMemo(() => { let last: string | undefined; return who.map(w => { const start = !!w && w !== last; if (w) last = w; return start }) }, [who])

  const words = useMemo(() => (t ? flatWords(t) : []), [t])
  const current = wordIndexAt(words, time)
  const q = query.trim().toLowerCase()

  // keep the spoken word in view while playing
  useEffect(() => {
    const el = list.current?.querySelector(`[data-i="${current}"]`) as HTMLElement | null
    if (el && list.current && dragging.current == null) {
      const r = el.getBoundingClientRect(), box = list.current.getBoundingClientRect()
      if (r.top < box.top + 40 || r.bottom > box.bottom - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [current])

  const make = async () => {
    setState('loading'); setError(null)
    try { const tr = await window.manul.transcript(project.dir, media, true); setT(tr); setState(tr ? 'ready' : 'none') }
    catch (e) { setError(clean(e)); setState('error') }
  }

  const fillers = words.filter(isFiller).length
  const lo = sel ? Math.min(sel.a, sel.b) : -1, hi = sel ? Math.max(sel.a, sel.b) : -1

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {finding && (
        <div className="mx-3 mb-1 flex items-center gap-2 text-[11px] text-faint">
          <Loader2 className="size-3 animate-spin" />Finding who speaks{finding.progress != null ? `… ${Math.round(finding.progress * 100)}%` : '…'}
        </div>
      )}

      {state === 'ready' && t && t.segments.length === 0 && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-dim">{t.language === 'none' ? 'This video has no sound.' : 'No speech found.'}</div>
      )}

      {state === 'ready' && t && t.segments.length > 0 && (
        <>
          <div className="mx-3 mb-1 flex items-center gap-1.5">
            <div className="flex flex-1 items-center gap-2 rounded-md bg-raised px-2.5 py-1">
              <Search className="size-3.5 text-faint" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find in transcript" className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-faint" />
            </div>
            {sp && <SpeakersPanel dir={project.dir} media={media} sp={sp} names={names} transcript={t} open={naming} onOpenChange={setNaming} onSeek={onSeek} />}
            {fillers > 0 && <span className="shrink-0 whitespace-nowrap rounded bg-amber-soft px-1.5 py-0.5 text-[10.5px] text-amber" title="Filler words (um, uh…)">{fillers} filler{fillers === 1 ? '' : 's'}</span>}
          </div>
          <div
            ref={list}
            className="flex-1 space-y-3 overflow-y-auto px-3 py-3 leading-[1.7]"
            onMouseUp={() => {
              if (dragging.current != null && sel && sel.a !== sel.b) onRange(rangeOfSelection(words, sel.a, sel.b))
              dragging.current = null
            }}
          >
            {t.segments.map((s, si) => (
              <div key={si}>
              {turnStarts[si] && <SpeakerChip id={who[si]!} names={names} onClick={() => setNaming(true)} />}
              <div className="group flex gap-2">
                <button className="mt-[3px] w-9 shrink-0 text-right text-[10.5px] text-faint tabular hover:text-fg" onClick={() => onSeek(s.s)}>{timecode(s.s, false)}</button>
                <p className="flex-1 text-[13px]">
                  {words.filter(w => w.seg === si).map(w => (
                    <span
                      key={w.i}
                      data-i={w.i}
                      onMouseDown={e => { e.preventDefault(); dragging.current = w.i; setSel({ a: w.i, b: w.i }) }}
                      onMouseEnter={() => { if (dragging.current != null) setSel({ a: dragging.current, b: w.i }) }}
                      onClick={() => { if (!sel || sel.a === sel.b) { setSel(null); onSeek(w.s) } }}
                      className={cn(
                        'cursor-pointer rounded-[3px] px-[1px] transition-colors',
                        w.i === current ? 'bg-fg/90 text-bg' : w.i < current ? 'text-fg/90' : 'text-dim',
                        w.i >= lo && w.i <= hi && 'bg-amber/30 text-fg',
                        isFiller(w) && w.i !== current && 'text-amber/80 underline decoration-amber/40 decoration-dotted underline-offset-4',
                        q && w.w.toLowerCase().includes(q) && 'outline outline-1 outline-note',
                      )}
                    >{w.w}{' '}</span>
                  ))}
                </p>
              </div>
              </div>
            ))}
            <div className="pt-2 text-[10.5px] text-faint">{t.model} · {t.language}</div>
          </div>
        </>
      )}

      {(state === 'loading' || jobs.length > 0) && state !== 'ready' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-dim">
          <Loader2 className="size-5 animate-spin text-amber" />
          <span>{jobs[0]?.progress != null ? `Transcribing… ${Math.round(jobs[0].progress * 100)}%` : 'Transcribing…'}</span>
        </div>
      )}

      {state === 'none' && jobs.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-dim">See every word, cut by text, and let Manul find moments by what is said.</p>
          <Button variant="primary" size="md" onClick={make}><AudioLines />Transcribe</Button>
        </div>
      )}

      {state === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-xs text-bad" data-selectable>{error}</p>
          <Button size="sm" onClick={make}>Try again</Button>
        </div>
      )}
    </div>
  )
}
