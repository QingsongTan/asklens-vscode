import { readFile } from 'node:fs/promises'
import type { Message } from '../llm/types'

type RawLine = {
  type?: string
  message?: {
    role?: string
    content?: string | Array<{ type: string; text?: string }>
  }
}

const estimateTokens = (s: string): number => Math.ceil(s.length / 4)

export async function buildContext(
  transcriptPath: string,
  opts: { maxTokens: number },
): Promise<Message[]> {
  const raw = await readFile(transcriptPath, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const msgs: Message[] = []

  for (const line of lines) {
    let obj: RawLine
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj.type !== 'user' && obj.type !== 'assistant') continue
    const m = obj.message
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue
    const content = extractText(m.content)
    if (content === '') continue
    msgs.push({ role: m.role, content })
  }

  const budget = Math.floor(opts.maxTokens * 0.6)
  let total = msgs.reduce((s, m) => s + estimateTokens(m.content), 0)
  if (total <= budget) return msgs

  let truncated = false
  while (msgs.length > 1 && total > budget) {
    const dropped = msgs.shift()!
    total -= estimateTokens(dropped.content)
    truncated = true
  }
  if (truncated) {
    msgs.unshift({ role: 'system', content: '[earlier conversation truncated]' })
  }
  return msgs
}

function extractText(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .filter((b) => b && (b as { type?: string }).type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join('\n')
      .trim()
  }
  return ''
}
