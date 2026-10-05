// Settings: one place for keys, models, skills, memory and tools.
import * as D from '@radix-ui/react-dialog'
import { Brain, KeyRound, Package, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { KeysPanel } from './KeysPanel'
import { MemoryPanel } from './MemoryPanel'
import { ToolsPanel } from './ToolsPanel'

export type Section = 'keys' | 'memory' | 'tools'
const SECTIONS: { id: Section; label: string; icon: ReactNode; panel: () => ReactNode }[] = [
  { id: 'keys', label: 'Keys', icon: <KeyRound />, panel: () => <KeysPanel /> },
  { id: 'memory', label: 'Memory', icon: <Brain />, panel: () => <MemoryPanel /> },
  { id: 'tools', label: 'Tools', icon: <Package />, panel: () => <ToolsPanel /> },
]

export function SettingsDialog({ section, onSection, onClose }: { section: Section | null; onSection(s: Section): void; onClose(): void }) {
  const current = SECTIONS.find(s => s.id === section)
  return (
    <D.Root open={!!section} onOpenChange={o => { if (!o) onClose() }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <D.Content className="fixed left-1/2 top-1/2 z-50 flex h-[640px] max-h-[calc(100vh-48px)] w-[820px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-card border border-line bg-panel shadow-2xl shadow-black/50 focus:outline-none">
          <D.Title className="sr-only">Settings</D.Title>
          <nav className="w-44 shrink-0 space-y-0.5 border-r border-line bg-bg/40 p-2">
            <div className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-faint">Settings</div>
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => onSection(s.id)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left [&_svg]:size-4', section === s.id ? 'bg-raised text-fg' : 'text-dim hover:bg-hover hover:text-fg')}>
                {s.icon}{s.label}
              </button>
            ))}
          </nav>
          <div className="relative flex-1 overflow-y-auto p-5">
            <D.Close className="absolute right-3 top-3 rounded-md p-1 text-faint hover:bg-hover hover:text-fg"><X className="size-4" /></D.Close>
            {current?.panel()}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
