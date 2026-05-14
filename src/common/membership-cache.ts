import { TtlCache } from './ttl-cache';

// Keyed on "userId:workspaceId" → role string ("owner" | "admin" | "member"). TTL 60s.
// removeMember()/updateMember() call delete() immediately so eviction is instant.
export const membershipCache = new TtlCache<string>(60_000, 5000);

export function membershipKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}
