// Mix: the film's own level, background music, and how far the music dips under speech. Heard live; Apply renders it.
import * as Popover from '@radix-ui/react-popover'
import { Loader2, Music, Plus, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Mix } from '../../../shared/mix'
import type { Project } from '../../../shared/types'

function Slider({ label, value, min, max, step = 1, unit = 'dB', onChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange(v: number): void; disabled?: boolean }) {
  return (
    <label className={cn('block', disabled && 'opacity-40')}>
      <div className="mb-1 flex justify-between text-xs"><span className="text-dim">{label}</span><span className="tabular text-fg">{value > 0 ? '+' : ''}{value} {unit}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} className="w-full accent-amber" />
    </label>
  )
}

export function MixPanel({ project, mix, applied, onChange }: { project: Project; mix: Mix; applied: Mix; onChange(m: Mix): void }) {
  const [busy, setBusy] = useState(false)
  // music the user added (an MP3's cover art doesn't make it a video), or any sound-only file the project knows
  const audioFiles = [...new Set([...Object.entries(project.files || {}).filter(([, f]) => f.kind === 'audio').map(([k]) => k),
    ...Object.entries(project.media).filter(([, i]) => i.hasAudio && !i.width).map(([k]) => k)])]
  const changed = JSON.stringify(mix) !== JSON.stringify(applied)
  const addMusic = async () => {
    const [f] = await window.manul.project.pickFiles()
    if (!f) return
    const [rel] = await window.manul.project.import(project.dir, f)
    if (!rel) return
    onChange({ ...mix, music: { src: rel, db: mix.music?.db ?? -14, duckDb: mix.music?.duckDb ?? 10 } })
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm" variant={changed ? 'secondary' : 'ghost'}><SlidersHorizontal />Mix{changed && <span className="size-1.5 rounded-full bg-amber" />}</Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" sideOffset={8} className="z-50 w-80 space-y-4 rounded-card border border-line bg-panel p-4 shadow-2xl shadow-black/50">
          <div className="text-[13px] font-medium">Mix <span className="text-xs font-normal text-faint">· changes play live</span></div>
          <Slider label="Film audio" value={mix.filmDb} min={-24} max={12} onChange={v => onChange({ ...mix, filmDb: v })} />
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-xs text-dim"><Music className="size-3.5" />Music</div>
            <div className="flex gap-1.5">
              <select value={mix.music?.src || ''} onChange={e => onChange({ ...mix, music: e.target.value ? { src: e.target.value, db: mix.music?.db ?? -14, duckDb: mix.music?.duckDb ?? 10 } : undefined })}
                className="h-7 min-w-0 flex-1 rounded-md border border-line bg-bg px-1.5 text-xs outline-none">
                <option value="">None</option>
                {audioFiles.map(f => <option key={f} value={f}>{f.split('/').pop()}</option>)}
              </select>
              <Button size="sm" variant="ghost" onClick={addMusic} title="Add a music file"><Plus /></Button>
            </div>
          </div>
          <Slider label="Music level" value={mix.music?.db ?? -14} min={-40} max={0} disabled={!mix.music} onChange={v => mix.music && onChange({ ...mix, music: { ...mix.music, db: v } })} />
          <Slider label="Dip under speech" value={mix.music?.duckDb ?? 10} min={0} max={24} disabled={!mix.music} onChange={v => mix.music && onChange({ ...mix, music: { ...mix.music, duckDb: v } })} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" disabled={!changed || busy} onClick={() => onChange(applied)}>Reset</Button>
            <Button size="sm" variant="primary" disabled={!changed || busy} onClick={async () => { setBusy(true); try { await window.manul.mix.apply(project.dir, mix) } finally { setBusy(false) } }}>
              {busy && <Loader2 className="animate-spin" />}Apply
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
