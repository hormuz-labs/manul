import { useEffect, useState } from 'react'
import { Check, KeyRound, Loader2, Sparkles } from 'lucide-react'
import { PanelHeader } from '@/components/ui/panel-header'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { AccountStatus, KeyInfo } from '../../../shared/types'
import { ProvidersSection } from './ProvidersSection'

const MANUL = 'MANUL_KEY'

const CAPS: { cap: string; label: string }[] = [
  { cap: 'text', label: 'Editing agent' },
  { cap: 'images', label: 'Image generation' },
  { cap: 'voice', label: 'AI voice' },
]

export function KeysPanel() {
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [customKeyed, setCustomKeyed] = useState(false)
  useEffect(() => { window.manul.keys.list().then(setKeys) }, [])

  const save = async (env: string, v: string) => {
    setKeys(await window.manul.keys.set(env, v.trim()))
    setEditing(null)
    setValue('')
  }
  const have = new Set([...keys.filter(k => k.set).flatMap(k => k.unlocks), ...(customKeyed ? ['text'] : [])])
  const own = keys.filter(k => k.env !== MANUL)
  const manul = keys.find(k => k.env === MANUL)

  return (
    <div>
      <PanelHeader title="Keys" description="Manul talks to AI models with your keys. They are stored encrypted in your system keychain." />
      <Tabs defaultValue={manul?.set ? 'manul' : 'own'} key={manul ? 'ready' : 'loading'}>
        <TabsList>
          <TabsTrigger value="own"><KeyRound className="size-3.5" />Your own keys</TabsTrigger>
          <TabsTrigger value="manul"><Sparkles className="size-3.5" />Manul key{manul?.set && <span className="size-1.5 rounded-full bg-ok" />}</TabsTrigger>
        </TabsList>

        <TabsContent value="own" className="space-y-2">
          {own.map(k => (
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
          <ProvidersSection onKeyed={setCustomKeyed} />
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
          <ManulKey manul={manul} onKeys={setKeys} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

const message = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Manul key: sign in (the browser, then back here with the person's key), or paste a key. */
function ManulKey({ manul, onKeys }: { manul?: KeyInfo; onKeys(k: KeyInfo[]): void }) {
  const [account, setAccount] = useState<AccountStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pasting, setPasting] = useState(false)
  const [value, setValue] = useState('')
  useEffect(() => { window.manul.account.status().then(setAccount) }, [])
  const refresh = async (a?: AccountStatus) => { if (a) setAccount(a); onKeys(await window.manul.keys.list()) }

  const signIn = async () => {
    setBusy(true); setError('')
    try { await refresh(await window.manul.account.signIn()) } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  const signOut = async () => refresh(await window.manul.account.signOut())
  const paste = async () => { onKeys(await window.manul.keys.set(MANUL, value.trim())); setValue(''); setPasting(false) }
  const remove = async () => onKeys(await window.manul.keys.set(MANUL, ''))

  if (!manul || !account) return null
  const row = 'mx-auto mt-4 flex max-w-md items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2'
  return (
    <div className="rounded-lg border border-line bg-raised/60 p-5">
      <div className="text-center">
        <div className="orb mx-auto mb-3 size-10 rounded-full" />
        <div className="text-[15px] font-semibold">One key for everything</div>
        <p className="mx-auto mt-1 max-w-sm text-dim">Manul picks the best model for the job and keeps it current. No vendor accounts to juggle. Your own keys, when set, are used first.</p>
      </div>
      {account.email && manul.set ? (
        <div className={row}>
          <span className="size-2 rounded-full bg-ok" />
          <span className="min-w-0 flex-1 truncate text-[13px]">Signed in as <span className="font-medium">{account.email}</span></span>
          <Button size="sm" variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      ) : manul.set && !pasting ? (
        <div className={row}>
          <span className="size-2 rounded-full bg-ok" />
          <span className="flex-1 text-[13px]">Manul key added</span>
          <Button size="sm" variant="ghost" onClick={remove}>Remove</Button>
          <Button size="sm" onClick={() => setPasting(true)}>Replace</Button>
        </div>
      ) : pasting ? (
        <form className="mx-auto mt-4 flex max-w-md gap-2" onSubmit={e => { e.preventDefault(); if (value.trim()) paste() }}>
          <input autoFocus type="password" value={value} onChange={e => setValue(e.target.value)} placeholder="Paste your Manul key" aria-label="Manul key"
            className="h-8 flex-1 rounded-lg border border-line bg-bg px-2.5 font-mono text-xs outline-none placeholder:font-sans placeholder:text-faint focus:border-amber/60" />
          <Button size="md" variant="primary" type="submit">Save</Button>
          <Button size="md" variant="ghost" type="button" onClick={() => setPasting(false)}>Cancel</Button>
        </form>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-2">
          {busy ? (
            <div className="flex items-center gap-2 text-[13px] text-dim">
              <Loader2 className="size-3.5 animate-spin" />Finish signing in in your browser…
              <Button size="sm" variant="ghost" onClick={() => window.manul.account.cancel()}>Cancel</Button>
            </div>
          ) : (
            <Button size="md" variant="primary" disabled={!account.available} onClick={signIn}>Sign in to Manul</Button>
          )}
          {error && <p className="max-w-sm text-center text-xs text-bad">{error}</p>}
          {!account.available && <p className="text-xs text-faint">Signing in isn’t available in this build.</p>}
          <button className="text-xs text-faint underline-offset-2 hover:text-fg hover:underline" onClick={() => setPasting(true)}>Have a key? Paste it</button>
        </div>
      )}
    </div>
  )
}
