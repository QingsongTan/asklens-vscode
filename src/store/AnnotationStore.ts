import { randomUUID } from 'node:crypto'

export interface Persister {
  get<T>(key: string, defaultValue: T): T
  update(key: string, value: unknown): Promise<void>
}

export type Turn = { role: 'user' | 'ai'; text: string; ts: number }

export type AnnotationCard = {
  id: string
  sessionId: string
  selectedText: string
  createdAt: number
  explained: boolean
  resolved: boolean
  turns: Turn[]
}

type StoreShape = { [sessionId: string]: AnnotationCard[] }

const KEY = 'ask-anytime.annotations.v1'

export class AnnotationStore {
  private listeners: Array<(sid: string) => void> = []
  constructor(private persister: Persister) {}

  private read(): StoreShape {
    return this.persister.get<StoreShape>(KEY, {})
  }

  private async write(s: StoreShape, touched: string): Promise<void> {
    await this.persister.update(KEY, s)
    for (const l of this.listeners) l(touched)
  }

  onChange(l: (sid: string) => void): void {
    this.listeners.push(l)
  }

  get(sessionId: string): AnnotationCard[] {
    return this.read()[sessionId] ?? []
  }

  async create(opts: { sessionId: string; selectedText: string }): Promise<AnnotationCard> {
    const card: AnnotationCard = {
      id: randomUUID(),
      sessionId: opts.sessionId,
      selectedText: opts.selectedText,
      createdAt: Date.now(),
      explained: false,
      resolved: false,
      turns: [{ role: 'ai', text: '', ts: Date.now() }],
    }
    const s = this.read()
    s[opts.sessionId] = [card, ...(s[opts.sessionId] ?? [])]
    await this.write(s, opts.sessionId)
    return card
  }

  private mutate(cardId: string, fn: (c: AnnotationCard) => void): Promise<void> {
    const s = this.read()
    for (const sid of Object.keys(s)) {
      const idx = s[sid].findIndex((c) => c.id === cardId)
      if (idx >= 0) {
        fn(s[sid][idx])
        return this.write(s, sid)
      }
    }
    return Promise.resolve()
  }

  appendStreamChunk(cardId: string, chunk: string): Promise<void> {
    return this.mutate(cardId, (c) => {
      const last = c.turns[c.turns.length - 1]
      if (last && last.role === 'ai') last.text += chunk
      else c.turns.push({ role: 'ai', text: chunk, ts: Date.now() })
    })
  }

  finalizeCard(cardId: string): Promise<void> {
    return this.mutate(cardId, (c) => {
      c.explained = true
    })
  }

  appendTurn(cardId: string, turn: { role: 'user' | 'ai'; text: string }): Promise<void> {
    return this.mutate(cardId, (c) => {
      c.turns.push({ ...turn, ts: Date.now() })
      if (turn.role === 'user') c.turns.push({ role: 'ai', text: '', ts: Date.now() })
    })
  }

  markResolved(cardId: string, resolved: boolean): Promise<void> {
    return this.mutate(cardId, (c) => {
      c.resolved = resolved
    })
  }

  async delete(cardId: string): Promise<void> {
    const s = this.read()
    for (const sid of Object.keys(s)) {
      const before = s[sid].length
      s[sid] = s[sid].filter((c) => c.id !== cardId)
      if (s[sid].length !== before) {
        await this.write(s, sid)
        return
      }
    }
  }

  findCard(cardId: string): AnnotationCard | undefined {
    const s = this.read()
    for (const sid of Object.keys(s)) {
      const f = s[sid].find((c) => c.id === cardId)
      if (f) return f
    }
    return undefined
  }
}
