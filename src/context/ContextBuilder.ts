import { readFile, open, stat } from 'node:fs/promises'
import type { Message } from '../llm/types'

type RawLine = {
  type?: string
  message?: {
    role?: string
    content?: string | Array<{ type: string; text?: string }>
  }
}

const estimateTokens = (s: string): number => Math.ceil(s.length / 4)

// estimateTokens 注: 粗估 (4 字符/token), 对中文严重低估 (中文常 1 字符 ≈ 0.6-1 token),
// 仅用于"上下文预算上限"的保守估算, 非精确 token 计数。

const DEFAULT_LARGE_FILE_THRESHOLD = 8 * 1024 * 1024  // 8 MB
const DEFAULT_TAIL_WINDOW = 4 * 1024 * 1024            // 4 MB

async function readJsonlSmart(
  p: string,
  largeFileThreshold: number,
  tailWindow: number,
): Promise<string> {
  const { size } = await stat(p)
  if (size <= largeFileThreshold) {
    return readFile(p, 'utf8')
  }
  const readSize = Math.min(tailWindow, size)
  const start = size - readSize
  const fh = await open(p, 'r')
  try {
    const buf = Buffer.alloc(readSize)
    await fh.read(buf, 0, readSize, start)
    const text = buf.toString('utf8')
    // 丢弃首行 (从尾部窗口起点切入, 第一行可能被截断不完整)
    const firstNewline = text.indexOf('\n')
    return firstNewline >= 0 ? text.slice(firstNewline + 1) : ''
  } finally {
    await fh.close()
  }
}

export async function buildContext(
  transcriptPath: string,
  opts: {
    maxTokens: number
    largeFileThreshold?: number
    tailWindow?: number
  },
): Promise<Message[]> {
  const raw = await readJsonlSmart(
    transcriptPath,
    opts.largeFileThreshold ?? DEFAULT_LARGE_FILE_THRESHOLD,
    opts.tailWindow ?? DEFAULT_TAIL_WINDOW,
  )
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
