import type { Session } from '../session/SessionTracker'

export type SelectionDeps = {
  getSelection: () => string
  getCurrentSession: () => Session | null
  showInfo: (msg: string) => void
  confirmEmptyTextMode: () => Promise<boolean>
  revealSidebar: () => void
  createCard: (opts: { sessionId: string; selectedText: string }) => Promise<{ id: string }>
  explainCard: (cardId: string) => Promise<void>
}

export const NO_SESSION = '__none__'

export async function handleExplainSelection(d: SelectionDeps): Promise<void> {
  const text = d.getSelection()
  if (!text || text.trim() === '') {
    d.showInfo('请先选中要解释的文字')
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
