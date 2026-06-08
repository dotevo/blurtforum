/**
 * useApp — main BlurtForum composable
 * Ports the entire app.js setup() logic into a typed Vue 3 composable.
 */
import {
  ref, reactive, computed, onMounted, watch, nextTick,
} from 'vue';
import CryptoJS from 'crypto-js';
import { BFUtils } from '../modules/utils';
import * as Earnings from '../modules/earnings';
import { Blockchain } from '../modules/blockchain';
import { useVote } from './useVote';
import { BlurtPlayerPlugin } from '../modules/blurt-player-plugin';
import { AuthService } from '../modules/auth';
import { BFCommunity, VIRTUAL_FORUMS, DEFAULT_COMMUNITIES } from '../modules/community';
import { BFPlayer } from '../modules/player';
import { Parser } from '../modules/parser';

import { TR, loadLanguage, type Lang, LANGS as langs } from '../modules/translations';
import '../modules/whalevault';
import type {
  Post, Forum, ForumCategory, RawPost, AuthUser, ActivityItem,
  Beneficiary, BcQueueEntry, GlobalProps, Moderator, CommunityInfo,
  UserSubscription, Notification, MediaTrack, Delegation,
} from '../types';

// dblurt is loaded from unpkg CDN via index.html
declare const dblurt: {
  Client: new (nodes: string[]) => {
    condenser: {
      getDynamicGlobalProperties: () => Promise<GlobalProps>;
      getAccounts: (names: string[]) => Promise<Array<Record<string, unknown>>>;
      getContent: (author: string, permlink: string) => Promise<RawPost>;
      getContentReplies: (author: string, permlink: string) => Promise<RawPost[]>;
      getDiscussions: (type: string, params: Record<string, unknown>) => Promise<RawPost[]>;
      call: (namespace: string, method: string, params: unknown[]) => Promise<unknown>;
    };
    call: (namespace: string, method: string, params: any) => Promise<unknown>;
    broadcast: {
      sendOperations: (ops: unknown[], key: ReturnType<typeof dblurt.PrivateKey.from>) => Promise<void>;
    };
    nexus: {
      getCommunity: (account: string) => Promise<Record<string, unknown>>;
    };
  };
  PrivateKey: {
    from: (key: string) => {
      createPublic: () => { toString: () => string };
      sign: (bytes: Uint8Array) => { toString: () => string } | Uint8Array;
    };
  };
  Signature: { fromString: (s: string) => { toString: () => string } };
};

export function useApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const browserLang = navigator.language.slice(0, 2).toLowerCase() as Lang;
  const lang = ref<Lang>(langs.includes(browserLang) ? browserLang : 'en');
  const setLang = (l: Lang) => {
    lang.value = l;
    document.documentElement.lang = l;
    loadLanguage(l);
  };
  const t = (k: string): string => {
    const val = TR[k];
    if (!val && Object.keys(TR).length > 0) console.warn(`Translation missing for key: "${k}" in lang: "${lang.value}"`);
    return val || k;
  };

  const themes = [
    { id: 'subsilver', label: '🏛 Classic' },
    { id: 'modern',    label: '📱 Modern' },
    { id: 'deepnight', label: '🌑 Night' },
    { id: 'ocean',     label: '🌊 Ocean' },
    { id: 'forest',    label: '🌿 Forest' },
    { id: 'midnight',  label: '🌙 Midnight' },
  ];
  const theme = ref<string>(localStorage.getItem('bf-theme') || 'subsilver');
  const setTheme = (id: string) => {
    theme.value = id;
    localStorage.setItem('bf-theme', id);
    document.body.className = `theme-${id}`;
  };

  const config = reactive({
    communityAccount: 'blurt-140455',
    nodes: ['https://blurtrpc.dagobert.uk', 'https://rpc.blurt.blog', 'https://rpc.beblurt.com', 'https://rpc.drakernoise.com'],
    lockedCommunity: false,
  });

  const rpcMenuOpen  = ref(false);
  const rpcForumNode = ref(localStorage.getItem('bf-rpc-forum') || 'https://rpc.drakernoise.com');
  const rpcDataNode  = ref(localStorage.getItem('bf-rpc-data')  || 'https://rpc.drakernoise.com');
  const rpcForumCustom = ref('');
  const rpcDataCustom  = ref('');

  const getForumUrl = () => rpcForumNode.value === 'custom' ? rpcForumCustom.value : rpcForumNode.value;
  const getDataUrl  = () => rpcDataNode.value  === 'custom' ? rpcDataCustom.value  : rpcDataNode.value;

  let forumClient = new dblurt.Client([getForumUrl()]);
  let client      = new dblurt.Client([getDataUrl()]);

  const applyRpcSettings = () => {
    const fUrl = getForumUrl();
    const dUrl = getDataUrl();
    if (!fUrl || !dUrl) return;
    forumClient = new dblurt.Client([fUrl]);
    client      = new dblurt.Client([dUrl]);
    localStorage.setItem('bf-rpc-forum', rpcForumNode.value === 'custom' ? rpcForumCustom.value : rpcForumNode.value);
    localStorage.setItem('bf-rpc-data',  rpcDataNode.value  === 'custom' ? rpcDataCustom.value  : rpcDataNode.value);
  };

  const view         = ref('index');
  const loading      = ref(true);
  const repliesLoading = ref(false);
  const targetNotifPermlink = ref<string | null>(null);
  const targetNotifMatch = ref<{ author: string; ts: number } | null>(null);
  const globalProps  = ref<GlobalProps>({});
  const forumStructure = ref<ForumCategory[]>([]);
  const activeForum  = ref<Forum | null>(null);
  const activeTopic  = ref<Post | null>(null);
  const forumPagination = reactive({
    lastAuthor: '',
    lastPermlink: '',
    hasMore: true,
    loading: false,
    bgLoading: false,
    fetchedCount: 0,
    visibleCount: 20,
    pageHistory: [] as Array<{ author: string; permlink: string }>,
  });
  const replies      = ref<Post[]>([]);
  const moderators   = ref<Moderator[]>([]);
  const communityInfo = ref<CommunityInfo>({});
  const communityRewards = reactive({ blurt: '0.000', vesting: '0.000', hasRewards: false });
  const structureNote = ref(false);
  const showStructureDocs = ref(false);
  const editStructureMode = ref(false);
  const rawDescription = ref('');
  const structureForm = reactive({ text: '', loading: false, error: '' });

  const auth = reactive<{ user: AuthUser | null }>({ user: null });

  const userRole = computed(() => {
    if (!auth.user || !moderators.value.length) return null;
    const entry = moderators.value.find(m => m.account === auth.user!.username);
    return entry ? entry.role : 'member';
  });
  const canEditStructure = computed(() => ['owner', 'admin'].includes(userRole.value ?? ''));
  const canMute = computed(() => ['owner', 'admin', 'mod'].includes(userRole.value ?? ''));

  const bodyCache: Record<string, string> = {};
  const selectedCommunity = ref('blurt-140455');
  const currentTagFilter = ref(urlParams.get('tag') || '');
  const customTag = ref('');
  const userSubscriptions = ref<UserSubscription[]>([]);
  const followingSet = ref<Set<string>>(new Set());

  const allCommunities = computed(() => {
    const combined = [...DEFAULT_COMMUNITIES];
    userSubscriptions.value.forEach(s => {
      if (!combined.find(c => c.account === s.account)) combined.push(s);
    });
    if (config.communityAccount && !combined.find(c => c.account === config.communityAccount)) {
      combined.push({ account: config.communityAccount, title: communityInfo.value.title || config.communityAccount });
    }
    return combined;
  });

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
      const history = await client.call('condenser_api', 'get_account_history', [username, start, limit] as any) as Array<[number, any]>;
      if (!Array.isArray(history)) return;
      
      const ratio = parseFloat(String(globalProps.value.total_vesting_fund_blurt || 0)) / parseFloat(String(globalProps.value.total_vesting_shares || 1));
      
      if (start === -1) {
        profileUser.earnings.rawHistory = history;
      } else {
        // Avoid duplicates if any, though sequence numbers should be unique
        const existingIds = new Set(profileUser.earnings.rawHistory.map((h: any) => h[0]));
        const newItems = history.filter(h => !existingIds.has(h[0]));
        profileUser.earnings.rawHistory = [...profileUser.earnings.rawHistory, ...newItems];
      }

      const { ops, stats, daily } = Earnings.processHistory(profileUser.earnings.rawHistory, ratio);

      profileUser.earnings.history = ops.reverse(); // Newest first for table
      profileUser.earnings.chartData.daily = daily;
      profileUser.earnings.stats = stats;
      profileUser.earnings.chartData.distribution = { author: stats.author, curation: stats.curation, benefactor: stats.benefactor };
    } catch (e) { console.error('Earnings fetch error:', e); }
    finally { profileUser.earnings.loading = false; }
  };

  const pinModal = reactive({ show: false, mode: 'setup', value: '', error: '', tempUser: null as null | { username: string; key: string; acc: Record<string, unknown> }, loading: false });
  const editModal = reactive({ show: false, loading: false, isPost: false, author: '', permlink: '', title: '', body: '', error: '', success: '', target: null as Post | null });

  const resumeAction = ref<(() => void) | null>(null);

  const checkLock = (fn: () => void): boolean => {
    if (auth.user && auth.user.type === 'key' && auth.user.locked) {
      resumeAction.value = fn;
      pinModal.mode = 'unlock';
      pinModal.value = '';
      pinModal.error = '';
      pinModal.show = true;
      return true;
    }
    return false;
  };

  const statusModal = reactive({ show: false, title: '', body: '', type: 'info' as 'info' | 'success' | 'error' });
  const showStatus = (title: string, body: string, type: 'info' | 'success' | 'error' = 'info') => {
    statusModal.title = title;
    statusModal.body = body;
    statusModal.type = type;
    statusModal.show = true;
  };

  const showLoginModal = ref(false);
  const loginTab  = ref('key');
  const loginForm = reactive({ username: '', key: '', remember: false });
  const loginErr  = ref('');
  const loginBusy = ref(false);
  const wvAvailable = computed(() => typeof window.blurt_keychain !== 'undefined');

  const replyTarget = ref<Post | null>(null);
  const replyForm   = reactive({ body: '', loading: false, error: '', success: '', beneficiary: { account: '', weight: '' } });

  const showNewPostForm = ref(false);
  const postPreview = ref(false);
  const replyPreview = ref(false);

  const getDraftKey = () => `bf-draft-${config.communityAccount}-${activeForum.value?.id || 'x'}`;
  const saveDraft = () => {
    if (!postForm.title && !postForm.body) return;
    localStorage.setItem(getDraftKey(), JSON.stringify({ title: postForm.title, body: postForm.body, selectedTag: postForm.selectedTag, customTags: postForm.customTags }));
  };
  const clearDraft = () => { localStorage.removeItem(getDraftKey()); postForm.hasDraft = false; };
  const loadDraft = () => {
    try {
      const d = localStorage.getItem(getDraftKey());
      if (d) {
        const p = JSON.parse(d);
        postForm.title = p.title || '';
        postForm.body  = p.body  || '';
        if (p.selectedTag) postForm.selectedTag = p.selectedTag;
        if (p.customTags)  postForm.customTags  = p.customTags;
        postForm.hasDraft = true;
      }
    } catch { /* ignore */ }
  };

  const postForm = reactive({
    title: '', body: '', loading: false, error: '', success: '', hasDraft: false,
    devTip: localStorage.getItem('blurtforum_devtip') !== 'false',
    beneficiary: { account: '', weight: '' },
    selectedTag: '', customTags: '',
  });

  const payoutModal = reactive<{ show: boolean; post: Partial<Post & { payoutDate?: string }>; beneficiaries: Beneficiary[] }>({ show: false, post: {}, beneficiaries: [] });
  const followModal = reactive({ show: false, user: '', isFollowing: false });
  const walletModal = reactive({ show: false, mode: 'transfer' as 'transfer' | 'power_up' | 'power_down', balance: '0.000', targetUser: '' });
  const notifModal = reactive({
    show: false, loading: false, list: [] as Notification[],
    lastReadId: parseInt(localStorage.getItem('bf_last_notif_id') || '0'),
    hasNew: false,
    clickedIds: JSON.parse(localStorage.getItem('bf_clicked_notif_ids') || '[]') as (number | string)[],
  });

  const globalActivity = ref<ActivityItem[]>([]);
  const activityTab = ref('comments');
  const activityExpanded = ref(true);
  const activityFullList = ref(false);
  const mobileActivityExpanded = ref(false);

  const fmtDate = (s: string) => BFUtils.fmtDate(s);
  const timeAgo = (s: string) => BFUtils.timeAgo(s, t);

  const forumHasUnread = (forum: Forum): boolean => {
    const topPosts = forum.posts.slice(0, 5);
    return topPosts.some(p => p.isUnread);
  };

  const renderMD = (text: string, context: any = null): string => {
    let ctx = context;
    if (context && context.author && context.permlink) {
      // Map Post fields to ParseContext
      ctx = {
        ...context,
        voteCount: context.vote_count,
        voted: hasVoted(context)
      };
    }
    return Parser.render(text, ctx);
  };

  const isNestedReply = (r: Post): boolean => {
    if (!activeTopic.value) return false;
    return !(r.parent_author === activeTopic.value.author && r.parent_permlink === activeTopic.value.permlink);
  };
  const getParentBody = (r: Post): string => bodyCache[`${r.parent_author}/${r.parent_permlink}`] || '';

  const getReadStatusMap = () => JSON.parse(localStorage.getItem('bf_read_status_v2') || '{}') as Record<string, number>;
  
  const normalizePost = (p: RawPost): Post => Blockchain.normalizePost(p, {
    currentUser: auth.user?.username,
    followingSet: followingSet.value,
    readStatusMap: getReadStatusMap(),
    canMute: canMute.value
  });

  const updateGlobalActivity = async (): Promise<void> => {
    if (!auth.user) return;
    const readStatus = getReadStatusMap();
    const allActivity: ActivityItem[] = [];
    const currentUsername = auth.user.username;
    
    // Fallback: if no subscriptions, check the primary community account
    const subsToCheck = userSubscriptions.value.length > 0 
      ? userSubscriptions.value.slice(0, 25) 
      : [{ account: config.communityAccount, title: 'Blurt' }];

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const sub of subsToCheck) {
      try {
        const posts = await client.call('bridge', 'get_forum_posts', { community: sub.account, limit: 5, sort: 'activity' }) as RawPost[];
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
            });
          });
        }
      } catch { /* silent fail */ }
    }
    allActivity.sort((a, b) => b.lastActivityTs - a.lastActivityTs);
    const seen = new Set<number>();
    globalActivity.value = allActivity.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; }).slice(0, 30);
  };

  const markTopicAsRead = (topic: { author: string; permlink: string; lastActivityTs?: number; lastActivity?: string }): void => {
    if (!topic) return;
    const readStatus = getReadStatusMap();
    const key = `${topic.author}/${topic.permlink}`;
    const currentStored = readStatus[key] || 0;
    const incomingTs = topic.lastActivityTs || (topic.lastActivity ? new Date(topic.lastActivity).getTime() : Date.now());
    readStatus[key] = Math.max(currentStored, incomingTs, Date.now());
    localStorage.setItem('bf_read_status_v2', JSON.stringify(readStatus));
    if (activeTopic.value?.author === topic.author && activeTopic.value?.permlink === topic.permlink) {
      activeTopic.value.isRead = true;
      activeTopic.value.isUnread = false;
    }
    globalActivity.value.forEach(act => {
      if (act.root_author === topic.author && act.root_permlink === topic.permlink) act.isRead = true;
    });
  };

  const openActivity = (act: ActivityItem): void => {
    if (act.community !== config.communityAccount) {
      config.communityAccount = act.community;
      selectedCommunity.value = act.community;
      forumClient = new dblurt.Client([getForumUrl()]);
      client      = new dblurt.Client([getDataUrl()]);
      loadData();
    }
    markTopicAsRead({ author: act.root_author, permlink: act.root_permlink, lastActivityTs: act.lastActivityTs });
    if (!act.is_post) { targetNotifMatch.value = { author: act.author, ts: act.lastActivityTs }; }
    else { targetNotifPermlink.value = act.permlink; }
    openTopic({ author: act.root_author, permlink: act.root_permlink } as Post);
  };

  const oldContentModal = reactive({
    show: false, loading: false, author: '', permlink: '', body: '', status: '',
    beneficiaries: [] as Beneficiary[], originalPost: null as RawPost | null, weight: 0,
  });
  const imgModal = reactive({ show: false, src: '' });
  const openImgModal = (src: string) => { imgModal.src = src; imgModal.show = true; };

  const loadData = async (direction: string | boolean = 'current', targetForum: Forum | null = null): Promise<void> => {
    loading.value = true;
    structureNote.value = false;
    refreshUser();
    try {
      if (direction === 'current' && !targetForum) {
        const props = await client.condenser.getDynamicGlobalProperties();
        globalProps.value = props;
        moderators.value = [];
        communityInfo.value = {};
        forumPagination.lastAuthor = '';
        forumPagination.lastPermlink = '';
        forumPagination.hasMore = true;
        forumPagination.pageHistory = [];
      }

      if (direction === 'current' && !targetForum) {
        try {
          if (config.communityAccount.startsWith('blurt-')) {
            const cc = await forumClient.nexus.getCommunity(config.communityAccount) as Record<string, unknown>;
            if (cc) {
              communityInfo.value = { title: (cc.title as string) || config.communityAccount, about: (cc.about as string) || '' };
              rawDescription.value = (cc.description as string) || '';
              let structureSource = (cc.description as string) || '';
              const extMatch = structureSource.match(/\[\[Forum config:(@?)([a-z0-9.-]+)\/([a-z0-9-]+)\]\]/i);
              if (extMatch) {
                try {
                  const post = await client.condenser.getContent(extMatch[2], extMatch[3]);
                  if (post?.body) structureSource = post.body;
                } catch (err) { console.warn('External config load error:', err); }
              }
              const parsed = BFUtils.parseStructure(structureSource);
              forumStructure.value = parsed ?? BFUtils.defaultStructure();
              if (!parsed) structureNote.value = true;
              if (cc.team) {
                moderators.value = (cc.team as Array<[string, string, string]>).map(m => ({ account: m[0], role: m[1], title: m[2] || '' }));
              }
            }
          } else {
            forumStructure.value = BFUtils.defaultStructure();
            structureNote.value = true;
          }
        } catch (e) {
          console.warn('Nexus getCommunity error:', (e as Error).message);
          if (!forumStructure.value.length) forumStructure.value = BFUtils.defaultStructure();
          structureNote.value = true;
        }

          const accounts = await client.condenser.getAccounts([config.communityAccount]) as Record<string, unknown>[];
          const acc = accounts?.[0];
          if (acc) {
            const rb = acc.reward_blurt_balance as string;
            const rv = acc.reward_vesting_balance as string;
            communityRewards.blurt = rb ? rb.split(' ')[0] : '0.000';
            communityRewards.vesting = rv ? rv.split(' ')[0] : '0.000';
            communityRewards.hasRewards = parseFloat(communityRewards.blurt) > 0 || parseFloat(communityRewards.vesting) > 0;
            
            if (!communityInfo.value?.title) {
              let meta: Record<string, unknown> = {};
              try { meta = JSON.parse((acc.posting_json_metadata as string) || (acc.json_metadata as string) || '{}'); } catch { /* ignore */ }
              const profile = (meta.profile as Record<string, string>) || {};
              communityInfo.value = { title: profile.name || acc.name as string, about: profile.about || '' };
            }
          }

        try {
          if (!moderators.value.length) {
            const roles = await forumClient.call('bridge', 'list_community_roles', { community: config.communityAccount }) as Array<[string, string, string]>;
            if (Array.isArray(roles) && roles.length > 0) {
              moderators.value = roles.map(r => ({ account: r[0], role: r[1], title: r[2] || '' }));
            }
          }
        } catch (e) { console.warn('Bridge list_community_roles error:', (e as Error).message); }

        let hasOther = false;
        forumStructure.value.forEach(cat => cat.forums.forEach(f => {
          f.posts = []; f.lastAuthor = ''; f.lastPermlink = ''; f.hasMore = true; f.pageHistory = [];
          if (!f.targetTags.length || f.name.toLowerCase().includes('other')) hasOther = true;
        }));
        if (!hasOther) {
          forumStructure.value.push({ name: 'General', forums: [{ id: 'f-other', name: 'Other / Inne', targetTags: [], desc: 'Posts', posts: [], lastAuthor: '', lastPermlink: '', hasMore: true, pageHistory: [] }] });
        }
      }

      const pag = targetForum || forumPagination;
      const fetchLimit = 31;
      const params: Record<string, unknown> = { community: config.communityAccount, limit: fetchLimit, sort: 'activity' };

      if (direction === 'next' && pag.lastAuthor) {
        params.start_author = pag.lastAuthor;
        params.start_permlink = pag.lastPermlink;
        (pag as Forum).start_author = pag.lastAuthor;
        (pag as Forum).start_permlink = pag.lastPermlink;
        pag.pageHistory.push({ author: pag.lastAuthor, permlink: pag.lastPermlink });
      } else if (direction === 'prev') {
        pag.pageHistory.pop();
        const prev = pag.pageHistory.pop();
        if (prev) { params.start_author = prev.author; params.start_permlink = prev.permlink; (pag as Forum).start_author = prev.author; (pag as Forum).start_permlink = prev.permlink; }
        else { (pag as Forum).start_author = ''; (pag as Forum).start_permlink = ''; }
      } else if (pag.lastAuthor && direction === true) {
        params.start_author = pag.lastAuthor; params.start_permlink = pag.lastPermlink;
      } else if ((pag as Forum).start_author && direction === 'current') {
        params.start_author = (pag as Forum).start_author; params.start_permlink = (pag as Forum).start_permlink;
      }

      if (targetForum?.targetTags.length) params.tags_any = [...targetForum.targetTags];
      if (currentTagFilter.value) {
        if (!params.tags_any) params.tags_any = [];
        if (!(params.tags_any as string[]).includes(currentTagFilter.value)) (params.tags_any as string[]).push(currentTagFilter.value);
      }

      let rawPosts: RawPost[] = [];
      const forumId = targetForum?.id || activeForum.value?.id;
      const vf = VIRTUAL_FORUMS.find(v => v.id === forumId);

      if (vf) {
        const apiParams: Record<string, unknown> = { limit: fetchLimit };
        if (params.start_author) {
          apiParams.start_author = params.start_author;
          apiParams.start_permlink = params.start_permlink;
        }
        
        if (currentTagFilter.value) apiParams.tag = currentTagFilter.value;

        if (vf.id === 'user-feed' && auth.user) {
          rawPosts = await forumClient.call('bridge', 'get_account_posts', { ...apiParams, account: auth.user.username, sort: 'feed' }) as RawPost[];
        } else if (vf.id === 'global-trending') {
          rawPosts = await forumClient.call('bridge', 'get_ranked_posts', { ...apiParams, sort: 'trending' }) as RawPost[];
        } else if (vf.id === 'global-new') {
          rawPosts = await forumClient.call('bridge', 'get_ranked_posts', { ...apiParams, sort: 'created' }) as RawPost[];
        } else if (vf.id === 'global-activity') {
          rawPosts = await forumClient.call('bridge', 'get_forum_posts', { ...apiParams, community: '', sort: 'activity' }) as RawPost[];
        }
      } else {
        const qp: Record<string, any> = { ...params };
        if (!qp.start_author) { delete qp.start_author; delete qp.start_permlink; }
        rawPosts = await forumClient.call('bridge', 'get_forum_posts', qp) as RawPost[];
      }

      if (!rawPosts || rawPosts.length === 0) {
        pag.hasMore = false;
        if (targetForum && direction !== true) targetForum.posts = [];
      } else {
        if (targetForum && direction !== true) targetForum.posts = [];
        processBatch(rawPosts, null, targetForum);
        const lastItem = rawPosts[rawPosts.length - 1];
        pag.lastAuthor = lastItem.author;
        pag.lastPermlink = lastItem.permlink;
        pag.hasMore = rawPosts.length >= fetchLimit;
      }
    } catch (err) {
      console.error('loadData error:', err);
      structureNote.value = true;
    } finally {
      loading.value = false;
    }
  };

  const processBatch = (slice: RawPost[], catchAllForum: Forum | null, targetForum: Forum | null = null): void => {
    if (!slice.length) return;
    slice.forEach(p => {
      const post = normalizePost(p);
      bodyCache[`${p.author}/${p.permlink}`] = p.body;
      
      if (post.isMuted && !canMute.value) return;
      if (targetForum) {
        if (!targetForum.posts.find(fp => fp.permlink === post.permlink && fp.author === post.author)) targetForum.posts.push(post);
        return;
      }
      let assignedCount = 0;
      for (const cat of forumStructure.value) {
        for (const forum of cat.forums) {
          if (forum === catchAllForum) continue;
          const targetTags = forum.targetTags.map(t => t.toLowerCase());
          const postTags = post.tags.map(t => t.toLowerCase());
          if (targetTags.length > 0 && targetTags.some(tag => postTags.includes(tag))) {
            if (!forum.posts.find(fp => fp.permlink === post.permlink && fp.author === post.author)) forum.posts.push(post);
            assignedCount++;
          }
        }
      }
      if (assignedCount === 0 && catchAllForum) {
        if (!catchAllForum.posts.find(fp => fp.permlink === post.permlink && fp.author === post.author)) catchAllForum.posts.push(post);
      }
    });
  };

  const changePage = async (dir: 'next' | 'prev') => { if (activeForum.value) { await loadData(dir, activeForum.value); syncUrl(); } };
  const loadMorePosts = async (): Promise<void> => {

    if (!activeForum.value) return;
    let attempts = 0;
    while (attempts < 5) {
      if (activeForum.value.posts.length > forumPagination.visibleCount) { forumPagination.visibleCount += 10; return; }
      if (!activeForum.value.hasMore) return;
      const prevCount = activeForum.value.posts.length;
      await loadData(true, activeForum.value);
      attempts++;
      if (activeForum.value.posts.length > prevCount) { forumPagination.visibleCount += 10; return; }
    }
  };

  const loadReplies = async (author: string, permlink: string, keepState = false): Promise<void> => {
    if (!keepState) {
      repliesLoading.value = true;
      replies.value = replies.value.filter(r => r._pending);
      replyTarget.value = null;
    }
    const flat: Post[] = [];
    const recurse = async (pAuthor: string, pPermlink: string, depth: number): Promise<void> => {
      let results: RawPost[];
      try {
        results = await client.condenser.getContentReplies(pAuthor, pPermlink);
      } catch (e) {
        console.error(`Error loading replies for ${pAuthor}/${pPermlink}:`, e);
        return;
      }
      if (!results?.length) return;
      for (const r of results) {
        bodyCache[`${r.author}/${r.permlink}`] = r.body;
        const post = { ...normalizePost(r), depth, _qOpen: false };
        flat.push(post);
        if (r.children && r.children > 0) await recurse(r.author, r.permlink, depth + 1);
      }
    };
    await recurse(author, permlink, 1);

    const pendingOnes = replies.value.filter(r => r._pending);
    const serverIds = new Set(flat.map(r => (r.author + '/' + r.permlink).toLowerCase()));
    const stillPending = pendingOnes.filter(p => !serverIds.has((p.author + '/' + p.permlink).toLowerCase()));
    replies.value = [...flat, ...stillPending].sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());

    if (targetNotifMatch.value) {
      const match = flat.find(r => r.author === targetNotifMatch.value!.author && new Date(r.created).getTime() === targetNotifMatch.value!.ts);
      if (match) targetNotifPermlink.value = match.permlink;
      targetNotifMatch.value = null;
    }

    if (!keepState) {
      repliesLoading.value = false;
      if (targetNotifPermlink.value) {
        nextTick(() => {
          const el = document.getElementById('post-' + targetNotifPermlink.value);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlighted-post');
            setTimeout(() => el.classList.remove('highlighted-post'), 3000);
          }
          targetNotifPermlink.value = null;
        });
      }
    }
  };

  const syncUrl = (): void => {
    const params = new URLSearchParams();
    params.set('community', config.communityAccount);
    if (view.value !== 'index') params.set('view', view.value);
    if (currentTagFilter.value) params.set('tag', currentTagFilter.value);
    if (view.value === 'forum' && activeForum.value) {
      params.set('forum', activeForum.value.id);
      if (activeForum.value.start_author && activeForum.value.start_permlink) {
        params.set('start_author', activeForum.value.start_author);
        params.set('start_permlink', activeForum.value.start_permlink);
      }
    } else if (view.value === 'topic' && activeTopic.value) {
      if (activeForum.value) params.set('forum', activeForum.value.id);
      params.set('author', activeTopic.value.author);
      params.set('permlink', activeTopic.value.permlink);
    } else if (view.value === 'profile' && profileUser.username) {
      params.set('user', profileUser.username);
      if (profileTab.value !== 'posts') params.set('tab', profileTab.value);
    }
    window.history.pushState({ path: window.location.pathname + '?' + params.toString() }, '', window.location.pathname + '?' + params.toString());
  };

  const applyTagFilter = async () => { syncUrl(); await loadData('current', activeForum.value); };
  const clearTagFilter = async () => { currentTagFilter.value = ''; syncUrl(); await loadData('current', activeForum.value); };

  const goHome = (): void => {
    view.value = 'index';
    activeForum.value = null;
    activeTopic.value = null;
    replies.value = [];
    showNewPostForm.value = false;
    currentTagFilter.value = '';
    syncUrl();
  };

  const openForum = (forum: Forum): void => {
    forum.lastAuthor = ''; forum.lastPermlink = ''; forum.start_author = ''; forum.start_permlink = '';
    forum.pageHistory = []; forum.hasMore = true;
    forumPagination.visibleCount = 20; // Reset visibility limit
    currentTagFilter.value = '';
    const isVirtual = VIRTUAL_FORUMS.find(vf => vf.id === forum.id);
    if (!isVirtual) { localStorage.setItem('bf_last_forum_id', forum.id); localStorage.setItem('bf_last_community', config.communityAccount); }
    activeForum.value = forum;
    view.value = 'forum';
    activeTopic.value = null;
    showNewPostForm.value = false;
    loadData('current', forum);
    syncUrl();
  };

  const openTopic = async (topic: Post): Promise<void> => {
    if (!topic.payout && !topic.body) {
      loading.value = true;
      try {
        const full = await client.condenser.getContent(topic.author, topic.permlink);
        if (full?.author) topic = normalizePost(full);
      } catch (e) { console.error('Error fetching full topic:', e); }
      loading.value = false;
    }
    activeTopic.value = { ...topic, beneficiaries: topic.beneficiaries || [] };
    bodyCache[`${topic.author}/${topic.permlink}`] = topic.body;
    view.value = 'topic';
    syncUrl();
    markTopicAsRead(activeTopic.value);
    loadReplies(topic.author, topic.permlink);
    if (!topic.beneficiaries?.length) {
      client.condenser.getContent(topic.author, topic.permlink).then(full => {
        if (full?.beneficiaries?.length && activeTopic.value?.permlink === topic.permlink) {
          activeTopic.value = { ...activeTopic.value, beneficiaries: full.beneficiaries as Beneficiary[] };
        }
      }).catch(() => {});
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
    syncUrl();
    try {
      const [accounts, followCount, posts, comments, replies] = await Promise.all([
        client.condenser.getAccounts([username]),
        client.call('condenser_api', 'get_follow_count', { account: username }) as Promise<{ follower_count: number; following_count: number }>,
        client.call('bridge', 'get_account_posts', { account: username, sort: 'posts', limit: 20 }) as Promise<RawPost[]>,
        client.call('bridge', 'get_account_posts', { account: username, sort: 'comments', limit: 20 }) as Promise<RawPost[]>,
        client.call('bridge', 'get_account_posts', { account: username, sort: 'replies', limit: 20 }) as Promise<RawPost[]>,
      ]);
      if (accounts?.[0]) {
        const acc = accounts[0] as Record<string, unknown>;
        profileUser.data = acc;
        if (followCount) { (profileUser.data as Record<string, unknown>).followerCount = followCount.follower_count; (profileUser.data as Record<string, unknown>).followingCount = followCount.following_count; }
        const ratio = parseFloat(String(globalProps.value.total_vesting_fund_blurt || 0)) / parseFloat(String(globalProps.value.total_vesting_shares || 1));
        const bp = parseFloat(acc.vesting_shares as string || '0') * ratio;
        const delegatedIn = parseFloat(acc.received_vesting_shares as string || '0') * ratio;
        const delegatedOut = parseFloat(acc.delegated_vesting_shares as string || '0') * ratio;
        Object.assign(profileUser.data, {
          bp: bp.toFixed(3), delegatedIn: delegatedIn.toFixed(3), delegatedOut: delegatedOut.toFixed(3),
          totalBP: (bp + delegatedIn - delegatedOut).toFixed(3),
          walletValue: (parseFloat(acc.balance as string || '0') + bp).toFixed(3),
        });
        try {
          const meta = JSON.parse((acc.posting_json_metadata as string) || (acc.json_metadata as string) || '{}');
          const p = (meta.profile as Record<string, string>) || {};
          Object.assign(profileUser.data, { about: p.about || '', website: p.website || '', location: p.location || '', displayName: p.name || acc.name });
        } catch { /* ignore */ }
      }
      
      if (posts) {
        profileUser.posts = posts.map(normalizePost);
        profileUser.postsHasMore = posts.length === 20;
      }
      if (comments) {
        profileUser.comments = comments.map(normalizePost);
        profileUser.commentsHasMore = comments.length === 20;
      }
      if (replies) {
        profileUser.replies = replies.map(normalizePost);
        profileUser.repliesHasMore = replies.length === 20;
      }

      // Fetch earnings
      _fetchEarningsHistory(username);
      _fetchWalletData(username);
    } catch (err) { console.error('Profile error:', err); }
    profileUser.loading = false;
  };

  const loadMoreProfileContent = async (sort: 'posts' | 'comments' | 'replies'): Promise<void> => {
    if (profileUser.loading) return;
    const list = profileUser[sort];
    if (list.length === 0) return;
    const last = list[list.length - 1];
    profileUser.loading = true;
    try {
      const more = await client.call('bridge', 'get_account_posts', {
        account: profileUser.username,
        sort,
        limit: 20,
        start_author: last.author,
        start_permlink: last.permlink
      }) as RawPost[];
      
      if (more && more.length > 0) {
        // Skip the first one as it's the 'last' from previous batch
        const filtered = more.slice(1).map(normalizePost);
        profileUser[sort] = [...profileUser[sort], ...filtered];
        profileUser[`${sort}HasMore`] = more.length === 20;
      } else {
        profileUser[`${sort}HasMore`] = false;
      }
    } catch (e) { console.error('Load more profile error:', e); }
    finally { profileUser.loading = false; }
  };

  const _fetchWalletData = async (username: string): Promise<void> => {
    profileUser.wallet.loading = true;
    try {
      if (!globalProps.value.total_vesting_fund_blurt) {
        const props = await client.condenser.getDynamicGlobalProperties();
        globalProps.value = props;
      }

      const ratio = parseFloat(String(globalProps.value.total_vesting_fund_blurt || 0)) / parseFloat(String(globalProps.value.total_vesting_shares || 1));
      
      const [delegations, expiringDel, history] = await Promise.all([
        client.call('condenser_api', 'get_vesting_delegations', [username, '', 100]) as Promise<Delegation[]>,
        client.call('condenser_api', 'get_expiring_vesting_delegations', [username, '2000-01-01T00:00:00', 100])
          .catch(() => [] as any[]),
        client.call('condenser_api', 'get_account_history', [username, -1, 1000]) as Promise<Array<[number, any]>>
      ]);

      // 1. Process Outgoing
      if (Array.isArray(delegations)) {
        profileUser.wallet.delegations = delegations.map(d => ({ ...d, bp: (parseFloat(d.vesting_shares) * ratio).toFixed(3) }));
      }

      // 2. Process History & Extract Incoming Delegations (Fallback)
      const incomingMap: Record<string, Delegation> = {};
      if (Array.isArray(history)) {
        profileUser.wallet.history = history
          .map(item => ({ seq: item[0], ...item[1] }))
          .filter(item => {
             const op = item.op;
             if (!op || !Array.isArray(op)) return false;
             
             // Extract incoming delegations from history while filtering
             if (op[0] === 'delegate_vesting_shares' && op[1].delegatee === username && op[1].delegator !== username) {
               const val = parseFloat(op[1].vesting_shares);
               if (val > 0) {
                 incomingMap[op[1].delegator] = {
                   delegator: op[1].delegator,
                   delegatee: username,
                   vesting_shares: op[1].vesting_shares,
                   min_delegation_time: '',
                   bp: (val * ratio).toFixed(3)
                 };
               } else { delete incomingMap[op[1].delegator]; }
             }

             return ['transfer', 'transfer_to_vesting', 'withdraw_vesting', 'delegate_vesting_shares'].includes(op[0]);
          })
          .reverse();
        
        profileUser.wallet.incomingDelegations = Object.values(incomingMap);
      }

      // 3. Try to get more Incoming via database_api (if supported)
      try {
        const dbIncoming = await client.call('database_api', 'list_vesting_delegations', { start: [username, ''], limit: 100, order: 'by_delegation' }) as any;
        const delList = (dbIncoming.delegations || dbIncoming) as any[];
        if (Array.isArray(delList)) {
          delList.forEach(d => {
            if (d.delegatee === username && d.delegator !== username) {
               const vs = typeof d.vesting_shares === 'string' ? d.vesting_shares : `${(parseFloat(d.vesting_shares.amount) / 1000000).toFixed(6)} VESTS`;
               incomingMap[d.delegator] = { 
                 delegator: d.delegator, delegatee: d.delegatee, vesting_shares: vs, min_delegation_time: d.min_delegation_time,
                 bp: (parseFloat(vs) * ratio).toFixed(3)
               };
            }
          });
          profileUser.wallet.incomingDelegations = Object.values(incomingMap);
        }
      } catch (e) { /* ignore, we have history fallback */ }

      if (profileUser.data) {
        const acc = profileUser.data as any;
        const withdrawRate = parseFloat(acc.vesting_withdraw_rate || '0');
        const toWithdraw = parseFloat(acc.to_withdraw || '0');
        const withdrawn = parseFloat(acc.withdrawn || '0');
        if (withdrawRate > 0) {
          profileUser.wallet.powerDown = {
            total: ((toWithdraw - withdrawn) / 1000000 * ratio).toFixed(3),
            rate: (withdrawRate / 1000000 * ratio).toFixed(3),
            next: acc.next_vesting_withdrawal,
            percent: Math.round((withdrawn / toWithdraw) * 100) || 0
          };
        } else { profileUser.wallet.powerDown = { total: '0.000', rate: '0.000', next: '', percent: 0 }; }
      }
    } catch (err) { console.warn('Wallet fetch error:', err); }
    profileUser.wallet.loading = false;
  };

  const switchCommunity = (account: string): void => {
    if (!account) return;
    config.communityAccount = account;
    const found = allCommunities.value.find(c => c.account === account);
    if (found) { selectedCommunity.value = account; }
    else { selectedCommunity.value = 'custom'; customTag.value = account; }
    forumClient = new dblurt.Client([getForumUrl()]);
    client      = new dblurt.Client([getDataUrl()]);
    goHome();
    loadData();
  };

  const handleCommunityChange = (): void => {
    const tag = selectedCommunity.value === 'custom' ? customTag.value.trim() : selectedCommunity.value;
    switchCommunity(tag);
  };

  const openCommunities = (): void => {
    view.value = 'communities';
    currentTagFilter.value = '';
    syncUrl();
    if (BFCommunity.state.list.length === 0) BFCommunity.fetchCommunities(client as unknown as Record<string, unknown>);
  };

  const toggleCommunitySub = async (communityName: string): Promise<void> => {
    if (!auth.user) { openLoginModal(); return; }
    if (checkLock(() => toggleCommunitySub(communityName))) return;
    const isSub = userSubscriptions.value.some(s => s.account === communityName);
    try {
      await BFCommunity.toggleSubscription(auth, broadcast as (ops: unknown[]) => Promise<void>, communityName, isSub);
      if (isSub) userSubscriptions.value = userSubscriptions.value.filter(s => s.account !== communityName);
      else { const commInfo = BFCommunity.state.list.find(c => c.name === communityName); userSubscriptions.value.push({ account: communityName, title: commInfo?.title ?? communityName }); }
      showStatus('Community', (isSub ? 'Unsubscribed from ' : 'Subscribed to ') + communityName, 'success');
    } catch (err) { showStatus('Community', 'Error: ' + ((err as Error).message || err), 'error'); }
  };

  const broadcast = (ops: unknown[]) => {
    if (!auth.user) throw new Error('Not logged in');
    return Blockchain.broadcast(client, auth.user, ops);
  };

  const loadFollowingList = async (username: string): Promise<void> => {
    if (!username) return;
    try {
      const following = await client.call('condenser_api', 'get_following', { account: username, start: '', type: 'blog', limit: 1000 }) as Array<{ following: string }>;
      if (Array.isArray(following)) followingSet.value = new Set(following.map(f => f.following));
    } catch (e) { console.warn('Error loading following list:', e); }
  };

  const toggleFollow = (targetAuthor: string): void => {
    if (!auth.user) { openLoginModal(); return; }
    followModal.user = targetAuthor;
    followModal.isFollowing = followingSet.value.has(targetAuthor);
    followModal.show = true;
  };

  const confirmToggleFollow = async (): Promise<void> => {
    const targetAuthor = followModal.user;
    followModal.show = false;
    if (checkLock(confirmToggleFollow)) return;
    const isFollowing = followingSet.value.has(targetAuthor);
    const op = ['custom_json', {
      required_auths: [], required_posting_auths: [auth.user!.username],
      id: 'follow', json: JSON.stringify(['follow', { follower: auth.user!.username, following: targetAuthor, what: isFollowing ? [] : ['blog'] }]),
    }];
    try {
      await broadcast([op]);
      const newSet = new Set(followingSet.value);
      isFollowing ? newSet.delete(targetAuthor) : newSet.add(targetAuthor);
      followingSet.value = newSet;
    } catch (err) { console.error('Follow error:', err); showStatus('Social', 'Error updating follow status: ' + ((err as Error).message || err), 'error'); }
  };

  // ── Image upload ──────────────────────────────────────────────────────────
  const uploadImageFile = async (file: File): Promise<string> => {
    if (!auth.user) throw new Error('Not logged in');
    const arrayBuf = await file.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuf);
    const prefix = new TextEncoder().encode('ImageSigningChallenge');
    const combined = new Uint8Array(prefix.length + fileBytes.length);
    combined.set(prefix, 0); combined.set(fileBytes, prefix.length);
    const wordArray = CryptoJS.lib.WordArray.create(combined as unknown as number[]);
    const hashHex = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
    const hashBytes = new Uint8Array(hashHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    let sigHex: string;
    if (auth.user.type === 'key') {
      const privKey = dblurt.PrivateKey.from(auth.user.key!);
      const sig = privKey.sign(hashBytes);
      sigHex = typeof (sig as { toString: () => string }).toString === 'function' ? (sig as { toString: () => string }).toString() : Array.from(sig as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      sigHex = await new Promise((resolve, reject) => {
        if (!window.blurt_keychain) { reject(new Error('WhaleVault not available')); return; }
        const bufferObject = { type: 'Buffer', data: Array.from(combined) };
        (window.blurt_keychain as Record<string, Function>).requestSignBuffer(auth.user!.username, JSON.stringify(bufferObject), 'posting', (res: { success: boolean; result?: string; message?: string }) => {
          if (res?.success) {
            let result = res.result ?? '';
            result = result.split(':')[0];
            if (result.startsWith('SIG_K1_')) { try { result = dblurt.Signature.fromString(result).toString(); } catch { /* ignore */ } }
            resolve(result);
          } else reject(new Error(res?.message ?? 'WV sign error'));
        });
      });
    }
    const url = `https://img-upload.blurt.blog/${auth.user.username}/${sigHex}`;
    const formData = new FormData(); formData.append('file', file);
    const resp = await fetch(url, { method: 'POST', body: formData });
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    const data = await resp.json() as { url?: string };
    if (!data.url) throw new Error('No URL in response: ' + JSON.stringify(data));
    return data.url;
  };

  const insertImageIntoBody = (target: 'post' | 'reply', imgUrl: string): void => {
    const md = `\n![image](${imgUrl})\n`;
    if (target === 'post') { postForm.body += md; saveDraft(); }
    else replyForm.body += md;
  };

  const handleImageUpload = async (file: File, target: 'post' | 'reply'): Promise<void> => {
    if (checkLock(() => handleImageUpload(file, target))) return;
    if (!file || !file.type.startsWith('image/')) return;
    try { insertImageIntoBody(target, await uploadImageFile(file)); }
    catch (err) {
      console.error('Image upload error:', err);
      if (target === 'post') postForm.error = 'Image upload failed: ' + (err as Error).message;
      else replyForm.error = 'Image upload failed: ' + (err as Error).message;
    }
  };

  const imgUploads = reactive({ post: false, reply: false });
  const onImagePick = async (target: 'post' | 'reply', e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    imgUploads[target] = true;
    try { await handleImageUpload(f, target); }
    finally { imgUploads[target] = false; }
  };
  const onPaste = async (target: 'post' | 'reply', e: ClipboardEvent) => {
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const f = item.getAsFile()!;
        imgUploads[target] = true;
        try { await handleImageUpload(f, target); }
        finally { imgUploads[target] = false; }
        break;
      }
    }
  };

  // ── Blockchain wait queue ─────────────────────────────────────────────────
  const bcWaitQueue = ref<BcQueueEntry[]>([]);
  const bcQueueExpanded = ref(false);
  let _bcId = 0;

  const refreshUser = async (): Promise<void> => {
    if (!auth.user) return;
    try {
      const accounts = await client.condenser.getAccounts([auth.user.username]);
      if (accounts?.[0]) {
        const acc = accounts[0] as Record<string, unknown>;
        const lastVoteTime = new Date((acc.last_vote_time as string) + 'Z').getTime();
        const delta = (Date.now() - lastVoteTime) / 1000;
        let vp = (acc.voting_power as number) + (10000 * delta / 432000);
        vp = Math.min(vp / 100, 100);
        const hasRewards = BFUtils.parsePayout(acc.reward_blurt_balance as string) > 0 || BFUtils.parsePayout(acc.reward_vesting_balance as string) > 0;
        auth.user = { ...auth.user, vp: vp.toFixed(2), hasRewards, rewardBlurt: acc.reward_blurt_balance as string, rewardVesting: acc.reward_vesting_balance as string };
      }
    } catch (e) { console.warn('Refresh user error:', e); }
  };

  const waitAndReload = async (isTopic: boolean, author: string | null = null, permlink: string | null = null, pollFn: ((c: RawPost) => boolean) | null = null, label: string | null = null): Promise<void> => {
    const id = ++_bcId;
    const entry = reactive<BcQueueEntry>({ id, label: label || t('waitingForBlock'), progress: 0 });
    bcWaitQueue.value.push(entry);

    const maxMs = 90000; const pollMs = 3000; const start = Date.now();
    let lastContent: RawPost | null = null; let found = false;
    const isReal = (c: RawPost | null): c is RawPost => !!(c?.author && c.body?.trim().length && c.created !== '1970-01-01T00:00:00');
    const isWaitingForReply = !!(author && permlink && isTopic && activeTopic.value && !(author === activeTopic.value.author && permlink === activeTopic.value.permlink));

    if (author && permlink) {
      const opt = replies.value.find(r => r._pending && r.author === author && r.permlink === permlink);
      if (opt) opt._pending = 'syncing';
      while (Date.now() - start < maxMs) {
        entry.progress = Math.min(((Date.now() - start) / maxMs) * 85, 85);
        await new Promise(r => setTimeout(r, pollMs));
        try {
          const c = await client.condenser.getContent(author, permlink);
          if (isReal(c)) { lastContent = c; if (!pollFn || pollFn(c)) { found = true; break; } }
        } catch { /* ignore */ }
        if (!found) entry.label = t('syncingWithBlockchain') || 'Waiting for data node synchronization…';
      }
      if (found && opt) opt._pending = 'indexing';
      if (!found) {
        entry.progress = 88; entry.label = 'Still syncing… final attempt';
        await new Promise(r => setTimeout(r, 10000));
        try { const c = await client.condenser.getContent(author, permlink); if (isReal(c)) { lastContent = c; found = true; } } catch { /* ignore */ }
      }
    } else {
      while (Date.now() - start < 4000) { entry.progress = Math.min(((Date.now() - start) / 4000) * 85, 85); await new Promise(r => setTimeout(r, 300)); }
    }

    entry.progress = 92;
    if (isTopic && activeTopic.value) {
      const maxReplyRetries = isWaitingForReply ? 15 : 1;
      let retries = 0;
      while (retries < maxReplyRetries) {
        await loadReplies(activeTopic.value.author, activeTopic.value.permlink, true);
        entry.progress = 92 + Math.min((retries / maxReplyRetries) * 6, 6);
        if (isWaitingForReply) {
          const targetId = ((author ?? '') + '/' + (permlink ?? '')).toLowerCase();
          const existsOnServer = replies.value.some(r => !r._pending && (r.author + '/' + r.permlink).toLowerCase() === targetId);
          if (existsOnServer) break;
          if (retries < maxReplyRetries - 1) entry.label = `${t('indexing') || 'Indexing…'} (${retries + 1}/${maxReplyRetries})`;
          retries++; await new Promise(r => setTimeout(r, 4000));
        } else break;
      }
      const finalCheckId = ((author ?? '') + '/' + (permlink ?? '')).toLowerCase();
      const pendingRef = replies.value.find(r => r._pending && (r.author + '/' + r.permlink).toLowerCase() === finalCheckId);
      if (pendingRef) delete pendingRef._pending;
    }

    if (lastContent) {
      const normalized = normalizePost(lastContent);
      if (activeTopic.value?.author === normalized.author && activeTopic.value?.permlink === normalized.permlink) {
        activeTopic.value = { ...activeTopic.value, ...normalized };
        markTopicAsRead(activeTopic.value);
      }
      // Also update in profileUser.posts if we are in profile view
      if (view.value === 'profile' && profileUser.username === normalized.author) {
        const idx = profileUser.posts.findIndex(p => p.permlink === normalized.permlink);
        if (idx >= 0) {
          profileUser.posts[idx] = normalized;
        }
      }
    } else if (activeTopic.value) {
      try {
        const fresh = await client.condenser.getContent(activeTopic.value.author, activeTopic.value.permlink);
        if (isReal(fresh)) { activeTopic.value = { ...activeTopic.value, ...normalizePost(fresh) }; markTopicAsRead(activeTopic.value); }
      } catch { /* ignore */ }
    }

    entry.progress = 100;
    await refreshUser();
    await new Promise(r => setTimeout(r, 800));
    const idx = bcWaitQueue.value.findIndex(e => e.id === id);
    if (idx >= 0) bcWaitQueue.value.splice(idx, 1);
    if (bcWaitQueue.value.length === 0) bcQueueExpanded.value = false;
  };

  // ── Beneficiaries ─────────────────────────────────────────────────────────
  const prepareBeneficiaries = (customBeneficiary: { account: string; weight: string }, communityAcc: string | null = null): Beneficiary[] => {
    const bens: Beneficiary[] = [];
    const author = auth.user?.username;
    if (!author) return [];
    if (communityAcc?.startsWith('blurt-') && communityAcc !== author) bens.push({ account: communityAcc, weight: 300 });
    if (postForm.devTip && author !== 'dotevo') bens.push({ account: 'dotevo', weight: 100 });
    if (customBeneficiary?.account.trim()) {
      const acc = customBeneficiary.account.trim().toLowerCase();
      const weight = Math.min(Math.max(Math.round(parseFloat(customBeneficiary.weight) * 100) || 0, 1), 10000);
      if (weight > 0 && acc !== author) {
        const existing = bens.find(b => b.account === acc);
        if (existing) existing.weight = Math.min(10000, existing.weight + weight);
        else bens.push({ account: acc, weight });
      }
    }
    return bens.sort((a, b) => a.account.localeCompare(b.account));
  };
  const submitReply = async (): Promise<void> => {
    if (checkLock(submitReply)) return;
    if (!auth.user || !replyTarget.value) return;
    const body = replyForm.body.trim();
    if (!body) { replyForm.error = 'Reply cannot be empty.'; return; }
    replyForm.loading = true; replyForm.error = ''; replyForm.success = '';
    const communityAcc = activeTopic.value?.category || replyTarget.value.category;
    const beneficiaries = prepareBeneficiaries(replyForm.beneficiary, communityAcc);
    const op = ['comment', { parent_author: replyTarget.value.author, parent_permlink: replyTarget.value.permlink, author: auth.user.username, permlink: BFUtils.genPermlink('re-' + replyTarget.value.author), title: '', body, json_metadata: JSON.stringify({ app: 'blurtforum/1.0', tags: [communityAcc || config.communityAccount], format: 'markdown' }) }];
    const options = ['comment_options', { author: auth.user.username, permlink: (op[1] as Record<string, string>).permlink, max_accepted_payout: '1000000.000 BLURT', percent_steem_dollars: 10000, allow_votes: true, allow_curation_rewards: true, extensions: beneficiaries.length > 0 ? [[0, { beneficiaries }]] : [] }];
    try {
      await broadcast([op, options]);
      replyForm.success = t('replySuccess');
      const parentPermlink = (op[1] as Record<string, string>).parent_permlink;
      const parentReply = replies.value.find(r => r.permlink === parentPermlink);
      const optimisticDepth = parentReply ? (parentReply.depth ?? 0) + 1 : 1;
      const optimistic: Post = { author: auth.user.username, permlink: (op[1] as Record<string, string>).permlink, parent_author: (op[1] as Record<string, string>).parent_author, parent_permlink: parentPermlink, body, created: new Date().toISOString().slice(0, 19), depth: optimisticDepth, pendingPayout: 0, totalPayout: 0, payout: 0, vote_count: 0, active_votes: [], net_rshares: 0, beneficiaries, _qOpen: false, _pending: 'sending', media: null, title: '', url: '', category: '', lastActivity: '', lastAuthor: '', isUnread: false, isRead: true, isFollowing: false, isMuted: false, isPaid: false, isCollapsed: false, replyCount: 0, tags: [] };
      replies.value = [...replies.value, optimistic];
      replyForm.body = ''; replyTarget.value = null;
      await waitAndReload(true, auth.user.username, (op[1] as Record<string, string>).permlink);
    } catch (err) { console.error('Reply error:', err); replyForm.error = t('replyError') + ' (' + ((err as Error).message || '') + ')'; }
    replyForm.loading = false;
  };

  const submitPost = async (): Promise<void> => {
    if (checkLock(submitPost)) return;
    if (!auth.user || !activeForum.value) return;
    const title = postForm.title.trim(); const body = postForm.body.trim();
    if (!title || !body) { postForm.error = 'Title and body are required.'; return; }
    postForm.loading = true; postForm.error = ''; postForm.success = '';
    const customTagsList = postForm.customTags.split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean);
    const targetCommunity = config.communityAccount.startsWith('blurt-') ? config.communityAccount : null;
    const primaryTag = targetCommunity || postForm.selectedTag || customTagsList[0] || 'blurt';
    const tags = [primaryTag];
    if (postForm.selectedTag && !tags.includes(postForm.selectedTag)) tags.push(postForm.selectedTag);
    for (const ct of customTagsList) { if (tags.length >= 5) break; if (!tags.includes(ct)) tags.push(ct); }
    const beneficiaries = prepareBeneficiaries(postForm.beneficiary, targetCommunity);
    const op = ['comment', { parent_author: '', parent_permlink: primaryTag, author: auth.user.username, permlink: BFUtils.genPermlink(title), title, body, json_metadata: JSON.stringify({ app: 'blurtforum/1.0', tags, format: 'markdown', community: targetCommunity || undefined }) }];
    const options = ['comment_options', { author: auth.user.username, permlink: (op[1] as Record<string, string>).permlink, max_accepted_payout: '1000000.000 BLURT', percent_steem_dollars: 10000, allow_votes: true, allow_curation_rewards: true, extensions: beneficiaries.length > 0 ? [[0, { beneficiaries }]] : [] }];
    try {
      await broadcast([op, options]);
      postForm.title = ''; postForm.body = '';
      clearDraft(); showNewPostForm.value = false;
      showStatus(t('newPost'), t('postSuccess'), 'success');
      waitAndReload(false, auth.user.username, (op[1] as Record<string, string>).permlink);
    } catch (err) { console.error('Post error:', err); showStatus(t('newPost'), (t('postError') || 'Error: ') + ((err as Error).message || err), 'error'); }
    postForm.loading = false;
  };

  const {
    voteModal,
    estimateVote,
    openVoteModal,
    hasVoted,
    submitVoteConfirmed: _submitVoteConfirmed,
    submitVote: _submitVote
  } = useVote(client, auth, broadcast as any, waitAndReload, t);

  const getFullPost = async (post: { author: string; permlink: string }): Promise<Post> => {
    const found = [
      activeTopic.value,
      ...replies.value,
      ...(activeForum.value?.posts || []),
      ...profileUser.posts
    ].find(p => p && p.author === post.author && p.permlink === post.permlink);
    
    if (found) return found;
    const raw = await client.condenser.getContent(post.author, post.permlink);
    return normalizePost(raw);
  };

  const submitVote = async (post: Post | { author: string; permlink: string }) => {
    if (checkLock(() => submitVote(post))) return;
    try {
      await _submitVote(post, getFullPost);
    } catch (err: any) {
      if (err.message === 'NOT_LOGGED_IN') openLoginModal();
      else showStatus('Error', 'Voting failed: ' + err.message, 'error');
    }
  };

  const topicViewRef = ref<any>(null);

  const submitVoteConfirmed = async () => {
    if (checkLock(submitVoteConfirmed)) return;
    try {
      const oldPost = await _submitVoteConfirmed();
      if (oldPost && (topicViewRef.value as any)?.triggerSupportLogic) {
        (topicViewRef.value as any).triggerSupportLogic(oldPost, (voteModal.weight * 100));
      }
    } catch (err: any) {
      showStatus('Error', 'Vote confirmation failed: ' + err.message, 'error');
    }
  };

  const feeInfo = Blockchain.feeInfo;
  const fetchFeeInfo = () => Blockchain.fetchFeeInfo(client);
  const estimateTxFee = (numOps: number, payloadBytes: number) => Blockchain.estimateTxFee(numOps, payloadBytes);
  const feeEstimates = reactive({ post: null as string | null, reply: null as string | null });
  const feeTimers = { post: null as ReturnType<typeof setTimeout> | null, reply: null as ReturnType<typeof setTimeout> | null };
  const scheduleFeeUpdate = (target: 'post' | 'reply') => {
    if (feeTimers[target]) clearTimeout(feeTimers[target]!);
    feeTimers[target] = setTimeout(() => {
      const content = target === 'post' ? (postForm.title || '') + (postForm.body || '') : (replyForm.body || '');
      const bodyBytes = new TextEncoder().encode(content).length;
      feeEstimates[target] = estimateTxFee(2, bodyBytes);
    }, 2000);
  };

  const openNewPostForm = (): void => {
    postForm.selectedTag = activeForum.value?.targetTags[0] || '';
    postForm.customTags = postForm.title = postForm.body = postForm.error = postForm.success = '';
    postForm.hasDraft = false; postPreview.value = false; showNewPostForm.value = true;
    loadDraft();
    fetchFeeInfo().then(() => { feeEstimates.post = estimateTxFee(2, 0); });
  };

  const startReply = (target: Post): void => {
    replyTarget.value = target; replyForm.body = replyForm.error = replyForm.success = '';
    fetchFeeInfo().then(() => { feeEstimates.reply = estimateTxFee(2, 0); });
  };

  const mutePost = async (post: Post, mute = true): Promise<void> => {
    if (checkLock(() => mutePost(post, mute))) return;
    if (!auth.user || !canMute.value) return;
    if (mute && !confirm(t('confirmMute'))) return;
    const json = JSON.stringify([mute ? 'mutePost' : 'unmutePost', { community: config.communityAccount, account: post.author, permlink: post.permlink, notes: 'Muted via BlurtForum' }]);
    const op = ['custom_json', { required_auths: [], required_posting_auths: [auth.user.username], id: 'community', json }];
    try { await broadcast([op]); waitAndReload(view.value === 'topic'); } catch (err) { console.error('Mute error:', err); }
  };

  const startEditStructure = (): void => { structureForm.text = rawDescription.value; structureForm.error = ''; editStructureMode.value = true; };

  const saveStructure = async (): Promise<void> => {
    if (checkLock(saveStructure)) return;
    if (!auth.user || !canEditStructure.value) return;
    if (structureForm.text.length > 1000) { structureForm.error = 'Description too long (max 1000 chars). Save config in a post and use [[Forum config:author/permlink]] instead.'; return; }
    structureForm.loading = true; structureForm.error = '';
    const op = ['custom_json', { required_auths: [], required_posting_auths: [auth.user.username], id: 'community', json: JSON.stringify(['updateProps', { community: config.communityAccount, props: { description: structureForm.text } }]) }];
    try { await broadcast([op]); editStructureMode.value = false; setTimeout(() => loadData('current'), 8000); }
    catch (err) { console.error('Save structure error:', err); structureForm.error = (err as Error).message || 'Error saving layout'; }
    structureForm.loading = false;
  };

  const openPayoutModal = async (post: Post | { author: string; permlink: string }): Promise<void> => {
    let fullPost: Post;
    if (!('created' in post) || !post.created) {
      loading.value = true;
      try {
        const raw = await client.condenser.getContent(post.author, post.permlink);
        fullPost = normalizePost(raw);
      } catch (e) {
        showStatus('Error', 'Could not fetch post details', 'error');
        loading.value = false;
        return;
      }
      loading.value = false;
    } else {
      fullPost = post as Post;
    }

    const dateObj = new Date((fullPost.created.endsWith('Z') ? fullPost.created : fullPost.created + 'Z'));
    dateObj.setDate(dateObj.getDate() + 7);
    const sortedVotes = [...(fullPost.active_votes || [])].sort((a, b) => parseFloat(String(b.rshares || 0)) - parseFloat(String(a.rshares || 0)));
    payoutModal.post = { ...fullPost, active_votes: sortedVotes, payoutDate: dateObj.toLocaleString() };
    payoutModal.beneficiaries = []; payoutModal.show = true;
    if (fullPost.beneficiaries?.length) payoutModal.beneficiaries = fullPost.beneficiaries as Beneficiary[];
    else {
      try { const fresh = await client.condenser.getContent(fullPost.author, fullPost.permlink); if (fresh?.beneficiaries) payoutModal.beneficiaries = fresh.beneficiaries as Beneficiary[]; } catch { /* ignore */ }
    }
  };

  const getNotifIcon = (type: string): string => {
    const icons: Record<string, string> = { reply: '💬', reply_comment: '💬', vote: '👍', mention: '🔔', follow: '👤', reblog: '🔄', transfer: '💰', witness_vote: '🗳️' };
    return icons[type] || '🔵';
  };

  const openWalletModal = (mode: 'transfer' | 'power_up' | 'power_down', balance: string, targetUser = ''): void => {
    walletModal.mode = mode;
    walletModal.balance = balance;
    walletModal.targetUser = targetUser;
    walletModal.show = true;
  };

  const handleWalletSubmit = async (data: { mode: string, to: string, amount: string, memo: string }): Promise<void> => {
    if (!auth.user) return;
    walletModal.show = false;
    if (checkLock(() => handleWalletSubmit(data))) return;

    try {
      const amount = parseFloat(data.amount).toFixed(3);
      let ops: any[] = [];
      let label = '';

      if (data.mode === 'transfer') {
        ops = [['transfer', { from: auth.user.username, to: data.to.trim().toLowerCase(), amount: `${amount} BLURT`, memo: data.memo || '' }]];
        label = `Transferring ${amount} BLURT to ${data.to}...`;
      } else if (data.mode === 'power_up') {
        ops = [['transfer_to_vesting', { from: auth.user.username, to: data.to.trim().toLowerCase() || auth.user.username, amount: `${amount} BLURT` }]];
        label = `Powering up ${amount} BLURT...`;
      } else if (data.mode === 'power_down') {
        const ratio = parseFloat(String(globalProps.value.total_vesting_fund_blurt || 0)) / parseFloat(String(globalProps.value.total_vesting_shares || 1));
        const vests = (parseFloat(data.amount) / ratio).toFixed(6);
        ops = [['withdraw_vesting', { account: auth.user.username, vesting_shares: `${vests} VESTS` }]];
        label = `Starting power down of ${amount} BP...`;
      }

      await broadcast(ops);
      showStatus('Wallet', 'Transaction broadcasted successfully!', 'success');
      waitAndReload(false, null, null, null, label);
    } catch (err) {
      console.error('Wallet error:', err);
      showStatus('Wallet', 'Transaction failed: ' + ((err as Error).message || err), 'error');
    }
  };

  const cancelDelegation = async (target: string): Promise<void> => {
    if (!auth.user || !confirm(`Cancel delegation to @${target}?`)) return;
    if (checkLock(() => cancelDelegation(target))) return;
    const op = ['delegate_vesting_shares', { delegator: auth.user.username, delegatee: target, vesting_shares: '0.000000 VESTS' }];
    try {
      await broadcast([op]);
      showStatus('Wallet', 'Delegation cancel requested', 'success');
      waitAndReload(false, null, null, null, `Cancelling delegation to @${target}...`);
    } catch (err) {
      showStatus('Wallet', 'Error: ' + ((err as Error).message || err), 'error');
    }
  };

  const openNotifModal = async (): Promise<void> => {
    if (!auth.user) return;
    notifModal.show = true; notifModal.loading = true;
    try {
      const list = await client.call('bridge', 'account_notifications', { account: auth.user.username, limit: 50 }) as Notification[];
      const results = list || [];
      try {
        const history = await client.call('condenser_api', 'get_account_history', { account: auth.user.username, start: -1, limit: 50 }) as Array<[number, { op: [string, Record<string, string>]; timestamp: string }]>;
        if (Array.isArray(history)) {
          history.forEach(item => {
            const op = item[1].op;
            if (op[0] === 'transfer' && op[1].to === auth.user!.username) {
              const tx = op[1];
              const notifId = 'tx-' + item[0];
              if (!results.find(n => n.id === notifId)) {
                results.push({ id: notifId, type: 'transfer', author: tx.from, date: item[1].timestamp, msg: `Received ${tx.amount} from @${tx.from}` + (tx.memo ? `: ${tx.memo}` : ''), url: `@${tx.from}` });
              }
            }
          });
        }
      } catch (e) { console.warn('History fetch error:', e); }
      results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      notifModal.list = results;
      if (notifModal.list.length > 0) {
        const numericIds = notifModal.list.filter(n => typeof n.id === 'number').map(n => n.id as number);
        if (numericIds.length > 0) { const maxId = Math.max(...numericIds); if (maxId > notifModal.lastReadId) { notifModal.lastReadId = maxId; localStorage.setItem('bf_last_notif_id', String(maxId)); notifModal.hasNew = false; } }
      }
    } catch (err) { console.error('Notif error:', err); } finally { notifModal.loading = false; }
  };

  const openNotification = async (notif: Notification): Promise<void> => {
    if (!notifModal.clickedIds.includes(notif.id)) {
      notifModal.clickedIds.push(notif.id);
      if (notifModal.clickedIds.length > 200) notifModal.clickedIds.shift();
      localStorage.setItem('bf_clicked_notif_ids', JSON.stringify(notifModal.clickedIds));
    }
    notifModal.show = false;
    if (!notif.url) return;
    loading.value = true;
    try {
      const parts = notif.url.split('/');
      const author = parts[0].replace('@', '');
      const permlink = parts[1];
      if (permlink) {
        const content = await client.condenser.getContent(author, permlink);
        if (content?.author) {
          let root: RawPost = content;
          if (content.parent_author) {
            const urlParts = content.url.split('#')[0].split('/');
            if (urlParts.length >= 4) {
              const rootAuthor = urlParts[2].replace('@', ''); const rootPermlink = urlParts[3];
              if (rootAuthor !== author || rootPermlink !== permlink) root = await client.condenser.getContent(rootAuthor, rootPermlink);
            }
          }
          const targetCommunity = root.category;
          if (targetCommunity?.startsWith('blurt-') && targetCommunity !== config.communityAccount && !config.lockedCommunity) {
            config.communityAccount = targetCommunity; selectedCommunity.value = targetCommunity;
            forumClient = new dblurt.Client([getForumUrl()]); client = new dblurt.Client([getDataUrl()]);
            await loadData();
          }
          targetNotifPermlink.value = permlink;
          openTopic(normalizePost(root));
        }
      } else { openProfile(author); }
    } catch (err) { console.error('Open notification error:', err); }
    loading.value = false;
  };

  const openLoginModal = (): void => { loginErr.value = ''; loginForm.username = ''; loginForm.key = ''; showLoginModal.value = true; };

  const completeLogin = (username: string, key: string, acc: Record<string, unknown>): void => {
    const lastVoteTime = new Date((acc.last_vote_time as string) + 'Z').getTime();
    const delta = (Date.now() - lastVoteTime) / 1000;
    let vp = (acc.voting_power as number) + (10000 * delta / 432000);
    vp = Math.min(vp / 100, 100);
    const hasRewards = BFUtils.parsePayout(acc.reward_blurt_balance as string) > 0 || BFUtils.parsePayout(acc.reward_vesting_balance as string) > 0;
    auth.user = { username, type: 'key', key, vp: vp.toFixed(2), hasRewards, rewardBlurt: acc.reward_blurt_balance as string, rewardVesting: acc.reward_vesting_balance as string, locked: false };
    showLoginModal.value = false; loginForm.key = '';
    loadUserCommunities(username); loadFollowingList(username);
  };

  const doKeyLogin = async (): Promise<void> => {
    const username = loginForm.username.trim(); const keyStr = loginForm.key.trim();
    if (!username || !keyStr) { loginErr.value = 'Both fields are required.'; return; }
    loginBusy.value = true; loginErr.value = '';
    try {
      const privKey = dblurt.PrivateKey.from(keyStr);
      const pubKey  = privKey.createPublic().toString();
      const accounts = await client.condenser.getAccounts([username]);
      const acc = accounts?.[0] as Record<string, unknown>;
      if (!acc) throw new Error('Account not found');
      const postingPubs = (acc.posting as { key_auths: [string, number][] }).key_auths.map(k => k[0]);
      if (!postingPubs.includes(pubKey)) throw new Error('Key mismatch');
      if (loginForm.remember) { pinModal.tempUser = { username, key: keyStr, acc }; pinModal.mode = 'setup'; pinModal.value = ''; pinModal.error = ''; pinModal.show = true; showLoginModal.value = false; }
      else completeLogin(username, keyStr, acc);
    } catch (err) { console.error('Key login error:', err); loginErr.value = t('loginError'); }
    loginBusy.value = false;
  };

  const handlePinSubmit = async (): Promise<void> => {
    if (pinModal.value.length < 4) { pinModal.error = 'Min 4 digits'; return; }
    pinModal.loading = true; pinModal.error = '';
    await new Promise(r => setTimeout(r, 50));
    try {
      if (pinModal.mode === 'setup') {
        const encrypted = AuthService.encryptKey(pinModal.tempUser!.key, pinModal.value);
        localStorage.setItem('blurtforum_session', JSON.stringify({ username: pinModal.tempUser!.username, key: encrypted, expires: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
        completeLogin(pinModal.tempUser!.username, pinModal.tempUser!.key, pinModal.tempUser!.acc);
        pinModal.show = false;
      } else {
        const sessionStr = localStorage.getItem('blurtforum_session');
        if (!sessionStr) return;
        const session = JSON.parse(sessionStr) as { username: string; key: string };
        let decrypted: string | null = null;
        if (AuthService.isEncrypted(session.key)) { decrypted = AuthService.decryptKey(session.key, pinModal.value); }
        else { try { const bytes = CryptoJS.AES.decrypt(session.key, pinModal.value); decrypted = bytes.toString(CryptoJS.enc.Utf8); } catch { /* fallback */ } }
        if (!decrypted || !decrypted.startsWith('5')) throw new Error('Invalid PIN');
        const accounts = await client.condenser.getAccounts([session.username]);
        if (accounts?.[0]) {
          completeLogin(session.username, decrypted, accounts[0] as Record<string, unknown>);
          if (!AuthService.isEncrypted(session.key)) { (JSON.parse(sessionStr) as Record<string, unknown>).key = AuthService.encryptKey(decrypted, pinModal.value); localStorage.setItem('blurtforum_session', JSON.stringify({ ...JSON.parse(sessionStr), key: AuthService.encryptKey(decrypted, pinModal.value) })); }
          if (auth.user) auth.user.locked = false;
          pinModal.show = false;
          if (resumeAction.value) { const fn = resumeAction.value; resumeAction.value = null; fn(); }
        }
      }
    } catch { pinModal.error = t('invalidPin'); pinModal.value = ''; }
    finally { pinModal.loading = false; }
  };

  const doWVLogin = async (): Promise<void> => {
    const username = loginForm.username.trim().toLowerCase();
    if (!username) { loginErr.value = 'Username is required.'; return; }
    loginBusy.value = true; loginErr.value = '';
    try {
      if (!window.blurt_keychain) throw new Error('Polyfill not available');
      await new Promise<void>((resolve, reject) => {
        (window.blurt_keychain as Record<string, Function>).requestSignBuffer(username, 'Login to BlurtForum ' + Date.now(), 'Posting', (res: { success: boolean; message?: string }) => {
          if (res?.success) resolve(); else reject(new Error(res.message || 'WhaleVault sign error'));
        });
      });
      const accounts = await client.condenser.getAccounts([username]);
      const acc = accounts?.[0] as Record<string, unknown> | undefined;
      let vp = 100; let hasRewards = false; let rewardBlurt = '0.000 BLURT'; let rewardVesting = '0.000000 VESTS';
      if (acc) {
        const lastVoteTime = new Date((acc.last_vote_time as string) + 'Z').getTime();
        const delta = (Date.now() - lastVoteTime) / 1000;
        vp = Math.min(((acc.voting_power as number) + (10000 * delta / 432000)) / 100, 100);
        hasRewards = BFUtils.parsePayout(acc.reward_blurt_balance as string) > 0 || BFUtils.parsePayout(acc.reward_vesting_balance as string) > 0;
        rewardBlurt = acc.reward_blurt_balance as string; rewardVesting = acc.reward_vesting_balance as string;
      }
      auth.user = { username, type: 'whalevault', key: null, vp: vp.toFixed(2), hasRewards, rewardBlurt, rewardVesting };
      localStorage.setItem('blurtforum_session', JSON.stringify({ username, type: 'whalevault', expires: Date.now() + 24 * 60 * 60 * 1000 }));
      showLoginModal.value = false;
      loadUserCommunities(username); loadFollowingList(username);
    } catch (err) { console.error('WhaleVault login error:', err); loginErr.value = t('loginError') + ' ' + ((err as Error).message || err); }
    loginBusy.value = false;
  };

  const loadUserCommunities = async (username: string): Promise<void> => {
    try {
      let subs = await client.call('bridge', 'list_all_subscriptions', { account: username }) as Array<[string, string]>;
      if (!subs?.length) subs = await client.condenser.call('bridge', 'list_all_subscriptions', [username]) as Array<[string, string]>;
      if (Array.isArray(subs)) userSubscriptions.value = subs.map(s => ({ account: s[0], title: s[1] || s[0] }));
    } catch (err) { console.error('Error loading communities:', err); }
  };

  const logout = (): void => { auth.user = null; replyTarget.value = null; localStorage.removeItem('blurtforum_session'); };

  const claimRewards = async (targetAccount?: string): Promise<void> => {
    const username = targetAccount || auth.user?.username;
    if (!username) return;
    if (checkLock(() => claimRewards(targetAccount))) return;
    try {
      const accounts = await client.condenser.getAccounts([username]);
      const acc = accounts?.[0] as Record<string, unknown>;
      if (!acc) return;
      if (BFUtils.parsePayout(acc.reward_blurt_balance as string) === 0 && BFUtils.parsePayout(acc.reward_vesting_balance as string) === 0) { 
        if (!targetAccount) showStatus(t('claimRewards'), t('noRewardsToClaim'), 'info'); 
        return; 
      }
      const fmtAsset = (val: string, unit: string): string => {
        if (!val) return unit === 'BLURT' ? '0.000 BLURT' : '0.000000 VESTS';
        if (val.includes(' ')) return val;
        const num = parseFloat(val) || 0;
        return unit === 'BLURT' ? num.toFixed(3) + ' BLURT' : num.toFixed(6) + ' VESTS';
      };
      const ops = [['claim_reward_balance', { 
        account: username, 
        reward_blurt: fmtAsset(acc.reward_blurt_balance as string, 'BLURT'), 
        reward_vests: fmtAsset(acc.reward_vesting_balance as string, 'VESTS') 
      }]];
      await broadcast(ops);
      if (auth.user) {
        auth.user.hasRewards = false;
        auth.user.rewardBlurt = '0.000 BLURT';
        auth.user.rewardVesting = '0.000000 VESTS';
      }
      await refreshUser();
      showStatus(t('claimRewards'), t('claimSuccess'), 'success');
    } catch (err) { console.error('Claim rewards error:', err); showStatus(t('claimRewards'), (t('claimError') || 'Error claiming rewards: ') + ((err as Error).message || err), 'error'); }
  };

  const startEdit = (target: Post): void => {
    editModal.target = target; editModal.author = target.author; editModal.permlink = target.permlink;
    editModal.title = target.title || ''; editModal.body = target.body; editModal.isPost = !target.parent_author;
    editModal.error = ''; editModal.success = ''; editModal.loading = false; editModal.show = true;
  };

  const submitEdit = async (): Promise<void> => {
    if (checkLock(submitEdit)) return;
    if (!auth.user || !editModal.target) return;
    editModal.loading = true; editModal.error = ''; editModal.success = '';
    let meta = editModal.target.json_metadata || '';
    if (typeof meta !== 'string') { try { meta = JSON.stringify(meta); } catch { meta = ''; } }
    const op = ['comment', { parent_author: editModal.target.parent_author || '', parent_permlink: editModal.target.parent_permlink || config.communityAccount, author: auth.user.username, permlink: editModal.permlink, title: editModal.title, body: editModal.body, json_metadata: meta }];
    try {
      await broadcast([op]);
      editModal.success = t('updateSuccess');
      const editedPermlink = editModal.permlink; const editedAuthor = editModal.author; const wasInTopic = view.value === 'topic';
      editModal.show = false;
      waitAndReload(wasInTopic, editedAuthor, editedPermlink);
    } catch (err) { console.error('Edit error:', err); editModal.error = t('updateError') + ' (' + ((err as Error).message || '') + ')'; }
    editModal.loading = false;
  };

  const handleUrlChange = (): void => {
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get('view') || 'index';
    const requestedTag = params.get('tag') || '';
    const tagChanged = currentTagFilter.value !== requestedTag;
    currentTagFilter.value = requestedTag;
    const requestedForumId = params.get('forum');
    const requestedStartAuthor = params.get('start_author');
    const requestedStartPermlink = params.get('start_permlink');
    const requestedAuthor = params.get('author');
    const requestedPermlink = params.get('permlink');
    const requestedUser = params.get('user');
    const requestedTab = params.get('tab');

    if (tagChanged && view.value !== 'topic' && view.value !== 'profile') loadData('current', activeForum.value);

    if (requestedView === 'index') {
      view.value = 'index'; activeForum.value = null; activeTopic.value = null;
      const allForums: Forum[] = [];
      forumStructure.value.forEach(cat => cat.forums.forEach(f => allForums.push(f)));
      allForums.forEach(async (f) => {
        const p: Record<string, unknown> = { community: config.communityAccount, limit: 10, sort: 'activity' };
        if (f.targetTags.length > 0) p.tags_any = f.targetTags;
        try {
          const raw = await client.call('bridge', 'get_forum_posts', p) as RawPost[];
          if (raw?.length) f.posts = raw.map(normalizePost).filter(post => !post.isMuted || canMute.value).slice(0, 5);
        } catch { /* ignore */ }
      });
    } else if (requestedView === 'forum' && requestedForumId) {
      let f: Forum | undefined = VIRTUAL_FORUMS.find(vf => vf.id === requestedForumId);
      if (!f) { for (const cat of forumStructure.value) { f = cat.forums.find(forum => forum.id === requestedForumId); if (f) break; } }
      if (f) {
        if (view.value === 'forum' && activeForum.value?.id === f.id && f.posts?.length) {
          if (f.start_author === (requestedStartAuthor || '') && f.start_permlink === (requestedStartPermlink || '')) return;
        }
        if (!f.posts) f.posts = [];
        f.lastAuthor = ''; f.lastPermlink = '';
        f.start_author = requestedStartAuthor || ''; f.start_permlink = requestedStartPermlink || '';
        f.pageHistory = []; f.hasMore = true;
        activeForum.value = f; view.value = 'forum'; activeTopic.value = null;
        loadData('current', f);
      }
    } else if (requestedView === 'topic' && requestedAuthor && requestedPermlink) {
      if (view.value === 'topic' && activeTopic.value?.author === requestedAuthor && activeTopic.value?.permlink === requestedPermlink) return;
      
      // Restore forum context if present
      if (requestedForumId) {
        let f: Forum | undefined = VIRTUAL_FORUMS.find(vf => vf.id === requestedForumId);
        if (!f) { for (const cat of forumStructure.value) { f = cat.forums.find(forum => forum.id === requestedForumId); if (f) break; } }
        if (f) activeForum.value = f;
      }

      client.condenser.getContent(requestedAuthor, requestedPermlink).then(content => {
        if (content?.author) { activeTopic.value = { ...normalizePost(content), beneficiaries: (content.beneficiaries || []) as Beneficiary[] }; view.value = 'topic'; loadReplies(content.author, content.permlink); }
      });
    } else if (requestedView === 'profile' && requestedUser) {
      if (requestedTab) profileTab.value = requestedTab;
      if (view.value === 'profile' && profileUser.username === requestedUser) return;
      openProfile(requestedUser);
    } else if (requestedView === 'communities') {
      view.value = 'communities';
      if (BFCommunity.state.list.length === 0) BFCommunity.fetchCommunities(client as unknown as Record<string, unknown>);
    }
  };

  const explorationForm = reactive<{ forums: Forum[]; loading: boolean }>({ forums: [...VIRTUAL_FORUMS], loading: false });
  const explorationExpanded = ref(false);

  const loadExplorationData = async (): Promise<void> => {
    explorationForm.loading = true;
    for (const vf of explorationForm.forums) {
      if ((vf as Forum & { auth?: boolean }).auth && !auth.user) continue;
      try {
        const apiParams: Record<string, unknown> = { limit: 1 };
        let raw: RawPost[] = [];
        if (vf.id === 'user-feed') raw = await forumClient.call('bridge', 'get_account_posts', { ...apiParams, account: auth.user!.username, sort: 'feed' }) as RawPost[];
        else if (vf.id === 'global-trending') raw = await forumClient.call('bridge', 'get_ranked_posts', { ...apiParams, sort: 'trending' }) as RawPost[];
        else if (vf.id === 'global-new') raw = await forumClient.call('bridge', 'get_ranked_posts', { ...apiParams, sort: 'created' }) as RawPost[];
        else if (vf.id === 'global-activity') raw = await forumClient.call('bridge', 'get_forum_posts', { ...apiParams, community: '', sort: 'activity' }) as RawPost[];
        vf.posts = raw?.length ? [normalizePost(raw[0])] : [];
      } catch { vf.posts = []; }
    }
    explorationForm.loading = false;
  };

  const toggleExploration = async (): Promise<void> => {
    explorationExpanded.value = !explorationExpanded.value;
    localStorage.setItem('bf_exploration_expanded', String(explorationExpanded.value));
    if (explorationExpanded.value) await loadExplorationData();
  };

  const isPostInCommunity = (post: Post): boolean => !!(post?.category && post.category === config.communityAccount);

  const loadTopicContext = async (): Promise<void> => {
    if (!activeTopic.value?.parent_author) return;
    loading.value = true;
    try {
      const url = activeTopic.value.url;
      if (url) {
        const parts = url.split('#')[0].split('/');
        if (parts.length >= 4) {
          const rootAuthor = parts[2].replace('@', ''); const rootPermlink = parts[3];
          const root = await client.condenser.getContent(rootAuthor, rootPermlink);
          if (root?.author) openTopic(normalizePost(root));
        }
      }
    } catch (err) { console.error('Load context error:', err); }
    loading.value = false;
  };

  const checkNewNotifications = async (): Promise<void> => {
    if (!auth.user || notifModal.show) return;
    try {
      const list = await client.call('bridge', 'account_notifications', { account: auth.user.username, limit: 1 }) as Notification[];
      if (list?.length && Number(list[0].id) > notifModal.lastReadId) notifModal.hasNew = true;
    } catch { /* ignore */ }
  };

  const player = BFPlayer;

  onMounted(() => {
    loadLanguage(lang.value);
    BFPlayer.registerPlugin(BlurtPlayerPlugin(client, auth));
    setTheme(theme.value);
    window.addEventListener('popstate', handleUrlChange);
    setInterval(checkNewNotifications, 60000);

    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG' && target.closest('.post-body')) { openImgModal((target as HTMLImageElement).src); return; }
      const mention = target.closest('.mention');
      if (mention) { e.preventDefault(); openProfile((mention as HTMLElement).getAttribute('data-user')!); return; }
    });
    // Expose openProfile for DOMPurify-sanitized content
    (window as Record<string, unknown>).app = { openProfile };

    // Restore session
    const saved = localStorage.getItem('blurtforum_session');
    if (saved) {
      try {
        const session = JSON.parse(saved) as { username: string; type: string; key: string };
        if (session.type === 'whalevault') {
          auth.user = { username: session.username, type: 'whalevault', key: null, vp: '…' };
          client.condenser.getAccounts([session.username]).then(accounts => {
            if (accounts?.[0]) {
              const acc = accounts[0] as Record<string, unknown>;
              const lastVoteTime = new Date((acc.last_vote_time as string) + 'Z').getTime();
              const delta = (Date.now() - lastVoteTime) / 1000;
              let vp = (acc.voting_power as number) + (10000 * delta / 432000);
              vp = Math.min(vp / 100, 100);
              const hasRewards = BFUtils.parsePayout(acc.reward_blurt_balance as string) > 0 || BFUtils.parsePayout(acc.reward_vesting_balance as string) > 0;
              auth.user = { username: session.username, type: 'whalevault', key: null, vp: vp.toFixed(2), hasRewards, rewardBlurt: acc.reward_blurt_balance as string, rewardVesting: acc.reward_vesting_balance as string };
            }
          });
          loadUserCommunities(session.username); loadFollowingList(session.username);
        } else {
          auth.user = { username: session.username, type: 'key', key: session.key, vp: '…', locked: true };
          loadUserCommunities(session.username); loadFollowingList(session.username); refreshUser();
        }
      } catch { /* ignore */ }
    } else {
      const legacy = localStorage.getItem('bf-session');
      if (legacy) {
        try { const session = JSON.parse(legacy) as { username?: string; type?: string }; if (session.username && session.type === 'whalevault') { localStorage.setItem('blurtforum_session', legacy); location.reload(); } } catch { /* ignore */ }
      }
    }

    const params = new URLSearchParams(window.location.search);
    const comm = params.get('community');
    const viewParam = params.get('view');
    const forumParam = params.get('forum');

    if (comm) {
      config.communityAccount = comm; config.lockedCommunity = true;
      const found = allCommunities.value.find(c => c.account === comm);
      if (found) selectedCommunity.value = comm; else { selectedCommunity.value = 'custom'; customTag.value = comm; }
    } else {
      const lastComm = localStorage.getItem('bf_last_community');
      if (lastComm) {
        config.communityAccount = lastComm;
        const found = allCommunities.value.find(c => c.account === lastComm);
        if (found) selectedCommunity.value = lastComm; else { selectedCommunity.value = 'custom'; customTag.value = lastComm; }
      }
    }

    loadData().then(() => {
      if (!comm && (!viewParam || viewParam === 'index') && !forumParam) {
        const lastForumId = localStorage.getItem('bf_last_forum_id');
        if (lastForumId) {
          for (const cat of forumStructure.value) {
            const f = cat.forums.find(forum => forum.id === lastForumId);
            if (f) { openForum(f); break; }
          }
        }
      }
      handleUrlChange();
      setTimeout(updateGlobalActivity, 2000);
      setInterval(updateGlobalActivity, 300000);
    });

    setInterval(() => {
      if (auth.user) {
        let val = parseFloat(auth.user.vp) + 0.01 / 43.2;
        if (val < 100) auth.user.vp = val.toFixed(2);
      }
    }, 30000);
  });

  return {
    lang, setLang, langs, t, theme, setTheme, themes, config, view, loading, globalProps, forumStructure,
    activeForum, activeTopic, replies, repliesLoading, moderators, communityInfo,
    structureNote, selectedCommunity, currentTagFilter, applyTagFilter, clearTagFilter, customTag, allCommunities, userSubscriptions, auth, showLoginModal, loginTab,
    loginForm, loginErr, loginBusy, wvAvailable, replyTarget, replyForm,
    showNewPostForm, openNewPostForm, postForm, fmtDate, timeAgo, forumHasUnread, renderMD, isNestedReply, getParentBody,
    goHome, openForum, openTopic, handleCommunityChange, switchCommunity, openCommunities, toggleCommunitySub, openLoginModal,
    syncUrl,
    community: BFCommunity, communityRewards,
    doKeyLogin, doWVLogin, logout, startReply, submitReply, submitPost, loadData,
    changePage,
    submitVote, hasVoted, openPayoutModal, payoutModal, openNotifModal, notifModal,
    walletModal, openWalletModal, handleWalletSubmit, cancelDelegation,
    followModal, confirmToggleFollow,
    openProfile, profileUser, profileTab, loadMoreProfileContent, fetchEarningsHistory: _fetchEarningsHistory, openNotification,
    canEditStructure, canMute, mutePost, editStructureMode, startEditStructure, saveStructure,
    structureForm, showStructureDocs,
    forumPagination, loadMorePosts,
    pinModal, handlePinSubmit,
    globalActivity, activityTab, activityExpanded, activityFullList, mobileActivityExpanded, openActivity,
    editModal, startEdit, submitEdit,
    voteModal, openVoteModal, submitVoteConfirmed, estimateVote,
    feeInfo, feeEstimates, scheduleFeeUpdate,
    bcWaitQueue, bcQueueExpanded,
    imgModal, openImgModal,
    statusModal, showStatus,
    claimRewards,
    postPreview, replyPreview, saveDraft, clearDraft,
    imgUploads, onImagePick, onPaste,
    rpcMenuOpen, rpcDataNode, rpcForumNode, rpcDataCustom, rpcForumCustom, applyRpcSettings,
    getNotifIcon,
    loadTopicContext,
    isPostInCommunity,
    toggleFollow,
    topicViewRef,
    broadcast, waitAndReload, checkLock,
    explorationExpanded,
    explorationForm,
    toggleExploration,
    followingSet,
    player: BFPlayer,
    client: forumClient,
    };
    }