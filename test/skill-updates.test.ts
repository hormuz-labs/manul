import { generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyManifest, buildManifest, verifyManifest } from '../src/main/skill-updates'
import { Skills } from '../src/main/skills'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const signed = (m: object) => { const bytes = Buffer.from(JSON.stringify(m)); return { bytes, sig: sign(null, bytes, privateKey).toString('base64') } }
const manifest = (issued: number, body = 'v2 body') => ({ issued, skills: [{ id: 'motion-design', version: 2, files: { 'SKILL.md': `---\nname: motion-design\ndescription: updated. Read before clips.\n---\n${body}\n` } }] })

describe('over-the-air skill updates', () => {
  it('accepts a manifest signed with Manul\'s key', () => {
    const { bytes, sig } = signed(manifest(1))
    expect(verifyManifest(bytes, sig, pub).issued).toBe(1)
  })

  it('rejects a tampered manifest or a wrong key', () => {
    const { bytes, sig } = signed(manifest(1))
    const tampered = Buffer.from(bytes.toString().replace('v2 body', 'evil'))
    expect(() => verifyManifest(tampered, sig, pub)).toThrow(/signature/)
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(() => verifyManifest(bytes, sig, other)).toThrow(/signature/)
  })

  it('installs newer skills, and never goes back to an older manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-ota-'))
    expect(applyManifest(manifest(5), dir)).toEqual({ applied: ['motion-design'] })
    expect(readFileSync(join(dir, 'motion-design', 'SKILL.md'), 'utf8')).toContain('v2 body')
    expect(applyManifest(manifest(4, 'old'), dir)).toEqual({ applied: [], skipped: 'not newer than what is installed (5)' })
    expect(readFileSync(join(dir, 'motion-design', 'SKILL.md'), 'utf8')).toContain('v2 body')
  })

  it('refuses file paths that leave the skill folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-ota-'))
    const bad = { issued: 9, skills: [{ id: 'x', version: 1, files: { '../../evil.sh': 'boom' } }] }
    expect(() => applyManifest(bad, dir)).toThrow(/path/)
    expect(existsSync(join(dir, '..', 'evil.sh'))).toBe(false)
    expect(() => applyManifest({ issued: 9, skills: [{ id: '../x', version: 1, files: { 'SKILL.md': 'a' } }] }, dir)).toThrow(/id/)
  })

  it('updates override bundled skills; the user\'s own copy still wins', () => {
    const root = mkdtempSync(join(tmpdir(), 'manul-ota-'))
    const mk = (d: string, body: string) => { mkdirSync(join(root, d, 'motion-design'), { recursive: true }); writeFileSync(join(root, d, 'motion-design', 'SKILL.md'), `---\nname: motion-design\ndescription: ${body}\n---\n`) }
    mk('bundled', 'shipped')
    const s = new Skills({ bundled: join(root, 'bundled'), updates: join(root, 'updates'), user: join(root, 'user'), profiles: join(root, 'profiles') })
    expect(s.list()[0].description).toBe('shipped')
    mk('updates', 'updated')
    expect(s.list()[0]).toMatchObject({ description: 'updated', source: 'bundled' })
    mk('user', 'mine')
    expect(s.list()[0]).toMatchObject({ description: 'mine', source: 'user' })
  })

  it('builds a manifest from a skills folder', () => {
    const m = buildManifest(join(import.meta.dirname, '..', 'resources', 'skills'), 7)
    expect(m.issued).toBe(7)
    expect(m.skills.map(k => k.id)).toEqual(expect.arrayContaining(['motion-design', 'talking-head']))
    expect(Object.keys(m.skills[0].files)).toContain('SKILL.md')
  })
})

import { createServer } from 'node:http'
import { fetchSkillUpdates } from '../src/main/skill-updates'

describe('the skills feed', () => {
  it('fetches, verifies and applies over HTTP; a bad signature changes nothing', async () => {
    let body = signed(manifest(10))
    const server = createServer((req, res) => res.end(req.url!.endsWith('.sig') ? body.sig : body.bytes)).listen(0)
    const feed = `http://127.0.0.1:${(server.address() as { port: number }).port}/skills.json`
    const dir = mkdtempSync(join(tmpdir(), 'manul-feed-'))
    expect(await fetchSkillUpdates({ feed, publicKeyPem: pub, dir })).toEqual({ applied: ['motion-design'] })
    body = { bytes: Buffer.from(JSON.stringify(manifest(11, 'evil'))), sig: body.sig }
    await expect(fetchSkillUpdates({ feed, publicKeyPem: pub, dir })).rejects.toThrow(/signature/)
    expect(readFileSync(join(dir, 'motion-design', 'SKILL.md'), 'utf8')).toContain('v2 body')
    server.close()
  })

  it('the shipped public key verifies what the signing script makes', async () => {
    const { execFileSync } = await import('node:child_process')
    const key = join(process.env.HOME!, '.config/manul/skills-signing.pem')
    if (!existsSync(key)) return // only on a machine that holds the signing key
    const root = join(import.meta.dirname, '..')
    execFileSync('node', ['--experimental-strip-types', '--no-warnings', 'scripts/sign-skills.mjs'], { cwd: root })
    const m = verifyManifest(readFileSync(join(root, 'updates', 'skills.json')), readFileSync(join(root, 'updates', 'skills.json.sig'), 'utf8'), readFileSync(join(root, 'resources', 'skills-public.pem'), 'utf8'))
    expect(m.skills.map(k => k.id)).toEqual(expect.arrayContaining(['motion-design', 'talking-head']))
  })
})
