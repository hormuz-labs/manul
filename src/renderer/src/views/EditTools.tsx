// The timeline's tools for editing by hand: split at the playhead, delete (the selected range, or the selected piece),
// undo and redo, and the selected piece's volume. On the right, while the edit isn't rendered: saying so, and saving
// it as a version (exporting does that too).
import * as Popover from '@radix-ui/react-popover'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, Redo2, Save, Scissors, Trash2, Undo2, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { MediaItem } from '../../../shared/timeline'

function Tool({ label, kbd, disabled, onClick, children }: { label: string; kbd?: string; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <Tip label={<span className="flex items-center gap-1.5">{label}{kbd && <Kbd>{kbd}</Kbd>}</span>}>
      <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
        className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-dim hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5">
        {children}
      </button>
    </Tip>
  )
}

/** The selected piece's loudness: a slider (saved when let go), mute, reset. */
function Level({ piece, disabled, onLevel }: { piece: MediaItem; disabled: boolean; onLevel(l: { db?: number; muted?: boolean }): void }) {
  const [db, setDb] = useState(piece.db || 0)
  useEffect(() => { setDb(piece.db || 0) }, [piece.id, piece.db])
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef({ piece, onLevel })
  latest.current = { piece, onLevel }
  // the range's change event comes when it is let go (or set by keys): one edit, not one per pixel
  useEffect(() => {
    const el = input.current
    if (!el) return
    const done = () => { const v = Number(el.value); if (v !== (latest.current.piece.db || 0)) latest.current.onLevel({ db: v }) }
    el.addEventListener('change', done)
    return () => el.removeEventListener('change', done)
  })
  return (
    <Popover.Root>
      <Tip label="Volume of the selected piece">
        <Popover.Trigger asChild>
          <button type="button" aria-label="Volume of the selected piece" disabled={disabled}
            className={cn('flex h-6 items-center gap-1 rounded px-1.5 text-[11px] hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5', piece.muted || piece.db ? 'text-amber' : 'text-dim')}>
            {piece.muted ? <VolumeX /> : <Volume2 />}{piece.muted ? 'Muted' : piece.db ? `${piece.db > 0 ? '+' : ''}${piece.db} dB` : 'Volume'}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} className="z-50 w-64 space-y-3 rounded-card border border-line bg-panel p-3.5 shadow-2xl shadow-black/50">
          <div className="text-[13px] font-medium">Volume <span className="text-xs font-normal text-faint">· this piece</span></div>
          <label className={cn('block', piece.muted && 'opacity-40')}>
            <div className="mb-1 flex justify-between text-xs"><span className="text-dim">Louder or quieter</span><span className="tabular text-fg">{db > 0 ? '+' : ''}{db} dB</span></div>
            <input ref={input} type="range" min={-40} max={12} step={1} value={db} disabled={piece.muted} onChange={e => setDb(Number(e.target.value))} className="w-full accent-amber" aria-label="Volume in dB" />
          </label>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" disabled={!piece.db} onClick={() => { setDb(0); onLevel({ db: 0 }) }}>Reset</Button>
            <Button size="sm" variant="secondary" onClick={() => onLevel({ muted: !piece.muted })}>{piece.muted ? <Volume2 /> : <VolumeX />}{piece.muted ? 'Unmute' : 'Mute'}</Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

type Props = {
  editable: boolean
  /** what Delete would do: cut the selected range, delete the selected piece, or nothing */
  deletes: 'range' | 'piece' | null
  undo: { back: number; forward: number }
  /** the selected piece, when it is footage (it has a volume) */
  piece?: MediaItem
  onSplit(): void
  onDelete(): void
  onUndo(): void
  onRedo(): void
  onLevel(l: { db?: number; muted?: boolean }): void
}

const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'

export function EditTools({ editable, deletes, undo, piece, onSplit, onDelete, onUndo, onRedo, onLevel }: Props) {
  return (
    <div className="flex items-center gap-0.5" role="toolbar" aria-label="Edit the timeline">
      <Tool label="Split at the playhead" kbd={`${mod}B`} disabled={!editable} onClick={onSplit}><Scissors />Split</Tool>
      <Tool label={deletes === 'range' ? 'Cut the selected range out' : 'Delete the selected piece'} kbd="⌫" disabled={!editable || !deletes} onClick={onDelete}><Trash2 />{deletes === 'range' ? 'Cut range' : 'Delete'}</Tool>
      {piece && <Level piece={piece} disabled={!editable} onLevel={onLevel} />}
      <span className="mx-1 h-4 w-px bg-line" />
      <Tool label="Undo" kbd={`${mod}Z`} disabled={!editable || !undo.back} onClick={onUndo}><Undo2 /></Tool>
      <Tool label="Redo" kbd={`⇧${mod}Z`} disabled={!editable || !undo.forward} onClick={onRedo}><Redo2 /></Tool>
    </div>
  )
}

/** Said while the edit isn't rendered: it plays from its pieces; saving makes it a version. */
export function EditStatus({ saving, onSave }: { saving: boolean; onSave(): void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Tip label="Your edit plays straight from its pieces. Save it as a version to render it (Export renders it too).">
        <span className="flex items-center gap-1.5 text-[11px] text-amber" data-edited><span className="size-1.5 rounded-full bg-amber" />Edited</span>
      </Tip>
      <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" disabled={saving} onClick={onSave}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save as version</Button>
    </div>
  )
}
