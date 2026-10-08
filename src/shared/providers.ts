// Custom model providers: any OpenAI- or Anthropic-compatible endpoint (Azure AI Foundry, a company gateway, a local
// server…) with the models it serves. Pure: parsing, checking and the omp import live here; main/providers.ts stores
// them and builds pi-ai providers. A provider's key never lives in this config: it sits in the keychain under keyEnv().

export type ProviderApi = 'openai-responses' | 'openai-completions' | 'anthropic-messages'
export const PROVIDER_APIS: { api: ProviderApi; label: string }[] = [
  { api: 'openai-responses', label: 'OpenAI Responses' },
  { api: 'openai-completions', label: 'OpenAI Chat Completions' },
  { api: 'anthropic-messages', label: 'Anthropic Messages' },
]

export type CustomModel = { id: string; name?: string; reasoning?: boolean; images?: boolean; contextWindow?: number; maxTokens?: number }
export type CustomProvider = {
  id: string
  name: string
  baseUrl: string
  api: ProviderApi
  /** Also send the key in this header (Azure wants `api-key`), besides the usual Authorization / x-api-key. */
  keyHeader?: string
  models: CustomModel[]
}
/** What the renderer sees: the provider plus whether its key is set (never the key). */
export type CustomProviderInfo = CustomProvider & { keySet: boolean }

/** Ids the built-in providers use: a custom provider may not shadow them. */
export const BUILTIN_IDS = ['anthropic', 'google', 'openai']

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

/** The keychain/env name holding a custom provider's key. */
export const keyEnv = (id: string) => `MANUL_PROVIDER_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_KEY`
export const isProviderKeyEnv = (name: string) => /^MANUL_PROVIDER_[A-Z0-9_]+_KEY$/.test(name)

/** A readable name for a model id: gpt-5.6-terra → GPT-5.6 Terra. */
export function modelName(id: string) {
  return id.split('-').map((w, i) => (i === 0 && /^gpt$/i.test(w) ? 'GPT' : /^[a-z]/.test(w) && !/\d/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ').replace(/^GPT (\d)/, 'GPT-$1')
}

/** Check and tidy a provider from the settings form or a file; throws a sentence the user can act on. */
export function normalizeProvider(p: Partial<CustomProvider> & { models?: (CustomModel | string)[] }, taken: string[] = []): CustomProvider {
  const name = String(p.name || '').trim()
  if (!name) throw new Error('Give the provider a name.')
  const id = slug(p.id || name)
  if (!id) throw new Error('Give the provider a name with letters or numbers.')
  if (BUILTIN_IDS.includes(id)) throw new Error(`"${name}" is a built-in provider: add its key above instead.`)
  if (taken.includes(id)) throw new Error(`There is already a provider called "${name}".`)
  let url: URL
  try { url = new URL(String(p.baseUrl || '').trim()) } catch { throw new Error('The base URL must be a full address, like https://example.com/v1.') }
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) throw new Error('The base URL must use https (http only for localhost).')
  const api = p.api || 'openai-responses'
  if (!PROVIDER_APIS.some(a => a.api === api)) throw new Error(`Unknown API "${api}".`)
  const seen = new Set<string>()
  const models: CustomModel[] = []
  for (const raw of p.models || []) {
    const m = typeof raw === 'string' ? { id: raw } : raw
    const mid = String(m.id || '').trim()
    if (!mid || seen.has(mid)) continue
    seen.add(mid)
    models.push({
      id: mid, name: m.name?.trim() || modelName(mid), reasoning: m.reasoning ?? true, images: m.images ?? true,
      ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}), ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
    })
  }
  if (!models.length) throw new Error('List at least one model id.')
  const keyHeader = p.keyHeader?.trim()
  if (keyHeader && !/^[A-Za-z0-9-]+$/.test(keyHeader)) throw new Error('The key header must be a plain header name, like api-key.')
  return { id, name, baseUrl: url.toString().replace(/\/+$/, ''), api, ...(keyHeader ? { keyHeader } : {}), models }
}

/** Where an imported provider's key comes from: a file to read once, or nothing (the user pastes it). */
export type KeySource = { file?: string }

/**
 * omp (oh-my-pi) keeps custom providers in ~/.omp/agent/models.yml:
 *   providers: { <id>: { baseUrl, api, apiKey: "!cat <file>" | "<key>", headers: { api-key: … }, models: [{ id, name, reasoning, input }] } }
 * Only `!cat <file>` key commands are followed (read the file); other commands are never run.
 */
export function fromOmp(doc: unknown, home = ''): { provider: CustomProvider; key?: string; keySource: KeySource }[] {
  const providers = (doc as { providers?: Record<string, any> } | null)?.providers
  if (!providers || typeof providers !== 'object') return []
  const out: { provider: CustomProvider; key?: string; keySource: KeySource }[] = []
  for (const [id, p] of Object.entries(providers)) {
    if (!p || typeof p !== 'object') continue
    const api: ProviderApi = PROVIDER_APIS.some(a => a.api === p.api) ? p.api : p.api === 'azure-openai-responses' ? 'openai-responses' : 'openai-completions'
    const keyHeader = Object.entries(p.headers || {}).find(([h, v]) => /key/i.test(h) && String(v) === String(p.apiKey))?.[0]
    const models = (Array.isArray(p.models) ? p.models : []).map((m: any) => ({
      id: String(m.id), name: m.name ? String(m.name).replace(/\s*\([^)]*\)\s*$/, '') : undefined,
      reasoning: m.reasoning ?? true, images: Array.isArray(m.input) ? m.input.includes('image') : true,
      contextWindow: m.contextWindow, maxTokens: m.maxTokens,
    }))
    let provider: CustomProvider
    try { provider = normalizeProvider({ id, name: niceName(id), baseUrl: p.baseUrl, api, keyHeader, models }, out.map(o => o.provider.id)) } catch { continue }
    const raw = String(p.apiKey ?? '')
    const cat = /^!\s*cat\s+(['"]?)(.+?)\1\s*$/.exec(raw)
    const keySource: KeySource = cat ? { file: cat[2].replace(/^~(?=\/)/, home) } : {}
    out.push({ provider, keySource, ...(!raw.startsWith('!') && raw ? { key: raw } : {}) })
  }
  return out
}

const niceName = (id: string) => id.split(/[-_]/).map(w => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ')
