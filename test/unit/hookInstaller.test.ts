import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isHookInstalled,
  installHook,
  uninstallHook,
  isHookInstalledAtPath,
  copyHookScript,
  getStableHookPath,
  HOOK_TAG,
  STABLE_HOOK_FILENAME,
} from '../../src/session/hookInstaller'

describe('hookInstaller', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'home-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('settings.json 不存在时, install 自动创建并写入 Claude Code 兼容的双层格式', async () => {
    await installHook({ home, hookScriptPath: `/ext/${STABLE_HOOK_FILENAME}` })
    const p = join(home, '.claude', 'settings.json')
    expect(existsSync(p)).toBe(true)
    const cfg = JSON.parse(readFileSync(p, 'utf8'))
    expect(cfg.hooks.SessionStart).toHaveLength(1)
    const entry = cfg.hooks.SessionStart[0]
    expect(entry.hooks).toEqual([
      { type: 'command', command: `node "/ext/${STABLE_HOOK_FILENAME}"` },
    ])
  })

  it('保留用户已有的 SessionStart hooks 在前, 我们的新格式 entry 追加在后', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'echo hi' }] },
        ],
      },
    }))
    await installHook({ home, hookScriptPath: `/ext/${STABLE_HOOK_FILENAME}` })
    const cfg = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart).toHaveLength(2)
    expect(cfg.hooks.SessionStart[0]).toEqual({ hooks: [{ type: 'command', command: 'echo hi' }] })
  })

  it('重复 install 幂等(不会重复追加)', async () => {
    await installHook({ home, hookScriptPath: `/ext/${STABLE_HOOK_FILENAME}` })
    await installHook({ home, hookScriptPath: `/ext/${STABLE_HOOK_FILENAME}` })
    const cfg = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart).toHaveLength(1)
  })

  it('settings.json 为坏 JSON 时, install 报错且不覆盖原文件', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    const settings = join(dir, 'settings.json')
    const original = '{"hooks":'
    writeFileSync(settings, original)

    await expect(installHook({ home, hookScriptPath: `/ext/${STABLE_HOOK_FILENAME}` })).rejects.toThrow('无法解析')
    expect(readFileSync(settings, 'utf8')).toBe(original)
  })

  it('settings.json 读取失败时, install 不包装成 JSON 解析错误', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(dir, 'settings.json'))

    let error: unknown
    try {
      await installHook({ home, hookScriptPath: `/ext/${STABLE_HOOK_FILENAME}` })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain('无法解析')
  })

  it('uninstall 仅移除含 ask-anytime-hook.js 的 entry, 保留用户已有 hooks', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'echo hi' }] },
          { hooks: [{ type: 'command', command: `node /ext/${STABLE_HOOK_FILENAME}` }] },
        ],
      },
    }))
    await uninstallHook({ home })
    const cfg = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart).toEqual([
      { hooks: [{ type: 'command', command: 'echo hi' }] },
    ])
  })

  it('settings.json 为坏 JSON 时, uninstall 报错且不覆盖原文件', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    const settings = join(dir, 'settings.json')
    const original = '{"hooks":'
    writeFileSync(settings, original)

    await expect(uninstallHook({ home })).rejects.toThrow('无法解析')
    expect(readFileSync(settings, 'utf8')).toBe(original)
  })

  it('uninstall 也能识别旧扁平格式 (含 tag 或含 ask-anytime-hook.js 的 entry.command)', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'echo hi' }] },
          { command: `node /OLD/${STABLE_HOOK_FILENAME}`, tag: HOOK_TAG },
        ],
      },
    }))
    await uninstallHook({ home })
    const cfg = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart).toEqual([
      { hooks: [{ type: 'command', command: 'echo hi' }] },
    ])
  })

  it('isHookInstalled 反映现状 (兼容新旧格式)', async () => {
    expect(await isHookInstalled({ home })).toBe(false)
    await installHook({ home, hookScriptPath: `/ext/${STABLE_HOOK_FILENAME}` })
    expect(await isHookInstalled({ home })).toBe(true)
  })

  it('isHookInstalled 识别旧扁平 tag 条目', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [
          { command: `node /OLD/${STABLE_HOOK_FILENAME}`, tag: HOOK_TAG },
        ],
      },
    }))
    expect(await isHookInstalled({ home })).toBe(true)
  })

  it('isHookInstalled 不把 ask-anytime-hook.js.bak 误判为本扩展 hook', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: `node "/OLD/${STABLE_HOOK_FILENAME}.bak"` }] },
        ],
      },
    }))
    expect(await isHookInstalled({ home })).toBe(false)
  })

  it('copyHookScript: 把脚本复制到 ~/.claude/ask-anytime-hook.js', async () => {
    const src = join(home, 'src-hook.js')
    writeFileSync(src, '// fake hook\n')
    await copyHookScript({ home, srcPath: src })
    const dst = getStableHookPath(home)
    expect(dst).toBe(join(home, '.claude', STABLE_HOOK_FILENAME))
    expect(readFileSync(dst, 'utf8')).toBe('// fake hook\n')
  })

  it('copyHookScript: ~/.claude 不存在时自动创建', async () => {
    rmSync(join(home, '.claude'), { recursive: true, force: true })
    const src = join(home, 'src-hook.js')
    writeFileSync(src, 'x')
    await copyHookScript({ home, srcPath: src })
    expect(existsSync(join(home, '.claude', STABLE_HOOK_FILENAME))).toBe(true)
  })

  it('isHookInstalledAtPath: 新格式且路径匹配返回 true', async () => {
    await installHook({ home, hookScriptPath: `/NEW/${STABLE_HOOK_FILENAME}` })
    expect(await isHookInstalledAtPath({ home, expectedScriptPath: `/NEW/${STABLE_HOOK_FILENAME}` })).toBe(true)
    expect(await isHookInstalledAtPath({ home, expectedScriptPath: `/OTHER/${STABLE_HOOK_FILENAME}` })).toBe(false)
  })

  it('isHookInstalledAtPath: 不把 ask-anytime-hook.js.bak 误判为稳定路径', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: `node "/NEW/${STABLE_HOOK_FILENAME}.bak"` }] },
        ],
      },
    }))
    expect(await isHookInstalledAtPath({ home, expectedScriptPath: `/NEW/${STABLE_HOOK_FILENAME}` })).toBe(false)
  })

  it('uninstall 不移除仅指向 ask-anytime-hook.js.bak 的用户 hook', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    const hook = { hooks: [{ type: 'command', command: `node "/USER/${STABLE_HOOK_FILENAME}.bak"` }] }
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: { SessionStart: [hook] },
    }))

    await uninstallHook({ home })

    const cfg = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart).toEqual([hook])
  })

  it('isHookInstalledAtPath: 旧扁平格式即使路径正确也返回 false (触发迁移)', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [
          { command: `node "/OLD/${STABLE_HOOK_FILENAME}"`, tag: HOOK_TAG },
        ],
      },
    }))
    expect(await isHookInstalledAtPath({ home, expectedScriptPath: `/OLD/${STABLE_HOOK_FILENAME}` })).toBe(false)
    // 但 isHookInstalled 仍为 true, 触发 ensureHookInstalled 走 uninstall+install 迁移
    expect(await isHookInstalled({ home })).toBe(true)
  })
})
