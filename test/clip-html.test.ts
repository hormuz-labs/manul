import { describe, expect, it } from 'vitest'
import { prepareClipHtml } from '../src/shared/clip-html'

const fmt = { width: 1280, height: 720, fps: 30 }

describe('prepareClipHtml', () => {
  it('adds the runtime, GSAP, the house font and the format to a bare snippet', () => {
    const out = prepareClipHtml('<div data-manul-id="t">Hi</div><script>gsap.timeline().from("[data-manul-id=t]", {opacity: 0})</script>', fmt, 3)
    expect(out).toMatch(/^<!doctype html>/i)
    expect(out).toContain('<html data-duration="3" data-width="1280" data-height="720" data-fps="30">')
    const gsapAt = out.indexOf('manul://lib/gsap.min.js'), runtimeAt = out.indexOf('manul://lib/clip-runtime.js'), userAt = out.indexOf('gsap.timeline()')
    expect(gsapAt).toBeGreaterThan(0)
    expect(runtimeAt).toBeGreaterThan(gsapAt) // runtime after GSAP…
    expect(userAt).toBeGreaterThan(runtimeAt) // …and before the clip's own script
    expect(out).toContain('manul://lib/manul.css')
    expect(out).toContain('width: 1280px; height: 720px')
  })

  it('keeps a full document, fixing its format and not duplicating scripts', () => {
    const doc = `<!doctype html><html data-duration="9" data-width="10"><head><script src="manul://lib/gsap.min.js"></script><script src="manul://lib/clip-runtime.js"></script></head><body><p>x</p></body></html>`
    const out = prepareClipHtml(doc, fmt, 4)
    expect(out.match(/gsap\.min\.js/g)).toHaveLength(1)
    expect(out.match(/clip-runtime\.js/g)).toHaveLength(1)
    expect(out).toContain('data-duration="4"')
    expect(out).toContain('data-width="1280"')
    expect(out).not.toContain('data-width="10"')
  })

  it('loads requested GSAP plugins before the runtime', () => {
    const out = prepareClipHtml('<h1 data-manul-id="h">Hello</h1><script>SplitText.create("h1")</script>', fmt, 2)
    expect(out).toContain('manul://lib/SplitText.min.js')
    expect(out.indexOf('SplitText.min.js')).toBeLessThan(out.indexOf('clip-runtime.js'))
  })

  it('removes anything pointing at the network', () => {
    const out = prepareClipHtml('<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=X"><script src="https://cdn.example.com/x.js"></script><p>ok</p>', fmt, 1)
    expect(out).not.toMatch(/https?:\/\//)
    expect(out).toContain('<p>ok</p>')
  })
})
