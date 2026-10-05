// Pure helpers for the transcript panel (tested in test/transcript-ui.test.ts).
import type { Transcript, Word } from '../../../shared/types'

export type FlatWord = Word & { i: number; seg: number }

export const flatWords = (t: Transcript): FlatWord[] => {
  let i = 0
  return t.segments.flatMap((s, seg) => s.words.map(w => ({ ...w, i: i++, seg })))
}

/** Index of the word being spoken at t, or the last one before t; -1 before the first word. */
export function wordIndexAt(words: Word[], t: number): number {
  let lo = 0, hi = words.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (words[mid].s <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

/** Words a..b (either order) → the time range they cover. */
export const rangeOfSelection = (words: Word[], a: number, b: number) => {
  const [i, j] = a <= b ? [a, b] : [b, a]
  return { t0: words[i].s, t1: words[j].e }
}

export { isFiller } from '../../../shared/fillers'
