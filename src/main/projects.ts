// Projects live in ~/Movies/Manul/<name>/ :
//   project.json   versions, notes, media info (the source of truth the UI and the agent share)
//   media/         imported files (copied, so the project is self-contained): footage, music, subtitles, documents…
//   renders/       the agent's outputs
//   notes/         frame stills attached to notes
//   fonts/         fonts the user added (copies, with Manul's Inter), the folder subtitles take fonts from
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { FFMPEG, FONTS_DIR, probe } from './media'
import * as Files from './files'
import { fromMedia } from '../shared/timeline'
import type { MediaInfo, Note, Project, RecentProject, Version } from '../shared/types'

const run = promisify(execFile)
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project'

export const projectsRoot = () => process.env.MANUL_PROJECTS || join(app.getPath('videos'), 'Manul')
const recentFile = () => join(app.getPath('userData'), 'recent.json')

export function recent(): RecentProject[] {
  try {
    return (JSON.parse(readFileSync(recentFile(), 'utf8')) as RecentProject[]).filter(r => existsSync(join(r.dir, 'project.json')))
  } catch { return [] }
}

function touchRecent(p: Project) {
  const thumb = existsSync(join(p.dir, 'thumb.jpg')) ? join(p.dir, 'thumb.jpg') : undefined
  const list = [{ id: p.id, title: p.title, dir: p.dir, openedAt: Date.now(), thumb }, ...recent().filter(r => r.dir !== p.dir)].slice(0, 12)
  writeFileSync(recentFile(), JSON.stringify(list, null, 1))
}

/** A timeline that is just this media file, in its own size and frame rate (even sizes, sane rate). */
const timelineOf = (src: string, info: MediaInfo) => fromMedia(src, info.duration, {
  width: Math.max(2, Math.round((info.width || 1920) / 2) * 2),
  height: Math.max(2, Math.round((info.height || 1080) / 2) * 2),
  fps: info.fps > 0 && info.fps <= 120 ? Math.round(info.fps * 100) / 100 : 30,
})

/** Make a version the one on screen; the timeline restarts from it. */
export function accept(p: Project, versionId: string) {
  const v = p.versions.find(x => x.id === versionId)
  if (!v) throw new Error(`no version ${versionId}`)
  p.current = v.id
  if (p.proposal === v.id) p.proposal = undefined
  p.timeline = v.timeline ? structuredClone(v.timeline) : timelineOf(v.path, p.media[v.path])
}

export async function load(dir: string): Promise<Project> {
  const p = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')) as Project
  p.dir = dir
  if (!p.timeline) { const v = p.versions.find(x => x.id === p.current)!; p.timeline = timelineOf(v.path, p.media[v.path]) }
  touchRecent(p)
  return p
}

export async function save(p: Project) {
  await writeFile(join(p.dir, 'project.json'), JSON.stringify(p, null, 1))
}

/** A new project from a dropped or picked file: copy it in, probe it, grab a thumbnail. */
export async function createFromFile(file: string): Promise<Project> {
  const title = basename(file, extname(file))
  let dir = join(projectsRoot(), slug(title))
  for (let n = 2; existsSync(dir); n++) dir = join(projectsRoot(), `${slug(title)}-${n}`)
  for (const sub of ['media', 'renders', 'notes', 'clips']) await mkdir(join(dir, sub), { recursive: true })

  const rel = join('media', basename(file))
  await copyFile(file, join(dir, rel))
  const { info: about, media: info } = await Files.inspect(dir, rel, probe)
  if (!info) {
    await rm(dir, { recursive: true, force: true })
    throw new Error(`${basename(file)} isn't a video Manul can play (${about.summary}). Start from a video; other files can be added to it.`)
  }
  const v: Version = { id: id(), path: rel, title: 'Original', createdAt: Date.now(), by: 'import' }
  const p: Project = { id: id(), title, dir, createdAt: Date.now(), versions: [v], current: v.id, notes: [], media: { [rel]: info }, files: { [rel]: about }, timeline: timelineOf(rel, info) }
  await run(FFMPEG, ['-y', '-ss', String(Math.min(1, info.duration / 2)), '-i', join(dir, rel), '-frames:v', '1', '-vf', 'scale=480:-2', join(dir, 'thumb.jpg')]).catch(() => {})
  await save(p)
  touchRecent(p)
  return p
}

/** Record what a file in media/ is (and its probe, for footage, audio and images). */
async function register(p: Project, rel: string) {
  const r = await Files.inspect(p.dir, rel, probe)
  p.files = { ...p.files, [rel]: r.info }
  if (r.media) p.media[rel] = r.media
  if (r.info.font) await projectFont(p, rel)
}

/** Subtitles (libass) load every file in their fonts folder, so they can't take fonts from media/ beside the footage:
 *  a font the user adds is also copied into the project's fonts/, with Manul's Inter beside it. */
async function projectFont(p: Project, rel: string) {
  const dir = join(p.dir, 'fonts')
  await mkdir(dir, { recursive: true })
  for (const f of readdirSync(FONTS_DIR).filter(f => /\.(ttf|otf)$/i.test(f))) if (!existsSync(join(dir, f))) await copyFile(join(FONTS_DIR, f), join(dir, f))
  if (!existsSync(join(dir, basename(rel)))) await copyFile(join(p.dir, rel), join(dir, basename(rel)))
}

/** Bring files into a project: a file of any kind, a folder (all its files) or a .zip (its contents). Returns their
 *  paths in media/. */
export async function addFiles(p: Project, src: string): Promise<string[]> {
  const rels = await Files.copyIn(p.dir, src)
  for (const rel of rels) await register(p, rel)
  await save(p)
  return rels
}

/** Bring one file into the project; its path in media/. */
export const importMedia = async (p: Project, file: string) => (await addFiles(p, file))[0]

/** Bring project.json's file list in line with media/ (files added or removed in Finder, projects made before the
 *  list existed). True when it changed. */
export async function syncFiles(p: Project): Promise<boolean> {
  const onDisk = new Set((await Files.walk(join(p.dir, 'media')).catch(() => [] as string[])).map(f => join('media', f)))
  let changed = false
  for (const rel of Object.keys(p.files || {})) if (!onDisk.has(rel) && !existsSync(join(p.dir, rel))) { delete p.files![rel]; changed = true } // (or added while listing)
  for (const rel of onDisk) if (!p.files?.[rel]) { await register(p, rel).catch(e => console.warn('file', rel, e)); changed = true }
  return changed
}

export async function addVersion(p: Project, absPath: string, title: string, by: Version['by'], timeline?: Version['timeline'], dry?: string) {
  const rel = relative(p.dir, absPath)
  p.media[rel] = await probe(absPath)
  const v: Version = { id: id(), path: rel, title, createdAt: Date.now(), by, ...(timeline ? { timeline } : {}), ...(dry ? { dry: relative(p.dir, dry) } : {}) }
  p.versions.push(v)
  return v
}

export async function addNote(p: Project, note: Omit<Note, 'id' | 'createdAt' | 'status' | 'still'>, still?: Buffer) {
  const n: Note = { ...note, id: id(), createdAt: Date.now(), status: 'open' }
  if (still) {
    n.still = join('notes', `${n.id}.jpg`)
    await writeFile(join(p.dir, n.still), still)
  }
  p.notes.push(n)
  await save(p)
  return n
}
