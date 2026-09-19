import { ref, watch } from 'vue';
import type { ActivityItem, RawPost, AuthUser } from '../types';
import { useTitle } from './useTitle';
import { Blockchain } from '../modules/blockchain';
import { isGloballyBanned } from '../modules/banned-users';

/**
 * Composable for managing global activity feed.
 */
export function useGlobalActivity(
  client: any,
  auth: { user: AuthUser | null },
  config: any,
  userSubscriptions: any,
  normalizePost: (p: RawPost) => any,
  // Community-role-muted accounts for config.communityAccount only (this feed spans many
  // communities the user is subscribed to, and we only have role data for the primary one -
  // see mutedAccounts in useApp.ts). The site-wide ban list (banned-users.ts) applies everywhere.
  moderation?: { mutedAccounts?: () => Set<string>; canBanUser?: () => boolean }
) {
  const globalActivity = ref<ActivityItem[]>([]);
  const { setTitleIcon } = useTitle();

  const updateGlobalActivity = async (): Promise<void> => {
    if (!auth.user) return;
    const allActivity: ActivityItem[] = [];
    
    const subsToCheck = userSubscriptions.value.length > 0 
      ? userSubscriptions.value.slice(0, 25) 
      : [{ account: config.communityAccount, title: 'Blurt' }];

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const sub of subsToCheck) {
      try {
        const posts = await Blockchain.getForumPosts(client, sub.account, 5, 'activity');
        if (Array.isArray(posts)) {
          posts.forEach(p => {
            const normalized = normalizePost(p);
            if (normalized.lastActivityTs! < sevenDaysAgo) return;
            // Skip the whole item if whoever left the last activity is banned - we can't tell
            // what the *previous* activity was (that data isn't returned by the API), so the
            // entry just disappears from the feed rather than showing the banned account's name.
            // This intentionally checks lastAuthor directly rather than normalized.isMuted/
            // isCommunityBanned/isGloballyBanned, which describe the root post's own author.
            const lastAuthorLower = (normalized.lastAuthor || '').toLowerCase();
            if (isGloballyBanned(lastAuthorLower)) return;
            if (sub.account === config.communityAccount) {
              const muted = moderation?.mutedAccounts?.();
              const canBan = moderation?.canBanUser?.() ?? false;
              if (muted?.has(lastAuthorLower) && !canBan) return;
            }
            allActivity.push({
              id: p.post_id ?? 0, author: normalized.lastAuthor, title: normalized.title,
              created: normalized.lastActivity, community: sub.account, community_title: sub.title,
              permlink: normalized.permlink, root_author: normalized.author, root_permlink: normalized.permlink,
              is_post: normalized.author === normalized.lastAuthor && normalized.created === normalized.lastActivity,
              isRead: normalized.isRead, lastActivityTs: normalized.lastActivityTs!,
              comment_permlink: p.last_reply_permlink
            });
          });
        }
      } catch { /* silent fail */ }
    }
    allActivity.sort((a, b) => b.lastActivityTs - a.lastActivityTs);
    const seen = new Set<number>();
    globalActivity.value = allActivity.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; }).slice(0, 30);
  };

  const markActivityAsRead = (author: string, permlink: string) => {
    globalActivity.value.forEach(act => {
      if (act.root_author === author && act.root_permlink === permlink) act.isRead = true;
    });
  };

  watch(globalActivity, (list) => {
    const hasUnread = list.some(a => !a.isRead);
    setTitleIcon('activity', hasUnread ? '⚡' : null);
  }, { deep: true, immediate: true });

  return {
    globalActivity,
    updateGlobalActivity,
    markActivityAsRead
  };
}
