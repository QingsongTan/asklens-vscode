import { describe, it, expect } from 'vitest'
import { LLMRouter } from '../../src/llm/LLMRouter'
import type { LLMAdapter, ExplainOptions } from '../../src/llm/types'

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

describe('LLMRouter', () => {
  it('按 provider 路由', async () => {
    const claude = fakeAdapter(['c1', 'c2'])
    const openai = fakeAdapter(['o1'])
    const router = new LLMRouter({ claude, openai, ollama: fakeAdapter([]), deepseek: fakeAdapter([]) })
    const got: string[] = []
    for await (const c of router.explain('claude', {
      selectedText: 'x', conversation: [], followUps: [], modelId: 'm',
    })) got.push(c)
    expect(got).toEqual(['c1', 'c2'])
  })

  it('未知 provider 抛错', async () => {
    const router = new LLMRouter({
      claude: fakeAdapter([]), openai: fakeAdapter([]), ollama: fakeAdapter([]),
      deepseek: fakeAdapter([]),
    })
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
    const router = new LLMRouter({
      claude: adapter as never,
      openai: fakeAdapter([]),
      ollama: fakeAdapter([]),
      deepseek: fakeAdapter([]),
    })
    const out: string[] = []
    for await (const c of router.chat('claude', [{ role: 'user', content: 'hi' }], 'mid')) out.push(c)
    expect(out.join('')).toBe('X')
    expect(capturedMessages).toEqual([{ role: 'user', content: 'hi' }])
    expect(capturedModel).toBe('mid')
  })
})
