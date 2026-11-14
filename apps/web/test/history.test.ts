import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffHistoryDocuments, diffHistoryText, historyDay, historyEventLabel, normalizeHistoryJson } from '../src/lib/history'
import type { DocJson, HistoryItem } from '../src/lib/types'

const p = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })
const doc = (...nodes): DocJson => ({ schemaVersion: 1, doc: { type: 'doc', content: nodes } })
const event = (action, details = {}): HistoryItem => ({ id: 'event:id', kind: 'event', userId: 'private-user-id', userName: '小林', createdAt: '2026-11-15T02:20:00Z', action, details })

test('normalization is immutable and ignores key order and neutral empty/null fields', () => {
  const before = { type: 'paragraph', attrs: { textAlign: null }, marks: [], content: [] }
  const frozen = JSON.stringify(before)
  assert.deepEqual(normalizeHistoryJson(before), normalizeHistoryJson({ type: 'paragraph' }))
  assert.equal(JSON.stringify(before), frozen)
  assert.deepEqual(normalizeHistoryJson({ checked: false, level: 0, language: 'bash' }), { checked: false, language: 'bash', level: 0 })
  assert.equal(diffHistoryDocuments(doc(before), doc({ type: 'paragraph' }))[0].kind, 'same')
})

test('Chinese and emoji changes preserve Unicode and reconstruct both exact strings', () => {
  const before = '今天整理📚知识库\n版本一', after = '今天完善📚知识库\n版本二'
  const parts = diffHistoryText(before, after)
  assert.equal(parts.filter(part => part.kind !== 'added').map(part => part.text).join(''), before)
  assert.equal(parts.filter(part => part.kind !== 'removed').map(part => part.text).join(''), after)
  assert.ok(parts.some(part => part.kind === 'same' && part.text.includes('📚')))
  assert.ok(parts.some(part => part.kind === 'added' && part.text === '完善'))
})

test('block alignment isolates added/deleted paragraphs instead of shifting the rest of the document', () => {
  const result = diffHistoryDocuments(doc(p('A'), p('remove'), p('B'), p('C')), doc(p('A'), p('B'), p('add'), p('C')))
  assert.deepEqual(result.map(block => [block.kind, block.before?.text, block.after?.text]), [
    ['same', 'A', 'A'], ['removed', 'remove', undefined], ['same', 'B', 'B'], ['added', undefined, 'add'], ['same', 'C', 'C'],
  ])
})

test('plain text edits and structural conversions are distinguished', () => {
  const text = diffHistoryDocuments(doc(p('draft')), doc(p('draft revised')))[0]
  assert.equal(text.kind, 'modified'); assert.equal(text.structureChanged, false)
  const heading = { type: 'heading', attrs: { level: 1 }, content: p('draft').content }
  const structural = diffHistoryDocuments(doc(p('draft')), doc(heading))[0]
  assert.equal(structural.structureChanged, true)
  assert.equal(structural.before?.label, '正文'); assert.equal(structural.after?.label, '标题 1')
  const bold = { type: 'paragraph', content: [{ type: 'text', text: 'draft', marks: [{ type: 'bold' }] }] }
  assert.equal(diffHistoryDocuments(doc(p('draft')), doc(bold))[0].structureChanged, true)
})

test('code language, task state, table shape and image source are retained as meaningful changes', () => {
  const code = language => ({ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text: 'a\n b' }] })
  const codeDiff = diffHistoryDocuments(doc(code('bash')), doc(code('python')))[0]
  assert.equal(codeDiff.structureChanged, true); assert.equal(codeDiff.after?.text, 'a\n b')
  const tasks = checked => ({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked }, content: [p('ship')] }] })
  assert.equal(diffHistoryDocuments(doc(tasks(false)), doc(tasks(true)))[0].structureChanged, true)
  const row = text => ({ type: 'tableRow', content: [{ type: 'tableCell', content: [p(text)] }] })
  const table = rows => ({ type: 'table', content: rows })
  const tableDiff = diffHistoryDocuments(doc(table([row('A')])), doc(table([row('A'), row('B')])))[0]
  assert.equal(tableDiff.before?.label, '表格 · 1 行 × 1 列'); assert.equal(tableDiff.after?.label, '表格 · 2 行 × 1 列')
  assert.equal(tableDiff.structureChanged, true)
  const image = src => ({ type: 'image', attrs: { src, alt: 'diagram' } })
  assert.equal(diffHistoryDocuments(doc(image('/a.png')), doc(image('/b.png')))[0].structureChanged, true)
})

test('bounded text diff still reconstructs large inputs without a quadratic matrix', () => {
  const before = '共同开头'.repeat(2000) + '旧段落' + '共同结尾'.repeat(2000)
  const after = '共同开头'.repeat(2000) + '新段落' + '共同结尾'.repeat(2000)
  const parts = diffHistoryText(before, after)
  assert.equal(parts.filter(part => part.kind !== 'added').map(part => part.text).join(''), before)
  assert.equal(parts.filter(part => part.kind !== 'removed').map(part => part.text).join(''), after)
  assert.ok(parts.length <= 5)
})

test('event summaries use server-authorized names and never reveal raw IDs', () => {
  assert.equal(historyEventLabel(event('rename', { beforeTitle: '旧名', afterTitle: '新名' })), '将“旧名”改名为“新名”')
  assert.equal(historyEventLabel(event('move', { fromParentTitle: '受限文件夹', toParentTitle: '团队资料', fromParentId: 'secret-folder' })), '从“受限文件夹”移至“团队资料”')
  assert.equal(historyEventLabel(event('acl', { targetUserId: 'secret-user', targetUserName: '小林', afterRole: 'viewer' })), '将小林的权限设为可查看')
  assert.equal(historyEventLabel(event('history_restore', { sourceVersion: 8 })), '将文档恢复到版本 8')
  assert.equal(historyEventLabel(event('restore')), '恢复了文档', 'legacy restore must not invent the source')
  for (const action of ['share_link_created', 'share_link_revoked', 'trash', 'trash_restore']) assert.notEqual(historyEventLabel(event(action)), '更新了文档设置')
  assert.equal(historyDay('invalid'), '日期未知')
})
