import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { AnnotationStore } from '../store/AnnotationStore'
import type { ExtToWeb, WebToExt } from './messages'

export class AnnotationViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ask-anytime.annotations'
  private view?: vscode.WebviewView

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: AnnotationStore,
    private currentSessionId: () => string,
    private handlers: {
      onFollowUp: (cardId: string, text: string) => void | Promise<void>
      onRetry: (cardId: string) => void | Promise<void>
    },
  ) {
    store.onChange((sid) => {
      if (sid === this.currentSessionId()) this.renderCurrent()
    })
  }

  setCurrentSession(_sid: string): void {
    this.renderCurrent()
  }

  reveal(): void {
    void vscode.commands.executeCommand(`${AnnotationViewProvider.viewType}.focus`)
  }

  postStreamChunk(cardId: string, chunk: string): void {
    this.post({ kind: 'card-stream', cardId, chunk })
  }
  postDone(cardId: string): void {
    this.post({ kind: 'card-done', cardId })
  }
  postError(cardId: string, message: string): void {
    this.post({ kind: 'card-error', cardId, message })
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'media')],
    }
    view.webview.html = this.buildHtml(view.webview)
    view.webview.onDidReceiveMessage(async (m: WebToExt) => {
      switch (m.kind) {
        case 'follow-up': await this.handlers.onFollowUp(m.cardId, m.text); break
        case 'mark-resolved': await this.store.markResolved(m.cardId, m.resolved); break
        case 'delete': await this.store.delete(m.cardId); break
        case 'retry': await this.handlers.onRetry(m.cardId); break
        case 'open-settings':
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:tanqs.ask-anytime')
          break
      }
    })
    this.renderCurrent()
  }

  private renderCurrent(): void {
    if (!this.view) return
    const sid = this.currentSessionId()
    this.post({ kind: 'render', cards: this.store.get(sid), currentSessionId: sid })
  }

  private post(msg: ExtToWeb): void {
    this.view?.webview.postMessage(msg)
  }

  private buildHtml(webview: vscode.Webview): string {
    const mediaDir = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'media')
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'main.js'))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'style.css'))
    const nonce = randomNonce()
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ')
    const html = fs.readFileSync(path.join(this.extensionUri.fsPath, 'src', 'webview', 'media', 'index.html'), 'utf8')
    return html
      .replace('{{CSP}}', csp)
      .replace('{{STYLE}}', styleUri.toString())
      .replace('{{SCRIPT}}', scriptUri.toString())
      .replace(/{{NONCE}}/g, nonce)
  }
}

function randomNonce(): string {
  return randomBytes(16).toString('hex')
}
