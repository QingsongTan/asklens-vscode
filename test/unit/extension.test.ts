import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import manifest from '../../package.json'
import { STABLE_HOOK_FILENAME } from '../../src/session/hookInstaller'

const vscodeMock = vi.hoisted(() => {
  const showErrorMessage = vi.fn()
  const showInformationMessage = vi.fn()
  const registeredCommands = new Map<string, (...args: unknown[]) => unknown>()
  let homeDir = ''

  return {
    showErrorMessage,
    showInformationMessage,
    registeredCommands,
    get homeDir() { return homeDir },
    set homeDir(value: string) { homeDir = value },
    module: {
      window: {
        showErrorMessage,
        showInformationMessage,
        showWarningMessage: vi.fn(),
        showQuickPick: vi.fn(),
        showInputBox: vi.fn(),
        registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
        activeTextEditor: undefined,
      },
      workspace: {
        workspaceFolders: undefined,
        getConfiguration: vi.fn((_section?: string) => ({ get: vi.fn(), update: vi.fn() })),
        onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
      },
      commands: {
        registerCommand: vi.fn((command: string, callback: (...args: unknown[]) => unknown) => {
          registeredCommands.set(command, callback)
          return { dispose: vi.fn() }
        }),
        executeCommand: vi.fn(),
      },
      env: { clipboard: { readText: vi.fn() } },
      ConfigurationTarget: { Global: 1 },
      Uri: {
        file: (fsPath: string) => ({ fsPath, toString: () => fsPath }),
        joinPath: (base: { fsPath: string }, ...parts: string[]) => {
          const fsPath = [base.fsPath, ...parts].join('/')
          return { fsPath, toString: () => fsPath }
        },
      },
    },
  }
})

vi.mock('vscode', () => vscodeMock.module)
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => vscodeMock.homeDir || actual.homedir() }
})

import { activate, ensureHookInstalledOnStartup } from '../../src/extension'

describe('extension hook startup', () => {
  let home: string
  let extensionPath: string
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'home-'))
    extensionPath = mkdtempSync(join(tmpdir(), 'ext-'))
    vscodeMock.homeDir = home
    vscodeMock.showErrorMessage.mockClear()
    vscodeMock.showInformationMessage.mockClear()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
    rmSync(home, { recursive: true, force: true })
    rmSync(extensionPath, { recursive: true, force: true })
  })

  it('settings.json 为坏 JSON 时, 启动安装路径提示错误且不覆盖原文件', async () => {
    const claudeDir = join(home, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    const settings = join(claudeDir, 'settings.json')
    const original = '{"hooks":'
    writeFileSync(settings, original)

    const hookDir = join(extensionPath, 'hook')
    mkdirSync(hookDir, { recursive: true })
    writeFileSync(join(hookDir, 'write_session.js'), '// hook\n')

    const context = { extensionPath } as Parameters<typeof ensureHookInstalledOnStartup>[0]
    await expect(ensureHookInstalledOnStartup(context, home)).resolves.toBeUndefined()

    expect(readFileSync(settings, 'utf8')).toBe(original)
    expect(existsSync(join(claudeDir, STABLE_HOOK_FILENAME))).toBe(false)
    expect(vscodeMock.showErrorMessage).toHaveBeenCalledWith(
      'settings.json 无法解析，AskLens 已跳过 hook 安装/更新且未修改该文件，仍可使用兜底会话感知。',
    )
  })

  it('源 hook 脚本不存在时, 启动安装路径不改 settings 且不显示成功提示', async () => {
    const claudeDir = join(home, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    const settings = join(claudeDir, 'settings.json')
    const original = JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: `node "/old/${STABLE_HOOK_FILENAME}"` }] },
        ],
      },
    })
    writeFileSync(settings, original)

    const context = { extensionPath } as Parameters<typeof ensureHookInstalledOnStartup>[0]
    await expect(ensureHookInstalledOnStartup(context, home)).resolves.toBeUndefined()

    expect(readFileSync(settings, 'utf8')).toBe(original)
    expect(vscodeMock.showErrorMessage).toHaveBeenCalledWith(
      'AskLens: hook 安装/更新失败，已停止本次 hook 安装/更新，仍可使用兜底会话感知。',
    )
    expect(vscodeMock.showInformationMessage).not.toHaveBeenCalledWith(
      'AskLens: 已更新 SessionStart hook 到稳定路径 (避免扩展升级后失效)',
    )
    expect(vscodeMock.showInformationMessage).not.toHaveBeenCalledWith(
      'hook 已安装,可通过 "AskLens: 移除 SessionStart hook" 卸载',
    )
  })
})

describe('extension configuration namespace', () => {
  let home: string
  let extensionPath: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'home-'))
    extensionPath = mkdtempSync(join(tmpdir(), 'ext-'))
    vscodeMock.homeDir = home
    vscodeMock.registeredCommands.clear()
    vscodeMock.module.window.showQuickPick.mockReset()
    vscodeMock.module.window.showInputBox.mockReset()
    vscodeMock.module.window.showInformationMessage.mockReset()
    vscodeMock.module.workspace.getConfiguration.mockReset()
    vscodeMock.module.workspace.onDidChangeWorkspaceFolders.mockReturnValue({ dispose: vi.fn() })
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(extensionPath, { recursive: true, force: true })
  })

  it('切换 Provider / 模型时只写入已注册的 asklens 配置项', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    const hookDir = join(extensionPath, 'hook')
    mkdirSync(hookDir, { recursive: true })
    writeFileSync(join(hookDir, 'write_session.js'), '// hook\n')

    const registeredSettings = new Set(Object.keys(manifest.contributes.configuration.properties))
    const updatedKeys: string[] = []
    vscodeMock.module.workspace.getConfiguration.mockImplementation((section = '') => ({
      get: vi.fn(),
      update: vi.fn(async (key: string) => {
        const fullKey = `${section}.${key}`
        if (!registeredSettings.has(fullKey)) {
          throw new Error(`没有注册配置 ${fullKey}`)
        }
        updatedKeys.push(fullKey)
      }),
    }))
    vscodeMock.module.window.showQuickPick
      .mockResolvedValueOnce({ label: 'DeepSeek', value: 'deepseek', models: ['deepseek-chat'] })
      .mockResolvedValueOnce({ label: 'deepseek-chat', value: 'deepseek-chat' })

    const context = {
      extensionPath,
      extensionUri: { fsPath: extensionPath },
      globalState: { get: vi.fn(), update: vi.fn() },
      secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
      subscriptions: [],
    } as unknown as Parameters<typeof activate>[0]
    await activate(context)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await vscodeMock.registeredCommands.get('asklens.switchModel')?.()

    expect(updatedKeys).toEqual(['asklens.provider', 'asklens.model'])
  })
})
