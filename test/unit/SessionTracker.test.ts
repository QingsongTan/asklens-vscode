import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionTracker } from '../../src/session/SessionTracker'

describe('SessionTracker', () => {
  let home: string
  let projectsDir: string
  let tracker: SessionTracker

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'home-'))
    projectsDir = join(home, '.claude', 'projects')
    mkdirSync(projectsDir, { recursive: true })
  })
  afterEach(() => {
    tracker?.dispose()
    rmSync(home, { recursive: true, force: true })
  })

  it('hook 文件存在时, 立即拿到 sessionId', async () => {
    writeFileSync(join(home, '.claude', '.ask_anytime_session.json'), JSON.stringify({
      sessionId: 'hook-sid',
      transcriptPath: '/p/hook-sid.jsonl',
      cwd: '/p',
      updatedAt: Date.now(),
    }))
    tracker = new SessionTracker({ home, workspace: '/p', staleMs: 30_000 })
    await tracker.init()
    expect(tracker.getCurrentSession()).toMatchObject({ sessionId: 'hook-sid' })
  })

  it('hook 文件过期时, 用 mtime 最新的 jsonl 兜底', async () => {
    const dir = join(projectsDir, '-p')
    mkdirSync(dir)
    writeFileSync(join(dir, 'old.jsonl'), '')
    writeFileSync(join(dir, 'new.jsonl'), '')
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(dir, 'old.jsonl'), old, old)
    tracker = new SessionTracker({ home, workspace: '/p', staleMs: 1 })
    await tracker.init()
    expect(tracker.getCurrentSession()?.sessionId).toBe('new')
  })

  it('hook 文件变更触发 onSessionChanged', async () => {
    tracker = new SessionTracker({ home, workspace: '/p', staleMs: 30_000 })
    await tracker.init()
    const seen: string[] = []
    tracker.onSessionChanged((s) => { if (s) seen.push(s.sessionId) })
    writeFileSync(join(home, '.claude', '.ask_anytime_session.json'), JSON.stringify({
      sessionId: 'changed',
      transcriptPath: '/p/changed.jsonl',
      cwd: '/p',
      updatedAt: Date.now(),
    }))
    await vi.waitFor(() => expect(seen).toContain('changed'), { timeout: 2000 })
  })

  it('hook 与兜底都无数据时, getCurrentSession 返回 null', async () => {
    tracker = new SessionTracker({ home, workspace: '/empty', staleMs: 30_000 })
    await tracker.init()
    expect(tracker.getCurrentSession()).toBeNull()
  })

  it('fs.watch 回调 filename 为 null 时仍触发 refresh (跨平台兜底)', async () => {
    let capturedCb: ((event: string, file: string | null) => void) | undefined
    const fakeWatcher = { close: () => {} } as unknown as import('node:fs').FSWatcher
    const fakeWatch = ((_p: unknown, cb: unknown) => {
      capturedCb = cb as (event: string, file: string | null) => void
      return fakeWatcher
    }) as unknown as typeof import('node:fs').watch

    tracker = new SessionTracker({ home, workspace: '/p', staleMs: 30_000, watchFn: fakeWatch })
    await tracker.init()
    expect(tracker.getCurrentSession()).toBeNull()

    // 写入 hook 文件, 然后用 null filename 触发回调
    writeFileSync(join(home, '.claude', '.ask_anytime_session.json'), JSON.stringify({
      sessionId: 'via-null', transcriptPath: '/p/x.jsonl', cwd: '/p', updatedAt: Date.now(),
    }))
    capturedCb?.('change', null)
    await vi.waitFor(() => expect(tracker.getCurrentSession()?.sessionId).toBe('via-null'), { timeout: 2000 })
  })
})
