// The files the user added to the project (footage, music, subtitles, fonts, LUTs…), what Manul made of each, and
// deleting them: the Files in the sidebar's project tree. Clicking one attaches it to the next message, so the agent
// knows to use it. Also the icons and chips for files the message box and the start screen use.
import { Captions, File, Film, Folder, Image as ImageIcon, Music, Palette, ScrollText, Sparkles, Trash2, Type } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn, timecode } from '@/lib/utils'
import { attachFiles, detachFiles, useAttached } from '@/lib/attach'
import { kindByName } from '../../../shared/file-kinds'
import type { FileKind, Project } from '../../../shared/types'

const ICON: Record<FileKind | 'folder' | 'clip', typeof File> = {
  folder: Folder, clip: Sparkles, video: Film, audio: Music, image: ImageIcon, subtitles: Captions, text: ScrollText, font: Type, lut: Palette, other: File,
}

export function FileIcon({ kind, className }: { kind: FileKind | 'folder' | 'clip'; className?: string }) {
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
    <button onClick={() => { setSure(false); onConfirm() }} className="shrink-0 self-center rounded bg-bad/15 px-1.5 py-0.5 text-[11px] font-medium text-bad hover:bg-bad/25" title="Moves to the Trash">Delete</button>
  ) : (
    <button onClick={() => setSure(true)} aria-label={`Delete ${label}`} title="Delete (moves to the Trash)"
      className="shrink-0 self-center rounded p-1 text-faint opacity-0 hover:bg-bad/15 hover:text-bad focus:opacity-100 group-hover:opacity-100"><Trash2 className="size-3" /></button>
  )
}

/** What a drag from the Files carries: the file, and its kind (readable while dragging, when the data isn't). */
export const DRAG_FILE = 'manul/file'
export const dragKind = (types: readonly string[]) => (types.find(t => t.startsWith('manul/kind-'))?.slice('manul/kind-'.length) as FileKind | undefined)

/** The project's files, compact, for the sidebar's tree: click one to attach it to the next message (again to take it
 *  off), a folder to attach all of it; drag footage onto the timeline to put it in the film; the bin moves one to the
 *  Trash, after a second click. */
export function FilesTree({ project }: { project: Project }) {
  const files = project.files || {}
  const rows = fileRows(Object.keys(files))
  const attached = useAttached(project.dir)
  const [kept, setKept] = useState<Record<string, string>>({})
  const remove = async (rels: string[]) => {
    try {
      const r = await window.manul.project.removeFiles(project.dir, rels)
      detachFiles(project.dir, r.removed)
      setKept(Object.fromEntries(r.blocked.map(b => [b.file, b.why])))
    } catch (e) { alert((e as Error).message) }
  }
  if (!rows.length) return <p className="px-2 py-1 text-[11.5px] leading-snug text-faint">Drop footage, music, logos or subtitles anywhere in the window.</p>
  return (
    <ul data-files-tree>
      {rows.map(row => {
        if (row.kind === 'folder') {
          return (
            <li key={`dir:${row.name}`} className="group flex items-center">
              <button onClick={() => attachFiles(project.dir, row.rels)} title={`Attach all ${row.rels.length} files`}
                className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-dim hover:bg-hover/60 hover:text-fg">
                <FileIcon kind="folder" /><span className="truncate">{row.name}</span><span className="ml-auto shrink-0 text-[11px] text-faint">{row.rels.length}</span>
              </button>
              <Remove label={`the folder ${row.name}`} onConfirm={() => remove(row.rels)} />
            </li>
          )
        }
        const f = files[row.rel]
        const on = attached.includes(row.rel)
        const m = project.media[row.rel]
        const long = (f.kind === 'video' || f.kind === 'audio') && m?.duration ? timecode(m.duration, false) : ''
        return (
          <li key={row.rel} className={cn('group flex items-center', row.depth && 'pl-3')}>
            <button
              draggable={f.kind === 'video'}
              onDragStart={e => { e.dataTransfer.setData(DRAG_FILE, row.rel); e.dataTransfer.setData(`manul/kind-${f.kind}`, '1'); e.dataTransfer.effectAllowed = 'copy' }}
              onClick={() => (on ? detachFiles : attachFiles)(project.dir, [row.rel])}
              aria-pressed={on}
              title={`${row.rel}\n${f.summary}${kept[row.rel] ? `\nCan't delete: ${kept[row.rel]}.` : ''}\n${on ? 'Attached to your next message (click to take it off)' : 'Click to attach to your next message'}${f.kind === 'video' ? ', or drag onto the timeline' : ''}`}
              className={cn('flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[12.5px] hover:bg-hover/60', on ? 'bg-amber-soft text-fg' : 'text-dim hover:text-fg')}
            >
              <FileIcon kind={f.kind} className={on ? 'text-amber' : undefined} />
              <span className="truncate">{row.depth ? row.rel.split('/').slice(2).join('/') : row.rel.replace(/^media\//, '')}</span>
              {long && <span className="ml-auto shrink-0 text-[10.5px] tabular text-faint">{long}</span>}
            </button>
            <Remove label={row.rel.split('/').pop()!} onConfirm={() => remove([row.rel])} />
          </li>
        )
      })}
    </ul>
  )
}
