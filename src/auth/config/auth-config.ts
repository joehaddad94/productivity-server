export const AUTH_CONFIG = {
  JWT_SECRET: 'JWT_SECRET',
  JWT_EXPIRES_IN: 'JWT_EXPIRES_IN',
  JWT_EXPIRES_IN_DEFAULT: '14d',
  COOKIE_NAME: 'accessToken',
  /** When set, GET /auth/verify redirects here after setting the cookie (e.g. frontend dashboard). */
  VERIFY_REDIRECT_URL: 'AUTH_VERIFY_REDIRECT_URL',
} as const;

export function parseExpiresInToSeconds(expiresIn: string): number {
  const match = /^(\d+)(d|h|m|s)$/.exec(expiresIn?.trim() || '');
  if (!match) return 14 * 24 * 60 * 60; // default 14 days in seconds
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    d: 24 * 60 * 60,
    h: 60 * 60,
    m: 60,
    s: 1,
  };
  return n * (multipliers[unit] ?? 0);
}
