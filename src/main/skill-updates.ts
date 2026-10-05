// Over-the-air skill updates: Manul publishes a manifest of its bundled skills (the files inline, they are small text)
// signed with an Ed25519 key. The app verifies the signature with the public key it ships with, ignores anything not
// newer than what it has (no rollbacks), and writes the skills into <userData>/skill-updates, which overrides the
// skills bundled with the app (the user's own skills still win).
import { createPublicKey, verify } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export type Manifest = { issued: number; skills: { id: string; version: number; files: Record<string, string> }[] }

export function verifyManifest(bytes: Buffer, signatureB64: string, publicKeyPem: string): Manifest {
  const ok = verify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(signatureB64, 'base64'))
  if (!ok) throw new Error('Skill update rejected: the signature does not match Manul\'s key.')
  return JSON.parse(bytes.toString('utf8')) as Manifest
}

const stateFile = (dir: string) => join(dir, '.manifest.json')

export function applyManifest(m: Manifest, dir: string): { applied: string[]; skipped?: string } {
  mkdirSync(dir, { recursive: true })
  const have = existsSync(stateFile(dir)) ? (JSON.parse(readFileSync(stateFile(dir), 'utf8')) as { issued: number }).issued : 0
  if (m.issued <= have) return { applied: [], skipped: `not newer than what is installed (${have})` }
  // validate everything before writing anything
  for (const k of m.skills) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(k.id)) throw new Error(`Skill update rejected: bad skill id "${k.id}".`)
    for (const f of Object.keys(k.files)) {
      const target = resolve(dir, k.id, f)
      if (!target.startsWith(resolve(dir, k.id) + sep)) throw new Error(`Skill update rejected: file path "${f}" leaves the skill folder.`)
    }
  }
  const applied: string[] = []
  for (const k of m.skills) {
    rmSync(join(dir, k.id), { recursive: true, force: true })
    for (const [f, content] of Object.entries(k.files)) {
      const target = join(dir, k.id, f)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content)
    }
    applied.push(k.id)
  }
  writeFileSync(stateFile(dir), JSON.stringify({ issued: m.issued }))
  return { applied }
}

/** A manifest of every skill in a folder (used by scripts/sign-skills.mjs when publishing). */
export function buildManifest(skillsDir: string, issued: number): Manifest {
  const files = (root: string, d = root): string[] => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? files(root, join(d, f)) : [relative(root, join(d, f))]))
  return {
    issued,
    skills: readdirSync(skillsDir).filter(id => existsSync(join(skillsDir, id, 'SKILL.md'))).sort().map(id => ({
      id, version: issued,
      files: Object.fromEntries(files(join(skillsDir, id)).map(f => [f.split(sep).join('/'), readFileSync(join(skillsDir, id, f), 'utf8')])),
    })),
  }
}

export const SKILLS_FEED = 'https://raw.githubusercontent.com/hormuz-labs/manul/main/updates/skills.json'

/** Fetch, verify and apply the skills feed. Quiet on failure: skills keep working from what is installed. */
export async function fetchSkillUpdates(o: { feed: string; publicKeyPem: string; dir: string; fetchImpl?: typeof fetch }) {
  const f = o.fetchImpl || fetch
  const [m, s] = await Promise.all([f(o.feed), f(`${o.feed}.sig`)])
  if (!m.ok || !s.ok) throw new Error(`skills feed: HTTP ${m.status}/${s.status}`)
  const manifest = verifyManifest(Buffer.from(await m.arrayBuffer()), (await s.text()).trim(), o.publicKeyPem)
  return applyManifest(manifest, o.dir)
}
