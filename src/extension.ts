import * as vscode from 'vscode'
import * as path from 'node:path'
import * as os from 'node:os'
import { AnnotationStore, type Persister } from './store/AnnotationStore'
import { SessionTracker } from './session/SessionTracker'
import { installHook, uninstallHook, isHookInstalled, isHookInstalledAtPath, copyHookScript, getStableHookPath } from './session/hookInstaller'
import { buildContext } from './context/ContextBuilder'
import { LLMRouter } from './llm/LLMRouter'
import { ClaudeAdapter } from './llm/ClaudeAdapter'
import { OpenAIAdapter } from './llm/OpenAIAdapter'
import { OllamaAdapter } from './llm/OllamaAdapter'
import type { ProviderId } from './llm/types'
import { handleExplainSelection, NO_SESSION } from './capture/SelectionCapture'
import { AnnotationViewProvider } from './webview/AnnotationViewProvider'

const SECRET_KEYS: Record<ProviderId, string> = {
  claude: 'ask-anytime.claude.apiKey',
  openai: 'ask-anytime.openai.apiKey',
  ollama: 'ask-anytime.ollama.apiKey',
}

export async function activate(context: vscode.ExtensionContext): Promise<{ store: AnnotationStore; tracker: SessionTracker }> {
  const home = os.homedir()
  const getCurrentWorkspace = (): string =>
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? home

  const persister: Persister = {
    get: (k, d) => context.globalState.get(k, d),
    update: (k, v) => Promise.resolve(context.globalState.update(k, v)),
  }
  const store = new AnnotationStore(persister)

  let tracker = new SessionTracker({ home, workspace: getCurrentWorkspace(), staleMs: 30_000 })
  await tracker.init()

  void ensureHookInstalled(context, home)

  const router = await buildRouter(context)

  const provider = new AnnotationViewProvider(
    context.extensionUri,
    store,
    () => tracker.getCurrentSession()?.sessionId ?? NO_SESSION,
    {
      onFollowUp: async (cardId, text) => {
        await store.appendTurn(cardId, { role: 'user', text })
        await runExplain(cardId)
      },
      onRetry: async (cardId) => { await runExplain(cardId) },
    },
  )
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AnnotationViewProvider.viewType, provider),
  )

  const attachTrackerListeners = (): void => {
    tracker.onSessionChanged((s) => provider.setCurrentSession(s?.sessionId ?? NO_SESSION))
  }
  attachTrackerListeners()

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      tracker.dispose()
      tracker = new SessionTracker({ home, workspace: getCurrentWorkspace(), staleMs: 30_000 })
      await tracker.init()
      attachTrackerListeners()
      provider.setCurrentSession(tracker.getCurrentSession()?.sessionId ?? NO_SESSION)
    }),
  )

  async function runExplain(cardId: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('ask-anytime')
    const providerId = cfg.get<ProviderId>('provider', 'claude')
    const modelId = cfg.get<string>('model', 'claude-opus-4-7')
    const cur = tracker.getCurrentSession()
    const conversation = cur
      ? await buildContext(cur.transcriptPath, { maxTokens: 100_000 }).catch((e) => {
          console.warn('[ask-anytime] 读取 Claude Code 会话日志失败, 将仅用选中文本解释:', e)
          return []
        })
      : []
    const card = store.findCard(cardId)
    if (!card) return
    let full = ''
    try {
      for await (const chunk of router.explain(providerId, {
        selectedText: card.selectedText,
        conversation,
        followUps: card.turns.slice(0, -1).map((t) => ({ role: t.role, text: t.text })),
        modelId,
      })) {
        full += chunk
        provider.postStreamChunk(cardId, chunk)
      }
      await store.appendStreamChunk(cardId, full)
      await store.setError(cardId, null)
      await store.finalizeCard(cardId)
      provider.postDone(cardId)
    } catch (e) {
      const msg = (e as Error).message
      if (full) await store.appendStreamChunk(cardId, full)
      await store.setError(cardId, msg)
      provider.postError(cardId, msg)
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('ask-anytime.explainSelection', async () => {
      await handleExplainSelection({
        getSelection: () => {
          const ed = vscode.window.activeTextEditor
          if (!ed) return ''
          return ed.document.getText(ed.selection)
        },
        getCurrentSession: () => tracker.getCurrentSession(),
        showInfo: (msg) => void vscode.window.showInformationMessage(msg),
        confirmEmptyTextMode: async () => {
          const choice = await vscode.window.showWarningMessage(
            '未检测到活跃的 Claude Code 会话, 是否仅用选中文本解释?',
            { modal: false }, '继续', '取消',
          )
          return choice === '继续'
        },
        revealSidebar: () => provider.reveal(),
        createCard: (o) => store.create(o),
        explainCard: (id) => runExplain(id),
      })
    }),
    vscode.commands.registerCommand('ask-anytime.uninstallHook', async () => {
      await uninstallHook({ home })
      void vscode.window.showInformationMessage('已移除 Ask Anytime 的 SessionStart hook')
    }),
  )

  context.subscriptions.push({ dispose: () => tracker.dispose() })

  return { store, get tracker() { return tracker } }
}

async function ensureHookInstalled(context: vscode.ExtensionContext, home: string): Promise<void> {
  // 1. 总是把最新版 hook 脚本复制到稳定路径 (相当于升级)
  const srcPath = path.join(context.extensionPath, 'hook', 'write_session.js')
  try {
    await copyHookScript({ home, srcPath })
  } catch (e) {
    console.warn('[ask-anytime] 复制 hook 脚本到稳定路径失败:', e)
  }

  const stablePath = getStableHookPath(home)

  // 2. 已装且路径正确 → 直接返回
  if (await isHookInstalledAtPath({ home, expectedScriptPath: stablePath })) return

  // 3. 已装但路径不是稳定路径 (旧版本残留) → 静默卸载旧条目, 准备装新的
  if (await isHookInstalled({ home })) {
    await uninstallHook({ home })
    await installHook({ home, hookScriptPath: stablePath })
    void vscode.window.showInformationMessage('Ask Anytime: 已更新 SessionStart hook 到稳定路径 (避免扩展升级后失效)')
    return
  }

  // 4. 完全未装 → 询问用户是否安装
  const choice = await vscode.window.showInformationMessage(
    'Ask Anytime 需要在 ~/.claude/settings.json 安装一个 SessionStart hook 才能精准感知 Claude Code 会话。是否同意安装?',
    '安装', '使用兜底方案(不安装)',
  )
  if (choice === '安装') {
    await installHook({ home, hookScriptPath: stablePath })
    void vscode.window.showInformationMessage('hook 已安装,可通过 "Ask Anytime: 移除 SessionStart hook" 卸载')
  }
}

async function buildRouter(context: vscode.ExtensionContext): Promise<LLMRouter> {
  const claudeKey = (await context.secrets.get(SECRET_KEYS.claude)) ?? ''
  const openaiKey = (await context.secrets.get(SECRET_KEYS.openai)) ?? ''
  const ollamaBaseUrl = vscode.workspace.getConfiguration('ask-anytime').get<string>('ollama.baseUrl') || undefined
  return new LLMRouter({
    claude: new ClaudeAdapter({ apiKey: claudeKey }),
    openai: new OpenAIAdapter({ apiKey: openaiKey }),
    ollama: new OllamaAdapter({ baseUrl: ollamaBaseUrl }),
  })
}
