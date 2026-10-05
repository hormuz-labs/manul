// Open projects as tabs (project folders), and which one is on screen (null = the start screen).
export type Tabs = { open: string[]; active: string | null }

export function openTab(t: Tabs, dir: string): Tabs {
  if (t.open.includes(dir)) return { ...t, active: dir }
  const at = t.active ? t.open.indexOf(t.active) + 1 : t.open.length
  const open = [...t.open]
  open.splice(at, 0, dir)
  return { open, active: dir }
}

export function closeTab(t: Tabs, dir: string): Tabs {
  const i = t.open.indexOf(dir)
  if (i < 0) return t
  const open = t.open.filter(d => d !== dir)
  if (t.active !== dir) return { open, active: t.active }
  return { open, active: open[i] ?? open[i - 1] ?? null }
}

export function cycleTab(t: Tabs, step: 1 | -1): Tabs {
  if (!t.open.length) return t
  const i = t.active ? t.open.indexOf(t.active) : -1
  return { ...t, active: t.open[(i + step + t.open.length) % t.open.length] }
}

export function moveTab(t: Tabs, dir: string, to: number): Tabs {
  const open = t.open.filter(d => d !== dir)
  open.splice(Math.max(0, Math.min(to, open.length)), 0, dir)
  return { ...t, open }
}
