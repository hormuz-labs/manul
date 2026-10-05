import { describe, expect, it } from 'vitest'
import { rank } from '../src/renderer/src/lib/commands'

const cmds = [
  { id: 'export', title: 'Export…', keywords: 'save render mp4' },
  { id: 'transcript', title: 'Show transcript' },
  { id: 'new', title: 'New project' },
  { id: 'settings.keys', title: 'Settings: Keys', keywords: 'api' },
  { id: 'note', title: 'Add a note at the playhead' },
]

describe('command palette ranking', () => {
  it('shows everything for an empty query, in order', () => {
    expect(rank(cmds, '').map(c => c.id)).toEqual(['export', 'transcript', 'new', 'settings.keys', 'note'])
  })
  it('prefers a prefix, then a word start, then letters in order', () => {
    expect(rank(cmds, 'exp')[0].id).toBe('export')
    expect(rank(cmds, 'keys')[0].id).toBe('settings.keys')
    expect(rank(cmds, 'np').map(c => c.id)).toContain('new')
  })
  it('matches keywords', () => {
    expect(rank(cmds, 'mp4')[0].id).toBe('export')
    expect(rank(cmds, 'api')[0].id).toBe('settings.keys')
  })
  it('drops what does not match', () => {
    expect(rank(cmds, 'zzz')).toEqual([])
  })
})
