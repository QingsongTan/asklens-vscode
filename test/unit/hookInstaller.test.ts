import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isHookInstalled, installHook, uninstallHook, HOOK_TAG } from '../../src/session/hookInstaller'

describe('hookInstaller', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'home-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('settings.json 不存在时, install 自动创建并写入', async () => {
    await installHook({ home, hookScriptPath: '/ext/hook/write_session.js' })
    const p = join(home, '.claude', 'settings.json')
    expect(existsSync(p)).toBe(true)
    const cfg = JSON.parse(readFileSync(p, 'utf8'))
    expect(cfg.hooks.SessionStart).toContainEqual(
      expect.objectContaining({ command: expect.stringContaining('write_session.js'), tag: HOOK_TAG }),
    )
  })

  it('保留用户已有的 SessionStart hooks', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ command: 'echo hi' }] },
    }))
    await installHook({ home, hookScriptPath: '/ext/hook/write_session.js' })
    const cfg = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart).toHaveLength(2)
    expect(cfg.hooks.SessionStart[0]).toEqual({ command: 'echo hi' })
  })

  it('重复 install 幂等(不会重复追加)', async () => {
    await installHook({ home, hookScriptPath: '/ext/hook/write_session.js' })
    await installHook({ home, hookScriptPath: '/ext/hook/write_session.js' })
    const cfg = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart.filter((h: { tag?: string }) => h.tag === HOOK_TAG)).toHaveLength(1)
  })

  it('uninstall 仅移除带我们 tag 的条目', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [
          { command: 'echo hi' },
          { command: 'node /ext/hook/write_session.js', tag: HOOK_TAG },
        ],
      },
    }))
    await uninstallHook({ home })
    const cfg = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart).toEqual([{ command: 'echo hi' }])
  })

  it('isHookInstalled 反映现状', async () => {
    expect(await isHookInstalled({ home })).toBe(false)
    await installHook({ home, hookScriptPath: '/ext/hook/write_session.js' })
    expect(await isHookInstalled({ home })).toBe(true)
  })

  it('copyHookScript: 把脚本复制到 ~/.claude/ask-anytime-hook.js', async () => {
    const { copyHookScript, getStableHookPath } = await import('../../src/session/hookInstaller.js')
    const src = join(home, 'src-hook.js')
    writeFileSync(src, '// fake hook\n')
    await copyHookScript({ home, srcPath: src })
    const dst = getStableHookPath(home)
    expect(dst).toBe(join(home, '.claude', 'ask-anytime-hook.js'))
    expect(readFileSync(dst, 'utf8')).toBe('// fake hook\n')
  })

  it('copyHookScript: ~/.claude 不存在时自动创建', async () => {
    const { copyHookScript } = await import('../../src/session/hookInstaller.js')
    rmSync(join(home, '.claude'), { recursive: true, force: true })
    const src = join(home, 'src-hook.js')
    writeFileSync(src, 'x')
    await copyHookScript({ home, srcPath: src })
    expect(existsSync(join(home, '.claude', 'ask-anytime-hook.js'))).toBe(true)
  })

  it('isHookInstalledAtPath: 已装但命令路径不一致返回 false', async () => {
    const { installHook, isHookInstalledAtPath } = await import('../../src/session/hookInstaller.js')
    await installHook({ home, hookScriptPath: '/OLD/path/hook.js' })
    expect(await isHookInstalledAtPath({ home, expectedScriptPath: '/NEW/path/hook.js' })).toBe(false)
    expect(await isHookInstalledAtPath({ home, expectedScriptPath: '/OLD/path/hook.js' })).toBe(true)
  })
})
