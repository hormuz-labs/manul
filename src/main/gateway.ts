// The Manul key: one key, one model ("Manul"), through Manul's gateway (Bifrost). The app never knows which model
// answers: the gateway's routing rule for `manul` picks it (Claude, Gemini, GPT…) and can change it any time. Requests
// go through Bifrost's OpenAI Responses route, the one whose translation keeps every vendor's tool-call state
// (Gemini's thought signatures, Claude's thinking signatures, GPT's encrypted reasoning): see gateway/README.md.
// The Manul key is a Bifrost virtual key, with its own budget and rate limits; the gateway holds the vendor keys.
import { createProvider } from '@earendil-works/pi-ai/models'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { getConfig } from './config'

export const MANUL_KEY = 'MANUL_KEY'
export const MANUL_MODEL = 'manul'
export const DEFAULT_GATEWAY = 'https://gateway.manul.si'

/** MANUL_GATEWAY (a local Bifrost while developing), else the config's, else Manul's. */
export const gatewayUrl = () => (process.env.MANUL_GATEWAY || getConfig().gateway || DEFAULT_GATEWAY).replace(/\/+$/, '')

export function manulProvider(gateway = gatewayUrl()) {
  const baseUrl = `${gateway}/openai`                    // the SDK adds /responses
  return createProvider({
    id: 'manul',
    name: 'Manul',
    baseUrl,
    auth: {
      apiKey: {
        name: 'Manul key',
        resolve: async ({ ctx }: any) => { const v = await ctx.env(MANUL_KEY); return v ? { auth: { apiKey: v }, source: MANUL_KEY } : undefined },
      },
    } as any,
    // Limits every model the gateway may route to meets; billing is the Manul key's, so no per-token price here.
    models: [{
      id: MANUL_MODEL, name: 'Manul', api: 'openai-responses', provider: 'manul', baseUrl,
      input: ['text', 'image'], reasoning: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 400_000, maxTokens: 64_000,
    }] as any,
    api: openAIResponsesApi(),
  })
}
