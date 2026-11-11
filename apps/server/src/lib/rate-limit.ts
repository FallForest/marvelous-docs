export type LoginRateLimiterOptions = {
  /** Failed attempts allowed per key inside the window. Defaults to 10. */
  maxAttempts?: number;
  /** Sliding window length in milliseconds. Defaults to 15 minutes. */
  windowMs?: number;
  /** Hard cap on tracked buckets so memory stays bounded. Defaults to 5000. */
  maxBuckets?: number;
  /** Clock override, mainly for tests. */
  now?: () => number;
};

type Bucket = { count: number; firstAt: number };

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_BUCKETS = 5000;

export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;
  private readonly now: () => number;

  constructor(options: LoginRateLimiterOptions = {}) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.windowMs = Math.max(1, options.windowMs ?? DEFAULT_WINDOW_MS);
    this.maxBuckets = Math.max(1, options.maxBuckets ?? DEFAULT_MAX_BUCKETS);
    this.now = options.now ?? Date.now;
  }

  /**
   * Seconds the caller must wait before retrying, or null when no supplied key
   * is currently blocked. Expired buckets are removed while checking.
   */
  retryAfter(keys: readonly string[]): number | null {
    const now = this.now();
    let blocked: number | null = null;
    for (const key of keys) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      if (now - bucket.firstAt >= this.windowMs) {
        this.buckets.delete(key);
        continue;
      }
      if (bucket.count >= this.maxAttempts) {
        const seconds = Math.max(1, Math.ceil((bucket.firstAt + this.windowMs - now) / 1000));
        blocked = blocked === null ? seconds : Math.max(blocked, seconds);
      }
    }
    return blocked;
  }

  /** Counts one failed attempt for every key, starting or extending its window. */
  recordFailure(keys: readonly string[]): void {
    const now = this.now();
    this.sweep(now);
    for (const key of keys) {
      if (!key) continue;
      const bucket = this.buckets.get(key);
      if (!bucket || now - bucket.firstAt >= this.windowMs) this.buckets.set(key, { count: 1, firstAt: now });
      else bucket.count += 1;
    }
    if (this.buckets.size > this.maxBuckets) this.evictOldest();
  }

  /** Drops the buckets for the given keys, e.g. after a successful login. */
  clear(keys: readonly string[]): void {
    for (const key of keys) this.buckets.delete(key);
  }

  /** Number of tracked buckets; exposed for tests and operational probes. */
  size(): number {
    return this.buckets.size;
  }

  /** Removes every bucket whose window has elapsed. */
  sweep(now: number = this.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.firstAt >= this.windowMs) this.buckets.delete(key);
    }
  }

  private evictOldest(): void {
    this.sweep();
    if (this.buckets.size <= this.maxBuckets) return;
    const entries = [...this.buckets.entries()].sort((left, right) => left[1].firstAt - right[1].firstAt);
    for (let index = 0; index < entries.length - this.maxBuckets; index += 1) this.buckets.delete(entries[index][0]);
  }
}

/** Builds the composite bucket keys used by the login endpoint. */
export function loginBuckets(ip: string, email: string): string[] {
  return [`ip:${ip}`, `email:${email.toLowerCase()}`];
}

/* -------------------------------------------------------------------------- */
/* Request rate limiting (not failure counting)                               */
/* -------------------------------------------------------------------------- */

export type RateLimitOptions = {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Hard cap on tracked buckets so memory stays bounded. Defaults to 20000. */
  maxBuckets?: number;
  /** Clock override, mainly for tests. */
  now?: () => number;
};

type Slot = { count: number; resetAt: number };

/**
 * Fixed-window request limiter.
 *
 * Distinct from {@link LoginRateLimiter}: that one counts *failures* so a
 * legitimate user is never locked out by successful calls, whereas abuse-prone
 * endpoints (uploads, export, search, markdown parsing) need a plain
 * requests-per-window budget keyed by caller.
 *
 * A fixed window is chosen over a sliding log because the endpoints it guards
 * are expensive per request rather than trickled; the coarse boundary burst it
 * allows is bounded by the still-generous limit and costs no per-request storage
 * beyond two numbers.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Slot>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;
  private readonly now: () => number;

  constructor(options: RateLimitOptions) {
    this.limit = Math.max(1, options.limit);
    this.windowMs = Math.max(1, options.windowMs);
    this.maxBuckets = Math.max(1, options.maxBuckets ?? 20000);
    this.now = options.now ?? Date.now;
  }

  /**
   * Consumes one slot for `key`.
   *
   * Returns `{ allowed: true, remaining }` or, when the budget is spent,
   * `{ allowed: false, retryAfter }` with whole seconds until the window rolls.
   */
  consume(key: string): { allowed: true; remaining: number } | { allowed: false; retryAfter: number } {
    const now = this.now();
    let slot = this.buckets.get(key)
    if (!slot || now >= slot.resetAt) {
      slot = { count: 0, resetAt: now + this.windowMs }
      this.buckets.set(key, slot)
      if (this.buckets.size > this.maxBuckets) this.evict(now)
    }
    if (slot.count >= this.limit) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((slot.resetAt - now) / 1000)) }
    }
    slot.count += 1
    return { allowed: true, remaining: this.limit - slot.count }
  }

  /** Number of tracked buckets; exposed for tests and operational probes. */
  size(): number {
    return this.buckets.size
  }

  private evict(now: number): void {
    for (const [key, slot] of this.buckets) if (now >= slot.resetAt) this.buckets.delete(key)
    if (this.buckets.size <= this.maxBuckets) return
    const entries = [...this.buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    for (let i = 0; i < entries.length - this.maxBuckets; i += 1) this.buckets.delete(entries[i][0])
  }
}
