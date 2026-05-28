import { describe, it, expect, beforeEach } from 'vitest'
import { AnnotationStore, type Persister } from '../../src/store/AnnotationStore'

class MemPersister implements Persister {
  private data: Record<string, unknown> = {}
  get<T>(key: string, defaultValue: T): T {
    return (this.data[key] as T) ?? defaultValue
  }
  async update(key: string, value: unknown): Promise<void> {
    this.data[key] = value
  }
}

describe('AnnotationStore', () => {
  let p: MemPersister
  let store: AnnotationStore
  beforeEach(() => {
    p = new MemPersister()
    store = new AnnotationStore(p)
  })

  it('create 返回带 id 的卡片并归到对应 sessionId', async () => {
    const card = await store.create({ sessionId: 's1', selectedText: 'foo' })
    expect(card.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(card.sessionId).toBe('s1')
    expect(card.selectedText).toBe('foo')
    expect(card.turns).toHaveLength(1)
    expect(card.turns[0]).toMatchObject({ role: 'ai', text: '' })
    expect(card.explained).toBe(false)
    expect(card.resolved).toBe(false)
    expect(store.get('s1')).toHaveLength(1)
  })

  it('get 不同 sessionId 互相隔离', async () => {
    await store.create({ sessionId: 's1', selectedText: 'a' })
    await store.create({ sessionId: 's2', selectedText: 'b' })
    expect(store.get('s1')).toHaveLength(1)
    expect(store.get('s2')).toHaveLength(1)
    expect(store.get('s3')).toHaveLength(0)
  })

  it('appendStreamChunk 累加到最后一条 AI turn', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.appendStreamChunk(c.id, 'Hel')
    await store.appendStreamChunk(c.id, 'lo')
    const got = store.get('s1')[0]
    expect(got.turns).toEqual([{ role: 'ai', text: 'Hello', ts: expect.any(Number) }])
  })

  it('finalizeCard 设置 explained=true', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.appendStreamChunk(c.id, 'done')
    await store.finalizeCard(c.id)
    expect(store.get('s1')[0].explained).toBe(true)
  })

  it('appendTurn 追加 user turn 并新开一个空 ai turn 占位', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.appendStreamChunk(c.id, 'A1')
    await store.finalizeCard(c.id)
    await store.appendTurn(c.id, { role: 'user', text: 'follow' })
    const turns = store.get('s1')[0].turns
    expect(turns).toHaveLength(3)
    expect(turns[1]).toMatchObject({ role: 'user', text: 'follow' })
    expect(turns[2]).toMatchObject({ role: 'ai', text: '' })
  })

  it('markResolved 切换 resolved', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.markResolved(c.id, true)
    expect(store.get('s1')[0].resolved).toBe(true)
  })

  it('delete 移除卡片', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.delete(c.id)
    expect(store.get('s1')).toHaveLength(0)
  })

  it('onChange 在 create 时触发', async () => {
    const calls: string[] = []
    store.onChange((sid) => calls.push(sid))
    await store.create({ sessionId: 's1', selectedText: 'x' })
    expect(calls).toEqual(['s1'])
  })

  it('findCard 能跨 session 按 id 查到', async () => {
    await store.create({ sessionId: 's1', selectedText: 'a' })
    const c2 = await store.create({ sessionId: 's2', selectedText: 'b' })
    expect(store.findCard(c2.id)?.selectedText).toBe('b')
    expect(store.findCard('not-exist')).toBeUndefined()
  })

  it('setError 写入与清除错误', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.setError(c.id, '网络异常')
    expect(store.findCard(c.id)?.error).toBe('网络异常')
    await store.setError(c.id, null)
    expect(store.findCard(c.id)?.error).toBeUndefined()
  })
})
