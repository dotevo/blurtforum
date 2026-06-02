// ─── Blockchain / API types ────────────────────────────────────────────────

export interface BlurtAccount {
  name: string;
  posting: { key_auths: [string, number][] };
  last_vote_time: string;
  voting_power: number;
  vesting_shares: string;
  received_vesting_shares: string;
  delegated_vesting_shares: string;
  balance: string;
  reward_blurt_balance: string;
  reward_vesting_balance: string;
  posting_json_metadata?: string;
  json_metadata?: string;
}

export interface RawPost {
  author: string;
  permlink: string;
  title: string;
  body: string;
  created: string;
  last_activity?: string;
  last_activity_author?: string;
  category: string;
  url: string;
  children?: number;
  reply_count?: number;
  pending_payout_value?: string | number;
  total_payout_value?: string | number;
  payout?: number | string;
  cashout_time?: string;
  active_votes?: ActiveVote[];
  net_votes?: number;
  net_rshares?: number;
  beneficiaries?: Beneficiary[];
  json_metadata?: string | Record<string, unknown>;
  parent_author?: string;
  parent_permlink?: string;
  stats?: { is_muted?: boolean; hide?: boolean };
  post_id?: number;
}

export interface ActiveVote {
  voter: string;
  percent: number;
  rshares?: number;
}

export interface Beneficiary {
  account: string;
  weight: number;
}

// ─── App domain types ──────────────────────────────────────────────────────

export interface Post {
  author: string;
  permlink: string;
  media: MediaTrack | null;
  title: string;
  body: string;
  created: string;
  url: string;
  category: string;
  lastActivity: string;
  lastAuthor: string;
  isUnread: boolean;
  isRead: boolean;
  isFollowing: boolean;
  isMuted: boolean;
  isPaid: boolean;
  isCollapsed: boolean;
  replyCount: number;
  parent_author: string;
  parent_permlink: string;
  pendingPayout: number;
  totalPayout: number;
  payout: number;
  vote_count: number;
  active_votes: ActiveVote[];
  net_rshares: number;
  beneficiaries: Beneficiary[];
  json_metadata?: string | Record<string, unknown>;
  tags: string[];
  depth?: number;
  _qOpen?: boolean;
  _pending?: string | boolean;
  lastActivityTs?: number;
}

export interface Forum {
  id: string;
  name: string;
  nameKey?: string;
  targetTags: string[];
  desc?: string;
  type?: string;
  auth?: boolean;
  posts: Post[];
  lastAuthor: string;
  lastPermlink: string;
  start_author?: string;
  start_permlink?: string;
  hasMore: boolean;
  pageHistory: Array<{ author: string; permlink: string }>;
}

export interface ForumCategory {
  name: string;
  forums: Forum[];
}

export interface CommunityInfo {
  title?: string;
  about?: string;
}

export interface Moderator {
  account: string;
  role: string;
  title?: string;
}

export interface AuthUser {
  username: string;
  type: 'key' | 'whalevault';
  key: string | null;
  vp: string;
  locked?: boolean;
  hasRewards?: boolean;
  rewardBlurt?: string;
  rewardVesting?: string;
}

export interface UserSubscription {
  account: string;
  title: string;
}

export interface Notification {
  id: number | string;
  type: string;
  author: string;
  date: string;
  msg?: string;
  url?: string;
  score?: number;
}

export interface ActivityItem {
  id: number;
  author: string;
  title: string;
  created: string;
  community: string;
  community_title: string;
  permlink: string;
  root_author: string;
  root_permlink: string;
  is_post: boolean;
  isRead: boolean;
  lastActivityTs: number;
}

export interface MediaTrack {
  type: 'audio' | 'youtube' | 'peertube';
  id: string;
  src?: string;
  cover?: string;
  host?: string;
  title?: string;
  author?: string;
  permlink?: string;
  payout?: number;
  voteCount?: number;
  voted?: boolean;
  pending?: boolean;
  _errorHandled?: boolean;
}

export interface BcQueueEntry {
  id: number;
  label: string;
  progress: number;
}

// Community returned from bridge list_communities — has many optional fields
export interface Community {
  name: string;
  title: string;
  about?: string;
  subscribers?: number;
  num_authors?: number;
  sum_pending?: number;
  lang?: string;
  avatar_url?: string;
  created_at?: string;
  [key: string]: unknown; // allow other API fields
}

export interface FollowCount {
  follower_count: number;
  following_count: number;
}

export interface GlobalProps {
  head_block_number?: number;
  total_vesting_fund_blurt?: string;
  total_vesting_shares?: string;
}

export interface RewardFund {
  recent_claims: string;
  reward_balance: string;
}

export interface ChainProperties {
  operation_flat_fee?: string;
  bandwidth_kbytes_fee?: string;
}

// Pagination state (used for the global index pagination, not per-forum)
export interface PaginationState {
  lastAuthor: string;
  lastPermlink: string;
  hasMore: boolean;
  loading: boolean;
  bgLoading: boolean;
  fetchedCount: number;
  visibleCount: number;
  pageHistory: Array<{ author: string; permlink: string }>;
  start_author?: string;
  start_permlink?: string;
}
