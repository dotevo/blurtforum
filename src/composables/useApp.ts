/**
 * useApp — main BlurtForum composable
 * Ports the entire app.js setup() logic into a typed Vue 3 composable.
 */
import {
  ref, reactive, computed, onMounted, nextTick, watch,
} from 'vue';
import { createBlurtNotifications } from '../modules/notifications_blurt/notifications-blurt';
import { BFUtils } from '../modules/utils';
import { trackPageView } from '../modules/analytics';
import { Blockchain } from '../modules/blockchain';
import { useVote } from './useVote';
import { useRpc } from './useRpc';
import { useDrafts } from './useDrafts';
import { useImageUpload } from './useImageUpload';
import { usePostForm } from './usePostForm';
import { useSupport } from './useSupport';
import { useWallet } from './useWallet';
import { useProfile } from './useProfile';
import { useAuth } from './useAuth';
import { useGlobalActivity } from './useGlobalActivity';
import { BlurtPlayerPlugin } from '../modules/player_blurt/blurt-player-plugin';
import { signBlurtMessage } from '../modules/blurt-sign-message';
import { SponsoredPlayerPlugin } from '../modules/player_blurt/sponsored-plugin';
import { BlurtCommentsPlugin } from '../modules/player_blurt/comments-plugin';
import { BFCommunity, VIRTUAL_FORUMS, DEFAULT_COMMUNITIES } from '../modules/community';
import { BFPlayer } from '../modules/player/player';
import { isTVPlatform } from '../modules/native/platform-info';
import { Parser } from '../modules/parser';
import { PostProcessor } from '../modules/post-processor';
import { loadCoalList, type CoalEntry } from '../modules/coal-list';
import { isHiddenFromViewer } from '../modules/visibility';

import { TR, loadLanguage, type Lang, LANGS as langs } from '../modules/translations';
import { syncSeoTags } from '../modules/seo';
import { isSeedingEnabled, initWebtorrent } from '../modules/player/webtorrent-pool';
import '../modules/whalevault';
import { Capacitor } from '@capacitor/core';
import * as sessionStore from '../modules/native/session-store';
import type {
  Post, Forum, ForumCategory, RawPost, AuthUser, ActivityItem,
  Beneficiary, BcQueueEntry, GlobalProps, Moderator, CommunityInfo,
  UserSubscription,
} from '../types';
import type { NotificationItem } from '../modules/notifications/types';


export function useApp() {
  const urlParams = new URLSearchParams(window.location.search);
  // Language resolution order: explicit ?lang= (a shared/indexed link, or
  // one of the hreflang variant URLs Google itself crawls — see
  // modules/seo.ts) > a previously-saved user choice > the visitor's own
  // browser language > 'en'.
  //
  // We used to only have the browser-language step, which is the right
  // call for a real visitor but meant Googlebot (which reports its own
  // fixed browser language during rendering, same on every crawl) always
  // saw one single language regardless of who'd actually be searching.
  // Rather than pin the default to one fixed language for everyone
  // (which would take away the auto-detection real visitors want), we
  // keep browser-detection for people, and separately hand Google an
  // explicit `<link rel="alternate" hreflang="xx">` for every language
  // variant of the current page (see syncSeoTags below) — that's the
  // mechanism Google actually uses to discover and serve the right
  // language version per searcher, rather than guessing from one crawl.
  const browserLang = navigator.language.slice(0, 2).toLowerCase() as Lang;
  const urlLang = urlParams.get('lang');
  const savedLang = localStorage.getItem('bf-lang');
  const initialLang: Lang =
    (urlLang && langs.includes(urlLang as Lang) ? urlLang as Lang
      : (savedLang && langs.includes(savedLang as Lang) ? savedLang as Lang
        : (langs.includes(browserLang) ? browserLang : 'en')));
  const lang = ref<Lang>(initialLang);
  document.documentElement.lang = initialLang;
  const setLang = (l: Lang) => {
    lang.value = l;
    document.documentElement.lang = l;
    localStorage.setItem('bf-lang', l);
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
    { id: 'amber',     label: '🟠 Amber' },
  ];
  const theme = ref<string>(localStorage.getItem('bf-theme') || 'amber');
  const setTheme = (id: string) => {
    theme.value = id;
    localStorage.setItem('bf-theme', id);
    document.body.className = `theme-${id}`;
  };

  // Manual toggle always wins once used; before that, default on if we look
  // like we're running on an Android TV (large screen, no touch, TV-ish UA).
  const isAndroidTV = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /Android/i.test(ua) && (/\bTV\b/i.test(ua) || /GoogleTV/i.test(ua) || /AFT[A-Z]/i.test(ua));
  };
  const cinemaModeUserSet = localStorage.getItem('bf-cinema-mode-user-set') === 'true';
  const cinemaMode = ref<boolean>(cinemaModeUserSet ? localStorage.getItem('bf-cinema-mode') === 'true' : isAndroidTV());
  // Set this synchronously, right here, rather than waiting for CinemaIndex's
  // own onMounted to do it -- CinemaIndex can mount a tick later than
  // MediaPlayer (e.g. once `loading` resolves), which left a brief window
  // where the docked bar's default (visible) state got rendered/painted
  // before flipping hidden, causing a visible flash on load.
  if (cinemaMode.value) BFPlayer.state.hidden = true;
  const setCinemaMode = (value: boolean) => {
    cinemaMode.value = value;
    localStorage.setItem('bf-cinema-mode', String(value));
    localStorage.setItem('bf-cinema-mode-user-set', 'true');
    if (value) {
      BFPlayer.state.hidden = true;
      // If something was already playing in the normal (non-cinema)
      // expanded panel when the user switches into cinema mode, promote it
      // to fullscreen cinema display instead of leaving it stuck in the old
      // inline panel style.
      if (BFPlayer.state.currentTrack && BFPlayer.state.expanded) {
        BFPlayer.state.cinema = true;
      }
    } else {
      // Mirror image of the branch above, and just as necessary: leaving
      // the TV/cinema browsing UI has to drop the player back out of its
      // OWN fullscreen cinema display too. Nothing else does this --
      // CinemaIndex.vue's onUnmounted only resets state.hidden (so the
      // docked mini-bar's visibility goes back to normal), it was never the
      // one flipping .cinema off. Real bug this fixed: switch into cinema
      // mode, start something playing (-> state.cinema = true above), then
      // toggle cinema mode back off from the settings button while it's
      // still playing -- state.cinema stayed true forever after, so
      // MediaPlayer.vue kept rendering its fullscreen `.bfp-panel--cinema`
      // (position:fixed, 100vh, z-index:999) on top of the now-normal page,
      // with the docked bar (gated on `!state.cinema`) unable to ever show
      // again and no obvious way back short of digging for the small
      // "back to library" button. Playback itself is left completely
      // alone here -- only the fullscreen *presentation* ends, same as
      // picking any other tab/source would; the user can keep listening/
      // watching docked or expanded, or stop it themselves as normal.
      BFPlayer.state.hidden = false;
      if (BFPlayer.state.cinema) {
        BFPlayer.state.cinema = false;
      }
    }
  };

  // On a real TV device, cinema mode is the app's only mode -- see
  // device-profiles' whole reason for existing (a profile picker only makes
  // sense as a permanent front door on TV, never as something a web/phone
  // user could stumble into or back out of). Overrides whatever
  // localStorage/isAndroidTV-heuristic value cinemaMode was initialized
  // with above, and re-asserts itself if anything ever tried to turn it off
  // (nothing should be able to on TV -- see SettingsSelectors.vue hiding the
  // toggle entirely -- but this is the actual guarantee, not just the UI
  // hiding a button).
  watch([isTVPlatform, cinemaMode], ([isTV, cm]) => {
    if (isTV && !cm) setCinemaMode(true);
  }, { immediate: true });

  const config = reactive({
    communityAccount: 'blurt-140455',
    nodes: ['https://blurtrpc.dagobert.uk', 'https://rpc.blurt.blog', 'https://rpc.beblurt.com', 'https://rpc.drakernoise.com'],
    lockedCommunity: false,
  });

  const rpc = useRpc();

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
  // Accounts with community role 'muted' in the current community (lowercase usernames).
  // Kept separate from `moderators`/`cc.team`, because `get_community`'s `team` field does
  // NOT include muted accounts - only `bridge.list_community_roles` does. This is what powers
  // both the "hide muted comments" logic (condenser_api replies don't carry stats.is_muted)
  // and the community-level "ban user" feature (see canBanUser/banUser below).
  const mutedAccounts = ref<Set<string>>(new Set());
  // COAL (coal.blurtwallet.com) spam/impersonation list - loaded once, cached in
  // localStorage by coal-list.ts (refreshed at most once/day). Never causes hiding,
  // only flags posts/comments for a warning badge (see Post.isCoal/coalInfo).
  const coalMap = ref<Map<string, CoalEntry>>(new Map());
  loadCoalList().then(m => { coalMap.value = m; }).catch(() => {});
  const communityInfo = ref<CommunityInfo>({});
  const communityRewards = reactive({ blurt: '0.000', vesting: '0.000', hasRewards: false });
  const structureNote = ref(false);
  const showStructureDocs = ref(false);
  const editStructureMode = ref(false);
  const rawDescription = ref('');
  const structureForm = reactive({ text: '', loading: false, error: '' });

  const bodyCache: Record<string, string> = {};
  const cachePostBody = (author: string, permlink: string, body: string): void => { bodyCache[`${author}/${permlink}`] = body; };
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



  const resumeAction = ref<(() => void) | null>(null);


  const statusModal = reactive({ show: false, title: '', body: '', type: 'info' as 'info' | 'success' | 'error' });
  const showStatus = (title: string, body: string, type: 'info' | 'success' | 'error' = 'info') => {
    statusModal.title = title;
    statusModal.body = body;
    statusModal.type = type;
    statusModal.show = true;
  };

  const replyTarget = ref<Post | null>(null);
  const quickReplyBody = ref('');
  watch(replyTarget, (newVal) => {
    if (!newVal && activeTopic.value) {
      replyForm.body = drafts.loadReplyDraft(activeTopic.value.author, activeTopic.value.permlink);
    }
  });
  const showNewPostForm = ref(false);
  const postPreview = ref(false);
  const replyPreview = ref(false);

  const drafts = useDrafts();
  const saveDraft = (data?: any) => drafts.saveDraft(config.communityAccount, activeForum.value?.id, postForm, data);
  const clearDraft = () => drafts.clearDraft(config.communityAccount, activeForum.value?.id, postForm);
  const loadDraft = () => drafts.loadDraft(config.communityAccount, activeForum.value?.id, postForm);

  const payoutModal = reactive<{ show: boolean; post: Partial<Post & { payoutDate?: string }>; beneficiaries: Beneficiary[] }>({ show: false, post: {}, beneficiaries: [] });
  const followModal = reactive({ show: false, user: '', isFollowing: false });

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
  
  const normalizePost = (p: RawPost): Post => PostProcessor.normalizePost(p, {
    currentUser: auth.user?.username,
    followingSet: followingSet.value,
    readStatusMap: getReadStatusMap(),
    canMute: canMute.value,
    mutedAccounts: mutedAccounts.value,
    coalMap: coalMap.value
  });

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
    markActivityAsRead(topic.author, topic.permlink);
  };

  const openActivity = (act: ActivityItem): void => {
    if (act.community !== config.communityAccount) {
      config.communityAccount = act.community;
      selectedCommunity.value = act.community;
    rpc.applyRpcSettings();
      loadData();
    }
    markTopicAsRead({ author: act.root_author, permlink: act.root_permlink, lastActivityTs: act.lastActivityTs });
    if (act.comment_permlink) {
      targetNotifPermlink.value = act.comment_permlink;
    } else if (!act.is_post) {
      targetNotifMatch.value = { author: act.author, ts: act.lastActivityTs };
    } else {
      targetNotifPermlink.value = act.permlink;
    }
    openTopic({ author: act.root_author, permlink: act.root_permlink } as Post);
  };

  const imgModal = reactive({ show: false, src: '' });
  const openImgModal = (src: string) => { imgModal.src = src; imgModal.show = true; };

  const loadData = async (direction: string | boolean = 'current', targetForum: Forum | null = null): Promise<void> => {
    loading.value = true;
    structureNote.value = false;
    refreshUser();
    try {
      if (direction === 'current' && !targetForum) {
        const props = await Blockchain.getDynamicGlobalProperties(rpc.dataClient.value);
        globalProps.value = props as any;
        moderators.value = [];
        mutedAccounts.value = new Set();
        communityInfo.value = {};
        forumPagination.lastAuthor = '';
        forumPagination.lastPermlink = '';
        forumPagination.hasMore = true;
        forumPagination.pageHistory = [];
        if (explorationExpanded.value) await loadExplorationData();
      }

      if (direction === 'current' && !targetForum) {
        try {
          if (config.communityAccount.startsWith('blurt-')) {
            const cc = await Blockchain.getCommunity(rpc.forumClient.value, config.communityAccount);
            if (cc) {
              communityInfo.value = { title: (cc.title as string) || config.communityAccount, about: (cc.about as string) || '' };
              rawDescription.value = (cc.description as string) || '';
              let structureSource = (cc.description as string) || '';
              const extMatch = structureSource.match(/\[\[Forum config:(@?)([a-z0-9.-]+)\/([a-z0-9-]+)\]\]/i);
              if (extMatch) {
                try {
                  const post = await Blockchain.getContent(rpc.dataClient.value, extMatch[2], extMatch[3]);
                  if (post?.body) structureSource = post.body;
                } catch (err) { console.warn('External config load error:', err); }
              }
              const parsed = BFUtils.parseStructure(structureSource);
              forumStructure.value = parsed ?? BFUtils.defaultStructure();
              if (!parsed) structureNote.value = true;
              if (cc.team) {
                moderators.value = (cc.team as any[]).map(m => ({ account: m[0], role: m[1], title: m[2] || '' }));
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

          const acc = await Blockchain.getAccount(rpc.dataClient.value, config.communityAccount);
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
          // bridge.get_community's `team` field (used above for `moderators`) does not
          // include accounts with role 'muted', so it's fetched separately here every
          // time rather than only as a fallback. If `team` was empty above (some
          // deployments), this also fills in `moderators` for the Team display.
          const roles = await Blockchain.listCommunityRoles(rpc.forumClient.value, config.communityAccount);
          if (Array.isArray(roles) && roles.length > 0) {
            mutedAccounts.value = new Set(
              roles.filter(r => r[1] === 'muted').map(r => String(r[0]).toLowerCase())
            );
            if (!moderators.value.length) {
              moderators.value = roles.map(r => ({ account: r[0], role: r[1], title: r[2] || '' }));
            }
          } else {
            mutedAccounts.value = new Set();
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
      } else if (direction === 'current') {
        // Force fresh load for 'current' view
        delete params.start_author; delete params.start_permlink;
        if (targetForum) { targetForum.start_author = ''; targetForum.start_permlink = ''; }
      } else if ((pag as Forum).start_author) {
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
          rawPosts = await Blockchain.getAccountPosts(rpc.forumClient.value, 'feed', auth.user.username, fetchLimit, params.start_author as string, params.start_permlink as string);
        } else if (vf.id === 'global-trending') {
          rawPosts = await Blockchain.getRankedPosts(rpc.forumClient.value, 'trending', currentTagFilter.value as string, fetchLimit, params.start_author as string, params.start_permlink as string);
        } else if (vf.id === 'global-new') {
          rawPosts = await Blockchain.getRankedPosts(rpc.forumClient.value, 'created', currentTagFilter.value as string, fetchLimit, params.start_author as string, params.start_permlink as string);
        } else if (vf.id === 'global-activity') {
          rawPosts = await Blockchain.getForumPosts(rpc.forumClient.value, '', fetchLimit, 'activity', undefined, params.start_author as string, params.start_permlink as string, params.tags_any as string[]);
        }
      } else {
        rawPosts = await Blockchain.getForumPosts(rpc.forumClient.value, params.community as string, fetchLimit, 'activity', undefined, params.start_author as string, params.start_permlink as string, params.tags_any as string[]);
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
      
      if (isHiddenFromViewer(post, { canBanUser: canBanUser.value, canMute: canMute.value })) return;
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

  const changePage = async (dir: 'next' | 'prev') => { 
    if (activeForum.value) { 
      BFPlayer.clearTracks();
      await loadData(dir, activeForum.value); 
      syncUrl(); 
    } 
  };
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
      let results: any[];
      try {
        results = await Blockchain.getContentReplies(rpc.dataClient.value, pAuthor, pPermlink);
      } catch (e) {
        console.error(`Error loading replies for ${pAuthor}/${pPermlink}:`, e);
        return;
      }
      if (!results?.length) return;
      for (const r of results) {
        bodyCache[`${r.author}/${r.permlink}`] = r.body;
        const post = { ...normalizePost(r), depth, _qOpen: false };
        // Hide entirely (not just gray out) for viewers without permission - this also hides
        // the whole reply subtree below a hidden comment, since condenser_api's flat reply
        // list has no reliable stats.is_muted of its own to rely on otherwise, and a visible
        // orphaned reply under a hidden parent would be confusing.
        if (!isHiddenFromViewer(post, { canBanUser: canBanUser.value, canMute: canMute.value })) {
          flat.push(post);
        }
        if (r.children && r.children > 0) await recurse(r.author, r.permlink, depth + 1);
      }
    };
    await recurse(author, permlink, 1);

    const pendingOnes = replies.value.filter(r => r._pending);
    const serverIds = new Set(flat.map(r => (r.author + '/' + r.permlink).toLowerCase()));
    const stillPending = pendingOnes.filter(p => !serverIds.has((p.author + '/' + p.permlink).toLowerCase()));
    replies.value = [...flat, ...stillPending].sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());

    if (targetNotifMatch.value) {
      const targetTs = targetNotifMatch.value.ts;
      const targetAuthor = targetNotifMatch.value.author;
      const match = flat.find(r => 
        r.author === targetAuthor && 
        Math.abs((r.lastActivityTs || 0) - targetTs) < 5000
      );
      if (match) targetNotifPermlink.value = match.permlink;
      targetNotifMatch.value = null;
    }

    if (!keepState) {
      repliesLoading.value = false;
      if (targetNotifPermlink.value) {
        const target = targetNotifPermlink.value;
        targetNotifPermlink.value = null;
        nextTick(() => {
          setTimeout(() => {
            const el = document.getElementById('post-' + target);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('highlighted-post');
              setTimeout(() => el.classList.remove('highlighted-post'), 3000);
            }
          }, 500);
        });
      }
    }
  };

  const syncUrl = (): void => {
    const params = new URLSearchParams();
    
    const isVirtualForum = activeForum.value && VIRTUAL_FORUMS.some(vf => vf.id === activeForum.value?.id);
    let shouldIncludeCommunity = false;
    if (view.value === 'index' || view.value === 'forum') {
      shouldIncludeCommunity = !isVirtualForum;
    } else if (view.value === 'topic' && activeTopic.value) {
      shouldIncludeCommunity = !isVirtualForum && isPostInCommunity(activeTopic.value);
    }

    if (shouldIncludeCommunity) {
      params.set('community', config.communityAccount);
    }

    if (view.value !== 'index') params.set('view', view.value);
    if (currentTagFilter.value) params.set('tag', currentTagFilter.value);
    if (view.value === 'forum' && activeForum.value) {
      params.set('forum', activeForum.value.id);
      if (activeForum.value.start_author && activeForum.value.start_permlink) {
        params.set('author', activeForum.value.start_author);
        params.set('permlink', activeForum.value.start_permlink);
      }
    } else if (view.value === 'topic' && activeTopic.value) {
      if (activeForum.value) params.set('forum', activeForum.value.id);
      params.set('author', activeTopic.value.author);
      params.set('permlink', activeTopic.value.permlink);
    } else if (view.value === 'profile' && profileUser.username) {
      params.set('user', profileUser.username);
      if (profileTab.value !== 'posts') params.set('tab', profileTab.value);
    }
    const fullPath = window.location.pathname + '?' + params.toString();
    window.history.pushState({ path: fullPath }, '', fullPath);
    syncSeoTags(langs);
    trackCurrentView(fullPath);
  };

  // Google Analytics virtual page view for whatever `view.value` /
  // activeForum / activeTopic / profileUser currently is.
  //
  // Pulled out of syncUrl() because syncUrl() only runs for in-app
  // navigation that itself writes the URL (openForum, openTopic, goHome,
  // etc). It was NEVER called by handleUrlChange() -- the function that
  // handles the initial page load and popstate (back/forward) -- so the
  // very first page_view of every single session (including every direct
  // link from search/shares) silently never fired. That's the actual
  // reason GA looked "broken" even after accepting cookies: the only
  // sessions that ever sent a hit were ones where the user clicked further
  // in-app navigation after landing. Fixed by also calling this from
  // handleUrlChange()'s branches below, once each has finished settling
  // view/activeForum/activeTopic/profileUser.
  const trackCurrentView = (fullPath?: string): void => {
    let gaTitle = 'BlurtForum';
    if (view.value === 'forum' && activeForum.value) gaTitle = 'BlurtForum | ' + activeForum.value.name;
    else if (view.value === 'topic' && activeTopic.value) gaTitle = 'BlurtForum | ' + activeTopic.value.title;
    else if (view.value === 'profile' && profileUser.username) gaTitle = 'BlurtForum | @' + profileUser.username;
    else if (view.value === 'communities') gaTitle = 'BlurtForum | Communities';
    trackPageView(fullPath ?? (window.location.pathname + window.location.search), gaTitle, {
      view: view.value,
      community: config.communityAccount
    });
  };

  const applyTagFilter = async () => { BFPlayer.clearTracks(); syncUrl(); await loadData('current', activeForum.value); };
  const clearTagFilter = async () => { BFPlayer.clearTracks(); currentTagFilter.value = ''; syncUrl(); await loadData('current', activeForum.value); };

  const goHome = (): void => {
    BFPlayer.clearTracks();
    view.value = 'index';
    activeForum.value = null;

    activeTopic.value = null;
    replies.value = [];
    showNewPostForm.value = false;
    currentTagFilter.value = '';
    syncUrl();
    loadData('current');
  };

  const openForum = (forum: Forum): void => {
    BFPlayer.clearTracks();
    // Aggressively reset all pagination markers for this forum
    forum.lastAuthor = ''; 
    forum.lastPermlink = ''; 
    forum.start_author = ''; 
    forum.start_permlink = '';
    forum.pageHistory = []; 
    forum.hasMore = true;
    forum.posts = []; // Clear existing posts immediately to avoid flicker

    forumPagination.visibleCount = 20; 
    currentTagFilter.value = '';
    
    const isVirtual = VIRTUAL_FORUMS.find(vf => vf.id === forum.id);
    if (!isVirtual) { 
      localStorage.setItem('bf_last_forum_id', forum.id); 
      localStorage.setItem('bf_last_community', config.communityAccount); 
    }
    
    activeForum.value = forum;
    view.value = 'forum';
    activeTopic.value = null;
    showNewPostForm.value = false;
    
    console.log('[DEBUG] Opening forum, pagination reset', forum.id);
    loadData('current', forum);
    syncUrl();
  };

  const openTopic = async (topic: Post): Promise<void> => {
    BFPlayer.clearTracks();
    if (!topic.payout && !topic.body) {
      loading.value = true;
      try {
        const full = await Blockchain.getContent(rpc.dataClient.value, topic.author, topic.permlink);
        if (full?.author) topic = normalizePost(full);
      } catch (e) { console.error('Error fetching full topic:', e); }
      loading.value = false;
    }
    activeTopic.value = { ...topic, beneficiaries: topic.beneficiaries || [] };
    bodyCache[`${topic.author}/${topic.permlink}`] = topic.body;
    replyTarget.value = null;
    replyForm.body = '';
    quickReplyBody.value = drafts.loadReplyDraft(topic.author, topic.permlink);
    replyForm.error = replyForm.success = '';
    view.value = 'topic';
    syncUrl();
    markTopicAsRead(activeTopic.value);
    loadReplies(topic.author, topic.permlink);
    if (!topic.beneficiaries?.length) {
      Blockchain.getContent(rpc.dataClient.value, topic.author, topic.permlink).then((full: any) => {
        if (full?.beneficiaries?.length && activeTopic.value?.permlink === topic.permlink) {
          activeTopic.value = { ...activeTopic.value, beneficiaries: full.beneficiaries as Beneficiary[] };
        }
      }).catch(() => {});
    }
  };

  const switchCommunity = (account: string): void => {
    if (!account) return;
    config.communityAccount = account;
    const found = allCommunities.value.find(c => c.account === account);
    if (found) { selectedCommunity.value = account; }
    else { selectedCommunity.value = 'custom'; customTag.value = account; }
    rpc.applyRpcSettings();
    goHome();
    loadData();
  };

  const handleCommunityChange = (): void => {
    const tag = selectedCommunity.value === 'custom' ? customTag.value.trim() : selectedCommunity.value;
    switchCommunity(tag);
  };

  const openCommunities = (): void => {
    BFPlayer.clearTracks();
    view.value = 'communities';
    currentTagFilter.value = '';
    syncUrl();
    if (BFCommunity.state.list.length === 0) BFCommunity.fetchCommunities(rpc.dataClient.value as unknown as Record<string, unknown>);
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

  const walletAuthModal = reactive({
    show: false,
    username: '',
    authority: 'Posting' as 'Posting' | 'Active',
    callback: null as ((key: string) => void) | null
  });

  const broadcast = async (ops: unknown[], targetUser?: AuthUser, authority: 'Posting' | 'Active' = 'Posting'): Promise<void> => {
    const user = targetUser || auth.user;
    if (!user) throw new Error('Not logged in');
    
    if (user.type === 'key' && authority === 'Active') {
       return new Promise((resolve, reject) => {
         walletAuthModal.username = user.username;
         walletAuthModal.authority = 'Active';
         walletAuthModal.show = true;
         walletAuthModal.callback = async (tempKey: string) => {
           walletAuthModal.show = false;
           try {
             const tempUser = { ...user, key: tempKey };
             await Blockchain.broadcast(rpc.dataClient.value, tempUser, ops, authority);
             resolve();
           } catch (e) {
             reject(e);
           }
         };
       });
    }
    
    return Blockchain.broadcast(rpc.dataClient.value, user, ops, authority);
  };

  const loadFollowingList = async (username: string): Promise<void> => {
    if (!username) return;
    try {
      const following = await Blockchain.getFollowing(rpc.dataClient.value, username);
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

  // ── Blockchain wait queue ─────────────────────────────────────────────────
  const bcWaitQueue = ref<BcQueueEntry[]>([]);
  const bcQueueExpanded = ref(false);
  let _bcId = 0;

  // Safety net: no matter what happens inside waitAndReload (thrown errors,
  // unawaited calls, future bugs...), a queue entry should never be able to
  // survive forever and force the user to refresh the page. This watchdog
  // sweeps anything older than STALE_MS every SWEEP_MS, independent of the
  // normal completion path below.
  const BC_QUEUE_STALE_MS = 130000; // a bit above the 90s + 10s worst case in waitAndReload
  const BC_QUEUE_SWEEP_MS = 15000;
  setInterval(() => {
    if (bcWaitQueue.value.length === 0) return;
    const now = Date.now();
    const fresh = bcWaitQueue.value.filter(e => now - e.createdAt < BC_QUEUE_STALE_MS);
    if (fresh.length !== bcWaitQueue.value.length) {
      bcWaitQueue.value = fresh;
      if (bcWaitQueue.value.length === 0) bcQueueExpanded.value = false;
    }
  }, BC_QUEUE_SWEEP_MS);

  const refreshUser = async (): Promise<void> => {
    if (!auth.user) return;
    try {
      const acc = await Blockchain.getAccount(rpc.dataClient.value, auth.user.username);
      if (acc) {
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
    const entry = reactive<BcQueueEntry>({ id, label: label || t('waitingForBlock'), progress: 0, createdAt: Date.now() });
    bcWaitQueue.value.push(entry);

    // Whatever happens below (success, RPC never catching up, or an
    // unexpected exception), this entry must disappear from the queue.
    // The watchdog above is only a last-resort backstop — this `finally`
    // is the primary guarantee and runs immediately instead of waiting
    // for the sweep interval.
    try {
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
            const c = await Blockchain.getContent(rpc.dataClient.value, author, permlink);
            if (isReal(c)) { lastContent = c; if (!pollFn || pollFn(c)) { found = true; break; } }
          } catch { /* ignore */ }
          if (!found) entry.label = t('syncingWithBlockchain') || 'Waiting for data node synchronization…';
        }
        if (found && opt) opt._pending = 'indexing';
        if (!found) {
          entry.progress = 88; entry.label = 'Still syncing… final attempt';
          await new Promise(r => setTimeout(r, 10000));
          try { const c = await Blockchain.getContent(rpc.dataClient.value, author, permlink); if (isReal(c)) { lastContent = c; found = true; } } catch { /* ignore */ }
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
          activeTopic.value = { ...activeTopic.value, ...normalized, _pendingVote: false };
          markTopicAsRead(activeTopic.value);
        }
        // Also update in profileUser.posts if we are in profile view
        if (view.value === 'profile' && profileUser.username === normalized.author) {
          const idx = profileUser.posts.findIndex(p => p.permlink === normalized.permlink);
          if (idx >= 0) {
            profileUser.posts[idx] = { ...normalized, _pendingVote: false };
          }
        }
      } else if (activeTopic.value) {
        try {
          const fresh = await rpc.dataClient.value.condenser.getContent(activeTopic.value.author, activeTopic.value.permlink);
          if (isReal(fresh)) { activeTopic.value = { ...activeTopic.value, ...normalizePost(fresh), _pendingVote: false }; markTopicAsRead(activeTopic.value); }
        } catch { /* ignore */ }
      }

      entry.progress = 100;
      await refreshUser();
      await new Promise(r => setTimeout(r, 800));
    } finally {
      // Clear any leftover optimistic-vote flag for the author/permlink this
      // call was waiting on, regardless of whether it was ever confirmed —
      // otherwise a vote on content the RPC never caught up on would leave
      // the vote button spinning forever (same class of bug as the queue
      // panel getting stuck).
      if (author && permlink) {
        if (activeTopic.value?.author === author && activeTopic.value?.permlink === permlink) activeTopic.value._pendingVote = false;
        const r = replies.value.find(x => x.author === author && x.permlink === permlink);
        if (r) r._pendingVote = false;
        if (view.value === 'profile' && profileUser.username === author) {
          const p = profileUser.posts.find(x => x.permlink === permlink);
          if (p) p._pendingVote = false;
        }
        // Fourth post-holding location -- see getFullPost() right below,
        // which already treats activeForum.value.posts as one of four known
        // spots a post object can live. Missing this one meant voting from
        // the forum LIST view (not after opening the topic, not from your
        // own profile) left that post's VoteButton spinning forever: the
        // vote succeeded on-chain, but nothing ever cleared the flag on
        // this specific object since it's a different array from the three
        // above.
        if (activeForum.value?.posts) {
          const fp = activeForum.value.posts.find(x => x.author === author && x.permlink === permlink);
          if (fp) fp._pendingVote = false;
        }
      }
      const idx = bcWaitQueue.value.findIndex(e => e.id === id);
      if (idx >= 0) bcWaitQueue.value.splice(idx, 1);
      if (bcWaitQueue.value.length === 0) bcQueueExpanded.value = false;
    }
  };

  // ── Beneficiaries ───────────────────────────────────────────────────────── (now in usePostForm)
  const getFullPost = async (post: { author: string; permlink: string }): Promise<Post> => {
    const found = [
      activeTopic.value,
      ...replies.value,
      ...(activeForum.value?.posts || []),
      ...profileUser.posts
    ].find(p => p && p.author === post.author && p.permlink === post.permlink);
    
    if (found) return found;
    const raw = await Blockchain.getContent(rpc.dataClient.value, post.author, post.permlink);
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

    const feeInfo = Blockchain.feeInfo;
  const fetchFeeInfo = () => Blockchain.fetchFeeInfo(rpc.dataClient.value);
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
    replyTarget.value = target;
    replyForm.body = drafts.loadReplyDraft(target.author, target.permlink);
    replyForm.error = replyForm.success = '';
    // A previous reply's own submitReply() can legitimately still be
    // running in the background here -- its waitAndReload() polling loop
    // can take minutes (see that function), well past when the user has
    // already moved on to reply to something else. Without this, the send
    // button below would stay disabled (loading still true from that
    // unrelated, still-in-flight submission) with absolutely no feedback:
    // a disabled button doesn't fire its click handler at all, so nothing
    // reaches the console either. See submitReply()'s own generation-guard
    // comment for the other half of this fix (stopping that old
    // submission's eventual completion from clobbering whatever the user
    // is doing by the time it finishes).
    replyForm.loading = false;
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

  // Community-level "ban": sets the account's community role to 'muted' (the same role
  // already used for e.g. blurt-rewards / blurt.rewards). Unlike mutePost (single post/comment,
  // still visible to mods), this hides ALL of the account's content in this community from
  // everyone except the owner/admin who can reverse it. Only owner/admin may call this
  // (see canBanUser) - Blurt's community consensus rules don't allow mods to set roles.
  // Guards against banning yourself or a fellow team member by mistake - setRole would demote/
  // ban them just as easily as a random scammer, and it's easy to fat-finger on a phone.
  const isProtectedFromBan = (account: string): boolean => {
    if (!account) return false;
    const lower = account.toLowerCase();
    if (auth.user && lower === auth.user.username.toLowerCase()) return true;
    return moderators.value.some(m => m.account.toLowerCase() === lower && ['owner', 'admin', 'mod'].includes(m.role));
  };

  const banUser = async (account: string, ban = true): Promise<void> => {
    if (checkLock(() => banUser(account, ban))) return;
    if (!auth.user || !canBanUser.value) return;
    if (ban && isProtectedFromBan(account)) {
      alert(t('cannotBanProtected').replace('{user}', account));
      return;
    }
    const confirmMsg = ban
      ? t('confirmBanUser').replace('{user}', account)
      : t('confirmUnbanUser').replace('{user}', account);
    if (!confirm(confirmMsg)) return;
    const role = ban ? 'muted' : 'member';
    const json = JSON.stringify(['setRole', { community: config.communityAccount, account, role }]);
    const op = ['custom_json', { required_auths: [], required_posting_auths: [auth.user.username], id: 'community', json }];
    try {
      await broadcast([op]);
      const lower = account.toLowerCase();
      if (ban) mutedAccounts.value = new Set([...mutedAccounts.value, lower]);
      else { const next = new Set(mutedAccounts.value); next.delete(lower); mutedAccounts.value = next; }
      waitAndReload(view.value === 'topic');
    } catch (err) { console.error('Ban user error:', err); }
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
        const raw = await Blockchain.getContent(rpc.dataClient.value, post.author, post.permlink);
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
      try { const fresh = await Blockchain.getContent(rpc.dataClient.value, fullPost.author, fullPost.permlink); if (fresh?.beneficiaries) payoutModal.beneficiaries = fresh.beneficiaries as Beneficiary[]; } catch { /* ignore */ }
    }
  };

  const loadUserCommunities = async (username: string): Promise<void> => {
    try {
      const subs = await Blockchain.listSubscriptions(rpc.dataClient.value, username);
      if (Array.isArray(subs)) userSubscriptions.value = subs.map(s => ({ account: s[0], title: s[1] || s[0] }));
    } catch (err) { console.error('Error loading communities:', err); }
  };


  const claimRewards = async (targetAccount?: string): Promise<void> => {
    const username = targetAccount || auth.user?.username;
    if (!username) return;

    const targetUser = auth.accounts.find(a => a.username === username) || (auth.user?.username === username ? auth.user : null);
    if (targetAccount && (!targetUser || (targetUser.type === 'key' && targetUser.locked))) {
      openLoginModal({ noSwitch: true, targetAccount: username });
      resumeAction.value = () => claimRewards(targetAccount);
      return;
    }

    if (checkLock(() => claimRewards(targetAccount))) return;
    try {
      const acc = await Blockchain.getAccount(rpc.dataClient.value, username);
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
      await broadcast(ops, targetUser || undefined);
      if (auth.user && auth.user.username === username) {
        auth.user.hasRewards = false;
        auth.user.rewardBlurt = '0.000 BLURT';
        auth.user.rewardVesting = '0.000000 VESTS';
      }
      if (targetUser) targetUser.hasRewards = false;
      await refreshUser();
      showStatus(t('claimRewards'), t('claimSuccess'), 'success');
    } catch (err) { console.error('Claim rewards error:', err); showStatus(t('claimRewards'), (t('claimError') || 'Error claiming rewards: ') + ((err as Error).message || err), 'error'); }
  };


  const navigateToPath = (path: string): void => {
    window.history.pushState({ path }, '', path);
    handleUrlChange();
  };

  const handleUrlChange = (): void => {
    syncSeoTags(langs);
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
        try {
          const raw = await Blockchain.getForumPosts(rpc.dataClient.value, config.communityAccount, 10, 'activity', undefined, undefined, undefined, f.targetTags.length > 0 ? f.targetTags : undefined);
          if (raw?.length) f.posts = raw.map(normalizePost).filter(post => !isHiddenFromViewer(post, { canBanUser: canBanUser.value, canMute: canMute.value })).slice(0, 5);
        } catch { /* ignore */ }
      });
      trackCurrentView();
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
        trackCurrentView();
      }
    } else if (requestedView === 'topic' && requestedAuthor && requestedPermlink) {
      if (view.value === 'topic' && activeTopic.value?.author === requestedAuthor && activeTopic.value?.permlink === requestedPermlink) return;
      
      // Restore forum context if present
      if (requestedForumId) {
        let f: Forum | undefined = VIRTUAL_FORUMS.find(vf => vf.id === requestedForumId);
        if (!f) { for (const cat of forumStructure.value) { f = cat.forums.find(forum => forum.id === requestedForumId); if (f) break; } }
        if (f) activeForum.value = f;
      }

      Blockchain.getContent(rpc.dataClient.value, requestedAuthor, requestedPermlink).then(content => {
        if (content?.author) { activeTopic.value = { ...normalizePost(content), beneficiaries: (content.beneficiaries || []) as Beneficiary[] }; view.value = 'topic'; loadReplies(content.author, content.permlink); trackCurrentView(); }
      });
    } else if (requestedView === 'profile' && requestedUser) {
      if (requestedTab) profileTab.value = requestedTab;
      if (view.value === 'profile' && profileUser.username === requestedUser) return;
      openProfile(requestedUser).then(() => trackCurrentView());
    } else if (requestedView === 'communities') {
      view.value = 'communities';
      trackCurrentView();
      if (BFCommunity.state.list.length === 0) BFCommunity.fetchCommunities(rpc.dataClient.value as unknown as Record<string, unknown>);
    }
  };

  // Deep clone, not [...VIRTUAL_FORUMS] -- see the comment on
  // loadExplorationData() below for why a shallow copy (same Forum object
  // references, just a new outer array) was a real, live bug: this data
  // and activeForum.value can end up pointing at the exact same object
  // when browsing a virtual forum (MyFeed/trending/etc), so this panel's
  // own 1-post preview fetch could silently overwrite the real listing's
  // posts array out from under it.
  const explorationForm = reactive<{ forums: Forum[]; loading: boolean }>({
    forums: VIRTUAL_FORUMS.map(f => ({ ...f, posts: [...f.posts], pageHistory: [...f.pageHistory] })),
    loading: false,
  });
  const explorationExpanded = ref(false);

  const loadExplorationData = async (): Promise<void> => {
    // Safe to mutate `vf.posts` here for each entry -- explorationForm.forums
    // is deep-cloned from VIRTUAL_FORUMS (see its own declaration above),
    // so this can never again land on the same object activeForum.value
    // might be pointing at while actually browsing one of these forums.
    explorationForm.loading = true;
    for (const vf of explorationForm.forums) {
      if ((vf as Forum & { auth?: boolean }).auth && !auth.user) continue;
      try {
        const apiParams: Record<string, unknown> = { limit: 1 };
        let raw: RawPost[] = [];
        if (vf.id === 'user-feed') raw = await rpc.forumClient.value.call('bridge', 'get_account_posts', { ...apiParams, account: auth.user!.username, sort: 'feed' }) as RawPost[];
        else if (vf.id === 'global-trending') raw = await rpc.forumClient.value.call('bridge', 'get_ranked_posts', { ...apiParams, sort: 'trending' }) as RawPost[];
        else if (vf.id === 'global-new') raw = await rpc.forumClient.value.call('bridge', 'get_ranked_posts', { ...apiParams, sort: 'created' }) as RawPost[];
        else if (vf.id === 'global-activity') raw = await rpc.forumClient.value.call('bridge', 'get_forum_posts', { ...apiParams, community: '', sort: 'activity' }) as RawPost[];
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
          const root = await Blockchain.getContent(rpc.dataClient.value, rootAuthor, rootPermlink);
          if (root?.author) openTopic(normalizePost(root));
        }
      }
    } catch (err) { console.error('Load context error:', err); }
    loading.value = false;

  };



  const {
    auth, loginTab, loginForm, loginErr, loginBusy, wvAvailable, showLoginModal, loginOptions, pinModal,
    completeLogin: _completeLogin, doKeyLogin: _doKeyLogin, doWVLogin: _doWVLogin, logout, 
    switchAccount: _switchAccount, removeAccount, openLoginModal, openSwitchAccountModal, showSwitchAccountModal,
    handlePinSubmit: _handlePinSubmit
  } = useAuth(rpc.dataClient.value, t);

  const authCallbacks = { 
    loadUserCommunities, loadFollowingList, loadData,
    resumeAction: () => { if (resumeAction.value) { const fn = resumeAction.value; resumeAction.value = null; fn(); } }
  };
  const doKeyLogin = () => _doKeyLogin(authCallbacks);
  const doWVLogin = () => _doWVLogin(authCallbacks);
  const switchAccount = (u: string) => _switchAccount(u, authCallbacks);
  const handlePinSubmit = () => _handlePinSubmit(authCallbacks);

  const {
    globalActivity,
    updateGlobalActivity,
    markActivityAsRead
  } = useGlobalActivity(rpc.dataClient.value, auth, config, userSubscriptions, normalizePost, {
    mutedAccounts: () => mutedAccounts.value,
    canBanUser: () => canBanUser.value
  });

  const userRole = computed(() => {
    if (!auth.user || !moderators.value.length) return null;
    const entry = moderators.value.find(m => m.account === auth.user!.username);
    return entry ? entry.role : 'member';
  });
  const canEditStructure = computed(() => ['owner', 'admin'].includes(userRole.value ?? ''));
  const canMute = computed(() => ['owner', 'admin', 'mod'].includes(userRole.value ?? ''));
  // Only owner/admin can change community roles (setRole) - mods can mutePost but not ban a whole account.
  const canBanUser = computed(() => ['owner', 'admin'].includes(userRole.value ?? ''));

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


  // ── Post / reply / edit forms ───────────────────────────────────────────────
  const postFormApi = usePostForm({
    auth, config, t, checkLock, broadcast, waitAndReload, showStatus,
  });
  const { postForm, replyForm, editModal } = postFormApi;

  const submitReply = (data?: any) =>
    postFormApi.submitReply(data?._target ?? replyTarget.value, replies, activeTopic.value?.permlink, quickReplyBody, drafts, data);

  const submitPost = (data?: any) =>
    postFormApi.submitPost(activeForum.value?.id, ({ author, permlink }) => {
      showNewPostForm.value = false;
      waitAndReload(false, author, permlink);
    }, { clearDraft }, data);

  const startEdit = postFormApi.startEdit;

  const submitEdit = (data?: any) =>
    postFormApi.submitEdit(view.value === 'topic', ({ author, permlink }, wasInTopic) => {
      waitAndReload(wasInTopic, author, permlink);
    }, data);

  // ── Image upload ──────────────────────────────────────────────────────────
  const images = useImageUpload(auth, checkLock);

  const appendImageMd = (target: string, md: string) => {
    if (editModal.show) { editModal.body += md; return; }
    if (target === 'post') { postForm.body += md; saveDraft(); }
    else replyForm.body += md;
  };
  const onImageError = (target: string, message: string) => {
    if (target === 'post') postForm.error = message;
    else replyForm.error = message;
  };
  const onImagePick = (target: 'post' | 'reply', e: Event) => images.onImagePick(target, e, appendImageMd, onImageError);
  const onPaste = (target: 'post' | 'reply', e: ClipboardEvent) => images.onPaste(target, e, appendImageMd, onImageError);

  const {
    profileUser,
    profileTab,
    openProfile,
    loadMoreProfileContent,
    fetchEarningsHistory: _fetchEarningsHistory
  } = useProfile(rpc.dataClient.value, globalProps, view, normalizePost, {
    canBanUser: () => canBanUser.value,
    canMute: () => canMute.value
  });

  // COAL data loads asynchronously (network fetch or even a cached-but-first-microtask read),
  // so anything already normalized before it resolves was baked with isCoal=false and never
  // updates on its own (normalizePost computes flags once, it doesn't keep watching coalMap).
  // Re-stamp every post/comment object we currently know about (by reference - these are the
  // SAME reactive objects the templates and voteModal.post point to, see getFullPost above) the
  // moment coalMap actually has data, and again whenever it's refreshed later (e.g. tomorrow).
  const applyCoalFlags = (): void => {
    const map = coalMap.value;
    if (!map.size) return;
    const reflag = (p?: Post | null) => {
      if (!p || !p.author) return;
      const entry = map.get(p.author.toLowerCase());
      if (entry && !p.isCoal) {
        p.isCoal = true;
        p.coalInfo = entry;
        p.isCoalCollapsed = true;
      }
    };
    reflag(activeTopic.value);
    replies.value.forEach(reflag);
    forumStructure.value.forEach(cat => cat.forums.forEach(f => f.posts.forEach(reflag)));
    if (activeForum.value) activeForum.value.posts.forEach(reflag);
    profileUser.posts.forEach(reflag);
    profileUser.comments.forEach(reflag);
    profileUser.replies.forEach(reflag);
  };
  watch(coalMap, applyCoalFlags);

  const { supportModal, submitSupportComment, triggerSupport } = useSupport(
    rpc.dataClient.value, auth, broadcast as any, checkLock, t
  );

  const {
    voteModal,
    estimateVote,
    openVoteModal,
    hasVoted,
    submitVoteConfirmed,
    submitVote: _submitVote
  } = useVote(rpc.dataClient.value, auth, broadcast as any, waitAndReload, t, triggerSupport);

  const {
    walletModal,
    openWalletModal,
    handleWalletSubmit: _handleWalletSubmit,
    cancelDelegation
  } = useWallet(auth, broadcast as any, waitAndReload, showStatus, checkLock);

  const handleWalletSubmit = (data: any) => _handleWalletSubmit(data, globalProps);

  const notifications = createBlurtNotifications(rpc.dataClient.value, auth, t);
  const { openList: openNotifModal, startPolling: startNotifPolling, togglePushNotifications, getNotifIcon, isUnread: isNotifUnread } = notifications;
  const notifModal = notifications.state;

  const openNotification = (notif: NotificationItem) => notifications.openNotification(notif, {
    openTopic, openProfile, normalizePost, client: rpc.dataClient.value, config, targetNotifPermlink,
    selectedCommunity, loading, auth, switchAccount,
  });

  onMounted(() => {
    loadLanguage(lang.value);
    BFPlayer.setClient(rpc.dataClient.value);
    BFPlayer.registerPlugin(BlurtPlayerPlugin(rpc.dataClient.value, auth, (message: string) => signBlurtMessage(auth, message)));
    BFPlayer.registerPlugin(SponsoredPlayerPlugin(rpc.dataClient.value));
    BFPlayer.registerPlugin(BlurtCommentsPlugin({
      client: rpc.dataClient.value,
      auth, t, fmtDate, renderMD, hasVoted, isNestedReply, getParentBody, isPostInCommunity,
      getFollowingSet: () => followingSet.value,
      getCanMute: () => canMute.value,
      getCanBanUser: () => canBanUser.value,
      isProtectedFromBan: (u: string) => isProtectedFromBan(u),
      getMutedAccounts: () => mutedAccounts.value,
      getCoalMap: () => coalMap.value,
      banUser: (u: string, b: boolean) => banUser(u, b),
      config, navigateToPath, cachePostBody,
      submitVote, mutePost, toggleFollow, openPayoutModal, openProfile,
    }));
    setTheme(theme.value);
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('focusin', (e) => {
      if (e.target instanceof HTMLTextAreaElement) {
        images.lastTextarea.value = e.target;
      }
    });
    startNotifPolling();
    
    // Auto-initialize WebTorrent on startup if seeding is enabled to resume seeding immediately
    if (isSeedingEnabled()) {
      console.log('[WT] Seeding is enabled, auto-initializing WebTorrent pool at startup.');
      initWebtorrent().catch(err => console.error('[WT] Startup WebTorrent auto-init failed:', err));
    }

    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG' && target.closest('.post-body')) { openImgModal((target as HTMLImageElement).src); return; }
      const mention = target.closest('.mention');
      if (mention) { e.preventDefault(); openProfile((mention as HTMLElement).getAttribute('data-user')!); return; }
    });
    // Expose app controls for DOMPurify-sanitized content and E2E testing
    (window as Record<string, unknown>).app = {
      openProfile,
      openTopic,
      openForum,
      goHome,
      config,
      view,
      activeForum,
      activeTopic,
      explorationForm
    };

    // Restore sessions.
    //
    // Web path below is UNCHANGED from before (same localStorage reads,
    // same synchronous timing) — it's just been pulled into
    // applyRestoredSessions() so the exact same logic can also serve the
    // native path, which has to be async (secure storage is a real native
    // call, not a synchronous localStorage read) and stores/restores a RAW
    // key with no PIN layer (see useAuth.ts's saveSessions/doKeyLogin —
    // "native" here means "always locked:false", never a PIN-encrypted key).
    const applyRestoredSessions = (savedAll: string | null, savedActive: string | null, native: boolean): void => {
      if (savedAll) {
        try {
          const sessions = JSON.parse(savedAll) as any[];
          sessions.forEach(session => {
            if (session.type === 'whalevault') {
              auth.accounts.push({ username: session.username, type: 'whalevault', key: null, vp: '…', hasRewards: false });
              Blockchain.getAccount(rpc.dataClient.value, session.username).then((acc: any) => {
                if (acc) {
                  const lastVoteTime = new Date((acc.last_vote_time as string) + 'Z').getTime();
                  const delta = (Date.now() - lastVoteTime) / 1000;
                  let vp = (acc.voting_power as number) + (10000 * delta / 432000);
                  vp = Math.min(vp / 100, 100);
                  const hasRewards = BFUtils.parsePayout(acc.reward_blurt_balance as string) > 0 || BFUtils.parsePayout(acc.reward_vesting_balance as string) > 0;
                  const idx = auth.accounts.findIndex(a => a.username === session.username);
                  if (idx >= 0) {
                     auth.accounts[idx].vp = vp.toFixed(2);
                     auth.accounts[idx].hasRewards = hasRewards;
                     auth.accounts[idx].rewardBlurt = acc.reward_blurt_balance as string;
                     auth.accounts[idx].rewardVesting = acc.reward_vesting_balance as string;
                  }
                  if (auth.user?.username === session.username) {
                    const u = auth.user!;
                    u.vp = vp.toFixed(2);
                    u.hasRewards = hasRewards;
                    u.rewardBlurt = acc.reward_blurt_balance as string;
                    u.rewardVesting = acc.reward_vesting_balance as string;
                  }
                }
              }).catch(() => {});
            } else {
              auth.accounts.push({ username: session.username, type: 'key', key: session.key, encryptedKey: session.key, vp: '…', locked: !native, hasRewards: false });
            }
          });
        } catch { /* ignore */ }
      }

      if (savedActive) {
        try {
          const session = JSON.parse(savedActive) as { username: string; type: string; key: string };
          const found = auth.accounts.find(a => a.username === session.username);
          if (found) {
            auth.user = found;
            if (session.type === 'whalevault') {
              loadUserCommunities(session.username); loadFollowingList(session.username);
            } else {
              loadUserCommunities(session.username); loadFollowingList(session.username); refreshUser();
            }
          } else {
            // Migration or single session
            if (session.type === 'whalevault') {
              auth.user = { username: session.username, type: 'whalevault', key: null, vp: '…' };
              auth.accounts.push(auth.user);
              Blockchain.getAccount(rpc.dataClient.value, session.username).then((acc: any) => {
                if (acc) {
                  const lastVoteTime = new Date((acc.last_vote_time as string) + 'Z').getTime();
                  const delta = (Date.now() - lastVoteTime) / 1000;
                  let vp = (acc.voting_power as number) + (10000 * delta / 432000);
                  vp = Math.min(vp / 100, 100);
                  const hasRewards = BFUtils.parsePayout(acc.reward_blurt_balance as string) > 0 || BFUtils.parsePayout(acc.reward_vesting_balance as string) > 0;
                  auth.user = { username: session.username, type: 'whalevault', key: null, vp: vp.toFixed(2), hasRewards, rewardBlurt: acc.reward_blurt_balance as string, rewardVesting: acc.reward_vesting_balance as string };
                  const idx = auth.accounts.findIndex(a => a.username === session.username);
                  if (idx >= 0) auth.accounts[idx] = auth.user;
                }
              });
              loadUserCommunities(session.username); loadFollowingList(session.username);
            } else {
              auth.user = { username: session.username, type: 'key', key: session.key, encryptedKey: session.key, vp: '…', locked: !native };
              auth.accounts.push(auth.user);
              loadUserCommunities(session.username); loadFollowingList(session.username); refreshUser();
            }
          }
        } catch { /* ignore */ }
      } else if (!native) {
        const legacy = localStorage.getItem('bf-session');
        if (legacy) {
          try { const session = JSON.parse(legacy) as { username?: string; type?: string }; if (session.username && session.type === 'whalevault') { localStorage.setItem('blurtforum_session', legacy); location.reload(); } } catch { /* ignore */ }
        }
      }
    };

    if (Capacitor.isNativePlatform()) {
      // Secure storage is a real native call — genuinely async, unlike the
      // synchronous localStorage read below. Fires whenever it resolves;
      // doesn't block the rest of this onMounted (URL param handling etc.
      // below doesn't depend on auth.user being restored first).
      Promise.all([sessionStore.loadSessions(), sessionStore.loadActiveSession()])
        .then(([savedAll, savedActive]) => applyRestoredSessions(savedAll, savedActive, true))
        .catch(e => console.error('Native session restore failed:', e));
    } else {
      // Unchanged from before: synchronous localStorage reads, same timing.
      applyRestoredSessions(
        localStorage.getItem('blurtforum_sessions'),
        localStorage.getItem('blurtforum_session'),
        false
      );
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

    if (cinemaMode.value) {
      // CinemaIndex.vue fetches its own content independently and never
      // reads forumStructure/the topic listing loadData() populates -- in
      // cinema mode this call (and the "loading community" state visible
      // while it runs) was pure waste, and the last-viewed-forum
      // restoration right after it is a classic-mode-only concept anyway.
      // IMPORTANT: `loading` defaults to true and is normally only ever
      // flipped to false inside loadData()'s finally block. Since cinema
      // mode deliberately never calls loadData(), it must clear the flag
      // itself here -- otherwise the app never leaves the "loading
      // community" gate (see App.vue's `v-if="!loading"` around the main
      // view) and CinemaIndex would never mount at all on a cold cinema
      // load.
      loading.value = false;
      handleUrlChange();
    } else {
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
        // NOTE: global activity polling is started/stopped by <GlobalActivity>'s
        // own onMounted/onUnmounted (see components/layout/GlobalActivity.vue).
        // Not triggered here so that simply not rendering the component (as in
        // cinema mode) is enough to stop the RPC calls, no cinemaMode checks needed.
      });
    }

    setInterval(() => {
      if (auth.user) {
        let val = parseFloat(auth.user.vp) + 0.01 / 43.2;
        if (val < 100) auth.user.vp = val.toFixed(2);
      }
    }, 30000);
  });

  return {
    lang, setLang, langs, t, theme, setTheme, themes, cinemaMode, setCinemaMode, config, view, loading, globalProps, forumStructure,
    activeForum, activeTopic, replies, repliesLoading, moderators, communityInfo,
    structureNote, selectedCommunity, currentTagFilter, applyTagFilter, clearTagFilter, customTag, allCommunities, userSubscriptions, auth, showLoginModal, loginTab,
    loginForm, loginErr, loginBusy, wvAvailable, loginOptions, replyTarget, quickReplyBody, replyForm,
    showNewPostForm, openNewPostForm, postForm, fmtDate, timeAgo, forumHasUnread, renderMD, isNestedReply, getParentBody,
    goHome, openForum, openTopic, handleCommunityChange, switchCommunity, openCommunities, toggleCommunitySub, openLoginModal,
    switchAccount, removeAccount, showSwitchAccountModal, openSwitchAccountModal,
    syncUrl,
    handleUrlChange,
    navigateToPath,
    community: BFCommunity, communityRewards,
    doKeyLogin, doWVLogin, logout, startReply, submitReply, submitPost, loadData,
    changePage,
    submitVote, hasVoted, openPayoutModal, payoutModal, openNotifModal, notifModal, togglePushNotifications, isNotifUnread,
    walletModal, openWalletModal, handleWalletSubmit, cancelDelegation,
    walletAuthModal,
    followModal, confirmToggleFollow,
    openProfile, profileUser, profileTab, loadMoreProfileContent, fetchEarningsHistory: _fetchEarningsHistory, openNotification,
    canEditStructure, canMute, mutePost, canBanUser, banUser, isProtectedFromBan, mutedAccounts, coalMap, editStructureMode, startEditStructure, saveStructure,
    structureForm, showStructureDocs,
    forumPagination, loadMorePosts,
    pinModal, handlePinSubmit,
    globalActivity, updateGlobalActivity, activityTab, activityExpanded, activityFullList, mobileActivityExpanded, openActivity,
    editModal, startEdit, submitEdit,
    voteModal, openVoteModal, submitVoteConfirmed, estimateVote,
    feeInfo, feeEstimates, scheduleFeeUpdate,
    bcWaitQueue, bcQueueExpanded,
    imgModal, openImgModal,
    statusModal, showStatus,
    claimRewards,
    postPreview, replyPreview, saveDraft, clearDraft,
    imgUploads: images.imgUploads, onImagePick, onPaste,
    saveReplyDraft: drafts.saveReplyDraft,
    ...rpc,
    getNotifIcon,
    loadTopicContext,
    isPostInCommunity,
    toggleFollow,
    supportModal, submitSupportComment,
    broadcast, waitAndReload, checkLock,
    explorationExpanded,
    explorationForm,
    toggleExploration,
    followingSet,
    player: BFPlayer,
    client: rpc.dataClient.value,
    };
    }