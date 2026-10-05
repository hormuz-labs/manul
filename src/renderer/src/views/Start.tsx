import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Film, KeyRound, Loader2, Package, X } from 'lucide-react'
import { JobsTray } from '@/components/JobsTray'
import { Button } from '@/components/ui/button'
import { cn, mediaUrl } from '@/lib/utils'
import type { Project, RecentProject } from '../../../shared/types'

const IDEAS = ['Cut the ums and long pauses', 'Make a 60-second vertical for Shorts', 'Add a fade in and fade out', 'Trim to the best 30 seconds']

export function Start({ onOpen, onKeys, onTools, ready }: { onOpen: (p: Project, prompt?: string) => void; onKeys: () => void; onTools: () => void; ready: boolean }) {
  const [file, setFile] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentProject[]>([])
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { window.manul.project.recent().then(setRecent) }, [])

  const choose = (path: string) => { setFile(path); setError(null); setTimeout(() => input.current?.focus(), 0) }
  const go = async () => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      onOpen(await window.manul.project.create(file), prompt.trim() || undefined)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) choose(window.manul.pathForFile(f)) }}
    >
      <div className="drag flex h-11 shrink-0 items-center justify-end gap-1 px-3">
        <JobsTray />
        <Button className="no-drag" size="sm" variant="ghost" onClick={onTools}><Package />Tools</Button>
        <Button className="no-drag" size="sm" variant="ghost" onClick={onKeys}><KeyRound />Keys</Button>
      </div>

      <div className="flex flex-1 flex-col items-center overflow-auto px-6 pb-16 pt-[12vh]">
        <img src="./manul.svg" alt="" className="mb-4 size-16 drop-shadow-[0_8px_24px_rgba(242,165,65,0.18)]" draggable={false} />
        <h1 className="mb-1 text-[28px] font-semibold tracking-tight">What are we making?</h1>
        <p className="mb-8 text-dim">Drop a video, say what you want. Manul does the edit.</p>

        <div className={cn('w-full max-w-[640px] rounded-2xl border bg-panel p-2 transition-colors', over ? 'border-amber bg-amber-soft' : 'border-line')}>
          {file ? (
            <div className="mb-1 flex items-center gap-2 rounded-xl bg-raised px-3 py-2">
              <Film className="size-4 text-amber" />
              <span className="flex-1 truncate" title={file}>{file.split('/').pop()}</span>
              <button className="rounded p-0.5 text-faint hover:text-fg" onClick={() => setFile(null)}><X className="size-3.5" /></button>
            </div>
          ) : (
            <button
              onClick={async () => { const f = await window.manul.project.pick(); if (f) choose(f) }}
              className="mb-1 flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong py-8 text-dim transition-colors hover:border-amber/60 hover:text-fg"
            >
              <Film className="mb-1 size-6" />
              <span className="font-medium text-fg">Drop a video here</span>
              <span className="text-xs">or click to choose · mp4, mov, webm, mkv</span>
            </button>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={input}
              rows={2}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } }}
              placeholder="Tell Manul what to do with it…"
              className="max-h-40 min-h-[52px] flex-1 resize-none bg-transparent px-2 py-2 text-[14px] outline-none placeholder:text-faint"
            />
            <Button size="icon" variant="primary" className="mb-1 rounded-full" disabled={!file || busy} onClick={go}>
              {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </div>

        {error && <p className="mt-3 text-bad">{error}</p>}
        {!ready && (
          <button onClick={onKeys} className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber hover:underline">
            <KeyRound className="size-3.5" />Add an API key so Manul can edit (Gemini, Anthropic or OpenAI)
          </button>
        )}

        <div className="mt-4 flex max-w-[640px] flex-wrap justify-center gap-2">
          {IDEAS.map(i => (
            <button key={i} onClick={() => { setPrompt(i); input.current?.focus() }} className="rounded-full border border-line px-3 py-1 text-xs text-dim hover:border-line-strong hover:text-fg">{i}</button>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="mt-16 w-full max-w-[880px]">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-faint">Recent</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {recent.map(r => (
                <button key={r.dir} onClick={async () => onOpen(await window.manul.project.open(r.dir))} className="group overflow-hidden rounded-card border border-line bg-panel text-left hover:border-line-strong">
                  <div className="aspect-video bg-raised">
                    {r.thumb && <img src={mediaUrl(r.thumb)} className="size-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />}
                  </div>
                  <div className="truncate px-3 py-2 font-medium">{r.title}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
