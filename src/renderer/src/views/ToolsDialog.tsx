import { useEffect, useState } from 'react'
import { Check, Download, Loader2, Package, Trash2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { JobRow, useJobs } from '@/components/JobsTray'
import type { OnDemandTool, ToolStatus } from '../../../shared/types'

const mb = (b?: number) => (b == null ? '' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)

export function ToolsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [bundled, setBundled] = useState<ToolStatus[]>([])
  const [tools, setTools] = useState<OnDemandTool[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const jobs = useJobs().filter(j => j.kind === 'install' || j.kind === 'download')
  const refresh = () => { window.manul.tools.bundled().then(setBundled); window.manul.tools.list().then(setTools) }
  useEffect(() => { if (open) refresh() }, [open])

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id); setError(null)
    try { await fn() } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    setBusy(null); refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Tools" description="Manul ships with ffmpeg. Heavier tools download only when you need them, into Manul's own folder.">
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Built in</div>
      <div className="mb-5 space-y-1.5">
        {bundled.map(t => (
          <div key={t.name} className="flex items-center gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2">
            <Package className="size-4 text-dim" />
            <span className="flex-1 font-medium">{t.name}</span>
            <span className="text-xs text-faint">{t.version || 'missing'}</span>
            {t.ok ? <Check className="size-4 text-ok" /> : <span className="text-xs text-bad">not working</span>}
          </div>
        ))}
      </div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Downloaded when needed</div>
      <div className="space-y-1.5">
        {tools.map(t => (
          <div key={t.id} className="rounded-lg border border-line bg-raised/60 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-faint">{t.installed ? `${t.version ?? 'installed'} · ${mb(t.diskBytes)}` : `about ${t.sizeMB} MB`}</div>
              </div>
              {busy === t.id ? <Loader2 className="size-4 animate-spin text-amber" /> : t.installed ? (
                <Button size="sm" variant="ghost" onClick={() => act(t.id, () => window.manul.tools.remove(t.id))}><Trash2 />Remove</Button>
              ) : (
                <Button size="sm" onClick={() => act(t.id, () => window.manul.tools.install(t.id))}><Download />Install</Button>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-dim">{t.description}</p>
          </div>
        ))}
      </div>
      {jobs.length > 0 && <div className="mt-4 space-y-3 rounded-lg border border-line p-3">{jobs.map(j => <JobRow key={j.id} j={j} />)}</div>}
      {error && <p className="mt-3 text-xs text-bad" data-selectable>{error}</p>}
    </Dialog>
  )
}
