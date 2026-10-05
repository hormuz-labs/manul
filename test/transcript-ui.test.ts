import { describe, expect, it } from 'vitest'
import { flatWords, isFiller, rangeOfSelection, wordIndexAt } from '../src/renderer/src/lib/transcript'
import type { Transcript } from '../src/shared/types'

const t: Transcript = {
  media: 'a.mp4', language: 'en', model: 'm', createdAt: 0,
  segments: [
    { s: 0, e: 1, text: 'Um hello', words: [{ w: 'Um', s: 0, e: 0.3 }, { w: 'hello', s: 0.4, e: 1 }] },
    { s: 2, e: 3, text: 'uh, world.', words: [{ w: 'uh,', s: 2, e: 2.2 }, { w: 'world.', s: 2.3, e: 3 }] },
  ],
}

describe('transcript panel logic', () => {
  const words = flatWords(t)

  it('flattens words with their segment and index', () => {
    expect(words.map(w => [w.i, w.seg, w.w])).toEqual([[0, 0, 'Um'], [1, 0, 'hello'], [2, 1, 'uh,'], [3, 1, 'world.']])
  })

  it('finds the word being spoken (or the last one before a gap)', () => {
    expect(wordIndexAt(words, 0.1)).toBe(0)
    expect(wordIndexAt(words, 0.35)).toBe(0) // between words: the previous one
    expect(wordIndexAt(words, 1.5)).toBe(1)
    expect(wordIndexAt(words, 2.5)).toBe(3)
    expect(wordIndexAt(words, 99)).toBe(3)
    expect(wordIndexAt(words, -1)).toBe(-1)
    expect(wordIndexAt([], 1)).toBe(-1)
  })

  it('turns a word selection into a time range, in either direction', () => {
    expect(rangeOfSelection(words, 1, 2)).toEqual({ t0: 0.4, t1: 2.2 })
    expect(rangeOfSelection(words, 2, 1)).toEqual({ t0: 0.4, t1: 2.2 })
    expect(rangeOfSelection(words, 3, 3)).toEqual({ t0: 2.3, t1: 3 })
  })

  it('recognises filler words, ignoring punctuation and case', () => {
    expect(['Um', 'uh,', 'Hmm...', 'erm', 'ah'].every(isFiller)).toBe(true)
    expect(['hello', 'umbrella', 'a'].some(isFiller)).toBe(false)
  })
})
