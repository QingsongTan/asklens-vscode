import { describe, it, expect } from 'vitest'
import { LLMRouter } from '../../src/llm/LLMRouter'
import type { LLMAdapter, ExplainOptions, ProviderId } from '../../src/llm/types'

function fakeAdapter(chunks: string[]): LLMAdapter {
  return {
    async *explain(_opts: ExplainOptions) {
      for (const c of chunks) yield c
    },
    async *chat(_messages, _modelId) {
      for (const c of chunks) yield c
    },
  }
}

// 13 个 provider 槽全填 fakeAdapter, 个别 case 覆盖时再替换需要的
function allFakes(override: Partial<Record<ProviderId, LLMAdapter>> = {}): Record<ProviderId, LLMAdapter> {
  const ids: ProviderId[] = [
    'claude', 'openai', 'ollama', 'deepseek', 'qwen', 'kimi', 'glm',
    'doubao', 'hunyuan', 'minimax', 'yi', 'step', 'ernie',
  ]
  const base = {} as Record<ProviderId, LLMAdapter>
  for (const id of ids) base[id] = fakeAdapter([])
  return { ...base, ...override }
}

describe('LLMRouter', () => {
  it('按 provider 路由', async () => {
    const router = new LLMRouter(allFakes({ claude: fakeAdapter(['c1', 'c2']) }))
    const got: string[] = []
    for await (const c of router.explain('claude', {
      selectedText: 'x', conversation: [], followUps: [], modelId: 'm',
    })) got.push(c)
    expect(got).toEqual(['c1', 'c2'])
  })

  it('未知 provider 抛错', async () => {
    const router = new LLMRouter(allFakes())
    await expect((async () => {
      // @ts-expect-error unknown provider
      for await (const _c of router.explain('unknown', { selectedText: 'x', conversation: [], followUps: [], modelId: 'm' })) {}
    })()).rejects.toThrow(/unknown provider/)
  })

  it('chat 按 provider 路由到 adapter.chat', async () => {
    let capturedMessages: unknown
    let capturedModel: unknown
    const adapter = {
      explain: async function* () { /* not used */ },
      chat: async function* (msgs: unknown, mid: unknown) {
        capturedMessages = msgs
        capturedModel = mid
        yield 'X'
      },
    }
    const router = new LLMRouter(allFakes({ claude: adapter as never }))
    const out: string[] = []
    for await (const c of router.chat('claude', [{ role: 'user', content: 'hi' }], 'mid')) out.push(c)
    expect(out.join('')).toBe('X')
    expect(capturedMessages).toEqual([{ role: 'user', content: 'hi' }])
    expect(capturedModel).toBe('mid')
  })

  it('新增中国 provider 也能路由 (qwen / kimi / glm)', async () => {
    const router = new LLMRouter(allFakes({
      qwen: fakeAdapter(['Q']),
      kimi: fakeAdapter(['K']),
      glm: fakeAdapter(['G']),
    }))
    const collect = async (provider: ProviderId): Promise<string> => {
      const out: string[] = []
      for await (const c of router.explain(provider, { selectedText: 'x', conversation: [], followUps: [], modelId: 'm' })) out.push(c)
      return out.join('')
    }
    expect(await collect('qwen')).toBe('Q')
    expect(await collect('kimi')).toBe('K')
    expect(await collect('glm')).toBe('G')
  })
})
