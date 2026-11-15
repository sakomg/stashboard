export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length > 0) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }

  retryAfter(key: string, now = Date.now()): number {
    const recent = this.recent(key, now);
    return recent.length < this.limit ? 0 : Math.ceil((recent[0]! + this.windowMs - now) / 1000);
  }

  fail(key: string, now = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  clear(key: string): void {
    this.failures.delete(key);
  }
}
