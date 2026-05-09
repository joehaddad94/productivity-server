import { TtlCache } from './ttl-cache';

// Keyed on "userId:workspaceId" → true. TTL 60s.
// removeMember() calls delete() immediately so eviction is instant.
export const membershipCache = new TtlCache<true>(60_000, 5000);

export function membershipKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}
