import { useEffect, useSyncExternalStore } from 'react'

// Commands shared by the native menu, keyboard shortcuts and the ⌘K palette.
export type Command = { id: string; title: string; keywords?: string; shortcut?: string; run?: () => void }

/** Score how well a query matches text: prefix > word start > substring > letters in order; 0 = no match. */
function score(text: string, q: string): number {
  const t = text.toLowerCase()
  if (t.startsWith(q)) return 100
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 80
  if (t.includes(q)) return 60
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length ? 30 : 0
}

/** Commands matching the query, best first (stable for ties); all of them for an empty query. */
export function rank<T extends Command>(cmds: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return cmds
  return cmds
    .map((c, i) => ({ c, i, s: Math.max(score(c.title, q), c.keywords ? score(c.keywords, q) - 5 : 0) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => x.c)
}

// ---------------------------------------------------------------- registry: screens add their commands while shown

const registry = new Map<string, Command>()
const subs = new Set<() => void>()
let snapshot: Command[] = []
const changed = () => { snapshot = [...registry.values()]; subs.forEach(f => f()) }

/** Register commands while the calling component is mounted (later registrations of an id win). */
export function useCommands(cmds: Command[], deps: unknown[]) {
  useEffect(() => {
    for (const c of cmds) registry.set(c.id, c)
    changed()
    return () => { for (const c of cmds) if (registry.get(c.id) === c) registry.delete(c.id); changed() }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}

export const useAllCommands = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => snapshot)
export const runCommand = (id: string) => registry.get(id)?.run?.()
