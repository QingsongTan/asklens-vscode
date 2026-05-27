import type { LLMAdapter, ExplainOptions } from './types'
import { buildMessages } from './promptBuilder'
import type { FetchFn } from './ClaudeAdapter'

export class OpenAIAdapter implements LLMAdapter {
  constructor(private opts: { apiKey: string; fetchFn?: FetchFn; baseUrl?: string }) {}

  async *explain(opts: ExplainOptions): AsyncIterable<string> {
    const f = this.opts.fetchFn ?? fetch
    const res = await f((this.opts.baseUrl ?? 'https://api.openai.com') + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.modelId,
        stream: true,
        messages: buildMessages(opts),
      }),
    })
    if (!res.ok || !res.body) throw new Error(`OpenAI API ${res.status}`)
    yield* parse(res.body)
  }
}

async function* parse(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
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
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') return
      try {
        const obj = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
        const t = obj.choices?.[0]?.delta?.content
        if (t) yield t
      } catch {
        /* ignore */
      }
    }
  }
}
