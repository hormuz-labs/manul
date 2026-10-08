// The files the user added to the project (footage, music, subtitles, fonts, LUTs…), what Manul made of each, adding
// more and deleting them: the side panel's Files tab. Clicking one attaches it to the next message, so the agent knows
// to use it; dragging footage or music onto the timeline (subtitles onto the video) puts it in the film.
import { Captions, File, Film, Folder, Image as ImageIcon, Music, Palette, Plus, ScrollText, Trash2, Type } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn, mediaUrl, timecode } from '@/lib/utils'
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

/** What a drag from the Files list carries: the file, and its kind (readable while dragging, when the data isn't). */
export const DRAG_FILE = 'manul/file'
export const dragKind = (types: readonly string[]) => (types.find(t => t.startsWith('manul/kind-'))?.slice('manul/kind-'.length) as FileKind | undefined)

/** A small picture of footage (a frame) or an image (itself). */
function Thumb({ dir, rel, kind, duration }: { dir: string; rel: string; kind: FileKind; duration: number }) {
  const [frame, setFrame] = useState<string | null>(kind === 'image' && !rel.endsWith('.svg') ? `${dir}/${rel}` : null)
  useEffect(() => {
    if (kind !== 'video' || !(duration > 0)) return
    const t = Math.min(1, duration / 2)
    window.manul.thumbnails(dir, rel, 1, t, t + 0.04).then(f => setFrame(f[0] || null)).catch(() => {})
  }, [dir, rel, kind, duration])
  return frame
    ? <img src={mediaUrl(frame)} alt="" loading="lazy" draggable={false} className="h-8 w-12 shrink-0 rounded-sm bg-raised object-cover" />
    : <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded-sm bg-raised"><FileIcon kind={kind} className="text-dim" /></span>
}

/** The Files tab: everything added to the project, by folder. Click to attach to the next message, drag footage or
 *  music onto the timeline (subtitles onto the video), delete what you don't need. */
export function FilesList({ project, attached, onAttach, onAdd, onRemoved }: { project: Project; attached: string[]; onAttach(rels: string[]): void; onAdd(): void; onRemoved(rels: string[]): void }) {
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-3 mb-1 flex items-center gap-2">
        <p className="flex-1 text-[11px] leading-snug text-faint">Click to attach to your message. Drag footage or music onto the timeline, subtitles onto the video.</p>
        <Button size="sm" variant="secondary" onClick={onAdd}><Plus />Add</Button>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-xs text-dim">Drop footage, music, logos, subtitles (.srt), fonts or LUTs anywhere in the window, or Add them.</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {rows.map(row => {
            if (row.kind === 'folder') {
              return (
                <li key={`dir:${row.name}`} className="group flex items-center gap-1 pr-1">
                  <button onClick={() => onAttach(row.rels)} title={`Attach all ${row.rels.length} files`} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
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
            const m = project.media[row.rel]
            const long = (f.kind === 'video' || f.kind === 'audio') && m?.duration ? timecode(m.duration, false) : ''
            return (
              <li key={row.rel} className={cn('group flex items-start gap-1 pr-1', row.depth && 'pl-4')}>
                <button
                  draggable
                  onDragStart={e => { e.dataTransfer.setData(DRAG_FILE, row.rel); e.dataTransfer.setData(`manul/kind-${f.kind}`, '1'); e.dataTransfer.effectAllowed = 'copy' }}
                  onClick={() => onAttach([row.rel])}
                  disabled={on}
                  title={`${row.rel}\n${f.summary}`}
                  className={cn('flex min-w-0 flex-1 gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover disabled:opacity-60', on && 'bg-amber-soft')}
                >
                  <Thumb dir={project.dir} rel={row.rel} kind={f.kind} duration={m?.duration || 0} />
                  <span className="min-w-0 flex-1">
                    <span className="flex gap-1.5"><span className="truncate text-[13px]">{row.depth ? row.rel.split('/').slice(2).join('/') : row.rel.replace(/^media\//, '')}</span>
                      {long && <span className="ml-auto shrink-0 text-[10.5px] tabular text-faint">{long}</span>}</span>
                    <span className="line-clamp-2 text-[11px] leading-snug text-faint">{f.summary}</span>
                    {kept[row.rel] && <span className="block text-[11px] text-bad">Can't delete: {kept[row.rel]}.</span>}
                    {on && <span className="block text-[10.5px] text-amber">attached to your next message</span>}
                  </span>
                </button>
                <Remove label={row.rel.split('/').pop()!} onConfirm={() => remove([row.rel])} />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
