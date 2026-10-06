import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Skills } from '../src/main/skills'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'manul-skills-'))
  const bundled = join(root, 'bundled'), user = join(root, 'user'), profiles = join(root, 'profiles')
  const skill = (dir: string, id: string, desc: string) => {
    mkdirSync(join(dir, id), { recursive: true })
    writeFileSync(join(dir, id, 'SKILL.md'), `---\nname: ${id}\ndescription: ${desc}\n---\n\n# ${id}\nbody\n`)
  }
  skill(bundled, 'motion-design', 'Make motion clips')
  skill(bundled, 'talking-head', 'Clean up talking videos')
  skill(user, 'my-brand', 'My brand rules')
  mkdirSync(join(user, 'broken'), { recursive: true }) // a folder without SKILL.md is ignored
  return { s: new Skills({ bundled, user, profiles }), bundled, user, profiles }
}

describe('skills and profiles', () => {
  it('lists bundled and user skills with their source', () => {
    const { s } = setup()
    expect(s.list().map(k => [k.id, k.source, k.description])).toEqual([
      ['motion-design', 'bundled', 'Make motion clips'],
      ['talking-head', 'bundled', 'Clean up talking videos'],
      ['my-brand', 'user', 'My brand rules'],
    ])
  })

  it('reads multi-line (YAML block) descriptions', () => {
    const { s, user } = setup()
    mkdirSync(join(user, 'web'), { recursive: true })
    writeFileSync(join(user, 'web', 'SKILL.md'), `---\nname: web\ndescription: |\n  Drive a browser: read pages,\n  fill forms.\nother: x\n---\nbody\n`)
    expect(s.list().find(k => k.id === 'web')?.description).toBe('Drive a browser: read pages, fill forms.')
  })

  it('the default profile has every skill on', () => {
    const { s } = setup()
    expect(s.profile()).toMatchObject({ id: 'default' })
    expect(s.enabled().map(k => k.id)).toEqual(['motion-design', 'talking-head', 'my-brand'])
  })

  it('switches skills off and on per profile, and remembers it', () => {
    const { s, bundled, user, profiles } = setup()
    s.setEnabled('talking-head', false)
    expect(s.enabled().map(k => k.id)).toEqual(['motion-design', 'my-brand'])
    const again = new Skills({ bundled, user, profiles })
    expect(again.enabled().map(k => k.id)).toEqual(['motion-design', 'my-brand'])
    again.setEnabled('talking-head', true)
    expect(again.enabled()).toHaveLength(3)
  })

  it('makes and switches profiles', () => {
    const { s } = setup()
    s.createProfile('Podcasts', ['talking-head'])
    s.useProfile('podcasts')
    expect(s.profile()).toMatchObject({ id: 'podcasts', name: 'Podcasts' })
    expect(s.enabled().map(k => k.id)).toEqual(['talking-head'])
    expect(s.profiles().map(p => p.id).sort()).toEqual(['default', 'podcasts'])
  })

  it('new skills are on in the default profile', () => {
    const { s, user } = setup()
    mkdirSync(join(user, 'new-one')); writeFileSync(join(user, 'new-one', 'SKILL.md'), '---\nname: new-one\ndescription: d\n---\n')
    expect(s.enabled().map(k => k.id)).toContain('new-one')
  })

  it('copies a bundled skill to the user folder to change it (bundled ones stay as shipped)', () => {
    const { s, user } = setup()
    const k = s.fork('motion-design')
    expect(k.source).toBe('user')
    expect(existsSync(join(user, 'motion-design', 'SKILL.md'))).toBe(true)
    expect(s.list().filter(x => x.id === 'motion-design')).toEqual([expect.objectContaining({ source: 'user' })]) // user copy wins
  })

  it('writes the prompt section with paths and how to use them', () => {
    const { s } = setup()
    const p = s.prompt()
    expect(p).toContain('motion-design')
    expect(p).toContain(join('motion-design', 'SKILL.md'))
    expect(p).toMatch(/read its SKILL\.md/i)
  })
})

describe('bundled skills', () => {
  it('each has a name matching its folder and a description that says when to use it', () => {
    const s = new Skills({ bundled: join(import.meta.dirname, '..', 'resources', 'skills'), user: mkdtempSync(join(tmpdir(), 'u-')), profiles: mkdtempSync(join(tmpdir(), 'p-')) })
    const list = s.list()
    expect(list.map(k => k.id)).toEqual(expect.arrayContaining(['motion-design', 'talking-head']))
    for (const k of list) {
      expect(k.name).toBe(k.id)
      expect(k.description.length).toBeGreaterThan(40)
      expect(k.description).toMatch(/Read before/)
    }
  })
})
