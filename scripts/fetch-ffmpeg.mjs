// Fetch Manul's pinned ffmpeg + ffprobe (static builds, same release for every platform) into resources/bin/<platform>-<arch>/.
// Every file is SHA-256 checked against the hashes pinned here. Runs on `npm install`; packaging fetches every target with --all.
//   node scripts/fetch-ffmpeg.mjs            this machine's platform
//   node scripts/fetch-ffmpeg.mjs --all      every platform Manul ships for
// Builds: https://ffmpeg.martin-riedl.de (FFmpeg 9.0.2, GPLv3 configuration incl. libx264, libass, VideoToolbox on macOS).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = '9.0.2'
const BASE = 'https://ffmpeg.martin-riedl.de/download'
export const BUILDS = {
  'darwin-arm64': { path: 'macos/arm64/1789931890_9.0.2', ffmpeg: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924', ffprobe: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6' },
  'darwin-x64': { path: 'macos/amd64/1789931006_9.0.2', ffmpeg: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4', ffprobe: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd' },
  'linux-x64': { path: 'linux/amd64/1789931100_9.0.2', ffmpeg: 'fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f', ffprobe: '3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32' },
  'linux-arm64': { path: 'linux/arm64/1789931697_9.0.2', ffmpeg: '93a76ae90db5474eecdf951a729857c64f3de23567228d6a7d5e6e8e3cd1021b', ffprobe: 'bcbe80fb741c180083327afaf5434812e006b33cacde2016b9aeaf6936128330' },
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'bin')

async function fetchOne(target, tool) {
  const b = BUILDS[target]
  const dir = join(root, target)
  const bin = join(dir, tool)
  const stamp = join(dir, `.${tool}.sha256`)
  if (existsSync(bin) && existsSync(stamp) && readFileSync(stamp, 'utf8') === b[tool]) return // already this build
  mkdirSync(dir, { recursive: true })
  const res = await fetch(`${BASE}/${b.path}/${tool}.zip`)
  if (!res.ok) throw new Error(`${tool} ${target}: HTTP ${res.status}`)
  const zip = Buffer.from(await res.arrayBuffer())
  const got = createHash('sha256').update(zip).digest('hex')
  if (got !== b[tool]) throw new Error(`${tool} ${target}: checksum mismatch (got ${got}); refusing to use it`)
  const tmp = join(dir, `${tool}.zip`)
  writeFileSync(tmp, zip)
  rmSync(bin, { force: true })
  execFileSync('unzip', ['-o', '-q', tmp, '-d', dir])
  rmSync(tmp)
  chmodSync(bin, 0o755)
  writeFileSync(stamp, b[tool])
  console.log(`  ${target}/${tool} ${VERSION} (${(zip.length / 1e6).toFixed(0)} MB zip)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.MANUL_SKIP_FFMPEG) process.exit(0)
  const targets = process.argv.includes('--all') ? Object.keys(BUILDS) : [`${process.platform}-${process.arch}`]
  for (const t of targets) {
    if (!BUILDS[t]) { console.warn(`no ffmpeg build pinned for ${t}`); continue }
    for (const tool of ['ffmpeg', 'ffprobe']) await fetchOne(t, tool)
  }
}
