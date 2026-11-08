import { test } from 'node:test'
import assert from 'node:assert/strict'
import { excerpt, formatDate, relativeTime, snippetText, wordCount } from '../src/lib/format.ts'

test('formatDate renders a short chinese date and tolerates bad input', () => {
  assert.equal(formatDate(undefined), '')
  assert.equal(formatDate(''), '')
  assert.equal(formatDate('not-a-date'), '')
  assert.match(formatDate('2024-03-15T12:00:00.000Z'), /3月/)
})

test('wordCount counts CJK characters and latin words', () => {
  assert.equal(wordCount(''), 0)
  assert.equal(wordCount(undefined), 0)
  assert.equal(wordCount('hello world'), 2)
  assert.equal(wordCount('你好世界'), 4)
  assert.equal(wordCount('你好 hello world'), 4)
  assert.equal(wordCount('   '), 0)
})

test('excerpt collapses whitespace and truncates long text', () => {
  assert.equal(excerpt('line one\n\n  line two'), 'line one line two')
  assert.equal(excerpt(undefined), '')
  assert.equal(excerpt('abc', 10), 'abc')
  const long = 'a'.repeat(200)
  const result = excerpt(long, 20)
  assert.equal(result.length, 21)
  assert.ok(result.endsWith('…'))
})

test('snippetText removes highlight markup before rendering', () => {
  assert.equal(snippetText('<b>季度</b>计划 正文'), ' 季度 计划 正文')
  assert.equal(snippetText(undefined), '')
  assert.equal(excerpt(snippetText('<b>季度</b>\n\n计划'), 40), '季度 计划')
})

test('relativeTime buckets recent timestamps', () => {
  const now = Date.parse('2024-03-15T12:00:00.000Z')
  assert.equal(relativeTime(undefined, now), '')
  assert.equal(relativeTime('not-a-date', now), '')
  assert.equal(relativeTime(new Date(now - 30_000).toISOString(), now), '刚刚')
  assert.equal(relativeTime(new Date(now - 5 * 60_000).toISOString(), now), '5 分钟前')
  assert.equal(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now), '3 小时前')
  assert.equal(relativeTime(new Date(now - 2 * 86_400_000).toISOString(), now), '2 天前')
  assert.match(relativeTime('2024-03-01T12:00:00.000Z', now), /3月/)
})
