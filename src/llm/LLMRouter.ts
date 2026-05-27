import type { LLMAdapter, ExplainOptions, ProviderId } from './types'

export class LLMRouter {
  constructor(private adapters: Record<ProviderId, LLMAdapter>) {}

  explain(provider: ProviderId, opts: ExplainOptions): AsyncIterable<string> {
    const a = this.adapters[provider]
    if (!a) throw new Error(`unknown provider: ${provider}`)
    return a.explain(opts)
  }
}
