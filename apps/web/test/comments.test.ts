import test from 'node:test'
import assert from 'node:assert/strict'
import { commentThreads, filterCommentThreads } from '../src/lib/comments'
import type { Comment } from '../src/lib/types'

const comment = (id: string, parentId?: string): Comment => ({ id, parentId, body: id, userName: 'Writer', userId: 'u' })

test('nested legacy replies stay with the root, even when replies arrive first', () => {
  const rows = [comment('nested', 'reply'), comment('reply', 'root'), comment('root'), comment('page')]
  const threads = commentThreads(rows)
  assert.equal(threads.length, 2)
  assert.equal(threads[0]?.root.id, 'root')
  assert.deepEqual(threads[0]?.replies.map((reply) => reply.id), ['nested', 'reply'])
})

test('missing parents and corrupt cycles remain readable without looping', () => {
  const rows = [comment('orphan', 'gone'), comment('a', 'b'), comment('b', 'a')]
  assert.deepEqual(commentThreads(rows).map((thread) => thread.root.id), ['orphan', 'a', 'b'])
})

test('author and status filters keep the whole discussion when a reply matches', () => {
  const root = { ...comment('root'), status: 'resolved' as const }
  const reply = { ...comment('reply', 'root'), userId: 'other' }
  const page = comment('page')
  const threads = commentThreads([root, reply, page])
  assert.deepEqual(filterCommentThreads(threads, 'all', 'other').map((thread) => thread.root.id), ['root'])
  assert.equal(filterCommentThreads(threads, 'open', 'other').length, 0)
  assert.equal(filterCommentThreads(threads, 'resolved', 'other')[0]?.replies.length, 1)
  assert.equal(filterCommentThreads(threads, 'all', 'missing').length, 0)
})
