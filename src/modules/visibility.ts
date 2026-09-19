import type { Post } from '../types';

/**
 * Single source of truth for whether a post/comment should be hidden from
 * the current viewer. Order matters - checked from the strongest rule down:
 *
 *  1. Globally banned (site-wide ban list, banned-users.ts): hidden from
 *     EVERYONE, no exceptions, everywhere in the app.
 *  2. Community-banned (community role = 'muted', set via the admin-only
 *     "Ban user" action): hidden from everyone except that community's
 *     owner/admin.
 *  3. Muted (single post/comment muted by a mod via mutePost): hidden from
 *     everyone except that community's owner/admin/mod.
 *  4. COAL-listed: never hidden by this function - COAL only adds a visual
 *     warning, handled separately by the UI (see Post.isCoal/coalInfo).
 */
export function isHiddenFromViewer(
  post: Pick<Post, 'isGloballyBanned' | 'isCommunityBanned' | 'isMuted'>,
  viewer: { canBanUser: boolean; canMute: boolean }
): boolean {
  if (post.isGloballyBanned) return true;
  if (post.isCommunityBanned) return !viewer.canBanUser;
  if (post.isMuted) return !viewer.canMute;
  return false;
}
