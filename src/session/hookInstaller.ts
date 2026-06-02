import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// 旧版扁平结构 entry 的标签, 仅用于自动迁移识别 (新装条目不再写 tag)
export const HOOK_TAG = 'ask-anytime/write_session/v1'

export const STABLE_HOOK_FILENAME = 'ask-anytime-hook.js'

type CommandHook = { type?: string; command?: string }
type HookEntry = {
  matcher?: string
  hooks?: CommandHook[]
  // 旧版字段, 仅用于读旧 settings.json 时识别需要迁移的条目
  command?: string
  tag?: string
}
type Settings = { hooks?: { SessionStart?: HookEntry[] } }

function settingsPath(home: string): { dir: string; file: string } {
  const dir = join(home, '.claude')
  return { dir, file: join(dir, 'settings.json') }
}

async function readSettings(home: string): Promise<Settings> {
  const { file } = settingsPath(home)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (e) {
    console.warn('[ask-anytime] 无法解析 ~/.claude/settings.json, 将以空配置覆盖写入(可能丢失用户配置):', e)
    return {}
  }
}

async function writeSettings(home: string, s: Settings): Promise<void> {
  const { dir, file } = settingsPath(home)
  await mkdir(dir, { recursive: true })
  await writeFile(file, JSON.stringify(s, null, 2))
}

function entryContainsOurScript(entry: HookEntry): boolean {
  if (entry.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(STABLE_HOOK_FILENAME))) {
    return true
  }
  // 旧扁平格式
  if (typeof entry.command === 'string' && entry.command.includes(STABLE_HOOK_FILENAME)) return true
  if (entry.tag === HOOK_TAG) return true
  return false
}

export async function isHookInstalled(opts: { home: string }): Promise<boolean> {
  const s = await readSettings(opts.home)
  return (s.hooks?.SessionStart ?? []).some(entryContainsOurScript)
}

export async function installHook(opts: { home: string; hookScriptPath: string }): Promise<void> {
  const s = await readSettings(opts.home)
  s.hooks ??= {}
  s.hooks.SessionStart ??= []
  if (s.hooks.SessionStart.some(entryContainsOurScript)) return
  s.hooks.SessionStart.push({
    hooks: [{ type: 'command', command: `node "${opts.hookScriptPath}"` }],
  })
  await writeSettings(opts.home, s)
}

export async function uninstallHook(opts: { home: string }): Promise<void> {
  const s = await readSettings(opts.home)
  if (!s.hooks?.SessionStart) return
  s.hooks.SessionStart = s.hooks.SessionStart.filter((e) => !entryContainsOurScript(e))
  await writeSettings(opts.home, s)
}

export function getStableHookPath(home: string): string {
  return join(home, '.claude', STABLE_HOOK_FILENAME)
}

export async function copyHookScript(opts: { home: string; srcPath: string }): Promise<void> {
  const { dir } = settingsPath(opts.home)
  await mkdir(dir, { recursive: true })
  await copyFile(opts.srcPath, getStableHookPath(opts.home))
}

// 仅识别"新格式且命令指向期望路径"的条目, 旧扁平条目即使路径正确也返回 false, 触发 ensureHookInstalled 自动迁移
export async function isHookInstalledAtPath(opts: { home: string; expectedScriptPath: string }): Promise<boolean> {
  const s = await readSettings(opts.home)
  return (s.hooks?.SessionStart ?? []).some((entry) =>
    entry.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(opts.expectedScriptPath)),
  )
}
