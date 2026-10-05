// The Screen view: the film, the scrubber with notes, and the agent beside it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, AudioLines, Check, FolderOpen, KeyRound, MessageSquarePlus, Package, Pause, Play, Plus, SquareDashed, X } from 'lucide-react'
import { JobsTray } from '@/components/JobsTray'
import { HistoryButton } from '@/components/HistoryButton'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { useAgent } from '@/lib/agui'
import { cn, mediaUrl, timecode } from '@/lib/utils'
import { AgentPanel } from './AgentPanel'
import { TranscriptPanel } from './TranscriptPanel'
import { TimelineStrip } from './TimelineStrip'
import { ClipEditor } from './ClipEditor'
import { Scrubber } from './Scrubber'
import { Stage, type StageHandle } from './Stage'
import type { Anchor, Box, Project } from '../../../shared/types'

export function ProjectView({ initial, firstPrompt, onHome, onKeys, onTools, ready }: { initial: Project; firstPrompt?: string; onHome(): void; onKeys(): void; onTools(): void; ready: boolean }) {
  const [p, setP] = useState(initial)
  const agent = useAgent(p.dir)
  const stage = useRef<StageHandle>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [anchor, setAnchor] = useState<Anchor | undefined>()
  const [drawing, setDrawing] = useState(false)
  const [compare, setCompare] = useState<'after' | 'before'>('after')
  const [over, setOver] = useState(false)
  const [editing, setEditing] = useState<{ itemId: string; clip: string; start: number } | null>(null)
  const [showTranscript, setShowTranscript] = useState(() => localStorage.getItem('manul.transcript') !== '0')
  useEffect(() => { try { localStorage.setItem('manul.transcript', showTranscript ? '1' : '0') } catch { /* private mode */ } }, [showTranscript])
  const sentFirst = useRef(false)

  useEffect(() => window.manul.project.onChange(np => { if (np.dir === p.dir) setP(np) }), [p.dir])
  useEffect(() => window.manul.onSeek((dir, t) => { if (dir === p.dir && stage.current?.video) stage.current.video.currentTime = t }), [p.dir])
  useEffect(() => { if (p.proposal) setCompare('after') }, [p.proposal])

  const send = useCallback(async (text: string) => {
    const a = anchor
    const still = a ? stage.current?.still(a.box) : undefined
    setAnchor(undefined)
    setDrawing(false)
    await window.manul.agent.send(p.dir, { text, anchor: a, still }).catch(e => alert((e as Error).message))
  }, [anchor, p.dir])

  // the request typed on the start screen goes out once the project is open
  useEffect(() => {
    if (firstPrompt && ready && !sentFirst.current) { sentFirst.current = true; send(firstPrompt) }
  }, [firstPrompt, ready, send])

  const seek = (t: number) => { const v = stage.current?.video; if (v) v.currentTime = t; setTime(t) }
  const noteHere = () => { stage.current?.video?.pause(); setAnchor(a => (a?.t1 != null ? a : { t0: time })); input.current?.focus() }

  // keyboard: Space play/pause · N note · B box · ←/→ ±1 s (⇧ ±5 s) · Esc clears
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input')) return
      const v = stage.current?.video
      if (e.key === ' ') { e.preventDefault(); if (v) v.paused ? v.play() : v.pause() }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); noteHere() }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); v?.pause(); setDrawing(d => !d) }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); setShowTranscript(x => !x) }
      else if (e.key === 'ArrowLeft' && v) seek(Math.max(0, v.currentTime - (e.shiftKey ? 5 : 1)))
      else if (e.key === 'ArrowRight' && v) seek(Math.min(duration, v.currentTime + (e.shiftKey ? 5 : 1)))
      else if (e.key === 'Escape') { setAnchor(undefined); setDrawing(false); setEditing(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const current = p.versions.find(v => v.id === p.current)!
  const proposal = p.proposal ? p.versions.find(v => v.id === p.proposal) : undefined
  const onScreen = proposal && compare === 'after' ? proposal : current
  const decide = async (accept: boolean) => setP(await window.manul.project.decide(p.dir, accept))

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={async e => {
        e.preventDefault(); setOver(false)
        for (const f of Array.from(e.dataTransfer.files)) {
          await window.manul.project.import(p.dir, window.manul.pathForFile(f))
        }
      }}
    >
      {/* title bar */}
      <div className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line pl-20 pr-2">
        <Button className="no-drag" size="iconSm" variant="ghost" onClick={onHome} title="All projects"><ArrowLeft /></Button>
        <span className="truncate font-medium">{p.title}</span>
        <select
          className="no-drag h-7 rounded-md border border-line bg-raised px-1.5 text-xs text-dim outline-none"
          value={p.current}
          onChange={async e => setP(await window.manul.project.setCurrent(p.dir, e.target.value))}
          title="Versions"
        >
          {p.versions.filter(v => v.id !== p.proposal).map((v, i) => <option key={v.id} value={v.id}>v{i + 1} · {v.title}</option>)}
        </select>
        <span className="flex-1" />
        <JobsTray />
        <HistoryButton project={p} onRestored={np => { setP(np); setEditing(null) }} />
        <Button className="no-drag" size="iconSm" variant="ghost" onClick={() => window.manul.project.reveal(p.dir)} title="Show in Finder"><FolderOpen /></Button>
        <Button className="no-drag" size="iconSm" variant="ghost" onClick={onTools} title="Tools"><Package /></Button>
        <Button className="no-drag" size="iconSm" variant="ghost" onClick={onKeys} title="Keys"><KeyRound /></Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {showTranscript && (
          <div className="w-[300px] shrink-0 border-r border-line bg-panel">
            <TranscriptPanel
              project={p}
              media={onScreen.path}
              time={time}
              onSeek={seek}
              onRange={r => { stage.current?.video?.pause(); setAnchor({ ...r, box: anchor?.box }); input.current?.focus() }}
            />
          </div>
        )}
        {/* the film */}
        <div className={cn('flex min-w-0 flex-1 flex-col gap-2 p-3', over && 'bg-amber-soft')}>
          {proposal && (
            <div className="flex items-center gap-2 rounded-lg border border-amber/30 bg-amber-soft px-3 py-1.5">
              <span className="font-medium text-amber">Proposed:</span>
              <span className="truncate">{proposal.title}</span>
              <div className="ml-2 inline-flex rounded-md border border-line bg-bg p-0.5">
                {(['before', 'after'] as const).map(k => (
                  <button key={k} onClick={() => setCompare(k)} className={cn('rounded px-2 py-0.5 text-xs capitalize', compare === k ? 'bg-raised text-fg' : 'text-dim')}>{k}</button>
                ))}
              </div>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => decide(false)}><X />Reject</Button>
              <Button size="sm" variant="primary" onClick={() => decide(true)}><Check />Accept</Button>
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            {editing && p.clips?.[editing.clip] && (
              <ClipEditor
                dir={p.dir}
                clip={p.clips[editing.clip]}
                width={(onScreen.timeline || p.timeline)!.width}
                height={(onScreen.timeline || p.timeline)!.height}
                time={time - editing.start}
                picked={anchor?.clip?.element}
                onPick={el => { setAnchor({ t0: time, clip: { id: editing.clip, element: el } }); input.current?.focus() }}
                onClose={() => setEditing(null)}
              />
            )}
            <Stage
              ref={stage}
              src={mediaUrl(`${p.dir}/${onScreen.path}`)}
              notes={p.notes}
              time={time}
              drawing={drawing}
              box={anchor?.box}
              working={agent.busy}
              onBox={(b: Box) => { setAnchor(a => ({ t0: a?.t0 ?? time, t1: a?.t1, box: b })); setDrawing(false); input.current?.focus() }}
              onTime={setTime}
              onDuration={setDuration}
              onPlaying={setPlaying}
            />
          </div>

          {(onScreen.timeline || p.timeline) && ((onScreen.timeline || p.timeline)!.items.some(i => i.kind === 'clip') || !!(onScreen.timeline || p.timeline)!.overlays?.length) && (
            <TimelineStrip
              dir={p.dir}
              timeline={(onScreen.timeline || p.timeline)!}
              clips={p.clips || {}}
              selected={editing?.itemId}
              onSelect={(it, start) => {
                if (it.kind !== 'clip') return
                stage.current?.video?.pause()
                seek(start + Math.min(it.dur / 2, 1))
                setEditing({ itemId: it.id, clip: it.clip, start })
              }}
              onSelectOverlay={o => {
                stage.current?.video?.pause()
                seek(o.start + Math.min(o.dur / 2, 1))
                setEditing({ itemId: o.id, clip: o.clip, start: o.start })
              }}
            />
          )}
          <Scrubber
            duration={duration}
            time={time}
            notes={p.notes}
            range={anchor}
            onSeek={seek}
            onRange={r => setAnchor(r ? { ...r, box: anchor?.box } : undefined)}
            onNote={n => seek(n.anchor.t0)}
          />

          <div className="flex items-center gap-1">
            <Button size="iconSm" variant="ghost" onClick={() => { const v = stage.current?.video; if (v) v.paused ? v.play() : v.pause() }}>
              {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
            </Button>
            <span className="tabular text-xs text-dim">{timecode(time)} <span className="text-faint">/ {timecode(duration)}</span></span>
            <span className="flex-1" />
            <Tip label={<>Transcript <Kbd>T</Kbd></>}>
              <Button size="sm" variant={showTranscript ? 'secondary' : 'ghost'} onClick={() => setShowTranscript(x => !x)}><AudioLines />Transcript</Button>
            </Tip>
            <Tip label={<>Note at the playhead <Kbd>N</Kbd></>}>
              <Button size="sm" variant="ghost" onClick={noteHere}><MessageSquarePlus />Note</Button>
            </Tip>
            <Tip label={<>Draw a box on the picture <Kbd>B</Kbd></>}>
              <Button size="sm" variant={drawing ? 'secondary' : 'ghost'} onClick={() => { stage.current?.video?.pause(); setDrawing(d => !d) }}><SquareDashed />Box</Button>
            </Tip>
            <Tip label="Add footage, images or audio (or drop files anywhere)">
              <Button size="sm" variant="ghost" onClick={async () => {
                const f = await window.manul.project.pick()
                if (f) await window.manul.project.import(p.dir, f)
              }}><Plus />Media</Button>
            </Tip>
          </div>
        </div>

        {/* the agent */}
        <div className="w-[360px] shrink-0 border-l border-line bg-panel">
          <AgentPanel
            project={p.dir}
            projectInfo={p}
            model={p.model}
            agent={agent}
            anchor={anchor}
            onClearAnchor={() => { setAnchor(undefined); setDrawing(false) }}
            onSend={send}
            onStop={() => window.manul.agent.stop(p.dir)}
            ready={ready}
            onKeys={onKeys}
            inputRef={input}
          />
        </div>
      </div>
    </div>
  )
}
