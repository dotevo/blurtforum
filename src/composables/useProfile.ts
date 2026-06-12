import { ref, reactive } from 'vue';
import type { Post, Delegation, RawPost } from '../types';
import * as Earnings from '../modules/earnings';
import * as dblurt from '@beblurt/dblurt';

/**
 * Composable for managing user profile state and logic.
 */
export function useProfile(
  client: any,
  config: any,
  globalProps: any,
  view: any,
  normalizePost: (p: any) => Post
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
    const user = username.toLowerCase();
    try {
      // Use bitmask filter for earnings: author_reward (37), curation_reward (38), comment_benefactor_reward (46)
      const opNames = ['author_reward', 'curation_reward', 'comment_benefactor_reward', 'claim_reward_balance'];
      const bitmask = dblurt.utils.makeBitMaskFilter(opNames.map(name => dblurt.utils.operationOrders[name as keyof typeof dblurt.utils.operationOrders]));

      const res = await client.condenser.getAccountHistory(user, start, limit, bitmask) as any;
      const history = Array.isArray(res) ? res : (res?.result || []);
      
      const fundVal = String(globalProps.value.total_vesting_fund_blurt || '0').split(' ')[0];
      const sharesVal = String(globalProps.value.total_vesting_shares || '1').split(' ')[0];
      const ratio = parseFloat(fundVal) / (parseFloat(sharesVal) || 1);
      
      if (start === -1) {
        profileUser.earnings.rawHistory = history;
      } else {
        const existingIds = new Set(profileUser.earnings.rawHistory.map((h: any) => h[0]));
        const newItems = history.filter((h: any) => !existingIds.has(h[0]));
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
    const user = username.toLowerCase();
    try {
      const fundVal = String(globalProps.value.total_vesting_fund_blurt || '0').split(' ')[0];
      const sharesVal = String(globalProps.value.total_vesting_shares || '1').split(' ')[0];
      const ratio = parseFloat(fundVal) / (parseFloat(sharesVal) || 1);
      
      // Use bitmask filter for wallet: transfer (2), transfer_to_vesting (3), withdraw_vesting (4), delegate_vesting_shares (32)
      const opNames = ['transfer', 'transfer_to_vesting', 'withdraw_vesting', 'delegate_vesting_shares'];
      const bitmask = dblurt.utils.makeBitMaskFilter(opNames.map(name => dblurt.utils.operationOrders[name as keyof typeof dblurt.utils.operationOrders]));

      const [delegationsRes, historyRes] = await Promise.all([
        client.condenser.getVestingDelegations(user, '', 1000) as Promise<any>,
        client.condenser.getAccountHistory(user, -1, 100, bitmask) as Promise<any>
      ]);

      const delegations = Array.isArray(delegationsRes) ? delegationsRes : (delegationsRes?.result || []);
      const history = Array.isArray(historyRes) ? historyRes : (historyRes?.result || []);

      if (delegations) {
        profileUser.wallet.delegations = delegations.map((d: any) => {
          const rawVests = d.vesting_shares?.amount || d.vesting_shares || '0';
          const vests = parseFloat(String(rawVests).split(' ')[0]);
          return { ...d, bp: (vests * ratio).toFixed(3) };
        });
      }

      if (history) {
        profileUser.wallet.history = history
          .filter((h: any) => h[1] && h[1].op && ['transfer', 'transfer_to_vesting', 'withdraw_vesting', 'delegate_vesting_shares'].includes(h[1].op[0]))
          .map((h: any) => ({ seq: h[0], timestamp: h[1].timestamp, op: h[1].op }))
          .reverse();
      }

      // Incoming delegations
      const incomingMap: Record<string, any> = {};
      try {
        const incoming = await client.call('database_api', 'find_vesting_delegations', [{ account: user }]) as any;
        const res = incoming?.result || incoming;
        const delegationsList = Array.isArray(res) ? res : (res?.delegations || []);
        
        if (delegationsList && Array.isArray(delegationsList)) {
          delegationsList.forEach(d => {
            if (d.delegator !== user) {
              const rawVests = d.vesting_shares?.amount || d.vesting_shares || '0';
              const vests = parseFloat(String(rawVests).split(' ')[0]);
              incomingMap[d.delegator] = { ...d, bp: (vests * ratio).toFixed(3) };
            }
          });
        }
      } catch (e) {
        console.warn('Error fetching incoming delegations via API, falling back to history scan:', e);
      }

      // Fallback/Enhance with history scan (Blurt often doesn't have an incoming delegations index)
      // Use broader search for history if incoming delegations are expected
      let historyForScan = history;
      if (profileUser.wallet.incomingDelegations.length === 0) {
         // If still 0, we might need to look back further in history just for this fallback
         // But only if we haven't already fetched a lot. 
         // For now, let's just use what we have in historyRes (which is filtered by wallet bitmask)
      }

      if (historyRes) {
        const rawHistory = Array.isArray(historyRes) ? historyRes : (historyRes?.result || []);
        const chronological = [...rawHistory].sort((a, b) => a[0] - b[0]);
        chronological.forEach(h => {
          const op = h[1].op;
          if (op[0] === 'delegate_vesting_shares' && op[1].delegatee === user) {
            const d = op[1];
            const rawVests = d.vesting_shares?.amount || d.vesting_shares || '0';
            const vests = parseFloat(String(rawVests).split(' ')[0]);
            if (vests > 0) {
              incomingMap[d.delegator] = { 
                delegator: d.delegator, 
                vesting_shares: d.vesting_shares, 
                bp: (vests * ratio).toFixed(3),
                timestamp: h[1].timestamp 
              };
            } else {
              delete incomingMap[d.delegator];
            }
          }
        });
      }
      profileUser.wallet.incomingDelegations = Object.values(incomingMap);
      console.log('[DEBUG] Final incoming delegations count:', profileUser.wallet.incomingDelegations.length);

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

        // Calculate BP and other wallet values safely
        const fundVal = String(globalProps.value.total_vesting_fund_blurt || '0').split(' ')[0];
        const sharesVal = String(globalProps.value.total_vesting_shares || '1').split(' ')[0];
        const ratio = parseFloat(fundVal) / (parseFloat(sharesVal) || 1);
        
        const bp = (parseFloat(String(acc.vesting_shares).split(' ')[0]) * ratio).toFixed(3);
        const delegatedIn = (parseFloat(String(acc.received_vesting_shares).split(' ')[0]) * ratio).toFixed(3);
        const delegatedOut = (parseFloat(String(acc.delegated_vesting_shares).split(' ')[0]) * ratio).toFixed(3);
        const totalBP = (parseFloat(bp) + parseFloat(delegatedIn) - parseFloat(delegatedOut)).toFixed(3);
        const walletValue = (parseFloat(String(acc.balance).split(' ')[0]) + parseFloat(totalBP)).toFixed(2);
        
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
