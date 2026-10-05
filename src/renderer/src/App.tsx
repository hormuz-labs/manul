import { useEffect, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAgent } from '@/lib/agui'
import { KeysDialog } from './views/KeysDialog'
import { ProjectView } from './views/ProjectView'
import { Start } from './views/Start'
import type { Project } from '../../shared/types'

export function App() {
  const [project, setProject] = useState<{ p: Project; prompt?: string } | null>(null)
  const [keys, setKeys] = useState(false)
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useAgent(null) // subscribe to agent events from the start, before any project view mounts

  const check = () => window.manul.agent.ready().then(setReady)
  useEffect(() => { check(); const a = window.manul.agent.onReady(check); const b = window.manul.onNotice(setNotice); return () => { a(); b() } }, [])

  return (
    <TooltipProvider>
      {project
        ? <ProjectView key={project.p.dir} initial={project.p} firstPrompt={project.prompt} ready={ready} onKeys={() => setKeys(true)} onHome={() => setProject(null)} />
        : <Start ready={ready} onKeys={() => setKeys(true)} onOpen={(p, prompt) => setProject({ p, prompt })} />}
      <KeysDialog open={keys} onOpenChange={v => { setKeys(v); if (!v) check() }} />
      {notice && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-bad/30 bg-panel px-4 py-2 text-bad shadow-xl" onClick={() => setNotice(null)}>{notice}</div>
      )}
    </TooltipProvider>
  )
}
