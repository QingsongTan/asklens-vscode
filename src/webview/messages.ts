import type { AnnotationCard } from '../store/AnnotationStore'

export type ExtToWeb =
  | { kind: 'render'; cards: AnnotationCard[]; currentSessionId: string }
  | { kind: 'card-stream'; cardId: string; chunk: string }
  | { kind: 'card-done'; cardId: string }
  | { kind: 'card-error'; cardId: string; message: string }

export type WebToExt =
  | { kind: 'follow-up'; cardId: string; text: string }
  | { kind: 'mark-resolved'; cardId: string; resolved: boolean }
  | { kind: 'delete'; cardId: string }
  | { kind: 'retry'; cardId: string }
  | { kind: 'open-settings' }
