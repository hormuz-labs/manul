// Naming the voices Manul found: each with a frame and a line from its longest turn, so you can tell who it is, and a
// name field. Two voices with the same name are one person (films often split one actor into several voices). Short
// voices (a laugh, a crowd, a split-off sliver) are tucked away at the bottom.
import * as Popover from '@radix-ui/react-popover'
import { Play, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn, mediaUrl, timecode } from '@/lib/utils'
import { colourOf, longestTurn, nameOf, people, type SpeakerNames, type Speakers } from '../../../shared/speakers'
import type { Transcript } from '../../../shared/types'

export const SPEAKER_COLOURS = ['#f2a541', '#6cb6ff', '#7ee787', '#ff7b72', '#d2a8ff', '#ffa657', '#56d4dd', '#f778ba']
export const speakerColour = (name: string) => SPEAKER_COLOURS[colourOf(name)]

/** What a voice says in its longest turn (from the transcript), for telling voices apart. */
function lineOf(t: Transcript | null, s: number, e: number) {
  const words = t?.segments.flatMap(x => x.words).filter(w => w.s >= s - 0.1 && w.e <= e + 0.1).map(w => w.w) || []
  const line = words.join(' ')
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}

function Voice({ dir, media, sp, id, names, transcript, onSeek, onName }: {
  dir: string; media: string; sp: Speakers; id: string; names: SpeakerNames; transcript: Transcript | null; onSeek(t: number): void; onName(id: string, name: string): void
}) {
  const v = sp.speakers.find(x => x.id === id)!
  const turn = longestTurn(sp, id)
  const [frame, setFrame] = useState<string | null>(null)
  const [draft, setDraft] = useState(names[id] || '')
  useEffect(() => { setDraft(names[id] || '') }, [names, id])
  useEffect(() => {
    if (!turn) return
    const mid = (turn.s + turn.e) / 2
    window.manul.thumbnails(dir, media, 1, mid - 0.05, mid + 0.05).then(f => setFrame(f[0] || null)).catch(() => {})
  }, [dir, media, turn?.s, turn?.e]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = nameOf(id, names)
  const commit = () => { if (draft.trim() !== (names[id] || '')) onName(id, draft.trim()) }
  return (
    <li className="flex gap-2.5 rounded-md px-2 py-2 hover:bg-hover">
      <button className="relative h-[54px] w-24 shrink-0 overflow-hidden rounded bg-raised" onClick={() => turn && onSeek(turn.s)} title="Play this voice's longest turn">
        {frame && <img src={mediaUrl(frame)} alt="" className="size-full object-cover" />}
        <Play className="absolute inset-0 m-auto size-4 fill-white text-white drop-shadow" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={{ background: speakerColour(name) }} />
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } if (e.key === 'Escape') setDraft(names[id] || '') }}
            placeholder={`Speaker ${id}`}
            list="manul-speaker-names"
            aria-label={`Name for speaker ${id}`}
            className="h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-[13px] outline-none placeholder:text-dim hover:border-line focus:border-line-strong focus:bg-bg"
          />
          <span className="shrink-0 text-[10.5px] tabular text-faint" title={`${v.turns} turns`}>{timecode(v.talk, false)}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 pl-3.5 text-xs text-faint">{turn && lineOf(transcript, turn.s, turn.e) || '…'}</p>
      </div>
    </li>
  )
}

export function SpeakersPanel({ dir, media, sp, names, transcript, open, onOpenChange, onSeek }: {
  dir: string; media: string; sp: Speakers; names: SpeakerNames; transcript: Transcript | null
  open: boolean; onOpenChange(o: boolean): void; onSeek(t: number): void
}) {
  const [showShort, setShowShort] = useState(false)
  const everyone = useMemo(() => people(sp, names), [sp, names])
  const voices = [...sp.speakers].sort((a, b) => b.talk - a.talk)
  const main = voices.filter(v => !v.minor && v.talk >= 3), short = voices.filter(v => v.minor || v.talk < 3)
  const known = [...new Set(Object.values(names).map(n => n.trim()).filter(Boolean))].sort()
  const onName = (id: string, name: string) => { window.manul.speakers.name(dir, media, { [id]: name }).catch(e => alert((e as Error).message)) }
  const shown = (list: typeof voices) => list.map(v => <Voice key={v.id} dir={dir} media={media} sp={sp} id={v.id} names={names} transcript={transcript} onSeek={onSeek} onName={onName} />)
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" title="Who speaks: name the voices"><Users />{everyone.length}</Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="right" align="start" sideOffset={8} className="z-50 flex max-h-[75vh] w-[420px] flex-col rounded-card border border-line bg-panel shadow-2xl shadow-black/50">
          <div className="border-b border-line px-4 py-3">
            <div className="text-[13px] font-medium">Speakers <span className="font-normal text-faint">· {everyone.length} {everyone.length === 1 ? 'person' : 'people'}, {sp.speakers.length} voices</span></div>
            <p className="mt-0.5 text-xs text-faint">Name each voice. One person split into several voices? Give them the same name. Click a picture to hear the voice.</p>
          </div>
          <datalist id="manul-speaker-names">{known.map(n => <option key={n} value={n} />)}</datalist>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {shown(main)}
            {short.length > 0 && (
              <li className="px-2 pt-2">
                <button className="text-xs text-dim hover:text-fg" onClick={() => setShowShort(x => !x)}>
                  {showShort ? 'Hide' : 'Show'} {short.length} short voice{short.length === 1 ? '' : 's'} <span className="text-faint">(a few seconds each: a laugh, a crowd, or a sliver of someone above)</span>
                </button>
              </li>
            )}
            {showShort && shown(short)}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** The chip above a transcript sentence where the speaker changes. */
export function SpeakerChip({ id, names, onClick }: { id: string; names: SpeakerNames; onClick(): void }) {
  const name = nameOf(id, names)
  return (
    <button onClick={onClick} className={cn('mb-0.5 ml-11 inline-flex items-center gap-1.5 rounded px-1 text-[11px] font-medium hover:bg-hover', !names[id] && 'text-dim')}
      title="Name this speaker">
      <span className="size-2 rounded-full" style={{ background: speakerColour(name) }} />{name}
    </button>
  )
}
