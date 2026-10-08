// Fetch Manul's pinned ffmpeg + ffprobe (static builds, same release for every platform) into resources/bin/<platform>-<arch>/.
// Every file is SHA-256 checked against the hashes pinned here. Runs on `npm install`; packaging fetches every target with --all.
//   node scripts/fetch-ffmpeg.mjs            this machine's platform
//   node scripts/fetch-ffmpeg.mjs --all      every platform Manul ships for
// Unix: martin-riedl.de; Windows x64: Gyan's GPLv3 static essentials build (libx264 + libass).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { download, extractZip, zipFiles } from './archive.mjs'

export const VERSION = '9.0.2'
const BASE = 'https://ffmpeg.martin-riedl.de/download'
export const BUILDS = {
  'darwin-arm64': { path: 'macos/arm64/1789931890_9.0.2', ffmpeg: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924', ffprobe: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6' },
  'darwin-x64': { path: 'macos/amd64/1789931006_9.0.2', ffmpeg: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4', ffprobe: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd' },
  'linux-x64': { path: 'linux/amd64/1789931100_9.0.2', ffmpeg: 'fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f', ffprobe: '3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32' },
  'linux-arm64': { path: 'linux/arm64/1789931697_9.0.2', ffmpeg: '93a76ae90db5474eecdf951a729857c64f3de23567228d6a7d5e6e8e3cd1021b', ffprobe: 'bcbe80fb741c180083327afaf5434812e006b33cacde2016b9aeaf6936128330' },
  'win32-x64': {
    url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
    sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
    prefix: 'ffmpeg-9.0.2-essentials_build',
  },
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'bin')

async function fetchOne(target, tool) {
  const b = BUILDS[target]
  const dir = join(root, target)
  const bin = join(dir, tool)
  const stamp = join(dir, `.${tool}.sha256`)
  if (existsSync(bin) && existsSync(stamp) && readFileSync(stamp, 'utf8') === b[tool]) return // already this build
  mkdirSync(dir, { recursive: true })
  const zip = await download(`${BASE}/${b.path}/${tool}.zip`, b[tool])
  extractZip(zip, dir)
  chmodSync(bin, 0o755)
  writeFileSync(stamp, b[tool])
  console.log(`  ${target}/${tool} ${VERSION} (${(zip.length / 1e6).toFixed(0)} MB zip)`)
}

export async function fetchWindows(dir = join(root, 'win32-x64')) {
  const b = BUILDS['win32-x64']
  const names = ['ffmpeg.exe', 'ffprobe.exe', 'ffmpeg-LICENSE.txt', 'ffmpeg-README.txt']
  if (names.every(n => existsSync(join(dir, n))) && ['ffmpeg', 'ffprobe'].every(t =>
    existsSync(join(dir, `.${t}.sha256`)) && readFileSync(join(dir, `.${t}.sha256`), 'utf8') === b.sha256)) return
  const zip = await download(b.url, b.sha256)
  const files = zipFiles(zip, [`${b.prefix}/bin/ffmpeg.exe`, `${b.prefix}/bin/ffprobe.exe`, `${b.prefix}/LICENSE`, `${b.prefix}/README.txt`])
  for (const data of files.slice(0, 2)) {
    if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error('Windows FFmpeg ZIP does not contain PE executables')
  }
  mkdirSync(dir, { recursive: true })
  names.forEach((name, i) => writeFileSync(join(dir, name), files[i]))
  for (const t of ['ffmpeg', 'ffprobe']) writeFileSync(join(dir, `.${t}.sha256`), b.sha256)
  console.log(`  win32-x64/ffmpeg + ffprobe ${VERSION} (${(zip.length / 1e6).toFixed(0)} MB zip)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.MANUL_SKIP_FFMPEG) process.exit(0)
  const targets = process.argv.includes('--all') ? Object.keys(BUILDS) : [process.argv.find(a => a.startsWith('--target='))?.slice(9) || `${process.platform}-${process.arch}`]
  for (const t of targets) {
    if (!BUILDS[t]) throw new Error(`no ffmpeg build pinned for ${t}`)
    if (t === 'win32-x64') await fetchWindows()
    else for (const tool of ['ffmpeg', 'ffprobe']) await fetchOne(t, tool)
  }
}
