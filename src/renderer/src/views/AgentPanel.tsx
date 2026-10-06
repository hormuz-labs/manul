// The agent panel: not a chat log. The user's requests, the agent's short replies, one card per tool call
// (rendered by tool), question cards, and the input, anchored to whatever is selected on the film.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Message } from '@ag-ui/core'
import { ArrowUp, AudioLines, Check, Sparkles, Clapperboard, Crosshair, Eye, FileSearch, Loader2, MessageSquareText, Square, Terminal, TriangleAlert, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { resultsOf, type AgentState } from '@/lib/agui'
import { ConsentCard, useConsents } from '@/components/ConsentStack'
import { ModelPicker } from '@/components/ModelPicker'
import { Conversations } from '@/components/Conversations'
import type { Project } from '../../../shared/types'
import { cn, timecode } from '@/lib/utils'
import type { Anchor } from '../../../shared/types'

type Call = { id: string; name: string; args: Record<string, any> }

const parse = (s: string) => { try { return JSON.parse(s) } catch { return {} } }

// ---------------------------------------------------------------- tool cards: one renderer per tool, a generic fallback
const TOOL: Record<string, { icon: ReactNode; title: (a: Record<string, any>) => string; body?: (a: Record<string, any>) => ReactNode }> = {
  project_state: { icon: <Eye />, title: () => 'Looked at the project' },
  probe: { icon: <FileSearch />, title: a => `Read ${String(a.path || '').split('/').pop() || 'a file'}` },
  ffmpeg: {
    icon: <Clapperboard />,
    title: a => { const out = (a.args || []).at(-1); return out ? `Rendering ${String(out).split('/').pop()}` : 'Running ffmpeg' },
    body: a => <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] text-faint" data-selectable>ffmpeg {(a.args || []).join(' ')}</code>,
  },
  propose_version: { icon: <Check />, title: a => `Proposed “${a.title || 'a new cut'}”` },
  resolve_note: { icon: <MessageSquareText />, title: a => a.reply ? `Note: ${a.reply}` : 'Resolved a note' },
  create_clip: { icon: <Sparkles />, title: a => `Made clip “${a.title || a.id}”` },
  render_clip: { icon: <Sparkles />, title: a => `Re-rendered clip ${a.id}` },
  insert_clip: { icon: <Sparkles />, title: a => `Inserted ${a.id} at ${timecode(a.at || 0)}` },
  rerender_timeline: { icon: <Clapperboard />, title: () => 'Rendered the film' },
  transcript: { icon: <AudioLines />, title: a => a.search ? `Searched the transcript for “${a.search}”` : 'Read the transcript' },
  seek: { icon: <Crosshair />, title: a => `Showed you ${timecode(a.t || 0)}` },
  bash: { icon: <Terminal />, title: a => `$ ${String(a.command || '').split('\n')[0].slice(0, 60)}` },
  read: { icon: <FileSearch />, title: a => `Read ${String(a.path || '').split('/').pop()}` },
  write: { icon: <Wrench />, title: a => `Wrote ${String(a.path || '').split('/').pop()}` },
  edit: { icon: <Wrench />, title: a => `Edited ${String(a.path || '').split('/').pop()}` },
}

function ToolCard({ call, state, result }: { call: Call; state: 'streaming' | 'running' | 'done' | 'error'; result?: string }) {
  const t = TOOL[call.name] || { icon: <Wrench />, title: () => call.name.replace(/_/g, ' ') }
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('rounded-lg bg-raised/70 text-xs', state === 'running' || state === 'streaming' ? 'beam' : state === 'error' && 'ring-1 ring-bad/40')}>
      <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => setOpen(!open)}>
        <span className={cn('[&_svg]:size-3.5', state === 'error' ? 'text-bad' : 'text-dim')}>{state === 'running' || state === 'streaming' ? <Loader2 className="size-3.5 animate-spin text-amber" /> : t.icon}</span>
        <span className="flex-1 truncate text-fg/90">{t.title(call.args)}</span>
        {state === 'error' && <TriangleAlert className="size-3.5 text-bad" />}
      </button>
      {(t.body || (open && result)) && (
        <div className="space-y-1.5 px-2.5 pb-2">
          {t.body?.(call.args)}
          {open && result && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] text-faint" data-selectable>{result}</pre>}
        </div>
      )}
    </div>
  )
}

function AskCard({ call, answered, onAnswer }: { call: Call; answered: boolean; onAnswer: (s: string) => void }) {
  return (
    <div className="rounded-lg border border-amber/30 bg-amber-soft p-3">
      <div className="mb-2 font-medium">{call.args.question}</div>
      <div className="flex flex-wrap gap-1.5">
        {(call.args.options || []).map((o: { label: string; description?: string }) => (
          <Button key={o.label} size="sm" variant={answered ? 'ghost' : 'secondary'} disabled={answered} title={o.description} onClick={() => onAnswer(o.label)}>{o.label}</Button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the panel
const NOTE = /^\[note \S+ ([^\]]*)\] /
const EDITOR = /^\[editor\] /

function Item({ m, results, busy, onAnswer, laterUser }: { m: Message; results: ReturnType<typeof resultsOf>; busy: boolean; onAnswer: (s: string) => void; laterUser: boolean }) {
  if (m.role === 'user') {
    const text = String(m.content ?? '')
    if (EDITOR.test(text)) return <div className="text-center text-[11px] text-faint">{text.replace(EDITOR, '')}</div>
    const note = NOTE.exec(text)
    return (
      <div className="ml-6 rounded-xl bg-raised px-3 py-2" data-selectable>
        {note && <div className="mb-1 inline-flex items-center gap-1 rounded bg-note/15 px-1.5 py-0.5 text-[10.5px] text-note"><MessageSquareText className="size-3" />{note[1].replace(/^@ /, '').replace(/, box [\d.,]+/, ' · box').replace(/, clip (\S+) element (\S+)/, ' · $1 · $2')}</div>}
        <div className="whitespace-pre-wrap">{text.replace(NOTE, '')}</div>
      </div>
    )
  }
  if (m.role === 'assistant') {
    return (
      <div className="space-y-1.5">
        {m.toolCalls?.map(c => {
          const call = { id: c.id, name: c.function.name, args: parse(c.function.arguments) }
          if (call.name === 'ask_user') return <AskCard key={c.id} call={call} answered={laterUser} onAnswer={onAnswer} />
          const r = results[c.id]
          return <ToolCard key={c.id} call={call} result={r?.content} state={r ? (r.error ? 'error' : 'done') : busy ? 'running' : 'error'} />
        })}
        {m.content && <div className="whitespace-pre-wrap leading-relaxed text-fg/95" data-selectable>{m.content}</div>}
      </div>
    )
  }
  return null
}

export function AgentPanel({ project, projectInfo, model, agent, anchor, onClearAnchor, onSend, onStop, ready, onKeys, inputRef }: {
  project: string
  projectInfo: Project
  model?: { provider: string; modelId: string }
  agent: AgentState
  anchor?: Anchor
  onClearAnchor(): void
  onSend(text: string): void
  onStop(): void
  ready: boolean
  onKeys(): void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [text, setText] = useState('')
  const consents = useConsents().filter(c => c.project === project)
  const scroller = useRef<HTMLDivElement>(null)
  const results = resultsOf(agent.messages)
  const shown = agent.messages.filter(m => m.role === 'user' || m.role === 'assistant')

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [agent.messages.length, agent.streaming?.text.length, Object.keys(agent.pending).length, consents.length])

  const submit = () => { const t = text.trim(); if (!t) return; onSend(t); setText('') }
  const anchorLabel = anchor && (anchor.clip?.element ? `${anchor.clip.id} · ${anchor.clip.element}`
    : `${timecode(anchor.t0)}${anchor.t1 != null ? `–${timecode(anchor.t1)}` : ''}${anchor.box ? ' · box' : ''}`)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3" data-panel-header>
        <div className={cn('size-3 rounded-full', agent.busy ? 'orb' : 'bg-line-strong')} />
        {agent.busy ? <span className="font-medium">Working…</span> : <Conversations project={projectInfo} />}
        <span className="flex-1" />
        {ready && <ModelPicker dir={project} picked={model} />}
        {agent.cost > 0 && <span className="text-[11px] text-faint tabular" title="Spent on AI in this project">${agent.cost.toFixed(agent.cost < 1 ? 3 : 2)}</span>}
      </div>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {shown.length === 0 && !agent.busy && (
          <div className="mt-8 space-y-3 px-2 text-center text-dim">
            <p>Tell Manul what to change.</p>
            <div className="space-y-1.5 text-left text-xs text-faint">
              <p><Kbd>N</Kbd> note at the playhead · drag the scrubber for a range</p>
              <p><Kbd>B</Kbd> draw a box on the picture</p>
              <p><Kbd>Space</Kbd> play / pause</p>
            </div>
          </div>
        )}
        {shown.map((m, i) => <Item key={m.id} m={m} results={results} busy={agent.busy} onAnswer={onSend} laterUser={shown.slice(i + 1).some(x => x.role === 'user')} />)}
        {Object.entries(agent.pending).map(([id, p]) => <ToolCard key={id} call={{ id, name: p.name, args: parse(p.args) }} state="streaming" />)}
        {agent.streaming?.text && <div className="whitespace-pre-wrap leading-relaxed text-fg/95">{agent.streaming.text}</div>}
        {consents.map(c => <ConsentCard key={c.id} c={c} />)}
        {agent.error && (
          <div className="flex gap-2 rounded-lg border border-bad/30 bg-bad/10 p-2.5 text-xs text-bad"><TriangleAlert className="mt-px size-3.5 shrink-0" /><span data-selectable>{agent.error}</span></div>
        )}
      </div>

      <div className="p-2">
        {!ready ? (
          <button onClick={onKeys} className="w-full rounded-xl border border-dashed border-amber/50 px-3 py-3 text-amber hover:bg-amber-soft">Add an API key to start editing</button>
        ) : (
          <div className={cn('rounded-xl bg-raised ring-1 focus-within:ring-line-strong', anchor ? 'ring-amber/40' : 'ring-transparent')}>
            {anchor && (
              <div className="flex items-center gap-1.5 px-2.5 pt-2">
                <span className="inline-flex items-center gap-1 rounded bg-amber-soft px-1.5 py-0.5 text-[11px] text-amber"><MessageSquareText className="size-3" />Note at {anchorLabel}</span>
                <button className="text-faint hover:text-fg" onClick={onClearAnchor}><X className="size-3" /></button>
              </div>
            )}
            <div className="flex items-end gap-1.5 p-1.5">
              <textarea
                ref={inputRef}
                rows={1}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
                  if (e.key === 'Escape') { (e.target as HTMLTextAreaElement).blur(); onClearAnchor() }
                }}
                placeholder={anchor ? 'What should change here?' : agent.busy ? 'Steer the edit…' : 'Ask for an edit…'}
                className="max-h-36 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 outline-none placeholder:text-faint [field-sizing:content]"
              />
              {agent.busy && !text ? (
                <Button size="iconSm" variant="secondary" className="rounded-full" onClick={onStop} title="Stop"><Square className="size-3 fill-current" /></Button>
              ) : (
                <Button size="iconSm" variant="primary" className="rounded-full" disabled={!text.trim()} onClick={submit}><ArrowUp /></Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
