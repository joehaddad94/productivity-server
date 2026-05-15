import { TtlCache } from './ttl-cache';
import type { WorkspaceRole } from './assert-member';

export type CachedMembership = {
  role: WorkspaceRole;
  canSeeAllTasks: boolean;
};

// Keyed on "userId:workspaceId". TTL 60s.
// removeMember()/updateMember() call delete() immediately so eviction is instant.
export const membershipCache = new TtlCache<CachedMembership>(60_000, 5000);

export function membershipKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}
