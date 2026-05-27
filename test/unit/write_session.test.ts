import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const HOOK = resolve(__dirname, '../../hook/write_session.js')

function run(input: string, homeDir: string): Promise<number> {
  return new Promise((resolveP) => {
    const p = spawn('node', [HOOK], { env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir } })
    p.stdin.end(input)
    p.on('close', (code) => resolveP(code ?? 1))
  })
}

describe('write_session.js', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'home-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('合法 JSON 输入 → 写入 .ask_anytime_session.json', async () => {
    const code = await run(JSON.stringify({ session_id: 'abc', cwd: '/x', transcript_path: '/x/abc.jsonl' }), home)
    expect(code).toBe(0)
    const out = join(home, '.claude', '.ask_anytime_session.json')
    expect(existsSync(out)).toBe(true)
    const data = JSON.parse(readFileSync(out, 'utf8'))
    expect(data).toMatchObject({
      sessionId: 'abc',
      cwd: '/x',
      transcriptPath: '/x/abc.jsonl',
    })
    expect(data.updatedAt).toEqual(expect.any(Number))
  })

  it('非法 JSON 输入 → 退出 0 不抛错 (不打断 Claude Code)', async () => {
    const code = await run('not json', home)
    expect(code).toBe(0)
  })

  it('~/.claude 不存在时自动创建', async () => {
    rmSync(join(home, '.claude'), { recursive: true, force: true })
    const code = await run(JSON.stringify({ session_id: 'x' }), home)
    expect(code).toBe(0)
    expect(existsSync(join(home, '.claude'))).toBe(true)
  })
})
