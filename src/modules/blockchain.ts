import { reactive } from 'vue';
import * as dblurt from '@beblurt/dblurt';
import type { AuthUser, ChainProperties } from '../types';

/**
 * Blockchain module for BlurtForum.
 * Handles interactions with the Blurt blockchain, including broadcasting,
 * fee estimation, and post fetching.
 */
export const Blockchain = {
  feeInfo: reactive({
    flatFee: 0.050,
    bwFee: 0.150,
    loaded: false
  }),

  _estCache: {
    acc: null as any,
    fund: null as any,
    props: null as any,
    last: 0
  },

  /** Fetches current chain properties to estimate transaction fees */
  async fetchFeeInfo(client: any): Promise<void> {
    if (this.feeInfo.loaded) return;
    try {
      const props = await client.call('condenser_api', 'get_chain_properties', []) as ChainProperties;
      if (props) {
        if (props.operation_flat_fee) this.feeInfo.flatFee = parseFloat(props.operation_flat_fee);
        if (props.bandwidth_kbytes_fee) this.feeInfo.bwFee = parseFloat(props.bandwidth_kbytes_fee);
        this.feeInfo.loaded = true;
      }
    } catch (e) {
      console.warn('Fee info fetch error (using fallback values):', e);
      this.feeInfo.loaded = true;
    }
  },

  /** Estimates the transaction fee based on number of operations and payload size */
  estimateTxFee(numOps: number, payloadBytes: number): string {
    const totalBytes = 300 + payloadBytes;
    return ((this.feeInfo.flatFee * numOps) + (totalBytes / 1024) * this.feeInfo.bwFee).toFixed(3);
  },

  /** Broadcasts operations to the blockchain using either private key or WhaleVault */
  async broadcast(client: any, user: AuthUser, ops: any[], authority: 'Posting' | 'Active' = 'Posting'): Promise<void> {
    if (user.type === 'key') {
      if (!user.key) throw new Error('Private key missing');
      const privKey = dblurt.PrivateKey.from(user.key);
      await client.broadcast.sendOperations(ops, privKey);
    } else {
      await new Promise<void>((resolve, reject) => {
        const wv = (window as any).blurt_keychain;
        if (!wv) {
          return reject(new Error('WhaleVault not installed'));
        }
        wv.requestBroadcast(user.username, ops, authority, (response: any) => {
          if (response.success) resolve();
          else reject(new Error(response.message || 'WhaleVault broadcast failed'));
        });
      });
    }
  },

  async estimateVoteValue(client: any, username: string, weight: number): Promise<{ vpCostPct: string; vpAfter: string; voteValue: string; fee: string } | null> {
    const now = Date.now();
    
    // Refresh cache if older than 60 seconds or for a different user
    if (!this._estCache.acc || now - this._estCache.last > 60000 || this._estCache.acc.name !== username) {
      try {
        const [accs, fund, props] = await Promise.all([
          client.condenser.getAccounts([username]),
          client.call('condenser_api', 'get_reward_fund', ['post']),
          client.condenser.getDynamicGlobalProperties(),
        ]);

        if (accs?.[0]) {
          this._estCache.acc = accs[0];
          this._estCache.fund = fund;
          this._estCache.props = props;
          this._estCache.last = now;
        }
      } catch (e) {
        console.warn('Vote estimate fetch error:', e);
        if (!this._estCache.acc) return null; // Can't even use old cache
      }
    }

    const acc = this._estCache.acc;
    const fund = this._estCache.fund;
    if (!acc || !fund) return null;

    try {
      const lastVoteTime = new Date((acc.last_vote_time as string) + 'Z').getTime();
      const delta = (Date.now() - lastVoteTime) / 1000;
      const rawVP = Math.min((acc.voting_power as number) + Math.floor(10000 * delta / 432000), 10000);
      const voteWeight = weight * 100;
      const usedPower = Math.ceil(rawVP * voteWeight / 10000 / 50);
      const vpAfterRaw = rawVP - usedPower;
      
      const vpCostPct = (usedPower / 100).toFixed(2);
      const vpAfter   = (vpAfterRaw / 100).toFixed(2);
      
      const vestingShares    = parseFloat(acc.vesting_shares as string);
      const receivedVesting  = parseFloat(acc.received_vesting_shares as string || '0');
      const delegatedVesting = parseFloat(acc.delegated_vesting_shares as string || '0');
      const effectiveVests   = vestingShares + receivedVesting - delegatedVesting;
      
      const microVests = BigInt(Math.floor(effectiveVests * 1000000));
      const rs = (microVests * BigInt(usedPower)) / 10000n;
      
      const rcStr = fund.recent_claims as string;
      const rc = BigInt(typeof rcStr === 'string' ? (rcStr.split(' ')[0] || rcStr) : String(rcStr));
      const rb = parseFloat(fund.reward_balance as string);
      
      let voteValue = 0;
      if (rc > 0n) voteValue = (Number(rs) / Number(rc)) * rb;
      
      const voteFee = this.estimateTxFee(1, 150);
      
      return { vpCostPct, vpAfter, voteValue: voteValue.toFixed(4), fee: voteFee };
    } catch (e) {
      console.warn('Vote estimate calculation error:', e);
      return null;
    }
  },

  async getVestingDelegations(client: any, account: string, startAccount = '', limit = 1000): Promise<any[]> {
    try {
      const res = await client.call('condenser_api', 'get_vesting_delegations', [account, startAccount, limit]);
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('get_vesting_delegations error:', e);
      return [];
    }
  },

  async getIncomingVestingDelegations(client: any, account: string, startAccount = '', limit = 1000): Promise<any[]> {
    try {
      const res = await client.call('condenser_api', 'get_incoming_vesting_delegations', [account, startAccount, limit]);
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('get_incoming_vesting_delegations error:', e);
      return [];
    }
  },

  async getExpiringVestingDelegations(client: any, account: string, afterTime?: string): Promise<any[]> {
    try {
      const time = afterTime || new Date().toISOString().split('.')[0];
      const res = await client.call('condenser_api', 'get_expiring_vesting_delegations', [account, time]);
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('get_expiring_vesting_delegations error:', e);
      return [];
    }
  },

  async getAccount(client: any, account: string): Promise<any | null> {
    try {
      const res = await client.condenser.getAccounts([account]);
      return (res && res[0]) ? res[0] : null;
    } catch (e) {
      console.warn('getAccount error:', e);
      return null;
    }
  },

  async getWitnessByAccount(client: any, account: string): Promise<any | null> {
    try {
      return await client.call('condenser_api', 'get_witness_by_account', [account]);
    } catch (e) {
      console.warn('get_witness_by_account error:', e);
      return null;
    }
  },

  async getContent(client: any, author: string, permlink: string): Promise<any | null> {
    try {
      return await client.condenser.getContent(author, permlink);
    } catch (e) {
      console.warn('getContent error:', e);
      return null;
    }
  },

  async getAccountHistory(client: any, account: string, start = -1, limit = 100, bitmask?: [number, number]): Promise<any[]> {
    try {
      const res = await client.condenser.getAccountHistory(account, start, limit, bitmask);
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('getAccountHistory error:', e);
      return [];
    }
  },

  async getDynamicGlobalProperties(client: any): Promise<any | null> {
    try {
      return await client.condenser.getDynamicGlobalProperties();
    } catch (e) {
      console.warn('getDynamicGlobalProperties error:', e);
      return null;
    }
  },

  async getFollowCount(client: any, account: string): Promise<any | null> {
    try {
      return await client.call('bridge', 'get_follow_count', { account });
    } catch (e) {
      console.warn('getFollowCount error:', e);
      return null;
    }
  },

  async getAccountPosts(client: any, sort: string, account: string, limit = 20, start_author?: string, start_permlink?: string): Promise<any[]> {
    try {
      const params: any = { sort, account, limit };
      if (start_author) params.start_author = start_author;
      if (start_permlink) params.start_permlink = start_permlink;
      const res = await client.call('bridge', 'get_account_posts', params);
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('getAccountPosts error:', e);
      return [];
    }
  },

  async getForumPosts(client: any, community: string, limit = 20, sort = 'trending', observer?: string, start_author?: string, start_permlink?: string, tags_any?: string[]): Promise<any[]> {
    try {
      const params: any = { community, limit, sort };
      if (observer) params.observer = observer;
      if (start_author) params.start_author = start_author;
      if (start_permlink) params.start_permlink = start_permlink;
      if (tags_any) params.tags_any = tags_any;
      const res = await client.call('bridge', 'get_forum_posts', params);
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('getForumPosts error:', e);
      return [];
    }
  },

  async getNotifications(client: any, account: string, limit = 20): Promise<any[]> {
    try {
      const res = await client.call('bridge', 'account_notifications', { account, limit });
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('getNotifications error:', e);
      return [];
    }
  },

  async getFollowing(client: any, follower: string, startAccount = '', type = 'blog', limit = 1000): Promise<any[]> {
    try {
      const res = await client.call('condenser_api', 'get_following', [follower, startAccount, type, limit]);
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('getFollowing error:', e);
      return [];
    }
  },

  async getContentReplies(client: any, author: string, permlink: string): Promise<any[]> {
    try {
      const res = await client.condenser.getContentReplies(author, permlink);
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('getContentReplies error:', e);
      return [];
    }
  },

  async listSubscriptions(client: any, account: string): Promise<any[]> {
    try {
      let res = await client.call('bridge', 'list_all_subscriptions', { account });
      if (!res?.length) {
        res = await client.call('condenser_api', 'list_all_subscriptions', [account]);
      }
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('listSubscriptions error:', e);
      return [];
    }
  },

  async getCommunity(client: any, account: string): Promise<any | null> {
    try {
      return await client.call('bridge', 'get_community', { name: account });
    } catch (e) {
      console.warn('getCommunity error:', e);
      return null;
    }
  },

  async listCommunityRoles(client: any, community: string): Promise<any[]> {
    try {
      const res = await client.call('bridge', 'list_community_roles', { community });
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('listCommunityRoles error:', e);
      return [];
    }
  },

  async getRankedPosts(client: any, sort: string, tag = '', limit = 20, start_author?: string, start_permlink?: string): Promise<any[]> {
    try {
      const params: any = { sort, tag, limit };
      if (start_author) params.start_author = start_author;
      if (start_permlink) params.start_permlink = start_permlink;
      const res = await client.call('bridge', 'get_ranked_posts', params);
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('getRankedPosts error:', e);
      return [];
    }
  },

  async listCommunities(client: any, last = '', limit = 20, query = ''): Promise<any[]> {
    try {
      const res = await client.call('bridge', 'list_communities', { last, limit, query });
      return Array.isArray(res) ? res : (res?.result || []);
    } catch (e) {
      console.warn('listCommunities error:', e);
      return [];
    }
  }
};
