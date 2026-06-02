import * as vscode from 'vscode'
import { writeFile } from 'node:fs/promises'
import type { AnnotationStore, AnnotationCard } from '../store/AnnotationStore'
import type { LLMRouter } from '../llm/LLMRouter'
import type { ProviderId } from '../llm/types'
import { renderRaw, renderArticle, estimateArticleTokens } from './Exporter'

export interface ExportDeps {
  store: AnnotationStore
  router: LLMRouter
  getProvider: () => ProviderId
  getModelId: () => string
  getMaxTokens: () => number
}

type CardItem = vscode.QuickPickItem & { card?: AnnotationCard }

export async function handleExportKnowledge(deps: ExportDeps): Promise<void> {
  const allCards: AnnotationCard[] = deps.store.allSessions().flatMap((sid) => deps.store.get(sid))

  if (allCards.length === 0) {
    void vscode.window.showInformationMessage('Ask Anytime: 还没有任何批注卡片可导出')
    return
  }

  // (1) 多选卡片 (按 session 分组)
  const items: CardItem[] = []
  const groups = new Map<string, AnnotationCard[]>()
  for (const c of allCards) {
    const arr = groups.get(c.sessionId) ?? []
    arr.push(c)
    groups.set(c.sessionId, arr)
  }
  for (const [sid, cards] of groups) {
    items.push({
      label: sid === '__none__' ? '— 无会话 —' : `— 会话 ${sid.slice(0, 8)} —`,
      kind: vscode.QuickPickItemKind.Separator,
    })
    for (const c of cards) {
      const oneLine = c.selectedText.replace(/\n/g, ' ')
      const titleShort = oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine
      items.push({
        label: (c.resolved ? '$(check) ' : '') + titleShort,
        description: new Date(c.createdAt).toLocaleString('zh-CN'),
        picked: true,
        card: c,
      })
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Ask Anytime 导出: 勾选要导出的卡片',
    canPickMany: true,
    matchOnDescription: true,
  })
  if (!picked) return
  const selectedCards: AnnotationCard[] = picked
    .filter((p): p is CardItem & { card: AnnotationCard } => !!p.card)
    .map((p) => p.card)
  if (selectedCards.length === 0) return

  // (2) 选格式
  const formatChoice = await vscode.window.showQuickPick(
    [
      { label: '$(book) AI 总结为知识文章', description: '调 LLM 把卡片整合为结构化文章 (耗 token)', value: 'article' as const },
      { label: '$(list-flat) 原文卡片清单', description: '按时间顺序输出 Markdown, 不调用 LLM', value: 'raw' as const },
    ],
    { title: 'Ask Anytime 导出: 选择格式' },
  )
  if (!formatChoice) return

  // (3) saveAs
  const defaultName = `ask-anytime-knowledge-${new Date().toISOString().slice(0, 10)}.md`
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri
  const defaultUri = folder
    ? vscode.Uri.joinPath(folder, defaultName)
    : vscode.Uri.file(defaultName)
  const fileUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { Markdown: ['md'] },
  })
  if (!fileUri) return

  // (4) 生成内容
  let content: string
  if (formatChoice.value === 'raw') {
    content = renderRaw(selectedCards)
  } else {
    const tokens = estimateArticleTokens(selectedCards)
    const budget = deps.getMaxTokens()
    if (tokens > budget * 0.7) {
      const proceed = await vscode.window.showWarningMessage(
        `选中卡片估算约 ${tokens} tokens, 超过预算 70% (${Math.floor(budget * 0.7)})。建议减少卡片再试。`,
        '仍要继续', '取消',
      )
      if (proceed !== '仍要继续') return
    }

    const provider = deps.getProvider()
    const modelId = deps.getModelId()
    const chunks: string[] = []
    let failed: Error | undefined
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Ask Anytime: 正在生成知识文章…', cancellable: false },
      async () => {
        try {
          for await (const chunk of renderArticle(
            selectedCards,
            (msgs, mid) => deps.router.chat(provider, msgs, mid),
            { modelId },
          )) {
            chunks.push(chunk)
          }
        } catch (e) {
          failed = e as Error
        }
      },
    )
    if (failed) {
      void vscode.window.showErrorMessage('Ask Anytime: 生成失败 — ' + failed.message)
      return
    }
    content = chunks.join('')
  }

  // (5) 写文件 + 打开预览
  await writeFile(fileUri.fsPath, content, 'utf8')
  const doc = await vscode.workspace.openTextDocument(fileUri)
  await vscode.window.showTextDocument(doc, { preview: false })
  void vscode.window.showInformationMessage(
    `Ask Anytime: 已导出 ${selectedCards.length} 张卡片到 ${fileUri.fsPath}`,
  )
}
