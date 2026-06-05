import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface ObsidianExportResult {
  noteCount: number
  outputDir: string
}

export function parseConceptSections(markdown: string): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string }> = []
  const lines = markdown.split('\n')
  let currentTitle: string | null = null
  let bodyLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('## ') && !line.startsWith('### ')) {
      if (currentTitle !== null) {
        sections.push({ title: currentTitle, body: bodyLines.join('\n').trim() })
      }
      currentTitle = line.slice(3).trim()
      bodyLines = []
    } else if (currentTitle !== null) {
      bodyLines.push(line)
    }
  }
  if (currentTitle !== null) {
    sections.push({ title: currentTitle, body: bodyLines.join('\n').trim() })
  }
  return sections
}

function addWikiLinks(text: string, otherTitles: string[]): string {
  // Sort longest first to avoid partial replacements (e.g. "VSCode" before "VSCode 扩展")
  const sorted = [...otherTitles].sort((a, b) => b.length - a.length)
  let result = text
  for (const title of sorted) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Skip if already wrapped in [[...]]
    result = result.replace(new RegExp(`(?<!\\[\\[)${escaped}(?!\\]\\])`, 'g'), `[[${title}]]`)
  }
  return result
}

function buildNoteContent(title: string, body: string, otherTitles: string[], date: string): string {
  const linkedBody = addWikiLinks(body, otherTitles)
  return [
    '---',
    'tags: [asklens, 知识卡片]',
    'aliases: []',
    `created: ${date}`,
    '---',
    '',
    `# ${title}`,
    '',
    linkedBody,
    '',
  ].join('\n')
}

function buildMOC(sections: Array<{ title: string }>, date: string, sourceFile: string): string {
  const links = sections.map((s) => `- [[${s.title}]]`).join('\n')
  return [
    '---',
    'tags: [MOC, asklens]',
    `created: ${date}`,
    '---',
    '',
    `# AskLens 知识地图 - ${date}`,
    '',
    `> 来源: ${path.basename(sourceFile)}`,
    '',
    '## 概念列表',
    '',
    links,
    '',
  ].join('\n')
}

export async function exportToObsidian(
  exportedFilePath: string,
  vaultPath: string,
): Promise<ObsidianExportResult> {
  const raw = await fs.readFile(exportedFilePath, 'utf-8')
  const date = new Date().toISOString().slice(0, 10)
  const sections = parseConceptSections(raw)

  if (sections.length === 0) {
    return { noteCount: 0, outputDir: vaultPath }
  }

  const outputDir = path.join(vaultPath, `asklens-${date}`)
  await fs.mkdir(outputDir, { recursive: true })

  const allTitles = sections.map((s) => s.title)
  await Promise.all(
    sections.map((s) => {
      const otherTitles = allTitles.filter((t) => t !== s.title)
      const content = buildNoteContent(s.title, s.body, otherTitles, date)
      return fs.writeFile(path.join(outputDir, `${s.title}.md`), content, 'utf-8')
    }),
  )

  const moc = buildMOC(sections, date, exportedFilePath)
  await fs.writeFile(path.join(outputDir, `000-MOC-asklens-${date}.md`), moc, 'utf-8')

  return { noteCount: sections.length, outputDir }
}
