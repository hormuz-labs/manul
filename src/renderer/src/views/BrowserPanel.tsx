// Manul's own browser, over the film: the agent's bsk drives it (its tabs have an amber edge) and the user can browse and
// sign in here too. The page itself is a native view the main process lays over the page area below; this component
// only draws the chrome around it and reports where the page area is (or that it is hidden or covered by a dialog).
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Bot, Globe, Loader2, Plus, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BrowserMode, BrowserState } from '../../../shared/types'

/** Something drawn over the page (a dialog, palette, popover): the native page view must step aside for it. */
const covered = () => !!document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')

export function useBrowserState() {
  const [s, setS] = useState<BrowserState>({ tabs: [], active: null, bsk: { connected: false, status: 'starting' } })
  useEffect(() => { window.manul.browser.state().then(setS); return window.manul.browser.onState(setS) }, [])
  return s
}

export function BrowserPanel({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const s = useBrowserState()
  const area = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<BrowserMode>('manul')
  const tab = s.tabs.find(t => t.id === s.active)
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setUrl(tab?.url && tab.url !== 'about:blank' ? tab.url : '') }, [tab?.url, editing])
  useEffect(() => { window.manul.browser.mode().then(setMode) }, [visible])

  // tell the main process where the page goes, and hide it while this panel is hidden or something covers it
  useEffect(() => {
    const report = () => {
      const el = area.current
      if (!visible || !el || covered()) return window.manul.browser.setBounds(null)
      const r = el.getBoundingClientRect()
      window.manul.browser.setBounds(r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null)
    }
    report()
    if (!visible) return
    const ro = new ResizeObserver(report)
    if (area.current) ro.observe(area.current)
    const mo = new MutationObserver(report)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-state'] })
    window.addEventListener('resize', report)
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', report); window.manul.browser.setBounds(null) }
  }, [visible])

  return (
    <div className={cn('absolute inset-0 z-20 flex flex-col bg-bg', !visible && 'hidden')} data-testid="browser-panel">
      {/* tabs */}
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2">
        {s.tabs.map(t => (
          <div
            key={t.id}
            onClick={() => window.manul.browser.select(t.id)}
            onAuxClick={e => { if (e.button === 1) window.manul.browser.close(t.id) }}
            className={cn('group flex h-7 max-w-[200px] shrink-0 cursor-default items-center gap-1.5 rounded-md border px-2 text-xs',
              t.id === s.active ? 'bg-raised text-fg' : 'text-dim hover:bg-raised/60',
              t.agent ? 'border-amber/60' : 'border-transparent')}
            title={t.agent ? `The agent is using this tab · ${t.url}` : t.url}
          >
            {t.loading ? <Loader2 className="size-3 shrink-0 animate-spin" /> : t.agent ? <Bot className="size-3 shrink-0 text-amber" /> : <Globe className="size-3 shrink-0" />}
            <span className="truncate">{t.title || t.url || 'New tab'}</span>
            <button className="ml-0.5 shrink-0 rounded opacity-0 hover:bg-line group-hover:opacity-100" onClick={e => { e.stopPropagation(); window.manul.browser.close(t.id) }}><X className="size-3" /></button>
          </div>
        ))}
        <Button size="iconSm" variant="ghost" onClick={() => window.manul.browser.newTab()} title="New tab"><Plus /></Button>
        <span className="flex-1" />
        <Button size="iconSm" variant="ghost" onClick={onClose} title="Back to the film"><X /></Button>
      </div>
      {/* address bar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <Button size="iconSm" variant="ghost" disabled={!tab?.canBack} onClick={() => window.manul.browser.back()}><ArrowLeft /></Button>
        <Button size="iconSm" variant="ghost" disabled={!tab?.canForward} onClick={() => window.manul.browser.forward()}><ArrowRight /></Button>
        <Button size="iconSm" variant="ghost" onClick={() => window.manul.browser.reload()}><RotateCw /></Button>
        <form className="flex-1" onSubmit={e => { e.preventDefault(); if (url.trim()) window.manul.browser.navigate(url.trim()); setEditing(false); (document.activeElement as HTMLElement)?.blur() }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onFocus={e => { setEditing(true); e.target.select() }}
            onBlur={() => setEditing(false)}
            placeholder="Search or enter address"
            className="h-7 w-full rounded-md border border-line bg-raised px-2.5 text-xs outline-none focus:border-amber/60"
          />
        </form>
        <span
          className="flex shrink-0 items-center gap-1.5 px-2 text-[11px] text-dim"
          data-testid="browser-status"
          title={mode === 'chrome' ? 'The agent uses your own Chrome (Settings → Browser). This browser is yours to use.' : s.bsk.connected ? 'The agent drives this browser, never your Chrome.' : s.bsk.status}
        >
          <span className={cn('size-1.5 rounded-full', mode === 'chrome' ? 'bg-faint' : s.bsk.connected ? 'bg-ok' : 'bg-amber')} />
          {mode === 'chrome' ? 'Agent uses your Chrome' : s.bsk.connected ? 'Agent browser' : 'Connecting…'}
        </span>
      </div>
      {/* the page (a native view is laid exactly over this box) */}
      <div ref={area} className="relative min-h-0 flex-1 bg-white/[0.02]">
        {!s.tabs.length && <div className="absolute inset-0 flex items-center justify-center text-dim">Opening…</div>}
      </div>
    </div>
  )
}
