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

export interface Delegation {
  delegator: string;
  delegatee: string;
  vesting_shares: string;
  min_delegation_time: string;
  bp?: string;
}

export interface AuthUser {
  username: string;
  type: 'key' | 'whalevault';
  key: string | null;
  vp: string;
  balance?: string;
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

export type PlayMode = 'sequential' | 'shuffle' | 'repeat-all' | 'repeat-one';

export interface PlayerState {
  enabled: boolean;
  active: boolean;
  playing: boolean;
  loading: boolean;
  minimized: boolean;
  expanded: boolean;
  expandedHeight: number;
  expandedTab: 'video' | 'queue' | 'playlists';
  currentTrack: MediaTrack | null;
  queue: MediaTrack[];
  autoQueue: MediaTrack[];
  history: MediaTrack[];
  progress: number;
  duration: number;
  volume: number;
  experimental: boolean;
  isAutoStarting: boolean;
  playMode: PlayMode;
}

export interface Playlist {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  tracks: (MediaTrack & { addedAt?: number })[];
}

export interface PlaylistState {
  playlists: Playlist[];
}

export type PlayerEvent =
  | 'trackChange' | 'play' | 'pause' | 'next' | 'prev'
  | 'ended' | 'volumeChange' | 'error';

export interface PlayerPlugin {
  name: string;
  install?: (player: BFPlayerAPI) => void;
  onTrackChange?: (track: MediaTrack) => void;
}

export interface BFPlayerAPI {
  state: PlayerState;
  playlistState: PlaylistState;
  playTrack: (track: MediaTrack, isManual?: boolean, manualIdx?: number, fromHistory?: boolean) => Promise<void>;
  playNext: (isAuto?: boolean) => void;
  playPrev: () => void;
  togglePlay: () => void;
  seek: (pct: number) => void;
  addToQueue: (track: MediaTrack) => void;
  scanView: (container?: Element | null) => void;
  registerTrack: (track: MediaTrack) => void;
  unregisterTrack: (trackId: string, type: string) => void;
  clearTracks: () => void;
  setAutoQueue: (tracks: MediaTrack[]) => void;
  initResize: (e: MouseEvent | TouchEvent) => void;
  scrollToCurrent: () => void;
  toggleExperimental: (val: boolean) => void;
  togglePlayMode: () => void;
  on: (event: PlayerEvent, fn: (data: unknown) => void) => void;
  off: (event: PlayerEvent, fn: (data: unknown) => void) => void;
  registerPlugin: (plugin: PlayerPlugin) => void;
  createPlaylist: (name: string, color?: string) => Playlist | null;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, newName: string) => void;
  addTrackToPlaylist: (playlistId: string, track: MediaTrack) => boolean;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  playPlaylist: (playlistId: string, startIndex?: number) => void;
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
