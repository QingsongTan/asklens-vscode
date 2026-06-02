import type { LLMAdapter, ExplainOptions, Message } from './types'
import { buildMessages } from './promptBuilder'

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

export class ClaudeAdapter implements LLMAdapter {
  constructor(private opts: { apiKey: string; fetchFn?: FetchFn; baseUrl?: string }) {}

  async *explain(opts: ExplainOptions): AsyncIterable<string> {
    yield* this.chat(buildMessages(opts), opts.modelId)
  }

  async *chat(messages: Message[], modelId: string): AsyncIterable<string> {
    const system = messages.find((m) => m.role === 'system')?.content
    const rest = messages.filter((m) => m.role !== 'system') as Array<Message & { role: 'user' | 'assistant' }>
    const f = this.opts.fetchFn ?? fetch
    const res = await f((this.opts.baseUrl ?? 'https://api.anthropic.com') + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1024,
        stream: true,
        system,
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
      }),
    })
    if (!res.ok || !res.body) throw new Error(`Claude API ${res.status}`)
    yield* parseSse(res.body)
  }
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = buf.split('\n\n')
    buf = events.pop() ?? ''
    for (const ev of events) {
      const line = ev.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      const json = line.slice(6).trim()
      try {
        const obj = JSON.parse(json) as { type?: string; delta?: { type?: string; text?: string } }
        if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta' && obj.delta.text) {
          yield obj.delta.text
        }
      } catch {
        /* ignore */
      }
    }
  }
}
