import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as vscode from 'vscode'

export async function run(): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  const dir = path.join(home, '.claude', 'projects', '-tmp-ws')
  fs.mkdirSync(dir, { recursive: true })
  const transcript = path.join(dir, 'sess1.jsonl')
  fs.writeFileSync(transcript, JSON.stringify({
    type: 'assistant', message: { role: 'assistant', content: '一段示例回答 retry policy' },
  }) + '\n')
  fs.writeFileSync(path.join(home, '.claude', '.ask_anytime_session.json'), JSON.stringify({
    sessionId: 'sess1', cwd: '/tmp/ws', transcriptPath: transcript, updatedAt: Date.now(),
  }))

  await vscode.extensions.getExtension('tanqs.ask-anytime')?.activate()
  const doc = await vscode.workspace.openTextDocument({ content: 'retry policy', language: 'plaintext' })
  const editor = await vscode.window.showTextDocument(doc)
  editor.selection = new vscode.Selection(0, 0, 0, 12)
  await vscode.commands.executeCommand('ask-anytime.explainSelection')

  await new Promise((r) => setTimeout(r, 1000))
  const ext = vscode.extensions.getExtension('tanqs.ask-anytime')!
  const api = ext.exports as { store: import('../../src/store/AnnotationStore').AnnotationStore }
  const cards = api.store.get('sess1')
  assert.strictEqual(cards.length, 1)
  assert.strictEqual(cards[0].selectedText, 'retry policy')
}
