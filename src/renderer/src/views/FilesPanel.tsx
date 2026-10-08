// The files the user added to the project (footage, music, subtitles, scripts, fonts, LUTs…), what Manul made of each,
// and adding more. Clicking one attaches it to the next message, so the agent knows to use it.
import * as Popover from '@radix-ui/react-popover'
import { Captions, File, Film, Folder, Image as ImageIcon, Music, Palette, Paperclip, Plus, ScrollText, Type } from 'lucide-react'
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

export function FilesPanel({ project, attached, onAttach, onAdd }: { project: Project; attached: string[]; onAttach(rels: string[]): void; onAdd(): void }) {
  const files = Object.entries(project.files || {}).sort(([a], [b]) => a.localeCompare(b))
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" title="Files in this project (drop more anywhere)"><Paperclip />Files{files.length > 0 && <span className="tabular text-faint">{files.length}</span>}</Button>
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
          {files.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-dim">
              Drop footage, music, logos, subtitles (.srt), fonts or LUTs anywhere in the window, or Add them.
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {files.map(([rel, f]) => {
                const on = attached.includes(rel)
                return (
                  <li key={rel}>
                    <button
                      onClick={() => onAttach([rel])}
                      disabled={on}
                      title={`${rel}\n${f.summary}`}
                      className={cn('flex w-full gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-hover disabled:opacity-60', on && 'bg-amber-soft')}
                    >
                      <FileIcon kind={f.kind} className="mt-0.5 text-dim" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{rel.replace(/^media\//, '')}</span>
                        <span className="line-clamp-2 text-xs text-faint">{f.summary}</span>
                      </span>
                      {on && <span className="self-center text-[10.5px] text-amber">attached</span>}
                    </button>
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
