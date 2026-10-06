// Open projects as tabs at the top of the window. The agent keeps working in background tabs (spinner).
import { useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useAgent } from '@/lib/agui'
import { cn } from '@/lib/utils'

type Props = { open: string[]; active: string | null; titles: Record<string, string>; onSelect(d: string | null): void; onClose(d: string): void; onMove(d: string, to: number): void }

function Tab({ dir, title, active, onSelect, onClose, onDrop }: { dir: string; title: string; active: boolean; onSelect(): void; onClose(): void; onDrop(from: string): void }) {
  const busy = useAgent(dir).busy
  const [over, setOver] = useState(false)
  return (
    <div
      draggable
      onDragStart={e => e.dataTransfer.setData('manul/tab', dir)}
      onDragOver={e => { if (e.dataTransfer.types.includes('manul/tab')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { setOver(false); const from = e.dataTransfer.getData('manul/tab'); if (from && from !== dir) onDrop(from) }}
      onMouseDown={e => { if (e.button === 1) { e.preventDefault(); onClose() } }}
      onClick={onSelect}
      title={dir}
      className={cn('no-drag group flex h-7 min-w-0 max-w-[200px] shrink cursor-default items-center gap-1.5 rounded-md px-2.5 text-xs',
        active ? 'bg-raised text-fg' : 'text-dim hover:bg-hover hover:text-fg', over && 'ring-1 ring-amber/60')}>
      {busy ? <Loader2 className="size-3 shrink-0 animate-spin text-amber" /> : <span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-amber' : 'bg-line-strong')} />}
      <span className="truncate">{title}</span>
      <button onClick={e => { e.stopPropagation(); onClose() }} className="ml-0.5 rounded text-faint opacity-0 hover:text-fg group-hover:opacity-100" title="Close tab"><X className="size-3" /></button>
    </div>
  )
}

export function TabBar({ open, active, titles, onSelect, onClose, onMove }: Props) {
  return (
    <div className="drag flex h-10 shrink-0 items-center gap-1 bg-bg pl-20 pr-2">
      {open.map((d, i) => (
        <Tab key={d} dir={d} title={titles[d] || d.split('/').pop()!} active={d === active} onSelect={() => onSelect(d)} onClose={() => onClose(d)} onDrop={from => onMove(from, i)} />
      ))}
      <button onClick={() => onSelect(null)} title="New project"
        className={cn('no-drag flex size-7 shrink-0 items-center justify-center rounded-md', active === null ? 'bg-raised text-fg' : 'text-dim hover:bg-hover hover:text-fg')}>
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}
