import { describe, expect, it } from 'vitest'
import { chooseModel, describeModels } from '../src/main/models'

const m = (provider: string, id: string, extra: Record<string, unknown> = {}) => ({ provider, id, name: id, contextWindow: 200000, input: ['text', 'image'], cost: { input: 1, output: 5 }, reasoning: true, ...extra })
const all = [m('google', 'gemini-3.8-flash'), m('google', 'gemini-2.5-pro'), m('anthropic', 'claude-sonnet-5'), m('anthropic', 'claude-opus-5'), m('openai', 'gpt-5.5'), m('openai', 'gpt-5-mini')]

describe('choosing a model', () => {
  it('prefers Claude Opus, then Gemini Flash, then GPT, by which keys exist', () => {
    expect(chooseModel(all)).toEqual({ provider: 'anthropic', modelId: 'claude-opus-5' })
    expect(chooseModel(all.filter(x => x.provider !== 'anthropic'))).toEqual({ provider: 'google', modelId: 'gemini-3.8-flash' })
    expect(chooseModel(all.filter(x => x.provider === 'openai'))).toEqual({ provider: 'openai', modelId: 'gpt-5.5' })
  })

  it('honours the user\'s pick when its key is there', () => {
    expect(chooseModel(all, { provider: 'openai', modelId: 'gpt-5-mini' })).toEqual({ provider: 'openai', modelId: 'gpt-5-mini' })
  })

  it('falls back when the picked model is no longer available', () => {
    expect(chooseModel(all.filter(x => x.provider === 'google'), { provider: 'anthropic', modelId: 'claude-opus-5' })).toEqual({ provider: 'google', modelId: 'gemini-3.8-flash' })
  })

  it('returns nothing without any key', () => expect(chooseModel([])).toBeUndefined())

  it('describes models for the picker: provider label, context, price, images', () => {
    const d = describeModels([m('google', 'gemini-3.8-flash', { cost: { input: 0.3, output: 2.5 }, contextWindow: 1048576 })])
    expect(d).toEqual([{ provider: 'google', providerLabel: 'Google', modelId: 'gemini-3.8-flash', name: 'gemini-3.8-flash', context: 1048576, price: { input: 0.3, output: 2.5 }, images: true, reasoning: true }])
  })
})

describe('picker list', () => {
  it('leaves out models that cannot drive an editing agent', () => {
    const ids = describeModels([m('google', 'deep-research-preview'), m('google', 'gemini-2.5-computer-use-preview'), m('google', 'gemini-2.5-flash-preview-tts'),
      m('google', 'gemini-embedding-001'), m('google', 'gemini-2.5-flash-image'), m('google', 'gemini-live-2.5'), m('google', 'gemini-2.5-flash')]).map(d => d.modelId)
    expect(ids).toEqual(['gemini-2.5-flash'])
  })
})
