// The files the user added to the project (footage, music, subtitles, scripts, fonts, LUTs…), what Manul made of each,
// and adding more. Clicking one attaches it to the next message, so the agent knows to use it.
import * as Popover from '@radix-ui/react-popover'
import { Captions, File, Film, Folder, Image as ImageIcon, Music, Palette, Paperclip, Plus, ScrollText, Trash2, Type } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { kindByName } from '../../../shared/file-kinds'
import type { FileKind, Project } from '../../../shared/types'

const ICON: Record<FileKind | 'folder', typeof File> = {
  folder: Folder, video: Film, audio: Music, image: ImageIcon, subtitles: Captions, text: ScrollText, font: Type, lut: Palette, other: File,
}

export function FileIcon({ kind, className }: { kind: FileKind | 'folder'; className?: string }) {
  const I = ICON[kind]
  return <I className={cn('size-3.5 shrink-0', className)} />
}

/** A file's kind: what Manul found, else what its name says. */
export const kindOf = (p: Project, rel: string) => p.files?.[rel]?.kind ?? kindByName(rel) ?? 'other'

/** Chips for attached files: a folder's files (media/<folder>/…) collapse into one chip when there are several. */
export function chipGroups(rels: string[]): { label: string; rels: string[] }[] {
  const out: { label: string; rels: string[] }[] = []
  const folders = new Map<string, string[]>()
  for (const r of rels) {
    const parts = r.split('/')
    if (parts.length > 2) folders.set(parts[1], [...(folders.get(parts[1]) || []), r])
    else out.push({ label: parts.at(-1)!, rels: [r] })
  }
  for (const [name, list] of folders) {
    if (list.length > 3) out.push({ label: `${name}/ · ${list.length} files`, rels: list })
    else out.push(...list.map(r => ({ label: r.split('/').slice(1).join('/'), rels: [r] })))
  }
  return out
}

type Row = { kind: 'file'; rel: string; depth: number } | { kind: 'folder'; name: string; rels: string[] }

/** The list: top-level files, then each folder (media/<name>/…) with its files under it. */
export function fileRows(rels: string[]): Row[] {
  const sorted = [...rels].sort((a, b) => a.localeCompare(b))
  const rows: Row[] = sorted.filter(r => r.split('/').length === 2).map(rel => ({ kind: 'file', rel, depth: 0 }))
  const folders = [...new Set(sorted.filter(r => r.split('/').length > 2).map(r => r.split('/')[1]))]
  for (const name of folders) {
    const inside = sorted.filter(r => r.startsWith(`media/${name}/`))
    rows.push({ kind: 'folder', name, rels: inside }, ...inside.map(rel => ({ kind: 'file' as const, rel, depth: 1 })))
  }
  return rows
}

/** A trash button that asks once ("Delete") before acting. */
function Remove({ label, onConfirm }: { label: string; onConfirm(): void }) {
  const [sure, setSure] = useState(false)
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t) }, [sure])
  return sure ? (
    <button onClick={() => { setSure(false); onConfirm() }} className="shrink-0 self-center rounded bg-bad/15 px-2 py-0.5 text-[11px] font-medium text-bad hover:bg-bad/25" title="Moves to the Trash">Delete</button>
  ) : (
    <button onClick={() => setSure(true)} aria-label={`Delete ${label}`} title="Delete (moves to the Trash)"
      className="shrink-0 self-center rounded p-1 text-faint opacity-0 hover:bg-bad/15 hover:text-bad focus:opacity-100 group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
  )
}

export function FilesPanel({ project, attached, onAttach, onAdd, onRemoved }: { project: Project; attached: string[]; onAttach(rels: string[]): void; onAdd(): void; onRemoved(rels: string[]): void }) {
  const files = project.files || {}
  const rows = fileRows(Object.keys(files))
  const [kept, setKept] = useState<Record<string, string>>({})
  const remove = async (rels: string[]) => {
    try {
      const r = await window.manul.project.removeFiles(project.dir, rels)
      onRemoved(r.removed)
      setKept(Object.fromEntries(r.blocked.map(b => [b.file, b.why])))
    } catch (e) { alert((e as Error).message) }
  }
  return (
    <Popover.Root onOpenChange={o => { if (!o) setKept({}) }}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" title="Files in this project (drop more anywhere)"><Paperclip />Files{rows.length > 0 && <span className="tabular text-faint">{Object.keys(files).length}</span>}</Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" sideOffset={8} className="z-50 flex max-h-[60vh] w-96 flex-col rounded-card border border-line bg-panel shadow-2xl shadow-black/50">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <div className="flex-1">
              <div className="text-[13px] font-medium">Files</div>
              <div className="text-xs text-faint">Click one to attach it to your next message.</div>
            </div>
            <Button size="sm" variant="secondary" onClick={onAdd}><Plus />Add</Button>
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-dim">
              Drop footage, music, logos, subtitles (.srt), fonts or LUTs anywhere in the window, or Add them.
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {rows.map(row => {
                if (row.kind === 'folder') {
                  return (
                    <li key={`dir:${row.name}`} className="group flex items-center gap-1 pr-1.5">
                      <button onClick={() => onAttach(row.rels)} title={`Attach all ${row.rels.length} files`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-hover">
                        <FileIcon kind="folder" className="text-dim" />
                        <span className="truncate text-[13px]">{row.name}</span>
                        <span className="shrink-0 text-xs text-faint">{row.rels.length} files</span>
                      </button>
                      <Remove label={`the folder ${row.name}`} onConfirm={() => remove(row.rels)} />
                    </li>
                  )
                }
                const f = files[row.rel]
                const on = attached.includes(row.rel)
                return (
                  <li key={row.rel} className={cn('group flex items-start gap-1 pr-1.5', row.depth && 'pl-5')}>
                    <button
                      onClick={() => onAttach([row.rel])}
                      disabled={on}
                      title={`${row.rel}\n${f.summary}`}
                      className={cn('flex min-w-0 flex-1 gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-hover disabled:opacity-60', on && 'bg-amber-soft')}
                    >
                      <FileIcon kind={f.kind} className="mt-0.5 text-dim" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{row.depth ? row.rel.split('/').slice(2).join('/') : row.rel.replace(/^media\//, '')}</span>
                        <span className="line-clamp-2 text-xs text-faint">{f.summary}</span>
                        {kept[row.rel] && <span className="block text-xs text-bad">Can't delete: {kept[row.rel]}.</span>}
                      </span>
                      {on && <span className="self-center text-[10.5px] text-amber">attached</span>}
                    </button>
                    <Remove label={row.rel.split('/').pop()!} onConfirm={() => remove([row.rel])} />
                  </li>
                )
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
