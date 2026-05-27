import { describe, it, expect, vi } from 'vitest'
import { handleExplainSelection, type SelectionDeps } from '../../src/capture/SelectionCapture'

function deps(over: Partial<SelectionDeps> = {}): SelectionDeps {
  return {
    getSelection: vi.fn(() => 'some text'),
    getCurrentSession: vi.fn(() => ({ sessionId: 's1', transcriptPath: '/x', cwd: '/' })),
    showInfo: vi.fn(),
    confirmEmptyTextMode: vi.fn(async () => true),
    revealSidebar: vi.fn(),
    createCard: vi.fn(async () => ({ id: 'c1' })),
    explainCard: vi.fn(async () => undefined),
    ...over,
  }
}

describe('SelectionCapture.handleExplainSelection', () => {
  it('选区为空 → 提示并返回, 不建卡片', async () => {
    const d = deps({ getSelection: () => '' })
    await handleExplainSelection(d)
    expect(d.showInfo).toHaveBeenCalledWith(expect.stringContaining('选中'))
    expect(d.createCard).not.toHaveBeenCalled()
  })

  it('正常路径: 拿选区 + session → 建卡 + 唤起侧栏 + 触发解释', async () => {
    const d = deps()
    await handleExplainSelection(d)
    expect(d.createCard).toHaveBeenCalledWith({ sessionId: 's1', selectedText: 'some text' })
    expect(d.revealSidebar).toHaveBeenCalled()
    expect(d.explainCard).toHaveBeenCalledWith('c1')
  })

  it('无 session: 用户确认走纯文本模式 → 用 sessionId="__none__" 建卡', async () => {
    const d = deps({ getCurrentSession: () => null, confirmEmptyTextMode: async () => true })
    await handleExplainSelection(d)
    expect(d.createCard).toHaveBeenCalledWith({ sessionId: '__none__', selectedText: 'some text' })
  })

  it('无 session: 用户拒绝 → 取消', async () => {
    const d = deps({ getCurrentSession: () => null, confirmEmptyTextMode: async () => false })
    await handleExplainSelection(d)
    expect(d.createCard).not.toHaveBeenCalled()
  })
})
