export type Message = { role: 'system' | 'user' | 'assistant'; content: string }

export type ExplainOptions = {
  selectedText: string
  conversation: Message[]
  followUps: { role: 'user' | 'ai'; text: string }[]
  modelId: string
}

export interface LLMAdapter {
  explain(opts: ExplainOptions): AsyncIterable<string>
}

export type ProviderId = 'claude' | 'openai' | 'ollama'
