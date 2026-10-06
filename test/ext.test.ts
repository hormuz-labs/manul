import { describe, expect, it } from 'vitest'
import { contentScriptMatches, globToRegExp, queryTabs, Store } from '../src/shared/ext-match'

describe('content-script matching (as Chrome does it)', () => {
  it('<all_urls> covers web pages and files, not chrome internals', () => {
    const cs = { matches: ['<all_urls>'] }
    expect(contentScriptMatches(cs, 'https://example.com/a')).toBe(true)
    expect(contentScriptMatches(cs, 'file:///x.html')).toBe(true)
    expect(contentScriptMatches(cs, 'devtools://devtools/x')).toBe(false)
  })

  it('about:blank only when asked for', () => {
    expect(contentScriptMatches({ matches: ['<all_urls>'] }, 'about:blank')).toBe(false)
    expect(contentScriptMatches({ matches: ['<all_urls>'], match_about_blank: true }, 'about:blank')).toBe(true)
  })

  it('scheme/host globs', () => {
    const cs = { matches: ['http://*/*', 'https://*/*'] }
    expect(contentScriptMatches(cs, 'https://www.youtube.com/watch?v=1')).toBe(true)
    expect(contentScriptMatches(cs, 'file:///x.html')).toBe(false)
    expect(globToRegExp('https://*.google.com/*').test('https://mail.google.com/u/0')).toBe(true)
    expect(globToRegExp('https://*.google.com/*').test('https://evil.com/?https://a.google.com/')).toBe(false)
  })
})

describe('chrome.tabs.query', () => {
  const tabs = [
    { id: 1, windowId: 1, active: true, url: 'https://a.com/', title: 'A', status: 'complete' },
    { id: 2, windowId: 1, active: false, url: 'https://b.com/x', title: 'B page', status: 'loading' },
    { id: 3, windowId: 2, active: true, url: 'https://a.com/y', title: 'Agent', status: 'complete' },
  ]
  const ids = (q: object, focused = 1) => queryTabs(tabs, q, focused).map(t => t.id)

  it('filters like Chrome', () => {
    expect(ids({})).toEqual([1, 2, 3])
    expect(ids({ active: true })).toEqual([1, 3])
    expect(ids({ active: true, currentWindow: true })).toEqual([1])
    expect(ids({ active: true, lastFocusedWindow: true }, 2)).toEqual([3])
    expect(ids({ windowId: 2 })).toEqual([3])
    expect(ids({ windowId: -2 }, 2)).toEqual([3])
    expect(ids({ status: 'loading' })).toEqual([2])
    expect(ids({ url: 'https://a.com/*' })).toEqual([1, 3])
    expect(ids({ url: ['https://b.com/*', 'https://nope/*'] })).toEqual([2])
    expect(ids({ title: 'B*' })).toEqual([2])
  })
})

describe('chrome.storage area', () => {
  it('get with null, a key, a list or defaults; set and remove report changes', () => {
    const changes: object[] = []
    const s = new Store({ a: 1 }, c => changes.push(c))
    s.set({ b: 2 })
    expect(s.get(null)).toEqual({ a: 1, b: 2 })
    expect(s.get('a')).toEqual({ a: 1 })
    expect(s.get(['a', 'zz'])).toEqual({ a: 1 })
    expect(s.get({ a: 0, c: 3 })).toEqual({ a: 1, c: 3 })
    s.remove(['a', 'missing'])
    expect(s.get(null)).toEqual({ b: 2 })
    expect(changes).toEqual([{ b: { oldValue: undefined, newValue: 2 } }, { a: { oldValue: 1 } }])
    s.remove('nothing')
    expect(changes).toHaveLength(2) // no event when nothing changed
  })
})
