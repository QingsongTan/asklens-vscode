import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const HOOK_TAG = 'ask-anytime/write_session/v1'

type HookEntry = { command: string; tag?: string }
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
  } catch {
    return {}
  }
}

async function writeSettings(home: string, s: Settings): Promise<void> {
  const { dir, file } = settingsPath(home)
  await mkdir(dir, { recursive: true })
  await writeFile(file, JSON.stringify(s, null, 2))
}

export async function isHookInstalled(opts: { home: string }): Promise<boolean> {
  const s = await readSettings(opts.home)
  return (s.hooks?.SessionStart ?? []).some((h) => h.tag === HOOK_TAG)
}

export async function installHook(opts: { home: string; hookScriptPath: string }): Promise<void> {
  const s = await readSettings(opts.home)
  s.hooks ??= {}
  s.hooks.SessionStart ??= []
  if (s.hooks.SessionStart.some((h) => h.tag === HOOK_TAG)) return
  s.hooks.SessionStart.push({
    command: `node "${opts.hookScriptPath}"`,
    tag: HOOK_TAG,
  })
  await writeSettings(opts.home, s)
}

export async function uninstallHook(opts: { home: string }): Promise<void> {
  const s = await readSettings(opts.home)
  if (!s.hooks?.SessionStart) return
  s.hooks.SessionStart = s.hooks.SessionStart.filter((h) => h.tag !== HOOK_TAG)
  await writeSettings(opts.home, s)
}
