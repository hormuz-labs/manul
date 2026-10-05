// The model chip in the agent panel: which model this project uses, and every model the keys unlock.
import { useEffect, useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Image as ImageIcon, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

type Info = Awaited<ReturnType<typeof window.manul.agent.models>>

const k = (n?: number) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`)

export function ModelPicker({ dir, picked }: { dir: string; picked?: { provider: string; modelId: string } }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => { window.manul.agent.models(dir).then(setInfo) }, [dir, picked?.modelId, open])
  const list = useMemo(() => (info?.models || []).filter(m => !q || `${m.name} ${m.providerLabel}`.toLowerCase().includes(q.toLowerCase())), [info, q])
  if (!info?.current) return null
  const cur = info.models.find(m => m.provider === info.current!.provider && m.modelId === info.current!.modelId)
  const choose = async (m: { provider: string; modelId: string } | null) => { await window.manul.agent.setModel(dir, m); setOpen(false); setInfo(await window.manul.agent.models(dir)) }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="inline-flex h-6 max-w-[150px] items-center gap-1 rounded-md px-1.5 text-[11px] text-dim hover:bg-hover hover:text-fg" title="Model for this project">
        <span className="truncate">{cur?.name || info.current.modelId}</span><ChevronDown className="size-3 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-80 rounded-card border border-line bg-panel shadow-2xl shadow-black/50">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search className="size-3.5 text-faint" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a model" className="h-6 flex-1 bg-transparent text-xs outline-none placeholder:text-faint" />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            <button onClick={() => choose(null)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-dim hover:bg-hover hover:text-fg">
              <span className="flex-1">Best available (automatic)</span>{!picked && <Check className="size-3.5 text-amber" />}
            </button>
            {list.map(m => {
              const on = !!picked && picked.provider === m.provider && picked.modelId === m.modelId
              return (
                <button key={`${m.provider}/${m.modelId}`} onClick={() => choose({ provider: m.provider, modelId: m.modelId })}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover', on && 'bg-raised')}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-fg">{m.name}</div>
                    <div className="text-[10.5px] text-faint">{m.providerLabel}{m.context ? ` · ${k(m.context)} context` : ''}{m.price ? ` · $${m.price.input}/$${m.price.output} per M` : ''}</div>
                  </div>
                  {m.images && <ImageIcon className="size-3 text-faint" aria-label="sees images" />}
                  {on && <Check className="size-3.5 text-amber" />}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
