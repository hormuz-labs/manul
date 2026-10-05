// Publish Manul's skills over the air: build a manifest of resources/skills and sign it with the Ed25519 key.
//   MANUL_SKILLS_KEY (PEM text, in CI) or MANUL_SKILLS_KEY_FILE (default ~/.config/manul/skills-signing.pem)
//   node --experimental-strip-types scripts/sign-skills.mjs   → updates/skills.json + updates/skills.json.sig
import { createPrivateKey, sign } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildManifest } from '../src/main/skill-updates.ts'

const root = join(import.meta.dirname, '..')
const pem = process.env.MANUL_SKILLS_KEY || readFileSync(process.env.MANUL_SKILLS_KEY_FILE || join(homedir(), '.config/manul/skills-signing.pem'), 'utf8')
const bytes = Buffer.from(JSON.stringify(buildManifest(join(root, 'resources', 'skills'), Date.now())))
mkdirSync(join(root, 'updates'), { recursive: true })
writeFileSync(join(root, 'updates', 'skills.json'), bytes)
writeFileSync(join(root, 'updates', 'skills.json.sig'), sign(null, bytes, createPrivateKey(pem)).toString('base64'))
console.log(`signed ${JSON.parse(bytes).skills.length} skills → updates/skills.json`)
