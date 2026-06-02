import type { AnnotationCard } from '../store/AnnotationStore'
import type { Message } from '../llm/types'

export type ChatFn = (messages: Message[], modelId: string) => AsyncIterable<string>

const ARTICLE_SYSTEM = [
  '你是知识整理助手。下面是用户在 Claude Code 协作过程中产生的多个"术语解释卡片",',
  '每张卡片包含原文片段 + AI 初次解释 + 多轮追问 Q&A。',
  '请把这些卡片合成一篇结构化的中文知识文章, 要求:',
  '1) 提炼核心概念列表, 每个概念用 ## 二级标题',
  '2) 每个概念给出定义、用法、例子 (从原 Q&A 归纳, 不要照抄原文)',
  '3) 在合适处标注概念之间的关联',
  '4) 不臆造原文未出现的事实, 不确定的标"原文未明确"',
  '5) 输出纯 Markdown, 顶层用 # 一级标题概括本次主题',
].join(' ')

function shortSid(sid: string): string {
  if (sid === '__none__') return '无会话'
  return sid.length > 8 ? sid.slice(0, 8) : sid
}

function truncateTitle(s: string, max = 40): string {
  const oneLine = s.replace(/\n/g, ' ')
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine
}

function formatQuote(s: string): string {
  return s.split('\n').map((l) => '> ' + l).join('\n')
}

export function renderRaw(cards: AnnotationCard[], opts?: { now?: Date }): string {
  const now = opts?.now ?? new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const sessionIds = new Set(cards.map((c) => c.sessionId))

  const out: string[] = []
  out.push(`# Ask Anytime 知识导出 (${dateStr})`)
  out.push('')
  out.push(`> 共 ${cards.length} 张卡片, 来自 ${sessionIds.size} 个会话`)
  out.push('')

  for (const c of cards) {
    const title =
      `## [${shortSid(c.sessionId)}] ${truncateTitle(c.selectedText)}` + (c.resolved ? ' ✓' : '')
    out.push(title)
    out.push('')
    out.push(formatQuote(c.selectedText))
    out.push('')

    c.turns.forEach((t, idx) => {
      if (!t.text) return
      if (idx === 0 && t.role === 'ai') {
        out.push('**初次解释**:')
        out.push(t.text)
        out.push('')
      } else if (t.role === 'user') {
        out.push(`**追问**: ${t.text}`)
        out.push('')
      } else if (t.role === 'ai') {
        out.push(`**回答**: ${t.text}`)
        out.push('')
      }
    })

    if (c.error) {
      out.push(`**❌ 错误**: ${c.error}`)
      out.push('')
    }
    out.push('---')
    out.push('')
  }

  return out.join('\n')
}

export function buildArticleMessages(cards: AnnotationCard[]): Message[] {
  const body = cards
    .map((c, i) => {
      const lines: string[] = []
      lines.push(`卡片 ${i + 1}:`)
      lines.push(`原文: ${c.selectedText}`)
      c.turns.forEach((t, idx) => {
        if (!t.text) return
        if (idx === 0 && t.role === 'ai') lines.push(`初次解释: ${t.text}`)
        else if (t.role === 'user') lines.push(`追问: ${t.text}`)
        else if (t.role === 'ai') lines.push(`回答: ${t.text}`)
      })
      return lines.join('\n')
    })
    .join('\n---\n')

  const userContent = `以下是 ${cards.length} 张卡片的内容:\n---\n${body}\n---\n请把它们整合为知识文章。`

  return [
    { role: 'system', content: ARTICLE_SYSTEM },
    { role: 'user', content: userContent },
  ]
}

export async function* renderArticle(
  cards: AnnotationCard[],
  chat: ChatFn,
  opts: { modelId: string },
): AsyncIterable<string> {
  const messages = buildArticleMessages(cards)
  yield* chat(messages, opts.modelId)
}

export function estimateArticleTokens(cards: AnnotationCard[]): number {
  const messages = buildArticleMessages(cards)
  return messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0)
}
