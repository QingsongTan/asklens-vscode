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
})
