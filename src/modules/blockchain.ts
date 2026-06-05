import { reactive } from 'vue';
import { BFUtils } from './utils';
import { Parser } from './parser';
import type { Post, RawPost, Beneficiary, GlobalProps, AuthUser, ActiveVote, RewardFund, ChainProperties } from '../types';

// dblurt is loaded from unpkg CDN via index.html
declare const dblurt: any;

/**
 * Blockchain module for BlurtForum.
 * Handles interactions with the Blurt blockchain, including broadcasting,
 * fee estimation, and post normalization.
 */
export const Blockchain = {
  feeInfo: reactive({
    flatFee: 0.050,
    bwFee: 0.150,
    loaded: false
  }),

  /** Fetches current chain properties to estimate transaction fees */
  async fetchFeeInfo(client: any): Promise<void> {
    if (this.feeInfo.loaded) return;
    try {
      const props = await client.call('condenser_api', 'get_chain_properties', {}) as ChainProperties;
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

  /** Normalizes a raw blockchain post into the application's Post format */
  normalizePost(p: RawPost): Post {
    const post: Post = {
      author: p.author,
      permlink: p.permlink,
      title: p.title,
      body: p.body,
      created: p.created,
      url: p.url,
      category: p.category,
      parent_author: p.parent_author || '',
      parent_permlink: p.parent_permlink || '',
      lastActivity: p.last_activity || p.created,
      lastAuthor: p.last_activity_author || p.author,
      pendingPayout: BFUtils.parsePayout(p.pending_payout_value),
      totalPayout: BFUtils.parsePayout(p.total_payout_value) + BFUtils.parsePayout((p as any).curator_payout_value),
      payout: 0,
      vote_count: p.active_votes?.length || 0,
      active_votes: p.active_votes || [],
      net_rshares: p.net_rshares || 0,
      beneficiaries: (p.beneficiaries || []) as Beneficiary[],
      json_metadata: p.json_metadata,
      media: Parser.detectMedia(p.body),
      isUnread: false,
      isRead: false,
      isFollowing: false,
      isMuted: !!(p.stats?.is_muted),
      isPaid: false, // Will be determined by payout value if needed
      isCollapsed: false,
      replyCount: p.children || p.reply_count || 0,
      tags: [],
    };
    post.payout = post.pendingPayout + post.totalPayout;
    
    // Extract tags and images from json_metadata
    if (p.json_metadata) {
      try {
        const meta = typeof p.json_metadata === 'string' ? JSON.parse(p.json_metadata) : p.json_metadata;
        if (meta.tags && Array.isArray(meta.tags)) {
          post.tags = meta.tags;
        }
        // If we detected media but it has no cover, try to use the first image from metadata
        if (post.media && !post.media.cover && meta.image && Array.isArray(meta.image) && meta.image.length > 0) {
          post.media.cover = meta.image[0];
        }
      } catch { /* ignore */ }
    }
    
    return post;
  },

  /** Broadcasts operations to the blockchain using either private key or WhaleVault */
  async broadcast(client: any, user: AuthUser, ops: any[]): Promise<void> {
    if (user.type === 'key') {
      if (!user.key) throw new Error('Private key missing');
      const privKey = dblurt.PrivateKey.from(user.key);
      await client.broadcast.sendOperations(ops, privKey);
    } else {
      await new Promise<void>((resolve, reject) => {
        if (!window.blurt_keychain) {
          return reject(new Error('WhaleVault (Blurt Keychain) not available'));
        }
        (window.blurt_keychain as any).requestBroadcast(
          user.username,
          ops,
          'Posting',
          (res: { success: boolean; message?: string }) => {
            if (res?.success) resolve();
            else reject(new Error(res.message || 'WhaleVault broadcast error'));
          }
        );
      });
    }
  },

  _estCache: {
    acc: null as any,
    fund: null as any,
    props: null as any,
    last: 0
  },

  /** Estimates the value of a vote based on current reward fund and voting power */
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
  }
};
