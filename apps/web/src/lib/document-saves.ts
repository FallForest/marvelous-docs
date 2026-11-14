import type { Doc } from './types'

/** Serialises writes per document and exposes a barrier before history restore. */
export class DocumentSaveQueue {
  private readonly documents = new Map<string, { tail: Promise<void>; latest?: Doc; failure?: unknown }>()

  enqueue(id: string, save: (previous?: Doc) => Promise<Doc>): Promise<Doc> {
    let entry = this.documents.get(id)
    if (!entry) {
      entry = { tail: Promise.resolve() }
      this.documents.set(id, entry)
    }
    const state = entry
    const operation = state.tail.then(() => save(state.latest))
    state.tail = operation.then(
      (document) => { state.latest = document; state.failure = undefined },
      (error: unknown) => { state.failure = error },
    )
    return operation
  }

  async wait(id: string): Promise<void> {
    const state = this.documents.get(id)
    if (!state) return
    // Also wait for writes queued while an earlier request was in flight.
    let tail: Promise<void>
    do { tail = state.tail; await tail } while (tail !== state.tail)
    if (state.failure !== undefined) throw state.failure
  }
}
