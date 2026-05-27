import { describe, it, expect } from 'vitest'
import { workspaceHash } from '../../src/session/workspaceHash'

describe('workspaceHash', () => {
  it('POSIX 绝对路径: 把 / 替换成 -', () => {
    expect(workspaceHash('/home/u/proj')).toBe('-home-u-proj')
  })

  it('Windows 路径: 把 \\ 和 : 替换成 -', () => {
    expect(workspaceHash('C:\\Users\\me\\proj')).toBe('C--Users-me-proj')
  })

  it('Windows 正斜杠路径', () => {
    expect(workspaceHash('C:/Users/me/proj')).toBe('C--Users-me-proj')
  })

  it('结尾斜杠/反斜杠会带上一个 - (与 Claude Code 实测对齐)', () => {
    expect(workspaceHash('/home/u/proj/')).toBe('-home-u-proj-')
  })

  it('Unicode 路径里的非 ASCII 字符保留 (Claude Code 不动它们)', () => {
    expect(workspaceHash('/home/张三/proj')).toBe('-home-张三-proj')
  })
})
