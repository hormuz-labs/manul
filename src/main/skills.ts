// Skills: folders with a SKILL.md (frontmatter name + description, then instructions). Manul ships some (bundled,
// read-only, updated with the app); the user and the agent add their own (user folder, editable). A profile says which
// skills are on; the agent sees the enabled skills' descriptions and reads a SKILL.md before work it covers.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type Skill = { id: string; name: string; description: string; path: string; source: 'bundled' | 'user' }
export type Profile = { id: string; name: string; /** when set, only these skills */ only?: string[]; disabled: string[] }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

export class Skills {
  /** updates: skills delivered over the air, which override the bundled ones */
  constructor(private dirs: { bundled: string; updates?: string; user: string; profiles: string }) {
    for (const d of [dirs.user, dirs.profiles]) mkdirSync(d, { recursive: true })
  }

  private read(dir: string, source: Skill['source']): Skill[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir).sort().flatMap(id => {
      const path = join(dir, id, 'SKILL.md')
      if (!existsSync(path)) return []
      const head = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path, 'utf8'))
      const field = (k: string) => (head && new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(head[1])?.[1]?.trim()) || ''
      return [{ id, name: field('name') || id, description: field('description'), path, source }]
    })
  }

  /** Every skill; a user skill with the same id as a bundled one replaces it (that is how a bundled skill is changed). */
  list(): Skill[] {
    const user = this.read(this.dirs.user, 'user')
    const updates = this.dirs.updates ? this.read(this.dirs.updates, 'bundled') : []
    const bundled = [...this.read(this.dirs.bundled, 'bundled').map(b => updates.find(u => u.id === b.id) || b), ...updates.filter(u => !this.read(this.dirs.bundled, 'bundled').some(b => b.id === u.id))]
    return [...bundled.filter(b => !user.some(u => u.id === b.id)), ...user]
  }

  // ---------------------------------------------------------------- profiles
  private file = (id: string) => join(this.dirs.profiles, `${id}.json`)
  private get activeFile() { return join(this.dirs.profiles, 'active') }

  profiles(): Profile[] {
    const list = readdirSync(this.dirs.profiles).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(this.dirs.profiles, f), 'utf8')) as Profile)
    return list.some(p => p.id === 'default') ? list : [{ id: 'default', name: 'Default', disabled: [] }, ...list]
  }

  profile(): Profile {
    const id = existsSync(this.activeFile) ? readFileSync(this.activeFile, 'utf8').trim() : 'default'
    return this.profiles().find(p => p.id === id) || { id: 'default', name: 'Default', disabled: [] }
  }

  private save(p: Profile) { writeFileSync(this.file(p.id), JSON.stringify(p, null, 1)) }

  createProfile(name: string, skills?: string[]): Profile {
    const id = slug(name) || 'profile'
    const p: Profile = { id, name, ...(skills ? { only: skills } : {}), disabled: [] }
    this.save(p)
    return p
  }

  useProfile(id: string) {
    if (!this.profiles().some(p => p.id === id)) throw new Error(`No profile "${id}".`)
    writeFileSync(this.activeFile, id)
  }

  enabled(): Skill[] {
    const p = this.profile()
    return this.list().filter(k => (!p.only || p.only.includes(k.id)) && !p.disabled.includes(k.id))
  }

  setEnabled(id: string, on: boolean) {
    const p = this.profile()
    if (p.only) p.only = on ? [...new Set([...p.only, id])] : p.only.filter(x => x !== id)
    p.disabled = on ? p.disabled.filter(x => x !== id) : [...new Set([...p.disabled, id])]
    this.save(p)
  }

  /** Copy a bundled skill into the user folder so it can be changed. */
  fork(id: string): Skill {
    const k = this.list().find(s => s.id === id)
    if (!k) throw new Error(`No skill "${id}".`)
    if (k.source === 'user') return k
    cpSync(dirname(k.path), join(this.dirs.user, id), { recursive: true })
    return this.list().find(s => s.id === id)!
  }

  prompt(): string {
    const on = this.enabled()
    if (!on.length) return ''
    return `Skills (profile "${this.profile().name}"). Each holds how a kind of work should be done. Before work a skill covers, read its ` +
      `SKILL.md (and any files it names) with the read tool, and follow it. When the user corrects how something should be done for good, ` +
      `change the skill: user skills (${this.dirs.user}) can be edited directly; to change a bundled skill, first copy it with fork_skill, ` +
      `then edit the copy. Say which file you changed.\n` +
      on.map(k => `- ${k.id} [${k.source}] (${k.path}): ${k.description.slice(0, 400)}`).join('\n')
  }
}
