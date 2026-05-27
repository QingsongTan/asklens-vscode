#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let payload = {}
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const home = process.env.HOME || process.env.USERPROFILE || os.homedir()
  const dir = path.join(home, '.claude')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    process.exit(0)
  }

  const out = {
    sessionId: payload.session_id ?? null,
    cwd: payload.cwd ?? null,
    transcriptPath: payload.transcript_path ?? null,
    updatedAt: Date.now(),
  }
  try {
    fs.writeFileSync(path.join(dir, '.ask_anytime_session.json'), JSON.stringify(out))
  } catch {
    /* ignore — 永不打断 Claude Code */
  }
  process.exit(0)
})
