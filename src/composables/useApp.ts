/**
 * useApp — main BlurtForum composable
 * Ports the entire app.js setup() logic into a typed Vue 3 composable.
 */
import {
  ref, reactive, computed, onMounted, nextTick, watch,
} from 'vue';
import CryptoJS from 'crypto-js';
import { useNotifications, notifModal } from './useNotifications';
import { BFUtils } from '../modules/utils';
import { Blockchain } from '../modules/blockchain';
import { useVote } from './useVote';
import { useWallet } from './useWallet';
import { useProfile } from './useProfile';
import { useAuth } from './useAuth';
import { useGlobalActivity } from './useGlobalActivity';
import { BlurtPlayerPlugin } from '../modules/blurt-player-plugin';
import { BFCommunity, VIRTUAL_FORUMS, DEFAULT_COMMUNITIES } from '../modules/community';
import { BFPlayer } from '../modules/player';
import { Parser } from '../modules/parser';
import { PostProcessor } from '../modules/post-processor';

import { TR, loadLanguage, type Lang, LANGS as langs } from '../modules/translations';
import '../modules/whalevault';
import type {
  Post, Forum, ForumCategory, RawPost, AuthUser, ActivityItem,
  Beneficiary, BcQueueEntry, GlobalProps, Moderator, CommunityInfo,
  UserSubscription, Notification,
} from '../types';

import * as dblurt from '@beblurt/dblurt';

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


  const editModal = reactive({ show: false, loading: false, isPost: false, author: '', permlink: '', title: '', body: '', error: '', success: '', target: null as Post | null });

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
      replyForm.body = loadReplyDraft(activeTopic.value.author, activeTopic.value.permlink);
    }
  });
  const replyForm   = reactive({ body: '', loading: false, error: '', success: '', beneficiary: { account: '', weight: '' } });

  const showNewPostForm = ref(false);
  const postPreview = ref(false);
  const replyPreview = ref(false);

  const getDraftKey = () => `bf-draft-${config.communityAccount}-${activeForum.value?.id || 'x'}`;
  const saveDraft = (data?: any) => {
    if (data) {
      postForm.title = data.title; postForm.body = data.body;
      if (data.selectedTag) postForm.selectedTag = data.selectedTag;
      if (data.customTags !== undefined) postForm.customTags = data.customTags;
    }
    if (!postForm.title && !postForm.body) return;
    localStorage.setItem(getDraftKey(), JSON.stringify({ title: postForm.title, body: postForm.body, selectedTag: postForm.selectedTag, customTags: postForm.customTags, ts: Date.now() }));
  };
  const clearDraft = () => { localStorage.removeItem(getDraftKey()); postForm.hasDraft = false; };
  
  const getReplyDraftKey = (author: string, permlink: string) => `bf-reply-draft-${author}-${permlink}`;
  const cleanupDrafts = () => {
    const now = Date.now(); const month = 30 * 24 * 60 * 60 * 1000;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('bf-reply-draft-')) {
          const d = JSON.parse(localStorage.getItem(key)!);
          if (now - (d.ts || 0) > month) { localStorage.removeItem(key); i--; }
        }
      }
    } catch { /* ignore */ }
  };
  const saveReplyDraft = (author: string, permlink: string, body: string) => {
    if (!body) { localStorage.removeItem(getReplyDraftKey(author, permlink)); return; }
    localStorage.setItem(getReplyDraftKey(author, permlink), JSON.stringify({ body, ts: Date.now() }));
    if (Math.random() < 0.1) cleanupDrafts();
  };
  const loadReplyDraft = (author: string, permlink: string) => {
    try {
      const d = localStorage.getItem(getReplyDraftKey(author, permlink));
      if (d) return JSON.parse(d).body;
    } catch { /* ignore */ }
    return '';
  };
  const clearReplyDraft = (author: string, permlink: string) => localStorage.removeItem(getReplyDraftKey(author, permlink));

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
    canMute: canMute.value
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
      forumClient = new dblurt.Client([getForumUrl()]);
      client      = new dblurt.Client([getDataUrl()]);
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
        const props = await Blockchain.getDynamicGlobalProperties(client);
        globalProps.value = props as any;
        moderators.value = [];
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
            const cc = await Blockchain.getCommunity(forumClient, config.communityAccount);
            if (cc) {
              communityInfo.value = { title: (cc.title as string) || config.communityAccount, about: (cc.about as string) || '' };
              rawDescription.value = (cc.description as string) || '';
              let structureSource = (cc.description as string) || '';
              const extMatch = structureSource.match(/\[\[Forum config:(@?)([a-z0-9.-]+)\/([a-z0-9-]+)\]\]/i);
              if (extMatch) {
                try {
                  const post = await Blockchain.getContent(client, extMatch[2], extMatch[3]);
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

          const acc = await Blockchain.getAccount(client, config.communityAccount);
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
            const roles = await Blockchain.listCommunityRoles(forumClient, config.communityAccount);
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
          rawPosts = await Blockchain.getAccountPosts(forumClient, 'feed', auth.user.username, fetchLimit, params.start_author as string, params.start_permlink as string);
        } else if (vf.id === 'global-trending') {
          rawPosts = await Blockchain.getRankedPosts(forumClient, 'trending', currentTagFilter.value as string, fetchLimit, params.start_author as string, params.start_permlink as string);
        } else if (vf.id === 'global-new') {
          rawPosts = await Blockchain.getRankedPosts(forumClient, 'created', currentTagFilter.value as string, fetchLimit, params.start_author as string, params.start_permlink as string);
        } else if (vf.id === 'global-activity') {
          rawPosts = await Blockchain.getForumPosts(forumClient, '', fetchLimit, 'activity', undefined, params.start_author as string, params.start_permlink as string, params.tags_any as string[]);
        }
      } else {
        rawPosts = await Blockchain.getForumPosts(forumClient, params.community as string, fetchLimit, 'activity', undefined, params.start_author as string, params.start_permlink as string, params.tags_any as string[]);
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
        results = await Blockchain.getContentReplies(client, pAuthor, pPermlink);
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
        const full = await Blockchain.getContent(client, topic.author, topic.permlink);
        if (full?.author) topic = normalizePost(full);
      } catch (e) { console.error('Error fetching full topic:', e); }
      loading.value = false;
    }
    activeTopic.value = { ...topic, beneficiaries: topic.beneficiaries || [] };
    bodyCache[`${topic.author}/${topic.permlink}`] = topic.body;
    replyTarget.value = null;
    replyForm.body = '';
    quickReplyBody.value = loadReplyDraft(topic.author, topic.permlink);
    replyForm.error = replyForm.success = '';
    view.value = 'topic';
    syncUrl();
    markTopicAsRead(activeTopic.value);
    loadReplies(topic.author, topic.permlink);
    if (!topic.beneficiaries?.length) {
      Blockchain.getContent(client, topic.author, topic.permlink).then((full: any) => {
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
    BFPlayer.clearTracks();
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
             await Blockchain.broadcast(client, tempUser, ops, authority);
             resolve();
           } catch (e) {
             reject(e);
           }
         };
       });
    }
    
    return Blockchain.broadcast(client, user, ops, authority);
  };

  const loadFollowingList = async (username: string): Promise<void> => {
    if (!username) return;
    try {
      const following = await Blockchain.getFollowing(client, username);
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
      const sig = privKey.sign(hashBytes as any);
      sigHex = sig.toString();
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

  const lastTextarea = ref<HTMLTextAreaElement | null>(null);

  const insertImageIntoBody = (target: 'post' | 'reply', imgUrl: string): void => {
    const md = `\n![image](${imgUrl})\n`;
    
    // Try to insert at cursor in the last focused textarea
    if (lastTextarea.value && document.contains(lastTextarea.value)) {
      const el = lastTextarea.value;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = el.value;
      el.value = val.substring(0, start) + md + val.substring(end);
      el.selectionStart = el.selectionEnd = start + md.length;
      el.dispatchEvent(new Event('input'));
      el.focus();
      return;
    }

    if (editModal.show) { editModal.body += md; return; }
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
    if (e.target instanceof HTMLTextAreaElement) lastTextarea.value = e.target;
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
      const acc = await Blockchain.getAccount(client, auth.user.username);
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
          const c = await Blockchain.getContent(client, author, permlink);
          if (isReal(c)) { lastContent = c; if (!pollFn || pollFn(c)) { found = true; break; } }
        } catch { /* ignore */ }
        if (!found) entry.label = t('syncingWithBlockchain') || 'Waiting for data node synchronization…';
      }
      if (found && opt) opt._pending = 'indexing';
      if (!found) {
        entry.progress = 88; entry.label = 'Still syncing… final attempt';
        await new Promise(r => setTimeout(r, 10000));
        try { const c = await Blockchain.getContent(client, author, permlink); if (isReal(c)) { lastContent = c; found = true; } } catch { /* ignore */ }
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
  const submitReply = async (data?: any): Promise<void> => {
    const target = data?._target || replyTarget.value;
    if (checkLock(() => submitReply(data))) return;
    if (!auth.user || !target) return;

    // Use provided data or fallback to global state
    const body = (data?.body || replyForm.body).trim();
    if (!body) { replyForm.error = 'Reply cannot be empty.'; return; }

    replyForm.loading = true; replyForm.error = ''; replyForm.success = '';
    const communityAcc = activeTopic.value?.category || target.category;
    const beneficiaries = prepareBeneficiaries(data?.beneficiary || replyForm.beneficiary, communityAcc);

    const op = ['comment', {
      parent_author: target.author,
      parent_permlink: target.permlink,
      author: auth.user.username,
      permlink: BFUtils.genPermlink('re-' + target.author),
      title: '',
      body,
      json_metadata: JSON.stringify({ app: 'blurtforum/1.0', tags: [communityAcc || config.communityAccount], format: 'markdown' })
    }];

    const options = ['comment_options', {
      author: auth.user.username,
      permlink: (op[1] as Record<string, string>).permlink,
      max_accepted_payout: '1000000.000 BLURT',
      percent_steem_dollars: 10000,
      allow_votes: true,
      allow_curation_rewards: true,
      extensions: beneficiaries.length > 0 ? [[0, { beneficiaries }]] : []
    }];

    try {
      await broadcast([op, options]);
      replyForm.success = t('replySuccess');
      clearReplyDraft(target.author, target.permlink);
      if (data) { data.body = ''; data.title = ''; data.success = t('replySuccess'); }

      if (target.permlink === activeTopic.value?.permlink) quickReplyBody.value = '';
      else replyForm.body = '';

      const parentPermlink = (op[1] as Record<string, string>).parent_permlink;
      const parentReply = replies.value.find(r => r.permlink === parentPermlink);
      const optimisticDepth = parentReply ? (parentReply.depth ?? 0) + 1 : 1;
      const optimistic: Post = { author: auth.user.username, permlink: (op[1] as Record<string, string>).permlink, parent_author: (op[1] as Record<string, string>).parent_author, parent_permlink: parentPermlink, body, created: new Date().toISOString().slice(0, 19), depth: optimisticDepth, pendingPayout: 0, totalPayout: 0, payout: 0, vote_count: 0, active_votes: [], net_rshares: 0, beneficiaries, _qOpen: false, _pending: 'sending', media: null, title: '', url: '', category: '', lastActivity: '', lastAuthor: '', isUnread: false, isRead: true, isFollowing: false, isMuted: false, isPaid: false, isCollapsed: false, replyCount: 0, tags: [] };
      replies.value = [...replies.value, optimistic];
      replyTarget.value = null;
      await waitAndReload(true, auth.user.username, (op[1] as Record<string, string>).permlink);
    } catch (err) {
      console.error('Reply error:', err); 
      replyForm.error = t('replyError') + ' (' + ((err as Error).message || '') + ')'; 
      if (data) data.error = replyForm.error;
    }
    replyForm.loading = false;
  };

  const submitPost = async (data?: any): Promise<void> => {
    if (checkLock(() => submitPost(data))) return;
    if (!auth.user || !activeForum.value) return;
    
    const title = (data?.title || postForm.title).trim();
    const body = (data?.body || postForm.body).trim();
    if (!title || !body) { postForm.error = 'Title and body are required.'; return; }
    
    postForm.loading = true; postForm.error = ''; postForm.success = '';
    
    const customTagsVal = data?.customTags ?? postForm.customTags;
    const selectedTagVal = data?.selectedTag ?? postForm.selectedTag;
    const beneficiaryVal = data?.beneficiary ?? postForm.beneficiary;

    const customTagsList = customTagsVal.split(',').map((s: string) => s.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean);
    const targetCommunity = config.communityAccount.startsWith('blurt-') ? config.communityAccount : null;
    const primaryTag = targetCommunity || selectedTagVal || customTagsList[0] || 'blurt';
    const tags = [primaryTag];
    if (selectedTagVal && !tags.includes(selectedTagVal)) tags.push(selectedTagVal);
    for (const ct of customTagsList) { if (tags.length >= 5) break; if (!tags.includes(ct)) tags.push(ct); }
    
    const beneficiaries = prepareBeneficiaries(beneficiaryVal, targetCommunity);
    const op = ['comment', { parent_author: '', parent_permlink: primaryTag, author: auth.user.username, permlink: BFUtils.genPermlink(title), title, body, json_metadata: JSON.stringify({ app: 'blurtforum/1.0', tags, format: 'markdown', community: targetCommunity || undefined }) }];
    const options = ['comment_options', { author: auth.user.username, permlink: (op[1] as Record<string, string>).permlink, max_accepted_payout: '1000000.000 BLURT', percent_steem_dollars: 10000, allow_votes: true, allow_curation_rewards: true, extensions: beneficiaries.length > 0 ? [[0, { beneficiaries }]] : [] }];
    try {
      await broadcast([op, options]);
      postForm.title = ''; postForm.body = '';
      if (data) { data.title = ''; data.body = ''; }
      clearDraft(); showNewPostForm.value = false;
      showStatus(t('newPost'), t('postSuccess'), 'success');
      waitAndReload(false, auth.user.username, (op[1] as Record<string, string>).permlink);
    } catch (err) {
 
      console.error('Post error:', err); 
      showStatus(t('newPost'), (t('postError') || 'Error: ') + ((err as Error).message || err), 'error'); 
    }
    postForm.loading = false;
  };

  const getFullPost = async (post: { author: string; permlink: string }): Promise<Post> => {
    const found = [
      activeTopic.value,
      ...replies.value,
      ...(activeForum.value?.posts || []),
      ...profileUser.posts
    ].find(p => p && p.author === post.author && p.permlink === post.permlink);
    
    if (found) return found;
    const raw = await Blockchain.getContent(client, post.author, post.permlink);
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
    replyTarget.value = target; 
    replyForm.body = loadReplyDraft(target.author, target.permlink);
    replyForm.error = replyForm.success = '';
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
        const raw = await Blockchain.getContent(client, post.author, post.permlink);
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
      try { const fresh = await Blockchain.getContent(client, fullPost.author, fullPost.permlink); if (fresh?.beneficiaries) payoutModal.beneficiaries = fresh.beneficiaries as Beneficiary[]; } catch { /* ignore */ }
    }
  };

  const getNotifIcon = (type: string): string => {
    const icons: Record<string, string> = { reply: '💬', reply_comment: '💬', vote: '👍', mention: '🔔', follow: '👤', reblog: '🔄', transfer: '💰', witness_vote: '🗳️' };
    return icons[type] || '🔵';
  };

  const loadUserCommunities = async (username: string): Promise<void> => {
    try {
      const subs = await Blockchain.listSubscriptions(client, username);
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
      const acc = await Blockchain.getAccount(client, username);
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

  const startEdit = (target: Post): void => {
    editModal.target = target; editModal.author = target.author; editModal.permlink = target.permlink;
    editModal.title = target.title || ''; editModal.body = target.body; editModal.isPost = !target.parent_author;
    editModal.error = ''; editModal.success = ''; editModal.loading = false; editModal.show = true;
  };

  const submitEdit = async (data?: any): Promise<void> => {
    if (checkLock(() => submitEdit(data))) return;
    if (!auth.user || !editModal.target) return;
    editModal.loading = true; editModal.error = ''; editModal.success = '';
    
    const body = (data?.body ?? editModal.body).trim();
    const title = (data?.title ?? editModal.title).trim();

    let meta = editModal.target.json_metadata || '';
    if (typeof meta !== 'string') { try { meta = JSON.stringify(meta); } catch { meta = ''; } }
    const op = ['comment', { parent_author: editModal.target.parent_author || '', parent_permlink: editModal.target.parent_permlink || config.communityAccount, author: auth.user.username, permlink: editModal.permlink, title, body, json_metadata: meta }];
    try {
      await broadcast([op]);
      editModal.success = t('updateSuccess');
      const editedPermlink = editModal.permlink; const editedAuthor = editModal.author; const wasInTopic = view.value === 'topic';
      editModal.show = false;
      waitAndReload(wasInTopic, editedAuthor, editedPermlink);
    } catch (err) { 
      console.error('Edit error:', err); 
      editModal.error = t('updateError') + ' (' + ((err as Error).message || '') + ')'; 
    }
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
        try {
          const raw = await Blockchain.getForumPosts(client, config.communityAccount, 10, 'activity', undefined, undefined, undefined, f.targetTags.length > 0 ? f.targetTags : undefined);
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

      Blockchain.getContent(client, requestedAuthor, requestedPermlink).then(content => {
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
          const root = await Blockchain.getContent(client, rootAuthor, rootPermlink);
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
  } = useAuth(client, t);

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
  } = useGlobalActivity(client, auth, config, userSubscriptions, normalizePost);

  const userRole = computed(() => {
    if (!auth.user || !moderators.value.length) return null;
    const entry = moderators.value.find(m => m.account === auth.user!.username);
    return entry ? entry.role : 'member';
  });
  const canEditStructure = computed(() => ['owner', 'admin'].includes(userRole.value ?? ''));
  const canMute = computed(() => ['owner', 'admin', 'mod'].includes(userRole.value ?? ''));

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

  const {
    profileUser,
    profileTab,
    openProfile,
    loadMoreProfileContent,
    fetchEarningsHistory: _fetchEarningsHistory
  } = useProfile(client, globalProps, view, normalizePost);

  const {
    voteModal,
    estimateVote,
    openVoteModal,
    hasVoted,
    submitVoteConfirmed: _submitVoteConfirmed,
    submitVote: _submitVote
  } = useVote(client, auth, broadcast as any, waitAndReload, t);

  const {
    walletModal,
    openWalletModal,
    handleWalletSubmit: _handleWalletSubmit,
    cancelDelegation
  } = useWallet(auth, broadcast as any, waitAndReload, showStatus, checkLock);

  const handleWalletSubmit = (data: any) => _handleWalletSubmit(data, globalProps);

  const { openNotifModal, openNotification: _openNotification, startPolling: startNotifPolling, togglePushNotifications } = useNotifications(client, auth, t);

  const openNotification = (notif: Notification) => _openNotification(notif, {
    openTopic, openProfile, normalizePost, client, config, targetNotifPermlink,
    selectedCommunity, loading, loadData, forumClient, getForumUrl, getDataUrl,
    auth, switchAccount
  });

  onMounted(() => {
    loadLanguage(lang.value);
    BFPlayer.setClient(client);
    BFPlayer.registerPlugin(BlurtPlayerPlugin(client, auth));
    setTheme(theme.value);
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('focusin', (e) => {
      if (e.target instanceof HTMLTextAreaElement) {
        lastTextarea.value = e.target;
      }
    });
    startNotifPolling();

    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG' && target.closest('.post-body')) { openImgModal((target as HTMLImageElement).src); return; }
      const mention = target.closest('.mention');
      if (mention) { e.preventDefault(); openProfile((mention as HTMLElement).getAttribute('data-user')!); return; }
    });
    // Expose openProfile for DOMPurify-sanitized content
    (window as Record<string, unknown>).app = { openProfile };

    // Restore sessions
    const savedAll = localStorage.getItem('blurtforum_sessions');
    const savedActive = localStorage.getItem('blurtforum_session');
    
    if (savedAll) {
      try {
        const sessions = JSON.parse(savedAll) as any[];
        sessions.forEach(session => {
          if (session.type === 'whalevault') {
            auth.accounts.push({ username: session.username, type: 'whalevault', key: null, vp: '…', hasRewards: false });
            Blockchain.getAccount(client, session.username).then((acc: any) => {
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
            auth.accounts.push({ username: session.username, type: 'key', key: session.key, encryptedKey: session.key, vp: '…', locked: true, hasRewards: false });
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
            Blockchain.getAccount(client, session.username).then((acc: any) => {
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
            auth.user = { username: session.username, type: 'key', key: session.key, encryptedKey: session.key, vp: '…', locked: true };
            auth.accounts.push(auth.user);
            loadUserCommunities(session.username); loadFollowingList(session.username); refreshUser();
          }
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
    loginForm, loginErr, loginBusy, wvAvailable, loginOptions, replyTarget, quickReplyBody, replyForm,
    showNewPostForm, openNewPostForm, postForm, fmtDate, timeAgo, forumHasUnread, renderMD, isNestedReply, getParentBody,
    goHome, openForum, openTopic, handleCommunityChange, switchCommunity, openCommunities, toggleCommunitySub, openLoginModal,
    switchAccount, removeAccount, showSwitchAccountModal, openSwitchAccountModal,
    syncUrl,
    community: BFCommunity, communityRewards,
    doKeyLogin, doWVLogin, logout, startReply, submitReply, submitPost, loadData,
    changePage,
    submitVote, hasVoted, openPayoutModal, payoutModal, openNotifModal, notifModal, togglePushNotifications,
    walletModal, openWalletModal, handleWalletSubmit, cancelDelegation,
    walletAuthModal,
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
    saveReplyDraft,
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