import test from 'node:test';
import assert from 'node:assert/strict';
import { LoginRateLimiter, loginBuckets } from '../src/lib/rate-limit.js';

function createClock(start = 0) {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => { value += ms; },
  };
}

test('loginBuckets builds ip and lower-cased email keys', () => {
  assert.deepEqual(loginBuckets('127.0.0.1', 'Ada@Example.COM'), ['ip:127.0.0.1', 'email:ada@example.com']);
});

test('blocks after ten failed attempts and reports Retry-After seconds', () => {
  const clock = createClock();
  const limiter = new LoginRateLimiter({ now: clock.now });
  const keys = loginBuckets('10.0.0.1', 'user@example.com');
  for (let attempt = 0; attempt < 9; attempt += 1) {
    limiter.recordFailure(keys);
    assert.equal(limiter.retryAfter(keys), null);
    clock.advance(1000);
  }
  limiter.recordFailure(keys);
  const retryAfter = limiter.retryAfter(keys);
  assert.ok(retryAfter !== null);
  assert.equal(retryAfter, 14 * 60 + 51);
});

test('either bucket being blocked blocks the login', () => {
  const clock = createClock();
  const limiter = new LoginRateLimiter({ now: clock.now, maxAttempts: 2 });
  limiter.recordFailure(['ip:10.0.0.2']);
  limiter.recordFailure(['ip:10.0.0.2']);
  assert.notEqual(limiter.retryAfter(['email:other@example.com', 'ip:10.0.0.2']), null);
  assert.equal(limiter.retryAfter(['email:other@example.com']), null);
});

test('successful login clears the bucket', () => {
  const clock = createClock();
  const limiter = new LoginRateLimiter({ now: clock.now, maxAttempts: 1 });
  const keys = loginBuckets('10.0.0.3', 'user@example.com');
  limiter.recordFailure(keys);
  assert.notEqual(limiter.retryAfter(keys), null);
  limiter.clear(keys);
  assert.equal(limiter.retryAfter(keys), null);
  assert.equal(limiter.size(), 0);
});

test('the window expires and a fresh attempt is allowed', () => {
  const clock = createClock();
  const limiter = new LoginRateLimiter({ now: clock.now, maxAttempts: 1, windowMs: 60_000 });
  const keys = ['ip:10.0.0.4'];
  limiter.recordFailure(keys);
  assert.notEqual(limiter.retryAfter(keys), null);
  clock.advance(60_000);
  assert.equal(limiter.retryAfter(keys), null);
  limiter.recordFailure(keys);
  assert.notEqual(limiter.retryAfter(keys), null);
});

test('memory is bounded by maxBuckets and evicts the oldest entries', () => {
  const clock = createClock();
  const limiter = new LoginRateLimiter({ now: clock.now, maxBuckets: 3 });
  for (let index = 0; index < 10; index += 1) {
    limiter.recordFailure(['ip:10.0.1.' + index]);
    clock.advance(10);
  }
  assert.equal(limiter.size(), 3);
  limiter.sweep(clock.now() + 60 * 60 * 1000);
  assert.equal(limiter.size(), 0);
});
