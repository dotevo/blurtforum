import { ref, reactive } from 'vue';
import type { Post, Delegation, RawPost } from '../types';
import * as Earnings from '../modules/earnings';

/**
 * Composable for managing user profile state and logic.
 */
export function useProfile(
  client: any,
  config: any,
  globalProps: any,
  view: any,
  normalizePost: (p: RawPost) => Post
) {
  const profileUser = reactive<{
    username: string;
    data: Record<string, unknown> | null;
    posts: Post[];
    comments: Post[];
    replies: Post[];
    postsHasMore: boolean;
    commentsHasMore: boolean;
    repliesHasMore: boolean;
    earnings: {
      rawHistory: any[];
      history: any[];
      stats: {
        author: number;
        curation: number;
        benefactor: number;
        claimed: number;
        total: number;
        avgPerDay: number;
        range: string;
      };
      chartData: {
        daily: Array<{ date: string; author: number, curation: number, benefactor: number, total: number }>;
        distribution: { author: number; curation: number; benefactor: number };
      };
      loading: boolean;
    };
    wallet: {
      delegations: Delegation[];
      incomingDelegations: Delegation[];
      history: any[];
      powerDown: { total: string, rate: string, next: string, percent: number };
      loading: boolean;
    };
    loading: boolean;
  }>({
    username: '',
    data: null,
    posts: [],
    comments: [],
    replies: [],
    postsHasMore: true,
    commentsHasMore: true,
    repliesHasMore: true,
    earnings: {
      rawHistory: [],
      history: [],
      stats: { author: 0, curation: 0, benefactor: 0, claimed: 0, total: 0, avgPerDay: 0, range: '' },
      chartData: { daily: [], distribution: { author: 0, curation: 0, benefactor: 0 } },
      loading: false
    },
    wallet: { delegations: [] as Delegation[], incomingDelegations: [] as Delegation[], history: [] as any[], powerDown: { total: '0.000', rate: '0.000', next: '', percent: 0 }, loading: false },
    loading: false
  });

  const profileTab = ref('posts');

  const _fetchEarningsHistory = async (username: string, start = -1, limit = 500): Promise<void> => {
    profileUser.earnings.loading = true;
    try {
      const history = await client.call('condenser_api', 'get_account_history', { account: username, start, limit }) as any[];
      const ratio = parseFloat(globalProps.value.total_vesting_fund_blurt || '0') / parseFloat(globalProps.value.total_vesting_shares || '1');
      
      if (start === -1) {
        profileUser.earnings.rawHistory = history;
      } else {
        const existingIds = new Set(profileUser.earnings.rawHistory.map((h: any) => h[0]));
        const newItems = history.filter(h => !existingIds.has(h[0]));
        profileUser.earnings.rawHistory = [...profileUser.earnings.rawHistory, ...newItems];
      }

      const { ops, stats, daily } = Earnings.processHistory(profileUser.earnings.rawHistory, ratio);
      profileUser.earnings.history = ops.reverse(); // Newest first for table
      profileUser.earnings.chartData.daily = daily;
      profileUser.earnings.stats = stats;
      profileUser.earnings.chartData.distribution = { author: stats.author, curation: stats.curation, benefactor: stats.benefactor };
    } catch (err) {
      console.error('Earnings fetch error:', err);
    } finally {
      profileUser.earnings.loading = false;
    }
  };

  const loadProfileWallet = async (username: string): Promise<void> => {
    profileUser.wallet.loading = true;
    try {
      const ratio = parseFloat(globalProps.value.total_vesting_fund_blurt || '0') / parseFloat(globalProps.value.total_vesting_shares || '1');
      const [delegations, history] = await Promise.all([
        client.call('database_api', 'get_vesting_delegations', { account: username, from: '', limit: 1000 }) as Delegation[],
        client.call('condenser_api', 'get_account_history', { account: username, start: -1, limit: 500 }) as any[]
      ]);

      if (delegations) {
        profileUser.wallet.delegations = delegations.map(d => ({ ...d, bp: (parseFloat(d.vesting_shares) * ratio).toFixed(3) }));
      }

      if (history) {
        profileUser.wallet.history = history
          .filter(h => ['transfer', 'transfer_to_vesting', 'withdraw_vesting', 'delegate_vesting_shares'].includes(h[1].op[0]))
          .map(h => ({ seq: h[0], timestamp: h[1].timestamp, op: h[1].op }))
          .reverse();
      }

      // Incoming delegations
      const incoming = await client.call('database_api', 'find_vesting_delegations', { account: username }) as Delegation[];
      if (incoming) {
        const incomingMap: Record<string, any> = {};
        incoming.forEach(d => {
          if (d.delegator !== username) {
            incomingMap[d.delegator] = { ...d, bp: (parseFloat(d.vesting_shares) * ratio).toFixed(3) };
          }
        });
        profileUser.wallet.incomingDelegations = Object.values(incomingMap);
      }

      // Finalize wallet data with power down info
      if (profileUser.data) {
        const acc = profileUser.data as any;
        if (acc.next_vesting_withdrawal !== '1969-12-31T23:59:59') {
          const totalVests = parseFloat(acc.vesting_withdraw_rate);
          const totalBP = (totalVests * ratio).toFixed(3);
          const rateVests = parseFloat(acc.vesting_withdraw_rate);
          const rateBP = (rateVests * ratio).toFixed(3);
          profileUser.wallet.powerDown = {
            total: totalBP,
            rate: rateBP,
            next: acc.next_vesting_withdrawal,
            percent: Math.min(100, Math.round((parseFloat(acc.withdrawn) / parseFloat(acc.to_withdraw)) * 100))
          };
        } else {
          profileUser.wallet.powerDown = { total: '0.000', rate: '0.000', next: '', percent: 0 };
        }
      }
    } catch (err) {
      console.error('Wallet fetch error:', err);
    } finally {
      profileUser.wallet.loading = false;
    }
  };

  const openProfile = async (username: string): Promise<void> => {
    profileUser.username = username;
    profileUser.loading = true;
    profileUser.data = null;
    profileUser.posts = [];
    profileUser.comments = [];
    profileUser.replies = [];
    profileUser.postsHasMore = profileUser.commentsHasMore = profileUser.repliesHasMore = true;
    view.value = 'profile';

    try {
      const [accounts, followCount, posts, comments, replies] = await Promise.all([
        client.condenser.getAccounts([username]),
        client.call('bridge', 'get_follow_count', { account: username }),
        client.call('bridge', 'get_account_posts', { sort: 'posts', account: username, limit: 20 }),
        client.call('bridge', 'get_account_posts', { sort: 'comments', account: username, limit: 20 }),
        client.call('bridge', 'get_account_posts', { sort: 'replies', account: username, limit: 20 })
      ]);

      if (accounts && accounts[0]) {
        const acc = accounts[0];
        profileUser.data = acc;
        if (followCount) {
          (profileUser.data as Record<string, unknown>).followerCount = followCount.follower_count;
          (profileUser.data as Record<string, unknown>).followingCount = followCount.following_count;
        }

        let p: any = {};
        try {
          p = JSON.parse(acc.posting_json_metadata || acc.json_metadata || '{}').profile || {};
        } catch { /* ignore */ }
        const profileData = {
          about: p.about || '',
          website: p.website || '',
          location: p.location || '',
          displayName: p.name || acc.name,
          bp: '0.000', delegatedIn: '0.000', delegatedOut: '0.000', totalBP: '0.000', walletValue: '0.00'
        };

        // Calculate BP and other wallet values
        const ratio = parseFloat(globalProps.value.total_vesting_fund_blurt || '0') / parseFloat(globalProps.value.total_vesting_shares || '1');
        const bp = (parseFloat(acc.vesting_shares) * ratio).toFixed(3);
        const delegatedIn = (parseFloat(acc.received_vesting_shares) * ratio).toFixed(3);
        const delegatedOut = (parseFloat(acc.delegated_vesting_shares) * ratio).toFixed(3);
        const totalBP = (parseFloat(bp) + parseFloat(delegatedIn) - parseFloat(delegatedOut)).toFixed(3);
        const walletValue = (parseFloat(acc.balance) + parseFloat(totalBP)).toFixed(2);
        
        Object.assign(profileData, { bp, delegatedIn, delegatedOut, totalBP, walletValue });
        profileUser.data = { ...acc, ...profileData };
      }

      if (Array.isArray(posts)) {
        profileUser.posts = posts.map(normalizePost);
        profileUser.postsHasMore = posts.length === 20;
      }
      if (Array.isArray(comments)) {
        profileUser.comments = comments.map(normalizePost);
        profileUser.commentsHasMore = comments.length === 20;
      }
      if (Array.isArray(replies)) {
        profileUser.replies = replies.map(normalizePost);
        profileUser.repliesHasMore = replies.length === 20;
      }

      _fetchEarningsHistory(username);
      loadProfileWallet(username);
    } catch (err) {
      console.error('Profile load error:', err);
    } finally {
      profileUser.loading = false;
    }
  };

  const loadMoreProfileContent = async (sort: 'posts' | 'comments' | 'replies'): Promise<void> => {
    if (profileUser.loading) return;
    const list = profileUser[sort];
    const last = list.length > 0 ? list[list.length - 1] : null;

    profileUser.loading = true;
    try {
      const more = await client.call('bridge', 'get_account_posts', {
        sort,
        account: profileUser.username,
        limit: 20,
        start_author: last?.author,
        start_permlink: last?.permlink
      }) as RawPost[];

      if (Array.isArray(more) && more.length > 0) {
        const filtered = more.slice(1).map(normalizePost);
        profileUser[sort] = [...profileUser[sort], ...filtered];
        profileUser[`${sort}HasMore`] = more.length === 20;
      } else {
        profileUser[`${sort}HasMore`] = false;
      }
    } catch (err) {
      console.error(`Load more ${sort} error:`, err);
    } finally {
      profileUser.loading = false;
    }
  };

  return {
    profileUser,
    profileTab,
    openProfile,
    loadMoreProfileContent,
    fetchEarningsHistory: _fetchEarningsHistory
  };
}
