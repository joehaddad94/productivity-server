import { HttpException, HttpStatus } from '@nestjs/common';

export class MagicLinkRateLimiter {
  private readonly window = 10 * 60 * 1000;
  private readonly max = 3;
  private readonly counts = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private lastSweep = Date.now();

  /** Drop entries whose window has closed; they can never deny anything. */
  private sweep(now: number): void {
    for (const [key, entry] of this.counts) {
      if (now >= entry.resetAt) this.counts.delete(key);
    }
    this.lastSweep = now;
  }

  check(email: string): void {
    const now = Date.now();
    // The map only ever grew: an entry was replaced when the same address came
    // back, but an address seen once stayed forever. Sweep occasionally rather
    // than on every call, which would be O(n) per request.
    if (now - this.lastSweep > this.window) this.sweep(now);

    const entry = this.counts.get(email);
    if (!entry || now >= entry.resetAt) {
      this.counts.set(email, { count: 1, resetAt: now + this.window });
      return;
    }
    if (entry.count >= this.max) {
      throw new HttpException(
        'Too many magic link requests. Please wait 10 minutes before trying again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    entry.count++;
  }
}
