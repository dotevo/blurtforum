/**
 * BlurtForum Community Discovery & Subscription Library
 */
import { reactive } from 'vue';
import type { Community, AuthUser, Forum, UserSubscription } from '../types';
import { Blockchain } from './blockchain';

export const VIRTUAL_FORUMS: Forum[] = [
  { id: 'user-feed',       nameKey: 'myFeed',         targetTags: [], type: 'feed',     auth: true,  posts: [], lastAuthor: '', lastPermlink: '', hasMore: true, pageHistory: [] },
  { id: 'global-trending', nameKey: 'trending',       targetTags: [], type: 'trending',              posts: [], lastAuthor: '', lastPermlink: '', hasMore: true, pageHistory: [] },
  { id: 'global-new',      nameKey: 'newPosts',       targetTags: [], type: 'new',                   posts: [], lastAuthor: '', lastPermlink: '', hasMore: true, pageHistory: [] },
  { id: 'global-activity', nameKey: 'globalActivity', targetTags: [], type: 'activity',              posts: [], lastAuthor: '', lastPermlink: '', hasMore: true, pageHistory: [] },
] as unknown as Forum[];

export const DEFAULT_COMMUNITIES: UserSubscription[] = [
  { account: 'blurt-140455', title: 'General Forum' },
  { account: 'blurt-179874', title: 'Blurt Polska' },
  { account: 'blurt-129105', title: 'Blurt Market' },
];

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
    const result = await Blockchain.listCommunities(client, state.last, 20, state.query);

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
