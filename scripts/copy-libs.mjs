// Copy the libraries motion clips may use into resources/lib (served to clips as manul://lib/<file>).
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const out = join(import.meta.dirname, '..', 'resources', 'lib')
mkdirSync(out, { recursive: true })
const gsap = dirname(require.resolve('gsap/package.json'))
for (const f of ['gsap.min.js', 'SplitText.min.js', 'MorphSVGPlugin.min.js', 'DrawSVGPlugin.min.js', 'MotionPathPlugin.min.js', 'TextPlugin.min.js', 'CustomEase.min.js'])
  copyFileSync(join(gsap, 'dist', f), join(out, f))
// Inter (variable weight) for clip typography, served as manul://lib/fonts/Inter.woff2
mkdirSync(join(out, 'fonts'), { recursive: true })
const inter = dirname(require.resolve('@fontsource-variable/inter/package.json'))
copyFileSync(join(inter, 'files', 'inter-latin-wght-normal.woff2'), join(out, 'fonts', 'Inter.woff2'))
