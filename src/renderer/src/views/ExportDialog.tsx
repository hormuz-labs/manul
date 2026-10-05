// Export the film: size, how other shapes are filled, captions. Progress shows in the jobs tray.
import { useState } from 'react'
import { Check, FolderOpen, Loader2, Upload } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PRESETS, type PresetId } from '../../../shared/export'

export function ExportDialog({ dir, open, onOpenChange }: { dir: string; open: boolean; onOpenChange(v: boolean): void }) {
  const [preset, setPreset] = useState<PresetId>('original')
  const [fit, setFit] = useState<'pad' | 'crop'>('pad')
  const [captions, setCaptions] = useState<'none' | 'burn' | 'srt'>('none')
  const [state, setState] = useState<'idle' | 'busy' | { file: string } | { error: string }>('idle')
  const go = async () => {
    setState('busy')
    try {
      const r = await window.manul.export.run(dir, { preset, fit, captions })
      setState(r ? { file: r.file } : 'idle')
    } catch (e) { setState({ error: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 300) }) }
  }
  const choice = (on: boolean) => cn('rounded-lg border px-3 py-2 text-left transition-colors', on ? 'border-amber bg-amber-soft' : 'border-line bg-raised/60 hover:border-line-strong')
  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) setState('idle') }} title="Export" description="A finished MP4 of the version on screen.">
      <div className="mb-4 grid grid-cols-2 gap-2">
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => setPreset(p.id)} className={choice(preset === p.id)}>
            <div className="font-medium">{p.label}</div><div className="text-xs text-dim">{p.hint}</div>
          </button>
        ))}
      </div>
      {preset !== 'original' && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs text-dim">When the shape differs</div>
          <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
            {([['pad', 'Blurred fill'], ['crop', 'Crop to fill']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFit(k)} className={cn('rounded-md px-3 py-1 text-xs', fit === k ? 'bg-raised text-fg' : 'text-dim')}>{l}</button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-5">
        <div className="mb-1.5 text-xs text-dim">Captions (from the transcript)</div>
        <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
          {([['none', 'None'], ['burn', 'In the picture'], ['srt', 'Separate .srt']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setCaptions(k)} className={cn('rounded-md px-3 py-1 text-xs', captions === k ? 'bg-raised text-fg' : 'text-dim')}>{l}</button>
          ))}
        </div>
      </div>
      {typeof state === 'object' && 'file' in state && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-xs">
          <Check className="size-3.5 text-ok" /><span className="flex-1 truncate" data-selectable>{state.file}</span>
          <Button size="sm" variant="ghost" onClick={() => window.manul.export.reveal(state.file)}><FolderOpen />Show</Button>
        </div>
      )}
      {typeof state === 'object' && 'error' in state && <p className="mb-3 text-xs text-bad" data-selectable>{state.error}</p>}
      <div className="flex justify-end">
        <Button variant="primary" onClick={go} disabled={state === 'busy'}>{state === 'busy' ? <Loader2 className="animate-spin" /> : <Upload />}Export</Button>
      </div>
    </Dialog>
  )
}
