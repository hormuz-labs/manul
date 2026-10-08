// The Screen view: the film, the scrubber with notes, and the agent beside it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Globe, Loader2, Upload, Check, FolderOpen, KeyRound, MessageSquarePlus, Package, Pause, Play, SquareDashed, X } from 'lucide-react'
import { JobsTray } from '@/components/JobsTray'
import { HistoryButton } from '@/components/HistoryButton'
import { useCommands } from '@/lib/commands'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { useAgent } from '@/lib/agui'
import { cn, mediaUrl, timecode } from '@/lib/utils'
import { AgentPanel } from './AgentPanel'
import { BrowserPanel } from './BrowserPanel'
import { SidePanel, type SideTab } from './SidePanel'
import { TimelineStrip } from './TimelineStrip'
import { ClipEditor } from './ClipEditor'
import { ExportDialog } from './ExportDialog'
import { MixPanel } from './MixPanel'
import { DRAG_FILE, dragKind } from './FilesPanel'
import { useLiveMix } from '@/lib/liveMix'
import type { Mix } from '../../../shared/mix'
import { needsProxy } from '../../../shared/proxy'
import { Scrubber } from './Scrubber'
import { Stage, type StageHandle } from './Stage'
import type { Anchor, Box, Project } from '../../../shared/types'

export function ProjectView({ initial, firstPrompt, firstFiles, onHome, onKeys, onTools, ready, active = true, tabbed = false }: { initial: Project; firstPrompt?: string; firstFiles?: string[]; onHome(): void; onKeys(): void; onTools(): void; ready: boolean; active?: boolean; tabbed?: boolean }) {
  const [p, setP] = useState(initial)
  const agent = useAgent(p.dir)
  const stage = useRef<StageHandle>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [anchor, setAnchor] = useState<Anchor | undefined>()
  // files attached to the next message (paths in media/): ones just added, or picked from the Files list
  const [attached, setAttached] = useState<string[]>(firstFiles || [])
  const attach = (rels: string[]) => setAttached(a => [...new Set([...a, ...rels])])
  const [drawing, setDrawing] = useState(false)
  const [compare, setCompare] = useState<'after' | 'before'>('after')
  const [over, setOver] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [regions, setRegions] = useState<[number, number][]>([])
  const [editing, setEditing] = useState<{ itemId: string; clip: string; start: number } | null>(null)
  // the side panel (Transcript · Subtitles · Files): open or a rail, and which tab
  const [showTranscript, setShowTranscript] = useState(() => localStorage.getItem('manul.transcript') !== '0')
  useEffect(() => { try { localStorage.setItem('manul.transcript', showTranscript ? '1' : '0') } catch { /* private mode */ } }, [showTranscript])
  const [side, setSide] = useState<SideTab>(() => (['transcript', 'subtitles', 'files'].includes(localStorage.getItem('manul.side') || '') ? localStorage.getItem('manul.side') as SideTab : 'transcript'))
  useEffect(() => { try { localStorage.setItem('manul.side', side) } catch { /* private mode */ } }, [side])
  const showSide = (tab: SideTab) => { setSide(tab); setShowTranscript(true) }
  const [dropping, setDropping] = useState<string | null>(null)
  const sentFirst = useRef(false)
  const [browsing, setBrowsing] = useState(false)
  // the agent opened or focused a browser window: show it (in the project on screen)
  useEffect(() => window.manul.browser.onReveal(() => { if (active) setBrowsing(true) }), [active])

  useEffect(() => window.manul.project.onChange(np => { if (np.dir === p.dir) setP(np) }), [p.dir])
  useEffect(() => window.manul.onSeek((dir, t) => { if (dir === p.dir && stage.current?.video) stage.current.video.currentTime = t }), [p.dir])
  useEffect(() => { if (p.proposal) setCompare('after') }, [p.proposal])

  const send = useCallback(async (text: string) => {
    const a = anchor
    const still = a ? stage.current?.still(a.box) : undefined
    const files = attached
    setAnchor(undefined)
    setDrawing(false)
    setAttached([])
    await window.manul.agent.send(p.dir, { text, anchor: a, still, files }).catch(e => alert((e as Error).message))
  }, [anchor, attached, p.dir])

  // the request typed on the start screen goes out once the project is open
  useEffect(() => {
    if (firstPrompt && ready && !sentFirst.current) { sentFirst.current = true; send(firstPrompt) }
  }, [firstPrompt, ready, send])

  const seek = (t: number) => { const v = stage.current?.video; if (v) v.currentTime = t; setTime(t) }
  const noteHere = () => { stage.current?.video?.pause(); setAnchor(a => (a?.t1 != null ? a : { t0: time })); input.current?.focus() }

  // keyboard: Space play/pause · N note · B box · ←/→ ±1 s (⇧ ±5 s) · Esc clears
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || (e.target as HTMLElement).closest('textarea, input')) return
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

  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'
  /** Copy files, folders or .zips into the project and attach them to the next message. */
  const addFiles = async (paths: string[]) => {
    for (const f of paths) {
      try { attach(await window.manul.project.import(p.dir, f)) } catch (e) { alert((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    }
  }
  const pickFiles = async () => addFiles(await window.manul.project.pickFiles())
  // a background tab stops playing and leaves the menu, palette and keys to the tab on screen
  useEffect(() => { if (!active) stage.current?.video?.pause() }, [active])
  useCommands(!active ? [] : [
    { id: 'export', title: 'Export…', keywords: 'save render mp4 vertical shorts captions srt', shortcut: `${mod}E`, run: () => setExporting(true) },
    { id: 'media', title: 'Add files…', keywords: 'import media footage image audio music logo subtitles srt vtt font lut folder zip', shortcut: `${mod}I`, run: pickFiles },
    { id: 'reveal', title: 'Show project in Finder', keywords: 'folder files', run: () => window.manul.project.reveal(p.dir) },
    { id: 'transcript', title: 'Show or hide the side panel', keywords: 'transcript words text subtitles files', shortcut: 'T', run: () => setShowTranscript(x => !x) },
    { id: 'side.transcript', title: 'Show the transcript', keywords: 'words speakers', run: () => showSide('transcript') },
    { id: 'side.subtitles', title: 'Show the subtitles', keywords: 'srt vtt captions', run: () => showSide('subtitles') },
    { id: 'side.files', title: 'Show the files', keywords: 'media footage music delete', run: () => showSide('files') },
    { id: 'history', title: 'History', keywords: 'undo restore versions', run: () => setHistoryOpen(true) },
    { id: 'note', title: 'Add a note at the playhead', shortcut: 'N', run: () => noteHere() },
    { id: 'box', title: 'Draw a box on the picture', shortcut: 'B', run: () => { stage.current?.video?.pause(); setDrawing(true) } },
    { id: 'play', title: 'Play or pause', shortcut: 'Space', run: () => { const v = stage.current?.video; if (v) v.paused ? v.play() : v.pause() } },
    { id: 'agent.new', title: 'New conversation', run: () => window.manul.agent.newConversation(p.dir) },
    { id: 'agent.focus', title: 'Ask Manul', shortcut: `${mod}L`, run: () => input.current?.focus() },
    { id: 'agent.stop', title: 'Stop the agent', run: () => window.manul.agent.stop(p.dir) },
    { id: 'browser', title: 'Show or hide the browser', keywords: 'web internet bsk sign in google youtube', shortcut: `${mod}⇧B`, run: () => setBrowsing(x => !x) },
  ], [p.dir, active])

  const current = p.versions.find(v => v.id === p.current)!
  const proposal = p.proposal ? p.versions.find(v => v.id === p.proposal) : undefined
  const onScreen = proposal && compare === 'after' ? proposal : current
  // the live mix starts from the mix the version on screen was rendered with; the player plays its dry film
  const applied: Mix = onScreen.timeline?.mix || { filmDb: 0 }
  const [mix, setMix] = useState<Mix>(applied)
  useEffect(() => { setMix(applied) }, [onScreen.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { window.manul.mix.speech(p.dir, onScreen.id).then(setRegions).catch(() => setRegions([])) }, [p.dir, onScreen.id, p.transcripts])
  useLiveMix(videoEl, p.dir, mix, regions)
  const playable = onScreen.dry || onScreen.path
  const decide = async (accept: boolean) => setP(await window.manul.project.decide(p.dir, accept))
  /** A file dragged from the Files tab: footage goes into the film at t (as a proposal), music under it (heard live,
   *  Apply in Mix keeps it), subtitles with the video on screen. */
  const dropFile = async (rel: string, t?: number) => {
    const kind = p.files?.[rel]?.kind
    try {
      if (kind === 'video' && t != null) await window.manul.timeline.insertMedia(p.dir, onScreen.id, rel, t)
      else if (kind === 'audio') setMix(m => ({ ...m, music: { src: rel, db: m.music?.db ?? -14, duckDb: m.music?.duckDb ?? 10 } }))
      else if (kind === 'subtitles') { await window.manul.subtitles.link(p.dir, onScreen.path, rel); showSide('subtitles') }
    } catch (err) { alert((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={async e => {
        e.preventDefault(); setOver(false)
        await addFiles(Array.from(e.dataTransfer.files).map(f => window.manul.pathForFile(f)).filter(Boolean))
      }}
    >
      <ExportDialog dir={p.dir} open={exporting} onOpenChange={setExporting} />
      {/* title bar */}
      <div className={cn('drag flex h-11 shrink-0 items-center gap-2 bg-bg pr-2', tabbed ? 'pl-2' : 'pl-20')}>
        <Button className="no-drag" size="iconSm" variant="ghost" onClick={onHome} title="All projects"><ArrowLeft /></Button>
        <span className="truncate font-medium" data-project-title={p.title}>{p.title}</span>
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
        <Button className="no-drag" size="sm" variant={browsing ? 'secondary' : 'ghost'} onClick={() => setBrowsing(x => !x)} title="Manul's browser (the agent uses it for the web)"><Globe />Browser</Button>
        <Button className="no-drag" size="sm" variant="primary" onClick={() => setExporting(true)}><Upload />Export</Button>
        <HistoryButton project={p} open={historyOpen} onOpenChange={setHistoryOpen} onRestored={np => { setP(np); setEditing(null) }} />
        <Button className="no-drag" size="iconSm" variant="ghost" onClick={() => window.manul.project.reveal(p.dir)} title="Show in Finder"><FolderOpen /></Button>
        <Button className="no-drag" size="iconSm" variant="ghost" onClick={onTools} title="Tools"><Package /></Button>
        <Button className="no-drag" size="iconSm" variant="ghost" onClick={onKeys} title="Keys"><KeyRound /></Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <SidePanel
          project={p}
          media={onScreen.path}
          time={time}
          open={showTranscript}
          onOpen={setShowTranscript}
          tab={side}
          onTab={setSide}
          onSeek={seek}
          onRange={r => { stage.current?.video?.pause(); setAnchor({ ...r, box: anchor?.box }); input.current?.focus() }}
          attached={attached}
          onAttach={attach}
          onAdd={pickFiles}
          onRemoved={rels => setAttached(a => a.filter(r => !rels.includes(r)))}
        />
        {/* the film */}
        <div
          className={cn('relative flex min-w-0 flex-1 flex-col gap-2 bg-canvas p-3', over && 'bg-amber-soft')}
          // from the Files tab: subtitles go with the video on screen, music under the film (footage goes on the timeline)
          onDragOver={e => { const k = dragKind(e.dataTransfer.types); if (k === 'subtitles' || k === 'audio') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropping(k) } }}
          onDragLeave={e => { if (e.currentTarget === e.target) setDropping(null) }}
          onDrop={e => { const rel = e.dataTransfer.getData(DRAG_FILE); setDropping(null); if (rel) { e.preventDefault(); dropFile(rel) } }}
        >
          {dropping && (
            <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-amber bg-amber-soft text-[13px] font-medium text-amber">
              {dropping === 'subtitles' ? 'Drop: use these subtitles for this video' : 'Drop: make this the film’s music'}
            </div>
          )}
          <BrowserPanel visible={browsing && active} onClose={() => setBrowsing(false)} />
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
            {p.media[onScreen.path] && needsProxy(p.media[onScreen.path]) && !p.proxies?.[onScreen.path] && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/80 text-center text-dim">
                <Loader2 className="size-5 animate-spin text-amber" />
                <span>Making a preview copy for smooth playback…</span>
                <span className="text-xs text-faint">{needsProxy(p.media[onScreen.path]) && (needsProxy(p.media[onScreen.path]) as { why: string }).why} · exports use the original</span>
              </div>
            )}
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
              src={mediaUrl(`${p.dir}/${p.proxies?.[playable] || playable}`)}
              onVideo={setVideoEl}
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
            onDropFile={(rel, t) => dropFile(rel, t)}
            media={{ dir: p.dir, src: onScreen.path, revision: onScreen.createdAt, fps: p.media[onScreen.path]?.fps || 30 }}
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
            <MixPanel project={p} mix={mix} applied={applied} onChange={setMix} />
            <Tip label={<>Note at the playhead <Kbd>N</Kbd></>}>
              <Button size="sm" variant="ghost" onClick={noteHere}><MessageSquarePlus />Note</Button>
            </Tip>
            <Tip label={<>Draw a box on the picture <Kbd>B</Kbd></>}>
              <Button size="sm" variant={drawing ? 'secondary' : 'ghost'} onClick={() => { stage.current?.video?.pause(); setDrawing(d => !d) }}><SquareDashed />Box</Button>
            </Tip>
          </div>
        </div>

        {/* the agent */}
        <div className="w-[360px] shrink-0 bg-panel">
          <AgentPanel
            project={p.dir}
            projectInfo={p}
            model={p.model}
            agent={agent}
            anchor={anchor}
            onClearAnchor={() => { setAnchor(undefined); setDrawing(false) }}
            attached={attached}
            onDetach={rels => setAttached(a => a.filter(r => !rels.includes(r)))}
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
