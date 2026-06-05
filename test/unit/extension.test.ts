import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { STABLE_HOOK_FILENAME } from '../../src/session/hookInstaller'

const vscodeMock = vi.hoisted(() => {
  const showErrorMessage = vi.fn()
  const showInformationMessage = vi.fn()

  return {
    showErrorMessage,
    showInformationMessage,
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
        getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
        onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
      },
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
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

import { ensureHookInstalledOnStartup } from '../../src/extension'

describe('extension hook startup', () => {
  let home: string
  let extensionPath: string
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'home-'))
    extensionPath = mkdtempSync(join(tmpdir(), 'ext-'))
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
      'settings.json 无法解析，Ask Anytime 已跳过 hook 安装/更新且未修改该文件，仍可使用兜底会话感知。',
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
      'Ask Anytime: hook 安装/更新失败，已停止本次 hook 安装/更新，仍可使用兜底会话感知。',
    )
    expect(vscodeMock.showInformationMessage).not.toHaveBeenCalledWith(
      'Ask Anytime: 已更新 SessionStart hook 到稳定路径 (避免扩展升级后失效)',
    )
    expect(vscodeMock.showInformationMessage).not.toHaveBeenCalledWith(
      'hook 已安装,可通过 "Ask Anytime: 移除 SessionStart hook" 卸载',
    )
  })
})
