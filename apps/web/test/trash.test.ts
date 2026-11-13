import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysUntil, isExpired, trashExpiryLabel } from '../src/lib/trash.ts'

/**
 * The bin's countdown.
 *
 * The clock is passed in, so every band is checked at its boundary instead of
 * at whatever moment the suite happens to run: an off-by-one here tells someone
 * they have a day left on the morning the sweep runs.
 */

const NOW = Date.parse('2024-03-01T12:00:00.000Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const DAY = 86_400_000
const HOUR = 3_600_000
const MINUTE = 60_000

test('missing or unreadable deadlines render as nothing', () => {
  assert.equal(trashExpiryLabel(undefined, NOW), '')
  assert.equal(trashExpiryLabel(null, NOW), '')
  assert.equal(trashExpiryLabel('not-a-date', NOW), '')
  assert.equal(daysUntil('not-a-date', NOW), null)
  assert.equal(isExpired('not-a-date', NOW), false)
})

test('whole days are floored, never rounded up', () => {
  assert.equal(daysUntil(at(30 * DAY), NOW), 30)
  assert.equal(daysUntil(at(29.9 * DAY), NOW), 29)
  assert.equal(daysUntil(at(DAY), NOW), 1)
  // 23h left is zero days, not one.
  assert.equal(daysUntil(at(23 * HOUR), NOW), 0)
})

test('the label switches bands at the day and hour boundaries', () => {
  assert.equal(trashExpiryLabel(at(30 * DAY), NOW), '30 天后自动删除')
  // Exactly one day is still "a day", so the switch is at 24h, not below it.
  assert.equal(trashExpiryLabel(at(DAY), NOW), '1 天后自动删除')
  assert.equal(trashExpiryLabel(at(DAY - MINUTE), NOW), '23 小时后自动删除')
  assert.equal(trashExpiryLabel(at(2 * HOUR), NOW), '2 小时后自动删除')
  assert.equal(trashExpiryLabel(at(HOUR), NOW), '1 小时后自动删除')
  // Under an hour the unit changes again; minutes are what the reader can act on.
  assert.equal(trashExpiryLabel(at(30 * MINUTE), NOW), '30 分钟后自动删除')
  assert.equal(trashExpiryLabel(at(MINUTE), NOW), '1 分钟后自动删除')
})

test('a deadline that has passed reads as expired, not as zero time left', () => {
  assert.equal(trashExpiryLabel(at(0), NOW), '已过期，等待清理')
  assert.equal(trashExpiryLabel(at(-1), NOW), '已过期，等待清理')
  assert.equal(daysUntil(at(-DAY), NOW), 0)
  assert.equal(isExpired(at(0), NOW), true)
  assert.equal(isExpired(at(1), NOW), false)
})

test('a sub-minute remainder still shows a minute rather than zero', () => {
  // The sweep runs on a timer, so the last seconds must not read as "0 分钟后".
  assert.equal(trashExpiryLabel(at(20 * 1000), NOW), '1 分钟后自动删除')
})
