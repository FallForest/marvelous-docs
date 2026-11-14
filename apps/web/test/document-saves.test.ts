import test from 'node:test'
import assert from 'node:assert/strict'
import { DocumentSaveQueue } from '../src/lib/document-saves'
import type { Doc } from '../src/lib/types'

const document = (id: string, version: number): Doc => ({ id, title: id, version })
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }

test('queued saves use the previous server version; restore waits through the last write', async () => {
  const queue = new DocumentSaveQueue(), gate = deferred(), order: string[] = []
  const first = queue.enqueue('a', async () => { order.push('first'); await gate.promise; return document('a', 2) })
  const second = queue.enqueue('a', async previous => { order.push('second:' + previous?.version); return document('a', 3) })
  let ready = false
  const barrier = queue.wait('a').then(() => { ready = true })
  await Promise.resolve(); assert.deepEqual(order, ['first']); assert.equal(ready, false)
  gate.resolve(); await Promise.all([first, second, barrier])
  assert.deepEqual(order, ['first', 'second:2']); assert.equal(ready, true)
})

test('a failed save blocks restore until a later successful save; other documents remain independent', async () => {
  const queue = new DocumentSaveQueue(), gate = deferred()
  const pending = queue.enqueue('a', async () => { await gate.promise; throw new Error('offline') })
  assert.equal((await queue.enqueue('b', async () => document('b', 2))).version, 2)
  gate.resolve(); await assert.rejects(pending, /offline/); await assert.rejects(queue.wait('a'), /offline/)
  await queue.enqueue('a', async () => document('a', 4)); await queue.wait('a')
})

test('the restore barrier includes writes appended during a pending request', async () => {
  const queue = new DocumentSaveQueue(), firstGate = deferred(), lastGate = deferred()
  const first = queue.enqueue('a', async () => { await firstGate.promise; return document('a', 2) })
  let ready = false
  const barrier = queue.wait('a').then(() => { ready = true })
  const last = queue.enqueue('a', async () => { await lastGate.promise; return document('a', 3) })
  firstGate.resolve(); await first; await Promise.resolve(); assert.equal(ready, false)
  lastGate.resolve(); await Promise.all([last, barrier]); assert.equal(ready, true)
})
