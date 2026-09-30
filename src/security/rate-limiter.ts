export interface UserRateLimiter {
  check(userId: string, operation: string): void;
}

export interface FixedWindowRateLimiterOptions {
  limitPerMinute?: number;
  nowMs?: () => number;
}

export class InMemoryFixedWindowRateLimiter implements UserRateLimiter {
  private readonly buckets = new Map<string, { minute: number; count: number }>();
  private readonly limitPerMinute: number;
  private readonly nowMs: () => number;

  constructor(options: FixedWindowRateLimiterOptions = {}) {
    this.limitPerMinute = options.limitPerMinute ?? 60;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  check(userId: string, operation: string): void {
    const minute = Math.floor(this.nowMs() / 60_000);
    const key = `${userId}\u0000${operation}`;
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.minute !== minute) {
      this.buckets.set(key, { minute, count: 1 });
      return;
    }
    if (bucket.count >= this.limitPerMinute) {
      throw new Error(`Rate limit exceeded for ${operation}`);
    }
    bucket.count += 1;
  }
}
