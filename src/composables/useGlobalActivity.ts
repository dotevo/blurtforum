import { ref, watch } from 'vue';
import type { ActivityItem, RawPost, AuthUser } from '../types';
import { useTitle } from './useTitle';
import { Blockchain } from '../modules/blockchain';

/**
 * Composable for managing global activity feed.
 */
export function useGlobalActivity(
  client: any,
  auth: { user: AuthUser | null },
  config: any,
  userSubscriptions: any,
  normalizePost: (p: RawPost) => any
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
