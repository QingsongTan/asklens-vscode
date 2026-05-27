import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { workspaceHash } from './workspaceHash'

export type Session = { sessionId: string; transcriptPath: string; cwd: string }

type Listener = (s: Session | null) => void

export class SessionTracker {
  private current: Session | null = null
  private listeners: Listener[] = []
  private watcher?: FSWatcher
  private hookFile: string

  constructor(private opts: { home: string; workspace: string; staleMs: number }) {
    this.hookFile = join(opts.home, '.claude', '.ask_anytime_session.json')
  }

  async init(): Promise<void> {
    await this.refresh()
    try {
      this.watcher = watch(join(this.opts.home, '.claude'), (_event, file) => {
        if (file === '.ask_anytime_session.json') void this.refresh()
      })
    } catch {
      /* 目录不存在等情况无视 */
    }
  }

  getCurrentSession(): Session | null {
    return this.current
  }

  onSessionChanged(l: Listener): void {
    this.listeners.push(l)
  }

  dispose(): void {
    this.watcher?.close()
    this.listeners = []
  }

  private async refresh(): Promise<void> {
    const next = (await this.fromHook()) ?? (await this.fromMtime())
    if (next?.sessionId !== this.current?.sessionId) {
      this.current = next
      for (const l of this.listeners) l(next)
    }
  }

  private async fromHook(): Promise<Session | null> {
    if (!existsSync(this.hookFile)) return null
    try {
      const data = JSON.parse(await readFile(this.hookFile, 'utf8'))
      if (typeof data.updatedAt === 'number' && Date.now() - data.updatedAt > this.opts.staleMs) {
        return null
      }
      if (!data.sessionId || !data.transcriptPath) return null
      return { sessionId: data.sessionId, transcriptPath: data.transcriptPath, cwd: data.cwd ?? '' }
    } catch {
      return null
    }
  }

  private async fromMtime(): Promise<Session | null> {
    const dir = join(this.opts.home, '.claude', 'projects', workspaceHash(this.opts.workspace))
    if (!existsSync(dir)) return null
    const entries = await readdir(dir)
    const jsonls = entries.filter((e) => e.endsWith('.jsonl'))
    if (jsonls.length === 0) return null
    const stats = await Promise.all(jsonls.map(async (f) => ({
      f,
      mtime: (await stat(join(dir, f))).mtimeMs,
    })))
    stats.sort((a, b) => b.mtime - a.mtime)
    const file = stats[0].f
    return {
      sessionId: file.replace(/\.jsonl$/, ''),
      transcriptPath: join(dir, file),
      cwd: this.opts.workspace,
    }
  }
}
