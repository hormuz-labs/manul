// Merge the latest-mac.yml written by the arm64 and x64 builds into one update feed listing both.
//   node scripts/merge-mac-feed.mjs <latest-mac.yml> <latest-mac.yml>  > latest-mac.yml
// Each build only knows its own files; published separately, the second one wins and the other Macs update to the wrong build.
// electron-updater picks the zip for its architecture from `files`, so one feed with both is all it needs.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function parse(text) {
  const version = text.match(/^version: (.+)$/m)?.[1]
  const files = [...text.matchAll(/^  - url: (.+)\n    sha512: (.+)\n    size: (\d+)$/gm)].map(([, url, sha512, size]) => ({ url, sha512, size }))
  const path = text.match(/^path: (.+)$/m)?.[1]
  const sha512 = text.match(/^sha512: (.+)$/m)?.[1]
  const releaseDate = text.match(/^releaseDate: (.+)$/m)?.[1]
  if (!version || !files.length) throw new Error('not a latest-mac.yml')
  return { version, files, path, sha512, releaseDate }
}

export function mergeMacFeeds(texts) {
  const feeds = texts.map(parse)
  const version = feeds[0].version
  if (feeds.some(f => f.version !== version)) throw new Error(`feeds are for different versions: ${feeds.map(f => f.version).join(', ')}`)
  // the legacy single-file fields: the Intel build's, which older updaters on either arch can at least run
  const main = feeds.find(f => !/arm64/.test(f.path)) || feeds[0]
  const seen = new Set()
  const files = feeds.flatMap(f => f.files).filter(f => !seen.has(f.url) && seen.add(f.url))
  const dates = feeds.map(f => f.releaseDate).filter(Boolean).sort()
  return `version: ${version}\nfiles:\n${files.map(f => `  - url: ${f.url}\n    sha512: ${f.sha512}\n    size: ${f.size}\n`).join('')}path: ${main.path}\nsha512: ${main.sha512}\n${dates.length ? `releaseDate: ${dates.at(-1)}\n` : ''}`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(mergeMacFeeds(process.argv.slice(2).map(p => readFileSync(p, 'utf8'))))
}
