/**
 * BlurtForum Community Discovery & Subscription Library
 */
import { reactive } from 'vue';
import type { Community, AuthUser } from '../types';

interface CommunityState {
  list: Community[];
  loading: boolean;
  query: string;
  last: string;
  hasMore: boolean;
}

type BroadcastFn = (ops: unknown[]) => Promise<void>;

const state = reactive<CommunityState>({
  list: [],
  loading: false,
  query: '',
  last: '',
  hasMore: true,
});

/**
 * Fetches list of communities from the bridge API.
 * Pass refresh=true to clear the list and start from the beginning.
 */
const fetchCommunities = async (client: Record<string, unknown>, refresh = false): Promise<void> => {
  if (state.loading) return;
  if (refresh) { state.list = []; state.last = ''; state.hasMore = true; }
  if (!state.hasMore) return;

  state.loading = true;
  try {
    const result = await (client as { call: (m: string, n: string, p: Record<string, unknown>) => Promise<Community[]> })
      .call('bridge', 'list_communities', { last: state.last, limit: 20, query: state.query });

    if (result && result.length > 0) {
      state.list.push(...result);
      state.last = result[result.length - 1].name;
      if (result.length < 20) state.hasMore = false;
    } else {
      state.hasMore = false;
    }
  } catch (err) {
    console.error('Failed to fetch communities:', err);
  } finally {
    state.loading = false;
  }
};

/**
 * Subscribes to or unsubscribes from a community.
 * @returns the new subscription status (true = subscribed)
 */
const toggleSubscription = async (
  auth: { user: AuthUser | null },
  broadcastFn: BroadcastFn,
  communityName: string,
  isSubscribed: boolean
): Promise<boolean> => {
  if (!auth.user) throw new Error('Must be logged in');

  const op = ['custom_json', {
    required_auths: [],
    required_posting_auths: [auth.user.username],
    id: 'community',
    json: JSON.stringify([isSubscribed ? 'unsubscribe' : 'subscribe', { community: communityName }]),
  }];

  await broadcastFn([op]);
  return !isSubscribed;
};

export const BFCommunity = { state, fetchCommunities, toggleSubscription };
