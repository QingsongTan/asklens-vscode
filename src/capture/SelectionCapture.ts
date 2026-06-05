import type { Session } from '../session/SessionTracker'

export type SelectionDeps = {
  getSelection: () => string
  readClipboard: () => Promise<string>
  getCurrentSession: () => Session | null
  showInfo: (msg: string) => void
  confirmEmptyTextMode: () => Promise<boolean>
  revealSidebar: () => void
  createCard: (opts: { sessionId: string; selectedText: string }) => Promise<{ id: string }>
  explainCard: (cardId: string) => Promise<void>
}

export const NO_SESSION = '__none__'

export async function handleExplainSelection(d: SelectionDeps): Promise<void> {
  // 先看编辑器选区
  let text = d.getSelection()
  // 拿不到则 fallback 到剪贴板 (覆盖 Claude Code webview 等无法读 selection 的场景)
  if (!text || text.trim() === '') {
    text = await d.readClipboard()
  }
  if (!text || text.trim() === '') {
    d.showInfo('请先选中要解释的文字后按 Ctrl+Enter 触发')
    return
  }
  let sessionId: string
  const cur = d.getCurrentSession()
  if (cur) {
    sessionId = cur.sessionId
  } else {
    const ok = await d.confirmEmptyTextMode()
    if (!ok) return
    sessionId = NO_SESSION
  }
  const card = await d.createCard({ sessionId, selectedText: text })
  d.revealSidebar()
  await d.explainCard(card.id)
}
