// Turns whatever HTML the agent (or a user) writes into a valid Manul clip: a full document with the clip's format on
// <html>, GSAP (+ any plugins it uses) and the clip runtime loaded before the clip's own scripts, the house stylesheet,
// a fixed-size stage, and nothing that points at the network (clips render offline and must be repeatable).

export type ClipFormat = { width: number; height: number; fps: number }

const PLUGINS = ['SplitText', 'MorphSVGPlugin', 'DrawSVGPlugin', 'MotionPathPlugin', 'TextPlugin', 'CustomEase']
const lib = (f: string) => `<script src="manul://lib/${f}"></script>`

export function prepareClipHtml(input: string, fmt: ClipFormat, duration: number): string {
  let html = input.trim()
  // nothing from the network: external scripts, stylesheets, @imports, url()s
  html = html
    .replace(/<script[^>]*\bsrc=["']https?:\/\/[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<link[^>]*\bhref=["']https?:\/\/[^"']*["'][^>]*>/gi, '')
    .replace(/@import\s+url\(["']?https?:\/\/[^)]*\)\s*;?/gi, '')
    .replace(/url\(["']?https?:\/\/[^)]*\)/gi, 'none')

  if (!/<html[\s>]/i.test(html)) html = `<html><head></head><body>${html}</body></html>`
  if (!/<head[\s>]/i.test(html)) html = html.replace(/<html([^>]*)>/i, '<html$1><head></head>')
  if (!/<body[\s>]/i.test(html)) html = html.replace(/<\/head>/i, '</head><body>').replace(/<\/html>/i, '</body></html>')
  html = html.replace(/^<!doctype[^>]*>\s*/i, '')

  // the format lives on <html>
  const attrs = `data-duration="${round(duration)}" data-width="${fmt.width}" data-height="${fmt.height}" data-fps="${fmt.fps}"`
  html = html.replace(/<html([^>]*)>/i, (_m, a: string) => `<html ${[a.replace(/\s*data-(duration|width|height|fps)="[^"]*"/gi, '').trim(), attrs].filter(Boolean).join(' ')}>`.replace('<html  ', '<html '))

  // libraries, once each, in order: GSAP, plugins in use, runtime; all before the clip's own scripts
  html = html.replace(/<script[^>]*src=["']manul:\/\/lib\/[^"']+["'][^>]*>\s*<\/script>\s*/gi, '')
  const plugins = PLUGINS.filter(p => new RegExp(`\\b${p}\\b`).test(html)).map(p => lib(`${p}.min.js`))
  const head = [
    '<meta charset="utf-8">',
    '<link rel="stylesheet" href="manul://lib/manul.css">',
    `<style>html, body { margin: 0; width: ${fmt.width}px; height: ${fmt.height}px; overflow: hidden; }</style>`,
    lib('gsap.min.js'), ...plugins, lib('clip-runtime.js'),
  ].join('\n')
  html = html.replace(/<meta charset=[^>]*>\s*/i, '').replace(/<link rel="stylesheet" href="manul:\/\/lib\/manul\.css">\s*/i, '')
  html = html.replace(/<head([^>]*)>/i, `<head$1>\n${head}\n`)
  return `<!doctype html>\n${html}\n`
}

const round = (n: number) => Math.round(n * 1000) / 1000
