import { describe, expect, it } from 'vitest'
import { colourOf, longestTurn, nameOf, people, speakerOfSegments, type Speakers } from '../src/shared/speakers'
import { speakersReport } from '../src/main/speakers'

const sp: Speakers = {
  duration: 60,
  speakers: [
    { id: 'A', talk: 20, turns: 2, share: 40, minor: false },
    { id: 'B', talk: 18, turns: 2, share: 36, minor: false },
    { id: 'C', talk: 10, turns: 1, share: 20, minor: false },
    { id: 'D', talk: 2, turns: 1, share: 4, minor: true },
  ],
  turns: [
    { speaker: 'A', s: 0, e: 12 }, { speaker: 'B', s: 12, e: 20 }, { speaker: 'C', s: 20, e: 30 },
    { speaker: 'A', s: 30, e: 38 }, { speaker: 'B', s: 38, e: 48 }, { speaker: 'D', s: 48, e: 50 },
  ],
}

describe('naming voices', () => {
  it('unnamed voices are Speaker A, B…', () => {
    expect(nameOf('C')).toBe('Speaker C')
    expect(nameOf('C', { C: '  Ultron ' })).toBe('Ultron')
  })

  it('the same name on two voices makes one person (diarization splits people)', () => {
    expect(people(sp, { A: 'Tony', C: 'Tony', B: 'Ultron' })).toEqual([
      { name: 'Tony', ids: ['A', 'C'], talk: 30, turns: 3, named: true },
      { name: 'Ultron', ids: ['B'], talk: 18, turns: 2, named: true },
      { name: 'Speaker D', ids: ['D'], talk: 2, turns: 1, named: false },
    ])
  })

  it('each transcript sentence gets the voice that speaks most of it', () => {
    const seg = (s: number, e: number) => ({ s, e, text: '', words: [] })
    expect(speakerOfSegments([seg(1, 5), seg(10, 19), seg(29, 33), seg(55, 58)], sp.turns)).toEqual(['A', 'B', 'A', undefined])
  })

  it("a voice's longest turn is where to hear who it is", () => {
    expect(longestTurn(sp, 'A')).toEqual({ speaker: 'A', s: 0, e: 12 })
    expect(longestTurn(sp, 'Z')).toBeUndefined()
  })

  it('a name keeps its colour', () => {
    expect(colourOf('Tony')).toBe(colourOf('Tony'))
    expect(colourOf('Tony')).toBeGreaterThanOrEqual(0)
    expect(colourOf('Tony')).toBeLessThan(8)
  })

  it('the agent reads the names, and who is one person', () => {
    const r = speakersReport(sp, 'media/film.mp4', '.cache/speakers/x.json', 120, { A: 'Tony', C: 'Tony', B: 'Ultron' })
    expect(r).toContain('Tony (A): 0:20 of talk')
    expect(r).toContain('People (voices with the same name are one person): Tony = A+C, Ultron = B, Speaker D = D')
    expect(r).toContain('0:20.0–0:30.0 Tony')
    expect(r).toContain('Names are the ones the user gave')
    expect(speakersReport(sp, 'media/film.mp4', 'x.json')).toContain('then name them with name_speakers')
  })
})
