import * as vscode from 'vscode'

export function activate(_context: vscode.ExtensionContext): void {
  console.log('[ask-anytime] activated')
}

export function deactivate(): void {
  console.log('[ask-anytime] deactivated')
}
