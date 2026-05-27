export function workspaceHash(absPath: string): string {
  return absPath.replace(/[\\/:]/g, '-')
}
