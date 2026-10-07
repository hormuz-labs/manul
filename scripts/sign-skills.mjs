// Publish Manul's skills over the air: build a manifest of resources/skills and sign it with the Ed25519 key.
//   MANUL_SKILLS_KEY (PEM text, in CI) or MANUL_SKILLS_KEY_FILE (default ~/.config/manul/skills-signing.pem)
//   node --experimental-strip-types scripts/sign-skills.mjs   → updates/skills.json + updates/skills.json.sig (MANUL_SKILLS_OUT: elsewhere)
import { createPrivateKey, sign } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildManifest } from '../src/main/skill-updates.ts'

const root = join(import.meta.dirname, '..')
const pem = process.env.MANUL_SKILLS_KEY || readFileSync(process.env.MANUL_SKILLS_KEY_FILE || join(homedir(), '.config/manul/skills-signing.pem'), 'utf8')
const bytes = Buffer.from(JSON.stringify(buildManifest(join(root, 'resources', 'skills'), Date.now())))
const out = process.env.MANUL_SKILLS_OUT || join(root, 'updates') // tests sign into a temp folder, never the published feed
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'skills.json'), bytes)
writeFileSync(join(out, 'skills.json.sig'), sign(null, bytes, createPrivateKey(pem)).toString('base64'))
console.log(`signed ${JSON.parse(bytes).skills.length} skills → ${join(out, 'skills.json')}`)
