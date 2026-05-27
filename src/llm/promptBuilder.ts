import type { ExplainOptions, Message } from './types'

export const SYSTEM_PROMPT = [
  '你是用户的术语翻译官,任务是用清晰、简短、贴近上下文的中文解释一段被选中的文本。',
  '严格基于"用户与 Claude Code 之前的对话"来作答,不要泛泛而谈。',
  '如果对话里有定义/例子,直接引用; 没有再用通识补充,并标明"基于通识"。',
].join(' ')

const MAX_SELECTED = 2200

function truncateSelected(s: string): string {
  if (s.length <= MAX_SELECTED) return s
  return s.slice(0, 2000) + `\n[已截断 ${s.length - 2200} 字符]\n` + s.slice(-200)
}

export function buildMessages(opts: ExplainOptions): Message[] {
  const out: Message[] = []
  out.push({ role: 'system', content: SYSTEM_PROMPT })
  for (const m of opts.conversation) out.push(m)
  out.push({
    role: 'user',
    content: [
      '请结合上文,解释下面这段被选中的文本:',
      '---',
      truncateSelected(opts.selectedText),
      '---',
    ].join('\n'),
  })
  for (const t of opts.followUps) {
    out.push({ role: t.role === 'ai' ? 'assistant' : 'user', content: t.text })
  }
  return out
}
