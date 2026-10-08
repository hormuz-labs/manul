// The panel beside the film: what you have to work with. Transcript (who says what, when), Subtitles (the ones that go
// with the video) and Files (everything added to the project). Collapsed, it is a rail with a button per tab.
import { useState } from 'react'
import { AudioLines, Captions, PanelLeftClose, Paperclip, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Project } from '../../../shared/types'
import { FilesList } from './FilesPanel'
import { SubtitlesView } from './SubtitlesView'
import { TranscriptPanel } from './TranscriptPanel'

export type SideTab = 'transcript' | 'subtitles' | 'files'
const TABS: { id: SideTab; label: string; Icon: typeof AudioLines }[] = [
  { id: 'transcript', label: 'Transcript', Icon: AudioLines },
  { id: 'subtitles', label: 'Subtitles', Icon: Captions },
  { id: 'files', label: 'Files', Icon: Paperclip },
]

type Props = {
  project: Project; media: string; time: number
  open: boolean; tab: SideTab; onTab(t: SideTab): void; onOpen(open: boolean): void
  onSeek(t: number): void; onRange(r: { t0: number; t1: number }): void
  attached: string[]; onAttach(rels: string[]): void; onAdd(): void; onRemoved(rels: string[]): void
}

export function SidePanel({ project, media, time, open, tab, onTab, onOpen, onSeek, onRange, attached, onAttach, onAdd, onRemoved }: Props) {
  const [query, setQuery] = useState('')
  const count = { files: Object.keys(project.files || {}).length, subtitles: Object.values(project.files || {}).filter(f => f.kind === 'subtitles').length }
  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 bg-panel pt-2" aria-label="Side panel">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => { onTab(id); onOpen(true) }} title={`${label}${id === 'transcript' ? ' (T)' : ''}`} aria-label={`Show ${label.toLowerCase()}`}
            className="flex w-9 flex-col items-center gap-2 rounded-md py-2 text-dim hover:bg-hover hover:text-fg">
            <Icon className="size-4" />
            <span className="text-[11px] tracking-wide [writing-mode:vertical-rl]">{label}</span>
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="flex w-[300px] shrink-0 flex-col bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-1 px-2" data-panel-header>
        <div className="flex gap-0.5" role="tablist">
          {TABS.map(({ id, label }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTab(id)}
              className={cn('flex items-center gap-1 rounded-md px-2 py-1 text-xs', tab === id ? 'bg-raised text-fg' : 'text-dim hover:text-fg')}>
              {label}{id !== 'transcript' && count[id] > 0 && <span className="tabular text-faint">{count[id]}</span>}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Button size="iconSm" variant="ghost" onClick={() => onOpen(false)} title="Collapse the side panel (T)" aria-label="Collapse the side panel"><PanelLeftClose /></Button>
      </div>

      {tab === 'transcript' && <TranscriptPanel project={project} media={media} time={time} onSeek={onSeek} onRange={onRange} />}

      {tab === 'subtitles' && (count.subtitles ? (
        <>
          <div className="mx-3 mb-1 flex items-center gap-2 rounded-md bg-raised px-2.5 py-1">
            <Search className="size-3.5 text-faint" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find in subtitles" className="h-6 flex-1 bg-transparent text-xs outline-none placeholder:text-faint" />
          </div>
          <SubtitlesView project={project} media={media} time={time} query={query} onSeek={onSeek} onRange={onRange} />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-dim">No subtitles yet. Add an .srt, .vtt or .ass file to see it line by line beside the video and check it matches what's said.</p>
          <Button size="sm" onClick={onAdd}><Plus />Add subtitles</Button>
        </div>
      ))}

      {tab === 'files' && <FilesList project={project} attached={attached} onAttach={onAttach} onAdd={onAdd} onRemoved={onRemoved} />}
    </div>
  )
}
