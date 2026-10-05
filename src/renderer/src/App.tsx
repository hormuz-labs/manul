import { useEffect, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAgent } from '@/lib/agui'
import { ConsentStack } from '@/components/ConsentStack'
import { CommandPalette } from '@/components/CommandPalette'
import { runCommand, useCommands } from '@/lib/commands'
import { SettingsDialog, type Section } from './views/SettingsDialog'
import { ProjectView } from './views/ProjectView'
import { Start } from './views/Start'
import type { Project } from '../../shared/types'

export function App() {
  const [project, setProject] = useState<{ p: Project; prompt?: string } | null>(null)
  const [settings, setSettings] = useState<Section | null>(null)
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useAgent(null) // subscribe to agent events from the start, before any project view mounts

  const [palette, setPalette] = useState(false)
  const [ready2update, setReady2update] = useState<string | null>(null)
  useEffect(() => window.manul.updates.onChange(st => setReady2update(st.status === 'ready' ? st.version || 'A new version' : null)), [])
  const check = () => window.manul.agent.ready().then(setReady)
  useEffect(() => window.manul.onMenu(id => (id === 'palette' ? setPalette(true) : runCommand(id))), [])
  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'
  useCommands([
    { id: 'palette', title: 'Command palette', shortcut: `${mod}K`, run: () => setPalette(true) },
    { id: 'home', title: 'New project', keywords: 'start home open recent', shortcut: `${mod}N`, run: () => setProject(null) },
    { id: 'settings', title: 'Settings', shortcut: `${mod},`, run: () => setSettings('keys') },
    { id: 'settings.keys', title: 'Settings: Keys', keywords: 'api gemini anthropic openai elevenlabs', run: () => setSettings('keys') },
    { id: 'settings.skills', title: 'Settings: Skills', keywords: 'profiles', run: () => setSettings('skills') },
    { id: 'settings.memory', title: 'Settings: Memory', keywords: 'remember', run: () => setSettings('memory') },
    { id: 'update.check', title: 'Check for updates', run: () => { setSettings('about'); window.manul.updates.check() } },
    { id: 'about', title: 'About Manul and updates', keywords: 'version update', run: () => setSettings('about') },
    { id: 'settings.tools', title: 'Settings: Tools', keywords: 'whisper ffmpeg download', run: () => setSettings('tools') },
  ], [])
  useEffect(() => { check(); const a = window.manul.agent.onReady(check); const b = window.manul.onNotice(setNotice); return () => { a(); b() } }, [])

  return (
    <TooltipProvider>
      {project
        ? <ProjectView key={project.p.dir} initial={project.p} firstPrompt={project.prompt} ready={ready} onKeys={() => setSettings('keys')} onTools={() => setSettings('tools')} onHome={() => setProject(null)} />
        : <Start ready={ready} onKeys={() => setSettings('keys')} onTools={() => setSettings('tools')} onOpen={(p, prompt) => setProject({ p, prompt })} />}
      <ConsentStack except={project?.p.dir} />
      <CommandPalette open={palette} onOpenChange={setPalette}
        onAsk={project ? q => window.manul.agent.send(project.p.dir, { text: q }).catch(e => setNotice(String(e.message))) : undefined} />
      <SettingsDialog section={settings} onSection={setSettings} onClose={() => { setSettings(null); check() }} />
      {ready2update && (
        <div className="fixed bottom-4 left-4 z-40 flex items-center gap-3 rounded-xl border border-amber/30 bg-panel px-3 py-2 shadow-xl">
          <img src="./manul.svg" className="size-6" alt="" />
          <span className="text-xs">Manul {ready2update} is ready.</span>
          <button className="rounded-md bg-amber px-2 py-1 text-xs font-medium text-[#1a1208]" onClick={() => window.manul.updates.install()}>Restart</button>
          <button className="text-xs text-faint hover:text-fg" onClick={() => setReady2update(null)}>Later</button>
        </div>
      )}
      {notice && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-bad/30 bg-panel px-4 py-2 text-bad shadow-xl" onClick={() => setNotice(null)}>{notice}</div>
      )}
    </TooltipProvider>
  )
}
