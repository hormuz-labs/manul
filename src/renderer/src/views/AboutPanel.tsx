import { useEffect, useState } from 'react'
import { FileText, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type St = Awaited<ReturnType<typeof window.manul.updates.state>>

export function AboutPanel() {
  const [info, setInfo] = useState<{ version: string; platform: string } | null>(null)
  const [st, setSt] = useState<St>()
  const [telemetry, setTelemetry] = useState<{ enabled: boolean; available: boolean } | null>(null)
  useEffect(() => { window.manul.info().then(setInfo); window.manul.updates.state().then(setSt); window.manul.telemetry.state().then(setTelemetry); return window.manul.updates.onChange(setSt) }, [])
  const line = !st ? '' : st.mode === 'off' ? `Updates are off (${st.why}).` : st.mode === 'package-manager' ? `Updates come from your package manager (${st.why?.replace(/^installed with apt: /, '')}).`
    : st.status === 'checking' ? 'Checking for updates…' : st.status === 'downloading' ? `Downloading ${st.version ?? 'an update'}… ${Math.round((st.progress || 0) * 100)}%`
    : st.status === 'ready' ? `Manul ${st.version} is ready.` : st.status === 'none' ? 'Manul is up to date.' : st.status === 'error' ? `Couldn't check: ${st.error}` : 'Manul checks for updates in the background.'
  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <img src="./manul.svg" className="size-16" alt="" />
        <div>
          <div className="text-[18px] font-semibold">Manul</div>
          <div className="text-dim">Version {info?.version} · {info?.platform === 'darwin' ? 'macOS' : info?.platform}</div>
          <div className="text-xs text-faint">An agentic video editor, named after the Pallas cat.</div>
        </div>
      </div>
      <div className="mb-3 rounded-lg border border-line bg-raised/60 p-3">
        <div className="mb-2 font-medium">Updates</div>
        <p className="mb-3 text-xs text-dim">{line}</p>
        <div className="flex gap-1.5">
          {st?.mode === 'self' && st.status !== 'ready' && <Button size="sm" onClick={async () => setSt(await window.manul.updates.check())} disabled={st.status === 'checking' || st.status === 'downloading'}>
            {st.status === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />}Check now</Button>}
          {st?.status === 'ready' && <Button size="sm" variant="primary" onClick={() => window.manul.updates.install()}>Restart to update</Button>}
        </div>
      </div>
      {telemetry?.available && <div className="mb-3 rounded-lg border border-line bg-raised/60 p-3">
        <div className="mb-1 font-medium">Anonymous usage telemetry</div>
        <p className="mb-3 text-xs text-dim">Help us see how long Manul is actively used. When enabled, Manul sends a random installation ID and seconds spent in the focused app while you are not idle. It never sends footage, project names, prompts, or keys. Off by default; you can turn it off anytime.</p>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={telemetry.enabled} onChange={e => window.manul.telemetry.set(e.target.checked).then(setTelemetry)} />Share active usage time</label>
      </div>}
      <Button size="sm" variant="ghost" onClick={() => window.manul.notices()}><FileText />Open-source licences</Button>
    </div>
  )
}
