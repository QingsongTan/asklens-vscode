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
import type { ProviderId, LLMAdapter } from './llm/types'
import { handleExplainSelection, NO_SESSION } from './capture/SelectionCapture'
import { AnnotationViewProvider } from './webview/AnnotationViewProvider'
import { handleExportKnowledge } from './exporter/exportCommand'

// 所有 Provider 的元数据 (label / 默认 baseUrl / 预置 model) 集中在这里
// 复用此常量驱动 SECRET_KEYS / buildRouter / setApiKey / clearApiKey / switchModel
type ProviderPreset = {
  id: ProviderId
  label: string
  hint?: string
  baseUrl?: string  // OpenAI 兼容 provider 的默认 baseUrl; claude/ollama 由各自 adapter 处理
  models: string[]
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'claude', label: 'Claude (Anthropic)', hint: 'sk-ant-...', models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { id: 'openai', label: 'OpenAI', hint: 'sk-...', models: ['gpt-4o', 'gpt-4.1', 'o3', 'o3-mini'] },
  { id: 'deepseek', label: 'DeepSeek', hint: 'sk-...', baseUrl: 'https://api.deepseek.com', models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-reasoner', 'deepseek-chat'] },
  { id: 'qwen', label: '通义千问 (Qwen, 阿里)', hint: 'sk-...', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3-max', 'qwen-plus', 'qwen-turbo', 'qwen3-coder-plus'] },
  { id: 'kimi', label: 'Kimi (月之暗面)', hint: 'sk-...', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2-0905-preview', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'] },
  { id: 'glm', label: 'GLM (智谱)', hint: 'xxx.xxx', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.6', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'] },
  { id: 'doubao', label: '豆包 (字节火山)', hint: 'xxx', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['ep-在火山控制台填推理点 ID'] },
  { id: 'hunyuan', label: '混元 (腾讯)', hint: 'sk-...', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', models: ['hunyuan-large', 'hunyuan-turbo', 'hunyuan-standard-256K'] },
  { id: 'minimax', label: 'MiniMax', hint: 'eyJ...', baseUrl: 'https://api.minimax.chat/v1', models: ['MiniMax-M2', 'abab6.5-chat', 'abab6.5s-chat'] },
  { id: 'yi', label: 'Yi (零一万物)', hint: 'xxx', baseUrl: 'https://api.lingyiwanwu.com/v1', models: ['yi-large', 'yi-large-turbo', 'yi-medium', 'yi-lightning'] },
  { id: 'step', label: '阶跃 (Step)', hint: 'xxx', baseUrl: 'https://api.stepfun.com/v1', models: ['step-2-16k', 'step-2-mini', 'step-1v-8k'] },
  { id: 'ernie', label: '文心 (百度千帆)', hint: 'xxx', baseUrl: 'https://qianfan.baidubce.com/v2', models: ['ernie-4.0-turbo-8k', 'ernie-3.5-128k', 'ernie-speed-128k'] },
  { id: 'ollama', label: 'Ollama (本地)', models: ['llama3.1:8b', 'qwen2.5:7b', 'qwen3:8b'] },
]

const SECRET_KEYS = PROVIDER_PRESETS.reduce((acc, p) => {
  acc[p.id] = `ask-anytime.${p.id}.apiKey`
  return acc
}, {} as Record<ProviderId, string>)

// Provider 需要 API key 的 (排除 ollama)
const KEYED_PROVIDERS = PROVIDER_PRESETS.filter((p) => p.id !== 'ollama')

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

  let router = await buildRouter(context)

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
        readClipboard: () => Promise.resolve(vscode.env.clipboard.readText()),
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
    vscode.commands.registerCommand('ask-anytime.exportKnowledge', async () => {
      const cfg = vscode.workspace.getConfiguration('ask-anytime')
      await handleExportKnowledge({
        store,
        router,
        getProvider: () => cfg.get<ProviderId>('provider', 'claude'),
        getModelId: () => cfg.get<string>('model', 'claude-opus-4-7'),
        getMaxTokens: () => 100_000,
      })
    }),
    vscode.commands.registerCommand('ask-anytime.setApiKey', async () => {
      const providerPick = await vscode.window.showQuickPick(
        KEYED_PROVIDERS.map((p) => ({ label: p.label, value: p.id, hint: p.hint ?? 'sk-...' })),
        { title: 'Ask Anytime: 选择要配置 API key 的 Provider' },
      )
      if (!providerPick) return
      const key = await vscode.window.showInputBox({
        title: `Ask Anytime: 输入 ${providerPick.label} API key`,
        placeHolder: providerPick.hint,
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim().length === 0 ? '不能为空' : null),
      })
      if (!key) return
      await context.secrets.store(SECRET_KEYS[providerPick.value], key.trim())
      router = await buildRouter(context)
      void vscode.window.showInformationMessage(`Ask Anytime: 已保存 ${providerPick.label} API key`)
    }),
    vscode.commands.registerCommand('ask-anytime.switchModel', async () => {
      const providerPick = await vscode.window.showQuickPick(
        PROVIDER_PRESETS.map((p) => ({ label: p.label, value: p.id, models: p.models })),
        { title: 'Ask Anytime: 选择 Provider' },
      )
      if (!providerPick) return

      type ModelItem = vscode.QuickPickItem & { value: string }
      const modelItems: ModelItem[] = [
        ...providerPick.models.map((m) => ({ label: m, value: m })),
        { label: '$(edit) 自定义...', value: '__custom__', description: '手动输入模型 ID' },
      ]
      const modelPick = await vscode.window.showQuickPick(modelItems, {
        title: `Ask Anytime: 选择 ${providerPick.label} 的 Model`,
      })
      if (!modelPick) return

      let modelId = modelPick.value
      if (modelId === '__custom__') {
        const custom = await vscode.window.showInputBox({
          title: `Ask Anytime: 输入 ${providerPick.label} 的 Model ID`,
          placeHolder: 'e.g. gpt-4o-mini, deepseek-chat, llama3.2:3b',
          ignoreFocusOut: true,
          validateInput: (v) => (v.trim().length === 0 ? '不能为空' : null),
        })
        if (!custom) return
        modelId = custom.trim()
      }

      const cfg = vscode.workspace.getConfiguration('ask-anytime')
      await cfg.update('provider', providerPick.value, vscode.ConfigurationTarget.Global)
      await cfg.update('model', modelId, vscode.ConfigurationTarget.Global)
      void vscode.window.showInformationMessage(
        `Ask Anytime: 已切换到 ${providerPick.label} / ${modelId}`,
      )
    }),
    vscode.commands.registerCommand('ask-anytime.clearApiKey', async () => {
      const providerPick = await vscode.window.showQuickPick(
        KEYED_PROVIDERS.map((p) => ({ label: p.label, value: p.id })),
        { title: 'Ask Anytime: 选择要清除 API key 的 Provider' },
      )
      if (!providerPick) return
      await context.secrets.delete(SECRET_KEYS[providerPick.value])
      router = await buildRouter(context)
      void vscode.window.showInformationMessage(`Ask Anytime: 已清除 ${providerPick.label} API key`)
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
  const cfg = vscode.workspace.getConfiguration('ask-anytime')
  // 用户可在 settings.json 通过 `ask-anytime.<provider>.baseUrl` 覆盖默认 baseUrl (走中转/镜像)
  const resolveBaseUrl = (id: ProviderId, fallback?: string): string | undefined =>
    cfg.get<string>(`${id}.baseUrl`) || fallback

  const adapters = {} as Record<ProviderId, LLMAdapter>
  for (const p of PROVIDER_PRESETS) {
    const apiKey = (await context.secrets.get(SECRET_KEYS[p.id])) ?? ''
    if (p.id === 'claude') {
      adapters[p.id] = new ClaudeAdapter({ apiKey })
    } else if (p.id === 'ollama') {
      adapters[p.id] = new OllamaAdapter({ baseUrl: resolveBaseUrl(p.id, p.baseUrl) })
    } else {
      // 其余全部走 OpenAI 兼容
      adapters[p.id] = new OpenAIAdapter({ apiKey, baseUrl: resolveBaseUrl(p.id, p.baseUrl) })
    }
  }
  return new LLMRouter(adapters)
}
