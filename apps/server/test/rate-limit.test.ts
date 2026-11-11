import test from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter } from '../src/lib/rate-limit.js'

/** A limiter whose clock the test drives, so no relying on real time. */
function fixedClock(start = 1_000_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

test('allows requests up to the limit then blocks', () => {
  const clock = fixedClock()
  const limiter = new RateLimiter({ limit: 3, windowMs: 60_000, now: clock.now })
  for (let i = 0; i < 3; i += 1) {
    const result = limiter.consume('user:a')
    assert.equal(result.allowed, true, 'call ' + (i + 1) + ' allowed')
  }
  const blocked = limiter.consume('user:a')
  assert.equal(blocked.allowed, false)
  if (!blocked.allowed) assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60)
})

test('the window rolls over and the budget resets', () => {
  const clock = fixedClock()
  const limiter = new RateLimiter({ limit: 2, windowMs: 10_000, now: clock.now })
  limiter.consume('k')
  limiter.consume('k')
  assert.equal(limiter.consume('k').allowed, false)
  clock.advance(10_000)
  assert.equal(limiter.consume('k').allowed, true, 'budget restored after the window')
})

test('keys are independent', () => {
  const clock = fixedClock()
  const limiter = new RateLimiter({ limit: 1, windowMs: 60_000, now: clock.now })
  assert.equal(limiter.consume('a').allowed, true)
  assert.equal(limiter.consume('a').allowed, false)
  assert.equal(limiter.consume('b').allowed, true, 'another caller is unaffected')
})

test('remains is reported so callers can send headers', () => {
  const clock = fixedClock()
  const limiter = new RateLimiter({ limit: 3, windowMs: 60_000, now: clock.now })
  const first = limiter.consume('k')
  assert.equal(first.allowed, true)
  if (first.allowed) assert.equal(first.remaining, 2)
})

test('bucket count stays bounded', () => {
  const clock = fixedClock()
  const limiter = new RateLimiter({ limit: 5, windowMs: 60_000, maxBuckets: 10, now: clock.now })
  for (let i = 0; i < 100; i += 1) limiter.consume('key-' + i)
  assert.ok(limiter.size() <= 10, 'tracked buckets capped at 10, saw ' + limiter.size())
})
