import { runTests } from '@vscode/test-electron'
import * as path from 'node:path'

async function main(): Promise<void> {
  // __dirname at runtime = dist-tests/test/integration, so go up 3 levels to reach project root
  const extensionDevelopmentPath = path.resolve(__dirname, '../../../')
  const extensionTestsPath = path.resolve(__dirname, './e2e.test')
  await runTests({ extensionDevelopmentPath, extensionTestsPath })
}
main().catch((e) => { console.error(e); process.exit(1) })
