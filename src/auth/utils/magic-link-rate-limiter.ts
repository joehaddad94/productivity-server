import { HttpException, HttpStatus } from '@nestjs/common';

export class MagicLinkRateLimiter {
  private readonly window = 10 * 60 * 1000;
  private readonly max = 3;
  private readonly counts = new Map<
    string,
    { count: number; resetAt: number }
  >();

  check(email: string): void {
    const now = Date.now();
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
