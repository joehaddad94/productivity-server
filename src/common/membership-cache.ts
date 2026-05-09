/**
 * Short-lived cache for workspace membership checks.
 * Keyed on "userId:workspaceId" → true.
 * TTL 60s — membership changes are rare; removeMember() deletes the entry immediately.
 */
class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly ttlMs: number, private readonly max: number) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return undefined; }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void { this.store.delete(key); }
}

export const membershipCache = new TtlCache<true>(60_000, 5000);

export function membershipKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}
