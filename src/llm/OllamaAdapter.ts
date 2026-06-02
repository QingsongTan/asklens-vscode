import type { LLMAdapter, ExplainOptions, Message } from './types'
import { buildMessages } from './promptBuilder'
import type { FetchFn } from './ClaudeAdapter'

export class OllamaAdapter implements LLMAdapter {
  constructor(private opts: { baseUrl?: string; fetchFn?: FetchFn }) {}

  async *explain(opts: ExplainOptions): AsyncIterable<string> {
    yield* this.chat(buildMessages(opts), opts.modelId)
  }

  async *chat(messages: Message[], modelId: string): AsyncIterable<string> {
    const f = this.opts.fetchFn ?? fetch
    const url = (this.opts.baseUrl ?? 'http://127.0.0.1:11434') + '/api/chat'
    let res: Response
    try {
      res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          stream: true,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })
    } catch (e) {
      const msg = (e as Error).message ?? ''
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        throw new Error('无法连接到 Ollama,确认 ollama 服务已运行 (ollama serve)')
      }
      throw e
    }
    if (!res.ok || !res.body) throw new Error(`Ollama API ${res.status}`)
    yield* parseNd(res.body)
  }
}

async function* parseNd(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
        if (obj.message?.content) yield obj.message.content
        if (obj.done) return
      } catch {
        /* ignore */
      }
    }
  }
}
