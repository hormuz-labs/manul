import { useEffect, useState } from 'react'
import { Check, KeyRound, Sparkles } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { KeyInfo } from '../../../shared/types'

const CAPS: { cap: string; label: string }[] = [
  { cap: 'text', label: 'Editing agent' },
  { cap: 'images', label: 'Image generation' },
  { cap: 'voice', label: 'AI voice' },
]

export function KeysDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  useEffect(() => { if (open) window.manul.keys.list().then(setKeys) }, [open])

  const save = async (env: string, v: string) => {
    setKeys(await window.manul.keys.set(env, v.trim()))
    setEditing(null)
    setValue('')
  }
  const have = new Set(keys.filter(k => k.set).flatMap(k => k.unlocks))

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keys" description="Manul talks to AI models with your keys. They are stored encrypted in your system keychain.">
      <Tabs defaultValue="own">
        <TabsList>
          <TabsTrigger value="own"><KeyRound className="size-3.5" />Your own keys</TabsTrigger>
          <TabsTrigger value="manul"><Sparkles className="size-3.5" />Manul key<span className="rounded bg-amber-soft px-1 text-[10px] text-amber">soon</span></TabsTrigger>
        </TabsList>

        <TabsContent value="own" className="space-y-2">
          {keys.map(k => (
            <div key={k.env} className="rounded-lg border border-line bg-raised/60 p-3">
              <div className="flex items-center gap-3">
                <span className={cn('size-2 rounded-full', k.set ? 'bg-ok' : 'bg-line-strong')} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{k.label}</div>
                  <div className="text-xs text-faint">{k.unlocks.join(' · ')}</div>
                </div>
                {editing !== k.env && (
                  <div className="flex gap-1">
                    {k.set && <Button size="sm" variant="ghost" onClick={() => save(k.env, '')}>Remove</Button>}
                    <Button size="sm" onClick={() => { setEditing(k.env); setValue('') }}>{k.set ? 'Replace' : 'Add'}</Button>
                  </div>
                )}
              </div>
              {editing === k.env && (
                <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (value.trim()) save(k.env, value) }}>
                  <input autoFocus type="password" value={value} onChange={e => setValue(e.target.value)} placeholder={k.hint}
                    className="h-8 flex-1 rounded-lg border border-line bg-bg px-2.5 font-mono text-xs outline-none placeholder:font-sans placeholder:text-faint focus:border-amber/60" />
                  <Button size="md" variant="primary" type="submit">Save</Button>
                  <Button size="md" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              )}
            </div>
          ))}
          <div className="mt-4 rounded-lg border border-dashed border-line p-3">
            <div className="mb-2 text-xs font-medium text-dim">What works with your keys</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {CAPS.map(c => (
                <span key={c.cap} className={cn('inline-flex items-center gap-1 text-xs', have.has(c.cap) ? 'text-fg' : 'text-faint line-through')}>
                  {have.has(c.cap) && <Check className="size-3 text-ok" />}{c.label}
                </span>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="manul">
          <div className="rounded-lg border border-line bg-raised/60 p-5 text-center">
            <div className="orb mx-auto mb-3 size-10 rounded-full" />
            <div className="text-[15px] font-semibold">One key for everything</div>
            <p className="mx-auto mt-1 max-w-sm text-dim">Claude, Gemini, OpenAI and ElevenLabs voices with a single Manul key: no accounts to juggle, pay as you go. Coming in a future update.</p>
          </div>
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}
