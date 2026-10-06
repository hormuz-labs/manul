// README screenshots with callouts: the screenshot on a dark canvas, chosen areas blurred, and curved amber arrows
// from labels in the margins to the exact spots in the interface. Rendered by headless Chrome.
//   node scripts/annotate.mjs <spec.json>      (spec: { out, shots: [{ src, out, crop, blur, notes }] })
// crop/blur are in source pixels [x, y, w, h]; a note points at `at` = [x, y] in source pixels, or at `box` = [x, y, w, h]:
// then the screenshot dims around its boxes, each box is outlined, and the arrow ends on the edge facing the label.
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const AMBER = '#f2a541'

function page(shot, base) {
  const [cx, cy, cw, ch] = shot.crop
  const W = shot.width || 1200 // CSS px the screenshot is drawn at
  const k = W / cw, H = Math.round(ch * k)
  const notes = shot.notes || []
  const side = s => notes.filter(n => n.side === s)
  const M = { left: side('left').length ? 300 : 56, right: side('right').length ? 300 : 56, top: side('top').length ? 130 : 56, bottom: side('bottom').length ? 130 : 56 }
  const PW = M.left + W + M.right, PH = M.top + H + M.bottom
  const px = ([x, y]) => [M.left + (x - cx) * k, M.top + (y - cy) * k]

  // place labels: beside their target, pushed apart so they never overlap
  const placed = []
  for (const s of ['left', 'right', 'top', 'bottom']) {
    const edge = (n) => {
      if (!n.box) return n.at
      const [x, y, w, h] = n.box, p = 7 / k // just outside the outline
      return s === 'left' ? [x - p, y + h / 2] : s === 'right' ? [x + w + p, y + h / 2] : s === 'top' ? [x + w / 2, y - p] : [x + w / 2, y + h + p]
    }
    const list = side(s).map(n => ({ n, t: px(edge(n)) }))
    const vertical = s === 'left' || s === 'right'
    list.sort((a, b) => (vertical ? a.t[1] - b.t[1] : a.t[0] - b.t[0]))
    const gap = vertical ? 120 : 280
    let last = -Infinity
    for (const it of list) {
      let c = vertical ? it.t[1] : it.t[0]
      c = Math.max(c, last + gap); last = c
      it.c = c
    }
    // keep the column inside the canvas
    const max = (vertical ? PH : PW) - gap / 2 - 10
    const over = Math.max(0, (list.at(-1)?.c ?? 0) - max)
    for (const it of list) it.c -= over
    for (const it of list) placed.push({ ...it, s })
  }

  const labels = [], paths = []
  for (const { n, t, c, s } of placed) {
    let lx, ly, ax, ay, align
    if (s === 'left') { lx = 20; ly = c; ax = M.left - 22; ay = c; align = 'right' }
    if (s === 'right') { lx = M.left + W + 36; ly = c; ax = M.left + W + 22; ay = c; align = 'left' }
    if (s === 'top') { lx = c; ly = 18; ax = c; ay = M.top - 30; align = 'center' }
    if (s === 'bottom') { lx = c; ly = M.top + H + 30; ax = c; ay = ly - 4; align = 'center' }
    const box = s === 'left' ? `left:${lx}px;width:${M.left - 52}px;top:${ly}px;transform:translateY(-50%);text-align:right`
      : s === 'right' ? `left:${lx}px;width:${M.right - 58}px;top:${ly}px;transform:translateY(-50%)`
        : s === 'top' ? `left:${lx}px;top:${ly}px;width:300px;transform:translateX(-50%);text-align:center`
          : `left:${lx}px;top:${ly}px;width:300px;transform:translateX(-50%);text-align:center`
    labels.push(`<div class="note" style="${box}"><b>${n.title}</b>${n.text ? `<span>${n.text}</span>` : ''}</div>`)
    // a soft curve from the label to the spot
    const [tx, ty] = t
    const bend = s === 'left' || s === 'right' ? [(ax + tx) / 2, ay, (ax + tx) / 2, ty] : [ax, (ay + ty) / 2, tx, (ay + ty) / 2]
    paths.push(`<path d="M${ax},${ay} C${bend.join(',')} ${tx},${ty}" class="arrow" marker-end="url(#head)"/>`)
    if (!n.box) paths.push(`<circle cx="${tx}" cy="${ty}" r="9" class="ring"/><circle cx="${tx}" cy="${ty}" r="3.5" fill="${AMBER}"/>`)
    void align
  }

  const img = pathToFileURL(isAbsolute(shot.src) ? shot.src : resolve(base, shot.src)).href
  const blurs = (shot.blur || []).map(([x, y, w, h]) => {
    const l = (x - cx) * k, t = (y - cy) * k // inside the screenshot's own box
    return `<div class="blur" style="left:${l}px;top:${t}px;width:${w * k}px;height:${h * k}px"></div>`
  })
  const boxes = notes.filter(n => n.box).map(n => { const [x, y, w, h] = n.box; return [(x - cx) * k - 5, (y - cy) * k - 5, w * k + 10, h * k + 10] })
  const spot = boxes.length ? `<svg class="spot" width="${W}" height="${H}"><defs><mask id="holes"><rect width="${W}" height="${H}" fill="#fff"/>${boxes.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="#000"/>`).join('')}</mask>
<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter></defs>
<rect width="${W}" height="${H}" fill="rgba(6,5,4,.52)" mask="url(#holes)"/>
${boxes.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="none" stroke="${AMBER}" stroke-width="3" opacity=".45" filter="url(#glow)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="none" stroke="${AMBER}" stroke-width="1.8"/>`).join('')}</svg>` : ''
  const font = pathToFileURL(join(root, 'resources/fonts/Inter-Regular.ttf')).href
  const bold = pathToFileURL(join(root, 'resources/fonts/Inter-Bold.ttf')).href
  return {
    PW, PH, html: `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:I;src:url(${font})}@font-face{font-family:I;font-weight:700;src:url(${bold})}
html,body{margin:0}
body{width:${PW}px;height:${PH}px;position:relative;overflow:hidden;font-family:I;
  background:radial-gradient(120% 90% at 50% 0%,#211b16 0%,#0e0d0c 60%)}
.shot{position:absolute;left:${M.left}px;top:${M.top}px;width:${W}px;height:${H}px;border-radius:14px;overflow:hidden;
  box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.06)}
.shot img{position:absolute;left:${-cx * k}px;top:${-cy * k}px;width:${shot.srcWidth * k}px}
.blur{position:absolute;backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);background:rgba(20,18,16,.35);border-radius:6px}
svg{position:absolute;left:0;top:0;overflow:visible}
.spot{position:absolute;left:0;top:0}
.arrow{fill:none;stroke:${AMBER};stroke-width:2.2;stroke-linecap:round;opacity:.95}
.ring{fill:rgba(242,165,65,.18);stroke:${AMBER};stroke-width:1.5}
.note{position:absolute;color:#efe8df;font-size:15px;line-height:1.35}
.note b{display:block;font-weight:700;font-size:16px;color:#fff;margin-bottom:3px}
.note span{color:#b5aa9b}
</style>
<div class="shot"><img src="${img}">${blurs.join('')}${spot}</div>
<svg width="${PW}" height="${PH}"><defs><marker id="head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1,1 L8,5 L1,9" fill="none" stroke="${AMBER}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>${paths.join('')}</svg>
${labels.join('')}`,
  }
}

const specPath = resolve(process.argv[2])
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const base = dirname(specPath)
const browser = await chromium.launch({ executablePath: CHROME, args: ['--allow-file-access-from-files'] })
try {
  for (const shot of spec.shots) {
    const { PW, PH, html } = page(shot, base)
    const p = await browser.newPage({ viewport: { width: PW, height: PH }, deviceScaleFactor: 2 })
    const file = join(base, `.${shot.name}.html`)
    ;(await import('node:fs')).writeFileSync(file, html)
    await p.goto(pathToFileURL(file).href)
    await p.waitForLoadState('networkidle')
    await p.evaluate(() => document.fonts.ready)
    const out = isAbsolute(shot.out) ? shot.out : join(root, shot.out)
    await p.screenshot({ path: out })
    await p.close()
    console.log(out)
  }
} finally { await browser.close() }
