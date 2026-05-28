import * as vscode from 'vscode'
import * as path from 'node:path'
import * as os from 'node:os'
import { AnnotationStore, type Persister } from './store/AnnotationStore'
import { SessionTracker } from './session/SessionTracker'
import { installHook, uninstallHook, isHookInstalled } from './session/hookInstaller'
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
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? home

  const persister: Persister = {
    get: (k, d) => context.globalState.get(k, d),
    update: (k, v) => Promise.resolve(context.globalState.update(k, v)),
  }
  const store = new AnnotationStore(persister)

  const tracker = new SessionTracker({ home, workspace, staleMs: 30_000 })
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

  tracker.onSessionChanged((s) => provider.setCurrentSession(s?.sessionId ?? NO_SESSION))

  async function runExplain(cardId: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('ask-anytime')
    const providerId = cfg.get<ProviderId>('provider', 'claude')
    const modelId = cfg.get<string>('model', 'claude-opus-4-7')
    const cur = tracker.getCurrentSession()
    const conversation = cur
      ? await buildContext(cur.transcriptPath, { maxTokens: 100_000 }).catch(() => [])
      : []
    const card = store.findCard(cardId)
    if (!card) return
    try {
      let full = ''
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
      await store.finalizeCard(cardId)
      provider.postDone(cardId)
    } catch (e) {
      provider.postError(cardId, (e as Error).message)
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

  return { store, tracker }
}

async function ensureHookInstalled(context: vscode.ExtensionContext, home: string): Promise<void> {
  if (await isHookInstalled({ home })) return
  const choice = await vscode.window.showInformationMessage(
    'Ask Anytime 需要在 ~/.claude/settings.json 安装一个 SessionStart hook 才能精准感知 Claude Code 会话。是否同意安装?',
    '安装', '使用兜底方案(不安装)',
  )
  if (choice === '安装') {
    const script = path.join(context.extensionPath, 'hook', 'write_session.js')
    await installHook({ home, hookScriptPath: script })
    void vscode.window.showInformationMessage('hook 已安装,可通过 "Ask Anytime: 移除 SessionStart hook" 卸载')
  }
}

async function buildRouter(context: vscode.ExtensionContext): Promise<LLMRouter> {
  const claudeKey = (await context.secrets.get(SECRET_KEYS.claude)) ?? ''
  const openaiKey = (await context.secrets.get(SECRET_KEYS.openai)) ?? ''
  return new LLMRouter({
    claude: new ClaudeAdapter({ apiKey: claudeKey }),
    openai: new OpenAIAdapter({ apiKey: openaiKey }),
    ollama: new OllamaAdapter({}),
  })
}
