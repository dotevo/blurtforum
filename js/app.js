/**
 * BlurtForum — complete Blurt blockchain forum frontend
 */
const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;
 
createApp({
  setup() {
    const langs = ['en', 'pl', 'eo'];
    const browserLang = navigator.language.slice(0, 2).toLowerCase();
    const lang = ref(langs.includes(browserLang) ? browserLang : 'en');
    const setLang = (l) => { lang.value = l; document.documentElement.lang = l; };
    const t = (k) => {
      const val = (TR[lang.value] || TR.en)[k];
      if (!val) console.warn(`Translation missing for key: "${k}" in lang: "${lang.value}"`);
      return val || k;
    };

    const themes = [
      { id: 'subsilver', label: '🏛 Classic' },
      { id: 'modern',    label: '📱 Modern' },
      { id: 'deepnight', label: '🌑 Night' },
      { id: 'ocean',     label: '🌊 Ocean' },
      { id: 'forest',    label: '🌿 Forest' },
      { id: 'midnight',  label: '🌙 Midnight' }
    ];
    const theme = ref(localStorage.getItem('bf-theme') || 'subsilver');
    const setTheme = (id) => {
      theme.value = id;
      localStorage.setItem('bf-theme', id);
      document.body.className = `theme-${id}`;
    };
 
    const config = reactive({
      communityAccount: 'blurt-140455',
      nodes: ['https://blurtrpc.dagobert.uk', 'https://rpc.blurt.blog', 'https://rpc.beblurt.com', 'https://rpc.drakernoise.com'],
      lockedCommunity: false
    });

    // RPC settings
    const rpcMenuOpen  = ref(false);
    // Nexus/Forum node: dagobert supports both APIs
    const rpcForumNode = ref(localStorage.getItem('bf-rpc-forum') || 'https://rpc.drakernoise.com');
    // Data/Broadcast node: dagobert supports both APIs
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
    const targetNotifPermlink = ref(null);
    const targetNotifMatch = ref(null); // { author, ts }
    const globalProps  = ref({});
    const forumStructure = ref([]);
    const activeForum  = ref(null);
    const activeTopic  = ref(null);
    const forumPagination = reactive({
      lastAuthor: '',
      lastPermlink: '',
      hasMore: true,
      loading: false,
      bgLoading: false,
      fetchedCount: 0,
      visibleCount: 20,
      pageHistory: [] // To store [author, permlink] for previous pages
    });
    const replies      = ref([]);
    const moderators   = ref([]);
    const communityInfo = ref({});
    const structureNote = ref(false);
    const showStructureDocs = ref(false);
    const editStructureMode = ref(false);
    const rawDescription = ref('');
    const structureForm = reactive({ text: '', loading: false, error: '' });

    const userRole = computed(() => {
      if (!auth.user || !moderators.value.length) return null;
      const entry = moderators.value.find(m => m.account === auth.user.username);
      return entry ? entry.role : 'member';
    });
    const canEditStructure = computed(() => ['owner', 'admin'].includes(userRole.value));
    const canMute = computed(() => ['owner', 'admin', 'mod'].includes(userRole.value));

    const bodyCache = {};
    const selectedCommunity = ref('blurt-140455');
    const customTag = ref('');
    const userSubscriptions = ref([]);
    const followingSet = ref(new Set());

    // Definitions for exploration sections
    const VIRTUAL_FORUMS = [
      { id: 'user-feed', name: t('myFeed'), targetTags: [], type: 'feed', auth: true },
      { id: 'global-trending', name: t('trending'), targetTags: [], type: 'trending' },
      { id: 'global-new', name: t('newPosts'), targetTags: [], type: 'new' },
      { id: 'global-activity', name: t('globalActivity'), targetTags: [], type: 'activity' }
    ];

    const allCommunities = computed(() => {
      const defaults = [
        { account: 'blurt-140455', title: 'General Forum'}, 
        { account: 'blurt-179874', title: 'Blurt Polska' },
        { account: 'blurt-129105', title: 'Blurt Market' }
      ];
      const combined = [...defaults];
      userSubscriptions.value.forEach(s => {
        if (!combined.find(c => c.account === s.account)) combined.push(s);
      });
      // Ensure current community is in the list
      if (config.communityAccount && !combined.find(c => c.account === config.communityAccount)) {
        combined.push({ account: config.communityAccount, title: communityInfo.value.title || config.communityAccount });
      }
      return combined;
    });
 
    const profileUser = reactive({
      username: '',
      data: null,
      posts: [],
      comments: [],
      loading: false
    });
    const profileTab = ref('posts');

    const pinModal = reactive({ show: false, mode: 'setup', value: '', error: '', tempUser: null });
    const editModal = reactive({ show: false, loading: false, isPost: false, author: '', permlink: '', title: '', body: '', error: '', success: '', target: null });

    const auth = reactive({ user: null });
    const resumeAction = ref(null);

    const checkLock = (fn) => {
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
    
    // Generic status modal (success/error/info)
    const statusModal = reactive({
      show: false,
      title: '',
      body: '',
      type: 'info' // info, success, error
    });

    const showStatus = (title, body, type = 'info') => {
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
    const wvAvailable = computed(() => typeof window.whalevault !== 'undefined');
 
    const replyTarget = ref(null);
    const replyForm   = reactive({ body: '', loading: false, error: '', success: '', beneficiary: { account: '', weight: '' } });
 
    const showNewPostForm = ref(false);
    const postPreview = ref(false);
    const replyPreview = ref(false);

    // Draft helpers
    const getDraftKey = () => `bf-draft-${config.communityAccount}-${activeForum.value?.id || 'x'}`;
    const saveDraft = () => {
      if (!postForm.title && !postForm.body) return;
      localStorage.setItem(getDraftKey(), JSON.stringify({
        title: postForm.title,
        body: postForm.body,
        selectedTag: postForm.selectedTag,
        customTags: postForm.customTags
      }));
    };
    const clearDraft = () => {
      localStorage.removeItem(getDraftKey());
      postForm.hasDraft = false;
    };
    const loadDraft = () => {
      try {
        const d = localStorage.getItem(getDraftKey());
        if (d) {
          const p = JSON.parse(d);
          postForm.title = p.title || '';
          postForm.body = p.body || '';
          if (p.selectedTag) postForm.selectedTag = p.selectedTag;
          if (p.customTags)  postForm.customTags  = p.customTags;
          postForm.hasDraft = true;
        }
      } catch (e) { /* ignore */ }
    };

    const openNewPostForm = () => {
      postForm.selectedTag = activeForum.value?.targetTags[0] || '';
      postForm.customTags  = '';
      postForm.title       = '';
      postForm.body        = '';
      postForm.error       = '';
      postForm.success     = '';
      postForm.hasDraft    = false;
      postPreview.value    = false;
      showNewPostForm.value = true;
      loadDraft();
      // Fetch current fee rates (once per session) and show initial estimate
      fetchFeeInfo().then(() => {
        postFeeEstimate.value = estimateTxFee(2, 0); // 2 ops: comment + comment_options
      });
    };
    const postForm = reactive({ title: '', body: '', loading: false, error: '', success: '', hasDraft: false, devTip: localStorage.getItem('blurtforum_devtip') !== 'false', beneficiary: { account: '', weight: '' }, selectedTag: '', customTags: '' });

    const payoutModal = reactive({ show: false, post: {}, beneficiaries: [] });
    const notifModal = reactive({ 
      show: false, 
      loading: false, 
      list: [], 
      lastReadId: parseInt(localStorage.getItem('bf_last_notif_id') || '0'),
      hasNew: false,
      clickedIds: JSON.parse(localStorage.getItem('bf_clicked_notif_ids') || '[]')
    });

    const globalActivity = ref([]);
    const activityExpanded = ref(true);
    const activityFullList = ref(false);
    const mobileActivityExpanded = ref(false);

    /**
     * updateGlobalActivity: Fetches recent activity from all subscribed communities.
     * Logic:
     * 1. Fetches up to 5 posts from each community, sorted by 'activity'.
     * 2. 'isRead' status is determined by comparing the post's 'last_activity' timestamp 
     *    against the value stored in localStorage (bf_read_status_v2).
     * 3. A post is considered READ if stored timestamp >= API last_activity timestamp.
     */
    const updateGlobalActivity = async () => {
      if (!auth.user || !userSubscriptions.value.length) return;
      
      const readStatus = JSON.parse(localStorage.getItem('bf_read_status_v2') || '{}');
      const allActivity = [];
      const currentUsername = auth.user.username;

      const subsToCheck = userSubscriptions.value.slice(0, 25);
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      for (const sub of subsToCheck) {
        try {
          const posts = await client.call('bridge', 'get_forum_posts', {
            community: sub.account,
            limit: 5,
            sort: 'activity'
          });
          
          if (posts && Array.isArray(posts)) {
            posts.forEach(p => {
              const activityTs = new Date(p.last_activity || p.created).getTime();
              
              // Skip items older than 7 days
              if (activityTs < sevenDaysAgo) return;

              const key = `${p.author}/${p.permlink}`;
              const lastReadTs = readStatus[key] || 0;
              const lastActAuthor = p.last_activity_author || p.author;
              
              // CRITICAL LOGIC: A post is read if our stored timestamp is exactly equal 
              // or greater than the API's reported last_activity timestamp.
              const isRead = !!(lastReadTs >= activityTs || (currentUsername && lastActAuthor === currentUsername));

              allActivity.push({
                id: p.post_id,
                author: lastActAuthor,
                title: p.title,
                created: p.last_activity || p.created,
                community: sub.account,
                community_title: sub.title,
                permlink: p.permlink,
                root_author: p.author,
                root_permlink: p.permlink,
                is_post: p.author === lastActAuthor && p.created === p.last_activity,
                isRead,
                lastActivityTs: activityTs // Store for use in markTopicAsRead
              });
            });
          }
        } catch (e) { /* silent fail */ }
      }
      
      allActivity.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
      
      const seen = new Set();
      globalActivity.value = allActivity.filter(a => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      }).slice(0, 30);
    };

    /**
     * markTopicAsRead: Updates the last read timestamp for a specific topic.
     * We store the 'last_activity' timestamp from the API to know exactly 
     * which state of the thread we have seen.
     */
    const markTopicAsRead = (topic) => {
      if (!topic) return;
      const readStatus = JSON.parse(localStorage.getItem('bf_read_status_v2') || '{}');
      
      const key = `${topic.author}/${topic.permlink}`;
      
      // CRITICAL: We take the maximum of current stored time, the topic's last activity,
      // or the specific lastActivityTs from the feed. This ensures we never "go back" 
      // in time and mark something as unread if we've already seen a newer state.
      const currentStored = readStatus[key] || 0;
      const incomingTs = topic.lastActivityTs || (topic.lastActivity ? new Date(topic.lastActivity).getTime() : Date.now());
      
      const finalTs = Math.max(currentStored, incomingTs, Date.now());
      
      readStatus[key] = finalTs;
      localStorage.setItem('bf_read_status_v2', JSON.stringify(readStatus));
      
      if (activeTopic.value && activeTopic.value.author === topic.author && activeTopic.value.permlink === topic.permlink) {
        activeTopic.value.isRead = true;
        activeTopic.value.isUnread = false;
      }
      
      // UI feedback: immediately update the global feed items without a new API call
      globalActivity.value.forEach(act => {
        if (act.root_author === topic.author && act.root_permlink === topic.permlink) {
          act.isRead = true;
        }
      });
    };

    const openActivity = (act) => {
      // Switch community context if different
      if (act.community !== config.communityAccount) {
        config.communityAccount = act.community;
        selectedCommunity.value = act.community;
        forumClient = new dblurt.Client([getForumUrl()]);
        client      = new dblurt.Client([getDataUrl()]);
        loadData();
      }
      
      // Mark as read using the exact timestamp from the activity item
      markTopicAsRead({ 
        author: act.root_author, 
        permlink: act.root_permlink,
        lastActivityTs: act.lastActivityTs 
      });

      // Set the target metadata for finding the specific comment in loadReplies
      if (!act.is_post) {
        targetNotifMatch.value = { author: act.author, ts: act.lastActivityTs };
      } else {
        targetNotifPermlink.value = act.permlink;
      }

      // Open the topic (root)
      openTopic({ author: act.root_author, permlink: act.root_permlink });
    };
    const oldContentModal = reactive({ show: false, loading: false, author: '', permlink: '', body: '', status: '', beneficiaries: [], originalPost: null });
    const imgModal = reactive({ show: false, src: '' });
    const openImgModal = (src) => {
      imgModal.src = src;
      imgModal.show = true;
    };
 
    const fmtDate = (s) => {
      if (!s) return '';
      try {
        return new Date(s.endsWith('Z') ? s : s + 'Z').toLocaleString();
      } catch (e) { return s || ''; }
    };

    const timeAgo = (s) => {
      if (!s) return '';
      try {
        const date = new Date(s.endsWith('Z') ? s : s + 'Z');
        const diff = Math.floor((Date.now() - date.getTime()) / 1000);
        
        // Correct unit lookup: ensure we use the translated unit and then append the 'ago' suffix
        if (diff < 60)     return `${diff}${t('secAgo') || 's'} ${t('ago') || 'ago'}`;
        if (diff < 3600)   return `${Math.floor(diff / 60)}${t('minAgo') || 'm'} ${t('ago') || 'ago'}`;
        if (diff < 86400)  return `${Math.floor(diff / 3600)}${t('hourAgo') || 'h'} ${t('ago') || 'ago'}`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}${t('dayAgo') || 'd'} ${t('ago') || 'ago'}`;
        return date.toLocaleDateString();
      } catch (e) { return ''; }
    };

    const forumHasUnread = (forum) => {
      const topPosts = forum.posts.slice(0, 5);
      if (topPosts.length === 0) return false;
      // If any of the top 5 are unread, category is unread
      return topPosts.some(p => p.isUnread);
    };
    const renderMD = renderMarkdown;
    const isNestedReply = (r) => {
      if (!activeTopic.value) return false;
      return !(r.parent_author === activeTopic.value.author &&
               r.parent_permlink === activeTopic.value.permlink);
    };
    const getParentBody = (r) => bodyCache[`${r.parent_author}/${r.parent_permlink}`] || '';
 
    const loadData = async (direction = 'current', targetForum = null) => {
      loading.value = true;
      structureNote.value = false;
      
      // Always try to refresh user rewards/VP when loading main data
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

        // Fetch Community Details (Nexus) - only on initial load
        if (direction === 'current' && !targetForum) {
          try {
            if (config.communityAccount.startsWith('blurt-')) {
              const cc = await forumClient.nexus.getCommunity(config.communityAccount);
              if (cc) {
                communityInfo.value = { title: cc.title || config.communityAccount, about: cc.about || '' };
                rawDescription.value = cc.description || '';
                
                let structureSource = cc.description || '';
                // Check for external config
                const extMatch = structureSource.match(/\[\[Forum config:(@?)([a-z0-9.-]+)\/([a-z0-9-]+)\]\]/i);
                if (extMatch) {
                  const author = extMatch[2];
                  const permlink = extMatch[3];
                  try {
                    const post = await client.condenser.getContent(author, permlink);
                    if (post && post.body) structureSource = post.body;
                  } catch (err) { console.warn('External config load error:', err); }
                }

                const parsed = parseStructure(structureSource);
                if (parsed) {
                  forumStructure.value = parsed;
                } else {
                  forumStructure.value = defaultStructure();
                  structureNote.value = true;
                }
                if (cc.team) moderators.value = cc.team.map(m => ({ account: m[0], role: m[1], title: m[2] || '' }));
              }
            } else {
              forumStructure.value = defaultStructure();
              structureNote.value = true;
            }
          } catch (e) {
            console.warn('Nexus getCommunity error:', e.message);
            if (!forumStructure.value.length) forumStructure.value = defaultStructure();
            structureNote.value = true;
          }

          // Accounts for title/about fallback
          try {
            const accounts = await client.condenser.getAccounts([config.communityAccount]);
            const acc = accounts && accounts[0];
            if (acc && (!communityInfo.value || !communityInfo.value.title)) {
              let meta = {};
              try { meta = JSON.parse(acc.posting_json_metadata || acc.json_metadata || '{}'); } catch (err) { /* ignore */ }
              const profile = meta.profile || {};
              communityInfo.value = { title: profile.name || acc.name, about: profile.about || '' };
            }
          } catch (e) { console.warn('Condenser getAccounts error:', e.message); }

          // Roles
          try {
            if (moderators.value.length === 0) {
              const roles = await forumClient.call('bridge', 'list_community_roles', { community: config.communityAccount });
              if (Array.isArray(roles) && roles.length > 0) moderators.value = roles.map(r => ({ account: r[0], role: r[1], title: r[2] || '' }));
            }
          } catch (e) { console.warn('Bridge list_community_roles error:', e.message); }

          // Ensure "Other" section exists and init forums
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
        const params = { community: config.communityAccount, limit: 21, sort: 'activity' };
        
        if (direction === 'next' && pag.lastAuthor) {
          pag.pageHistory.push({ author: pag.lastAuthor, permlink: pag.lastPermlink });
        } else if (direction === 'prev') {
          pag.pageHistory.pop(); // pop current page
          const prev = pag.pageHistory.pop(); // get previous page cursor
          if (prev) {
            params.start_author = prev.author;
            params.start_permlink = prev.permlink;
          } else {
            params.start_author = undefined;
            params.start_permlink = undefined;
          }
        } else if (pag.lastAuthor) {
          params.start_author = pag.lastAuthor;
          params.start_permlink = pag.lastPermlink;
        }

        if (targetForum && targetForum.targetTags.length > 0) params.tags_any = targetForum.targetTags;

        let rawPosts = [];
        const vf = targetForum ? VIRTUAL_FORUMS.find(v => v.id === targetForum.id) : null;
        
        if (vf) {
          const apiParams = {
            limit: 21,
            start_author: params.start_author,
            start_permlink: params.start_permlink
          };
          
          if (vf.id === 'user-feed' && auth.user) {
            rawPosts = await forumClient.call('bridge', 'get_account_posts', { ...apiParams, account: auth.user.username, sort: 'feed' });
          } else if (vf.id === 'global-trending') {
            rawPosts = await forumClient.call('bridge', 'get_ranked_posts', { ...apiParams, sort: 'trending' });
          } else if (vf.id === 'global-new') {
            rawPosts = await forumClient.call('bridge', 'get_ranked_posts', { ...apiParams, sort: 'created' });
          } else if (vf.id === 'global-activity') {
            rawPosts = await forumClient.call('bridge', 'get_forum_posts', { ...apiParams, community: '', sort: 'activity' });
          }
        } else {
          rawPosts = await forumClient.call('bridge', 'get_forum_posts', params);
        }

        if (!rawPosts || rawPosts.length === 0) {
          pag.hasMore = false;
          if (targetForum) targetForum.posts = [];
        } else {
          if (targetForum) targetForum.posts = []; // Clear for page-based view
          
          processBatch(rawPosts, null, targetForum);
          
          const lastItem = rawPosts[rawPosts.length - 1];
          pag.lastAuthor = lastItem.author;
          pag.lastPermlink = lastItem.permlink;
          pag.hasMore = rawPosts.length >= 20; // 21st item check not needed if we don't slice
        }
 
      } catch (err) {
        console.error('loadData error:', err);
        structureNote.value = true;
      } finally {
        loading.value = false;
      }
    };

    const nextPage = () => {
      if (activeForum.value) loadData('next', activeForum.value);
    };
    const prevPage = () => {
      if (activeForum.value) loadData('prev', activeForum.value);
    };

    const getNotifIcon = (type) => {
      const icons = {
        reply: '💬',
        reply_comment: '💬',
        vote: '👍',
        mention: '🔔',
        follow: '👤',
        reblog: '🔄',
        transfer: '💰',
        witness_vote: '🗳️'
      };
      return icons[type] || '🔵';
    };

    const normalizePost = (p) => {
      let tags = [];
      try { 
        const meta = typeof p.json_metadata === 'string' ? JSON.parse(p.json_metadata || '{}') : p.json_metadata;
        if (meta && meta.tags) tags = meta.tags;
      } catch (e) { /* ignore */ }
      
      const pending = parsePayout(p.pending_payout_value || 0);
      const total = parsePayout(p.total_payout_value || 0);
      const bridgePayout = typeof p.payout === 'number' ? p.payout : parsePayout(p.payout || 0);

      const readStatus = JSON.parse(localStorage.getItem('bf_read_status_v2') || '{}');
      const lastReadTs = readStatus[`${p.author}/${p.permlink}`] || 0;
      
      // Use last_activity for comparison, falling back to created
      const activityTs = new Date(p.last_activity || p.created).getTime();
      
      // Post is read if our recorded timestamp is >= last activity
      // OR if we are the author of the last activity
      const lastActAuthor = p.last_activity_author || p.author;
      const currentUsername = auth.user ? auth.user.username : null;
      
      const isRead = !!(lastReadTs >= activityTs || (currentUsername && lastActAuthor === currentUsername));
      const isUnread = !isRead;
      const isFollowing = currentUsername && followingSet.value.has(p.author);

      // Muting logic
      const isMuted = p.stats?.is_muted || p.stats?.hide || false;

      // Payout status logic: on Blurt content pays out after 7 days.
      const createdDate = new Date(p.created.endsWith('Z') ? p.created : p.created + 'Z');
      const now = new Date();
      const ageDays = (now - createdDate) / (1000 * 60 * 60 * 24);
      
      let isPaid = total > 0 || ageDays > 7.5; 
      if (p.cashout_time && p.cashout_time.startsWith('1970')) isPaid = true;

      // Auto-collapse support comments
      const isCollapsed = p.body && p.body.startsWith('Supporting original content by @');

      return {
        author: p.author,
        permlink: p.permlink,
        title: p.title || '(no title)',
        body: p.body,
        created: p.created,
        url: p.url, 
        category: p.category, 
        lastActivity: p.last_activity || p.created,
        lastAuthor: p.last_activity_author || p.author,
        isUnread,
        isRead,
        isFollowing,
        isMuted,        isPaid,
        isCollapsed,
        replyCount: p.reply_count || 0,
        parent_author: p.parent_author || '',
        parent_permlink: p.parent_permlink || '',
        pendingPayout: pending,
        totalPayout: total,
        payout: bridgePayout || (pending + total),
        vote_count: p.active_votes ? p.active_votes.length : (p.net_votes || 0),
        active_votes: p.active_votes || [],
        net_rshares: parseFloat(p.net_rshares || 0),
        beneficiaries: p.beneficiaries || [],
        json_metadata: p.json_metadata,
        tags
      };
    };

    const explorationForm = reactive({ forums: [...VIRTUAL_FORUMS], loading: false });
    const explorationExpanded = ref(localStorage.getItem('bf_exploration_expanded') === 'true');
    
    const toggleExploration = async () => {
      explorationExpanded.value = !explorationExpanded.value;
      localStorage.setItem('bf_exploration_expanded', explorationExpanded.value);
      if (explorationExpanded.value) {
        // Load some preview data for virtual forums
        explorationForm.loading = true;
        for (const vf of explorationForm.forums) {
          if (vf.auth && !auth.user) continue;
          try {
            const apiParams = { limit: 1 };
            let raw = [];
            if (vf.id === 'user-feed') raw = await forumClient.call('bridge', 'get_account_posts', { ...apiParams, account: auth.user.username, sort: 'feed' });
            else if (vf.id === 'global-trending') raw = await forumClient.call('bridge', 'get_ranked_posts', { ...apiParams, sort: 'trending' });
            else if (vf.id === 'global-new') raw = await forumClient.call('bridge', 'get_ranked_posts', { ...apiParams, sort: 'created' });
            else if (vf.id === 'global-activity') raw = await forumClient.call('bridge', 'get_forum_posts', { ...apiParams, community: '', sort: 'activity' });
            
            if (raw && raw.length > 0) {
              vf.posts = [normalizePost(raw[0])];
            } else {
              vf.posts = [];
            }
          } catch (e) { vf.posts = []; }
        }
        explorationForm.loading = false;
      }
    };

    const isPostInCommunity = (post) => {
      if (!post || !post.category) return false;
      return post.category === config.communityAccount;
    };

    const loadTopicContext = async () => {
      if (!activeTopic.value || !activeTopic.value.parent_author) return;
      loading.value = true;
      try {
        const url = activeTopic.value.url;
        if (url) {
          const parts = url.split('#')[0].split('/');
          // Bridge API url usually: /category/@author/permlink
          if (parts.length >= 4) {
            const rootAuthor = parts[2].replace('@', '');
            const rootPermlink = parts[3];
            const root = await client.condenser.getContent(rootAuthor, rootPermlink);
            if (root && root.author) {
              openTopic(normalizePost(root));
            }
          }
        }
      } catch (err) {
        console.error('Load context error:', err);
      }
      loading.value = false;
    };

    const processBatch = (slice, catchAllForum, targetForum = null) => {
      if (slice.length === 0) return;

      slice.forEach(p => {
        const post = normalizePost(p);
        bodyCache[`${p.author}/${p.permlink}`] = p.body;

        // Skip muted posts if not a moderator/admin
        if (post.isMuted && !canMute.value) return;

        if (targetForum) {
           if (!targetForum.posts.find(fp => fp.permlink === post.permlink && fp.author === post.author)) {
             targetForum.posts.push(post);
           }
           return;
        }

        let assignedCount = 0;
        for (const cat of forumStructure.value) {
          for (const forum of cat.forums) {
            if (forum === catchAllForum) continue;
            const targetTags = forum.targetTags.map(t => t.toLowerCase());
            const postTags = post.tags.map(t => t.toLowerCase());
            if (targetTags.length > 0 && targetTags.some(tag => postTags.includes(tag))) {
              if (!forum.posts.find(fp => fp.permlink === post.permlink && fp.author === post.author)) {
                forum.posts.push(post);
              }
              assignedCount++;
            }
          }
        }

        if (assignedCount === 0 && catchAllForum) {
          if (!catchAllForum.posts.find(fp => fp.permlink === post.permlink && fp.author === post.author)) {
            catchAllForum.posts.push(post);
          }
        }
      });
    };

    const loadMorePosts = async () => {
      if (!activeForum.value) return;
      
      let attempts = 0;
      while (attempts < 5) {
        if (activeForum.value.posts.length > forumPagination.visibleCount) {
          forumPagination.visibleCount += 10;
          return;
        }
        
        if (!activeForum.value.hasMore) return;
        
        const prevCount = activeForum.value.posts.length;
        await loadData(true, activeForum.value);
        attempts++;
        
        if (activeForum.value.posts.length > prevCount) {
          forumPagination.visibleCount += 10;
          return;
        }
      }
    };
 
    const loadReplies = async (author, permlink, keepState = false) => {
      if (!keepState) {
        repliesLoading.value = true;
        // Keep pending comments even when clearing the list for refresh
        replies.value = replies.value.filter(r => r._pending);
        replyTarget.value = null;
      }
      const flat = [];
      const recurse = async (pAuthor, pPermlink, depth) => {
        let results;
        try {
          results = await client.condenser.getContentReplies(pAuthor, pPermlink);
        } catch (e) { return; }
        if (!results || !results.length) return;
        for (const r of results) {
          bodyCache[`${r.author}/${r.permlink}`] = r.body;
          flat.push({
            ...normalizePost(r),
            depth,
            _qOpen: false
          });
          if (r.children > 0) await recurse(r.author, r.permlink, depth + 1);
        }
      };
      await recurse(author, permlink, 1);
      
      // Preserve pending comments that aren't on the server yet
      const pendingOnes = replies.value.filter(r => r._pending);
      const serverIds = new Set(flat.map(r => (r.author + '/' + r.permlink).toLowerCase()));
      const stillPending = pendingOnes.filter(p => !serverIds.has((p.author + '/' + p.permlink).toLowerCase()));
      
      replies.value = [...flat, ...stillPending].sort((a, b) => new Date(a.created) - new Date(b.created));
      
      // If we are looking for a specific comment by author/timestamp (from Activity Feed)
      if (targetNotifMatch.value) {
        const match = flat.find(r => r.author === targetNotifMatch.value.author && new Date(r.created).getTime() === targetNotifMatch.value.ts);
        if (match) {
          targetNotifPermlink.value = match.permlink;
        }
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
              setTimeout(() => { el.classList.remove('highlighted-post'); }, 3000);
            }
            targetNotifPermlink.value = null;
          });
        }
      }    };
 
    const syncUrl = () => {
      const params = new URLSearchParams();
      params.set('community', config.communityAccount);
      if (view.value !== 'index') params.set('view', view.value);
      
      if (view.value === 'forum' && activeForum.value) {
        params.set('forum', activeForum.value.id);
      } else if (view.value === 'topic' && activeTopic.value) {
        params.set('author', activeTopic.value.author);
        params.set('permlink', activeTopic.value.permlink);
      } else if (view.value === 'profile' && profileUser.username) {
        params.set('user', profileUser.username);
      }

      const newUrl = window.location.pathname + '?' + params.toString();
      window.history.pushState({ path: newUrl }, '', newUrl);
    };

    const goHome = () => {
      view.value = 'index';
      activeForum.value = null;
      activeTopic.value = null;
      replies.value = [];
      showNewPostForm.value = false;
      syncUrl();
    };
 
    const openForum = (forum) => {
      // Reset pagination to start from page 1
      forum.lastAuthor = "";
      forum.lastPermlink = "";
      forum.pageHistory = [];
      forum.hasMore = true;

      // Handle Virtual Forums (Global Sections)
      const isVirtual = VIRTUAL_FORUMS.find(vf => vf.id === forum.id);
      
      if (!isVirtual) {
        localStorage.setItem('bf_last_forum_id', forum.id);
        localStorage.setItem('bf_last_community', config.communityAccount);
      } else {
        // Clear community context for global views if desired, or keep it?
        // Let's keep it for now but maybe show a breadcrumb for global.
      }

      activeForum.value = forum;
      view.value = "forum";
      activeTopic.value = null;
      showNewPostForm.value = false;
      syncUrl();
      loadData("current", forum);
    };
 
    const openTopic = async (topic) => {
      // If topic is just a stub (from activity feed), fetch full content first
      if (!topic.payout && !topic.body) {
        loading.value = true;
        try {
          const full = await client.condenser.getContent(topic.author, topic.permlink);
          if (full && full.author) {
            topic = normalizePost(full);
          }
        } catch (e) { console.error('Error fetching full topic:', e); }
        loading.value = false;
      }

      activeTopic.value = { ...topic, beneficiaries: topic.beneficiaries || [] };
      bodyCache[`${topic.author}/${topic.permlink}`] = topic.body;
      view.value = 'topic';
      loadReplies(topic.author, topic.permlink);
      syncUrl();

      markTopicAsRead(activeTopic.value);

      // Fetch full content in background to get beneficiaries if still missing
      if (!topic.beneficiaries || !topic.beneficiaries.length) {
        client.condenser.getContent(topic.author, topic.permlink).then(full => {
          if (full && full.beneficiaries && full.beneficiaries.length && activeTopic.value && activeTopic.value.permlink === topic.permlink) {
            activeTopic.value = { ...activeTopic.value, beneficiaries: full.beneficiaries };
          }
        }).catch(() => {});
      }
    };

    const openProfile = async (username) => {
      profileUser.username = username;
      profileUser.loading = true;
      profileUser.data = null;
      profileUser.posts = [];
      profileUser.comments = [];
      view.value = 'profile';
      syncUrl();

      try {
        const [accounts, followCount] = await Promise.all([
          client.condenser.getAccounts([username]),
          client.call('condenser_api', 'get_follow_count', [username])
        ]);

        if (accounts && accounts[0]) {
          const acc = accounts[0];
          profileUser.data = acc;
          if (followCount) {
            profileUser.data.followerCount = followCount.follower_count;
            profileUser.data.followingCount = followCount.following_count;
          }

          const ratio = (parseFloat(globalProps.value.total_vesting_fund_blurt || 0) / 
                         parseFloat(globalProps.value.total_vesting_shares || 1));
          
          const bp = parseFloat(acc.vesting_shares || 0) * ratio;
          const delegatedIn = parseFloat(acc.received_vesting_shares || 0) * ratio;
          const delegatedOut = parseFloat(acc.delegated_vesting_shares || 0) * ratio;
          
          profileUser.data.bp = bp.toFixed(3);
          profileUser.data.delegatedIn = delegatedIn.toFixed(3);
          profileUser.data.delegatedOut = delegatedOut.toFixed(3);
          profileUser.data.totalBP = (bp + delegatedIn - delegatedOut).toFixed(3);
          profileUser.data.walletValue = (parseFloat(acc.balance || 0) + bp).toFixed(3);
          
          try {
            const meta = JSON.parse(acc.posting_json_metadata || acc.json_metadata || '{}');
            const p = meta.profile || {};
            profileUser.data.about = p.about || '';
            profileUser.data.website = p.website || '';
            profileUser.data.location = p.location || '';
            profileUser.data.displayName = p.name || acc.name;
          } catch (e) { /* ignore */ }
        }

        const history = await client.condenser.getDiscussions('blog', { tag: username, limit: 20 });
        profileUser.posts = history.filter(p => p.author === username).map(normalizePost);
        
        const comments = await client.call('bridge', 'get_account_posts', { account: username, sort: 'comments', limit: 20 });
        if (comments) {
          profileUser.comments = comments.map(normalizePost);
        }
      } catch (err) {
        console.error('Profile error:', err);
      }
      profileUser.loading = false;
    };
 
    const switchCommunity = (account) => {
      if (!account) return;
      config.communityAccount = account;
      // If it's in our known list, select it. Otherwise use 'custom'.
      const found = allCommunities.value.find(c => c.account === account);
      if (found) {
        selectedCommunity.value = account;
      } else {
        selectedCommunity.value = 'custom';
        customTag.value = account;
      }
      forumClient = new dblurt.Client([getForumUrl()]);
      client      = new dblurt.Client([getDataUrl()]);
      goHome();
      loadData();
    };

    const handleCommunityChange = () => {
      const tag = selectedCommunity.value === 'custom' ? customTag.value.trim() : selectedCommunity.value;
      switchCommunity(tag);
    };

    const broadcastKey = async (ops) => {
      const privKey = dblurt.PrivateKey.from(auth.user.key);
      await client.broadcast.sendOperations(ops, privKey);
    };
    const broadcastWV = async (ops) => {
      return new Promise((resolve, reject) => {
        if (!window.blurt_keychain) {
          reject(new Error('WhaleVault polyfill not available'));
          return;
        }
        window.blurt_keychain.requestBroadcast(auth.user.username, ops, 'posting', (res) => {
          if (res && res.success) resolve(res);
          else reject(new Error(res ? res.message : 'WhaleVault broadcast error'));
        });
      });
    };

    const broadcast = (ops) => auth.user.type === 'key' ? broadcastKey(ops) : broadcastWV(ops);

    const loadFollowingList = async (username) => {
      if (!username) return;
      try {
        // Fetch up to 1000 following (should be enough for most users)
        const following = await client.call('condenser_api', 'get_following', [username, '', 'blog', 1000]);
        if (following && Array.isArray(following)) {
          followingSet.value = new Set(following.map(f => f.following));
        }
      } catch (e) { console.warn('Error loading following list:', e); }
    };

    const toggleFollow = async (targetAuthor) => {
      if (!auth.user) { openLoginModal(); return; }
      if (checkLock(() => toggleFollow(targetAuthor))) return;

      const isFollowing = followingSet.value.has(targetAuthor);
      const op = ['custom_json', {
        required_auths: [],
        required_posting_auths: [auth.user.username],
        id: 'follow',
        json: JSON.stringify(['follow', {
          follower: auth.user.username,
          following: targetAuthor,
          what: isFollowing ? [] : ['blog']
        }])
      }];

      try {
        await broadcast([op]);
        const newSet = new Set(followingSet.value);
        if (isFollowing) {
          newSet.delete(targetAuthor);
        } else {
          newSet.add(targetAuthor);
        }
        followingSet.value = newSet;
      } catch (err) {
        console.error('Follow error:', err);
        showStatus('Social', 'Error updating follow status: ' + err.message, 'error');
      }
    };

    // ── Image upload to img-upload.blurt.blog ──────────────────────────────
    // Protocol: POST https://img-upload.blurt.blog/{username}/{sig}
    // sig = hex(secp256k1_sign(sha256(fileBytes), postingKey))
    const uploadImageFile = async (file) => {
      if (!auth.user) throw new Error('Not logged in');
      // Protocol: SHA256("ImageSigningChallenge" + fileBytes) signed with posting key
      // Signature must be 65 bytes (130 hex) including recovery byte
      const arrayBuf = await file.arrayBuffer();
      const fileBytes = new Uint8Array(arrayBuf);
      const prefix = new TextEncoder().encode('ImageSigningChallenge');
      const combined = new Uint8Array(prefix.length + fileBytes.length);
      combined.set(prefix, 0);
      combined.set(fileBytes, prefix.length);
      // SHA-256 via CryptoJS (works on HTTP too, unlike crypto.subtle)
      const wordArray = CryptoJS.lib.WordArray.create(combined);
      const hashHex = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
      console.log('Upload Hash:', hashHex);
      const hashBytes = new Uint8Array(hashHex.match(/.{2}/g).map(b => parseInt(b, 16)));

      let sigHex;
      if (auth.user.type === 'key') {
        const privKey = dblurt.PrivateKey.from(auth.user.key);
        const sig = privKey.sign(hashBytes);
        // Keep full 65-byte signature (130 hex) including recovery byte
        sigHex = typeof sig.toString === 'function' ? sig.toString() : Array.from(sig).map(b => b.toString(16).padStart(2,'0')).join('');
        console.log('Private Key Sig:', sigHex);
      } else {
        // WhaleVault: sign using the Buffer-JSON format convention
        // This tells the keychain to treat the string as binary data, hash it, and sign it.
        sigHex = await new Promise((resolve, reject) => {
          if (!window.blurt_keychain) { reject(new Error('WhaleVault not available')); return; }
          
          const bufferObject = {
            type: 'Buffer',
            data: Array.from(combined)
          };
          const bufJson = JSON.stringify(bufferObject);

          window.blurt_keychain.requestSignBuffer(auth.user.username, bufJson, 'posting', (res) => {
            if (res && res.success) {
              let result = res.result;
              if (typeof result === 'string') {
                // Strip any suffix like :0 or :1
                result = result.split(':')[0];

                // Convert EOS-style signature (SIG_K1_...) to hex if needed
                if (result.startsWith('SIG_K1_')) {
                  try {
                    result = dblurt.Signature.fromString(result).toString();
                  } catch (e) { console.warn('Signature conversion error:', e); }
                }
              }
              console.log('WhaleVault Sig (Buffer-JSON):', result);
              resolve(result || '');
            }
            else reject(new Error(res ? res.message : 'WV sign error'));
          });
        });
      }

      const url = `https://img-upload.blurt.blog/${auth.user.username}/${sigHex}`;
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(url, { method: 'POST', body: formData });
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
      const data = await resp.json();
      // blurt returns { url: "https://..." }
      if (!data.url) throw new Error('No URL in response: ' + JSON.stringify(data));
      return data.url;
    };

    const insertImageIntoBody = (textareaRef, imgUrl) => {
      const md = `\n![image](${imgUrl})\n`;
      if (textareaRef === 'post') {
        postForm.body += md;
        saveDraft();
      } else {
        replyForm.body += md;
      }
    };

    const handleImageUpload = async (file, target) => {
      if (checkLock(() => handleImageUpload(file, target))) return;
      if (!file || !file.type.startsWith('image/')) return;
      const key = target === 'post' ? 'postImgUploading' : 'replyImgUploading';
      try {
        window[key] = true;
        const imgUrl = await uploadImageFile(file);
        insertImageIntoBody(target, imgUrl);
      } catch (err) {
        console.error('Image upload error:', err);
        if (target === 'post') postForm.error = 'Image upload failed: ' + err.message;
        else replyForm.error = 'Image upload failed: ' + err.message;
      } finally {
        window[key] = false;
      }
    };
    // Expose for template event handlers
    const postImgUpload = ref(false);
    const replyImgUpload = ref(false);
    const onPostImagePick = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      postImgUpload.value = true;
      try { await handleImageUpload(file, 'post'); } finally { postImgUpload.value = false; }
    };
    const onReplyImagePick = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      replyImgUpload.value = true;
      try { await handleImageUpload(file, 'reply'); } finally { replyImgUpload.value = false; }
    };
    const onPostPaste = async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          postImgUpload.value = true;
          try { await handleImageUpload(file, 'post'); } finally { postImgUpload.value = false; }
          break;
        }
      }
    };
    const onReplyPaste = async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          replyImgUpload.value = true;
          try { await handleImageUpload(file, 'reply'); } finally { replyImgUpload.value = false; }
          break;
        }
      }
    };
    // ──────────────────────────────────────────────────────────────────────

    const claimRewards = async () => {
      if (checkLock(claimRewards)) return;
      if (!auth.user) return;
      try {
        const accounts = await client.condenser.getAccounts([auth.user.username]);
        const acc = accounts && accounts[0];
        if (!acc) return;

        if (parsePayout(acc.reward_blurt_balance) === 0 && parsePayout(acc.reward_vesting_balance) === 0) {
          showStatus(t('claimRewards'), t('noRewardsToClaim'), 'info');
          return;
        }

        const fmtAsset = (val, unit) => {
          if (!val) return unit === 'BLURT' ? '0.000 BLURT' : '0.000000 VESTS';
          if (val.includes(' ')) return val; // already formatted
          const num = parseFloat(val) || 0;
          return unit === 'BLURT' ? num.toFixed(3) + ' BLURT' : num.toFixed(6) + ' VESTS';
        };

        const ops = [
          ['claim_reward_balance', {
            account: auth.user.username,
            reward_blurt: fmtAsset(acc.reward_blurt_balance, 'BLURT'),
            reward_vests: fmtAsset(acc.reward_vesting_balance, 'VESTS')
          }]
        ];
        
        // Use 'posting' key for claiming rewards
        await broadcast(ops);
        await refreshUser();
        showStatus(t('claimRewards'), t('claimSuccess'), 'success');
      } catch (err) {
        console.error('Claim rewards error:', err);
        showStatus(t('claimRewards'), (t('claimError') || 'Error claiming rewards: ') + (err.message || err), 'error');
      }
    };
 
    const startReply = (target) => {
      replyTarget.value = target;
      replyForm.body = '';
      replyForm.error = '';
      replyForm.success = '';
      // Fetch current fee rates (once per session) and show initial estimate
      fetchFeeInfo().then(() => {
        replyFeeEstimate.value = estimateTxFee(2, 0); // 2 ops: comment + comment_options
      });
    };

    // ── Blockchain wait queue ───────────────────────────────────────────────
    const bcWaitQueue = ref([]);
    const bcQueueExpanded = ref(false);
    let _bcId = 0;

    const refreshUser = async () => {
      if (!auth.user) return;
      try {
        const accounts = await client.condenser.getAccounts([auth.user.username]);
        if (accounts && accounts[0]) {
          const acc = accounts[0];
          const lastVoteTime = new Date(acc.last_vote_time + 'Z').getTime();
          const now = new Date().getTime();
          const delta = (now - lastVoteTime) / 1000;
          let vp = acc.voting_power + (10000 * delta / 432000);
          vp = Math.min(vp / 100, 100).toFixed(2);
          const hasRewards = parsePayout(acc.reward_blurt_balance) > 0 || parsePayout(acc.reward_vesting_balance) > 0;
          auth.user = { 
            ...auth.user, 
            vp, hasRewards, 
            rewardBlurt: acc.reward_blurt_balance, 
            rewardVesting: acc.reward_vesting_balance 
          };
        }
      } catch (e) { console.warn('Refresh user error:', e); }
    };

    const waitAndReload = async (isTopic, author = null, permlink = null, pollFn = null, label = null) => {
      const id = ++_bcId;
      const entry = reactive({ id, label: label || t('waitingForBlock'), progress: 0 });
      bcWaitQueue.value.push(entry);

      const maxMs = 90000;
      const pollMs = 3000;
      const start = Date.now();
      let lastContent = null;
      let found = false;

      const isReal = (c) => c && c.author && c.body && c.body.trim().length > 0 && c.created !== '1970-01-01T00:00:00';

      // True when we're waiting for a comment that should appear in replies (not the root post itself)
      const isWaitingForReply = author && permlink && isTopic && activeTopic.value &&
        !(author === activeTopic.value.author && permlink === activeTopic.value.permlink);

      if (author && permlink) {
        // Stage 2: syncing (Wait for it to appear in basic getContent)
        const opt = replies.value.find(r => r._pending && r.author === author && r.permlink === permlink);
        if (opt) opt._pending = 'syncing';

        while (Date.now() - start < maxMs) {
          entry.progress = Math.min(((Date.now() - start) / maxMs) * 85, 85);
          await new Promise(r => setTimeout(r, pollMs));

          try {
            const c = await client.condenser.getContent(author, permlink);
            if (isReal(c)) {
              lastContent = c;
              if (!pollFn || pollFn(c)) {
                found = true;
                break;
              }
            }
          } catch (e) { /* ignore */ }

          if (!found) {
            entry.label = t('syncingWithBlockchain') || 'Waiting for data node synchronization…';
          }
        }

        // Stage 3: indexing (Wait for it to appear in replies list/RPC index)
        if (found && opt) opt._pending = 'indexing';
        
        if (!found) {
          entry.progress = 88;
          entry.label = 'Still syncing… final attempt';
          await new Promise(r => setTimeout(r, 10000));
          try {
            const c = await client.condenser.getContent(author, permlink);
            if (isReal(c)) { lastContent = c; found = true; }
          } catch (e) { /* ignore */ }
        }
      } else {
        // No content to poll – just wait for a couple of blocks
        while (Date.now() - start < 4000) {
          entry.progress = Math.min(((Date.now() - start) / 4000) * 85, 85);
          await new Promise(r => setTimeout(r, 300));
        }
      }

      entry.progress = 92;

      if (isTopic && activeTopic.value) {
        // For a new reply: keep retrying loadReplies until the comment actually appears
        // in getContentReplies (RPC replication lag can be several seconds after getContent confirms it)
        const maxReplyRetries = isWaitingForReply ? 15 : 1;
        const retryDelayMs = 4000;
        let retries = 0;

        while (retries < maxReplyRetries) {
          await loadReplies(activeTopic.value.author, activeTopic.value.permlink, true);
          entry.progress = 92 + Math.min((retries / maxReplyRetries) * 6, 6);

          if (isWaitingForReply) {
            // MUST check for non-pending version to confirm indexing (case-insensitive)
            const targetId = (author + '/' + permlink).toLowerCase();
            const existsOnServer = replies.value.some(r => !r._pending && (r.author + '/' + r.permlink).toLowerCase() === targetId);
            
            if (existsOnServer) break;
            
            if (retries < maxReplyRetries - 1) {
              entry.label = `${t('indexing') || 'Indexing…'} (${retries + 1}/${maxReplyRetries})`;
            }
            retries++;
            await new Promise(r => setTimeout(r, retryDelayMs));
          } else {
            break;
          }
        }
        
        // Final fallback: if we timed out, remove the pending status so it doesn't hang forever
        const finalCheckId = (author + '/' + permlink).toLowerCase();
        const pendingRef = replies.value.find(r => r._pending && (r.author + '/' + r.permlink).toLowerCase() === finalCheckId);
        if (pendingRef) {
          // If we never found it on server after 15 retries, we still keep it but stop the 'indexing' animation
          // or we can remove it if we suspect it failed. Better to just stop the animation.
          delete pendingRef._pending; 
        }
      }

      // Refresh the root post content (vote counts etc.)
      if (lastContent && activeTopic.value &&
          lastContent.author === activeTopic.value.author &&
          lastContent.permlink === activeTopic.value.permlink) {
        activeTopic.value = { ...activeTopic.value, ...normalizePost(lastContent) };
        markTopicAsRead(activeTopic.value);
      } else if (activeTopic.value) {
        try {
          const fresh = await client.condenser.getContent(activeTopic.value.author, activeTopic.value.permlink);
          if (isReal(fresh)) {
            activeTopic.value = { ...activeTopic.value, ...normalizePost(fresh) };
            markTopicAsRead(activeTopic.value);
          }
        } catch (e) { /* ignore */ }
      }

      entry.progress = 100;
      await refreshUser();
      await new Promise(r => setTimeout(r, 800));
      const idx = bcWaitQueue.value.findIndex(e => e.id === id);
      if (idx >= 0) bcWaitQueue.value.splice(idx, 1);
      // Collapse the expand state once queue empties
      if (bcWaitQueue.value.length === 0) bcQueueExpanded.value = false;
    };
    // ───────────────────────────────────────────────────────────────────────
 
    const submitReply = async () => {
      if (checkLock(submitReply)) return;
      if (!auth.user || !replyTarget.value) return;
      const body = replyForm.body.trim();
      if (!body) { replyForm.error = 'Reply cannot be empty.'; return; }
      replyForm.loading = true;
      replyForm.error = '';
      replyForm.success = '';

      const beneficiaries = [{ account: config.communityAccount, weight: 300 }];
      if (postForm.devTip) beneficiaries.push({ account: 'dotevo', weight: 100 });
      if (replyForm.beneficiary.account.trim()) {
        const w = Math.min(Math.max(Math.round(parseFloat(replyForm.beneficiary.weight) * 100) || 0, 1), 10000);
        if (w > 0) beneficiaries.push({ account: replyForm.beneficiary.account.trim(), weight: w });
      }
      beneficiaries.sort((a, b) => a.account.localeCompare(b.account));

      const op = ['comment', {
        parent_author: replyTarget.value.author,
        parent_permlink: replyTarget.value.permlink,
        author: auth.user.username,
        permlink: genPermlink('re-' + replyTarget.value.author),
        title: '',
        body,
        json_metadata: JSON.stringify({
          app: 'blurtforum/1.0',
          tags: [config.communityAccount],
          format: 'markdown'
        })
      }];

      const beneficiaryExt = [[0, { beneficiaries }]];

      const options = ['comment_options', {
        author: auth.user.username,
        permlink: op[1].permlink,
        max_accepted_payout: '1000000.000 BLURT',
        percent_steem_dollars: 10000,
        allow_votes: true,
        allow_curation_rewards: true,
        extensions: beneficiaryExt
      }];

      try {
        await broadcast([op, options]);
        replyForm.success = t('replySuccess');

        // ── Optimistic UI ──────────────────────────────────────────────────
        // Show the comment immediately while the blockchain confirms it.
        // waitAndReload will later replace this with the real on-chain data.
        const parentPermlink = op[1].parent_permlink;
        const parentReply    = replies.value.find(r => r.permlink === parentPermlink);
        const optimisticDepth = parentReply ? parentReply.depth + 1 : 1;
        const optimistic = {
          author:         auth.user.username,
          permlink:       op[1].permlink,
          parent_author:  op[1].parent_author,
          parent_permlink: parentPermlink,
          body,
          created:        new Date().toISOString().slice(0, 19),
          depth:          optimisticDepth,
          pendingPayout:  0, totalPayout: 0, payout: 0,
          vote_count:     0, active_votes: [], net_rshares: 0,
          beneficiaries:  [],
          _qOpen:         false,
          _pending:       'sending'
        };
        replies.value = [...replies.value, optimistic];
        // ──────────────────────────────────────────────────────────────────

        replyForm.body = '';
        replyTarget.value = null;
        
        await waitAndReload(true, auth.user.username, op[1].permlink);
      } catch (err) {
        console.error('Reply error:', err);
        replyForm.error = t('replyError') + ' (' + (err.message || '') + ')';
      }
      replyForm.loading = false;
    };
 
    const submitPost = async () => {
      if (checkLock(submitPost)) return;
      if (!auth.user || !activeForum.value) return;
      const title = postForm.title.trim();
      const body  = postForm.body.trim();
      if (!title || !body) { postForm.error = 'Title and body are required.'; return; }
      postForm.loading = true;
      postForm.error = '';
      postForm.success = '';

      // Build tags: community account is always first, then the one selected forum tag,
      // then any custom tags the user typed — max 5 total.
      const customTagsList = postForm.customTags
        .split(',')
        .map(s => s.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
        .filter(Boolean);
      const tags = [config.communityAccount];
      if (postForm.selectedTag && !tags.includes(postForm.selectedTag)) tags.push(postForm.selectedTag);
      for (const ct of customTagsList) {
        if (tags.length >= 5) break;
        if (!tags.includes(ct)) tags.push(ct);
      }

      const beneficiaries = [{ account: config.communityAccount, weight: 300 }];
      if (postForm.devTip) beneficiaries.push({ account: 'dotevo', weight: 100 });
      if (postForm.beneficiary.account.trim()) {
        const w = Math.min(Math.max(Math.round(parseFloat(postForm.beneficiary.weight) * 100) || 0, 1), 10000);
        if (w > 0) beneficiaries.push({ account: postForm.beneficiary.account.trim(), weight: w });
      }
      beneficiaries.sort((a, b) => a.account.localeCompare(b.account));

      const op = ['comment', {
        parent_author: '',
        parent_permlink: config.communityAccount,
        author: auth.user.username,
        permlink: genPermlink(title),
        title,
        body,
        json_metadata: JSON.stringify({
          app: 'blurtforum/1.0',
          tags,
          format: 'markdown',
          community: config.communityAccount
        })
      }];

      const beneficiaryExtPost = [[0, { beneficiaries }]];

      const options = ['comment_options', {
        author: auth.user.username,
        permlink: op[1].permlink,
        max_accepted_payout: '1000000.000 BLURT',
        percent_steem_dollars: 10000,
        allow_votes: true,
        allow_curation_rewards: true,
        extensions: beneficiaryExtPost
      }];

      try {
        await broadcast([op, options]);
        postForm.title = '';
        postForm.body = '';
        clearDraft();
        showNewPostForm.value = false;
        showStatus(t('newPost'), t('postSuccess'), 'success');
        waitAndReload(false, auth.user.username, op[1].permlink);
      } catch (err) {
        console.error('Post error:', err);
        showStatus(t('newPost'), (t('postError') || 'Error: ') + (err.message || err), 'error');
      }
      postForm.loading = false;
    };

    // ── Vote weight modal ──────────────────────────────────────────────────
    const voteModal = reactive({
      show: false,
      post: null,
      weight: parseInt(localStorage.getItem('bf-vote-weight') || '100'),
      estimatedValue: null,    // { vpCostPct, vpAfter, voteValue }
      estimating: false
    });

    // Cache for vote estimation to avoid flooding RPC
    const estCache = { acc: null, fund: null, props: null, last: 0 };

    // Blurt transaction fee info (flat fee + bandwidth fee, set by witnesses dynamically)
    const feeInfo = reactive({
      flatFee: 0.050,   // BLURT per operation (fallback to known current values)
      bwFee:   0.150,   // BLURT per kilobyte
      loaded:  false
    });

    // Fetch current fee rates from chain properties (witness-voted, can change)
    const fetchFeeInfo = async () => {
      if (feeInfo.loaded) return; // fetch once per session is enough
      try {
        const props = await client.call('condenser_api', 'get_chain_properties', []);
        if (props) {
          if (props.operation_flat_fee)   feeInfo.flatFee = parseFloat(props.operation_flat_fee);
          if (props.bandwidth_kbytes_fee) feeInfo.bwFee   = parseFloat(props.bandwidth_kbytes_fee);
          feeInfo.loaded = true;
        }
      } catch (e) {
        console.warn('Fee info fetch error (using fallback values):', e);
        feeInfo.loaded = true; // don't retry on error, fallback values are fine
      }
    };

    /**
     * Estimate BLURT fee for a transaction.
     * @param {number} numOps      - number of operations in the tx (usually 1 or 2)
     * @param {number} payloadBytes - estimated payload size in bytes
     * @returns {string} formatted fee string e.g. "0.088"
     */
    const estimateTxFee = (numOps, payloadBytes) => {
      // Base TX overhead: ~300 bytes (headers, expiry, ref_block, signature)
      const totalBytes = 300 + payloadBytes;
      const fee = (feeInfo.flatFee * numOps) + (totalBytes / 1024) * feeInfo.bwFee;
      return fee.toFixed(3);
    };

    // Per-form fee estimates, updated lazily (debounced, not per-keystroke)
    const postFeeEstimate  = ref(null);
    const replyFeeEstimate = ref(null);
    let _postFeeTimer  = null;
    let _replyFeeTimer = null;

    // Call this from the post textarea @input — recalculates 2s after user stops typing
    const schedulePostFeeUpdate = () => {
      clearTimeout(_postFeeTimer);
      _postFeeTimer = setTimeout(() => {
        // comment op + comment_options op = 2 ops
        const bodyBytes = new TextEncoder().encode(
          (postForm.title || '') + (postForm.body || '')
        ).length;
        postFeeEstimate.value = estimateTxFee(2, bodyBytes);
      }, 2000);
    };

    // Call this from the reply textarea @input
    const scheduleReplyFeeUpdate = () => {
      clearTimeout(_replyFeeTimer);
      _replyFeeTimer = setTimeout(() => {
        const bodyBytes = new TextEncoder().encode(replyForm.body || '').length;
        replyFeeEstimate.value = estimateTxFee(2, bodyBytes);
      }, 2000);
    };

    const estimateVote = async (weight) => {
      if (!auth.user) return;
      
      const now = Date.now();
      // Only fetch if cache is older than 60 seconds
      if (!estCache.acc || (now - estCache.last > 60000)) {
        voteModal.estimating = true;
        try {
          const [accs, fund, props] = await Promise.all([
            client.condenser.getAccounts([auth.user.username]),
            client.call('condenser_api', 'get_reward_fund', ['post']),
            client.condenser.getDynamicGlobalProperties()
          ]);
          if (accs && accs[0]) estCache.acc = accs[0];
          if (fund) estCache.fund = fund;
          if (props) estCache.props = props;
          estCache.last = now;
        } catch (e) { console.warn('Vote estimate fetch error:', e); }
        voteModal.estimating = false;
      }

      const acc = estCache.acc;
      const fund = estCache.fund;
      if (!acc || !fund) return;

      try {
        // Current raw VP (0-10000)
        const lastVoteTime = new Date(acc.last_vote_time + 'Z').getTime();
        const delta = (Date.now() - lastVoteTime) / 1000;
        const rawVP = Math.min(acc.voting_power + Math.floor(10000 * delta / 432000), 10000);

        // VP cost: used_power = ceil(rawVP * voteWeight / 10000 / 50)
        // At 100% VP and 100% weight: ceil(10000 * 10000 / 10000 / 50) = 200 (~2% of VP)
        const voteWeight = weight * 100; // scale 1-100 → 100-10000
        const usedPower = Math.ceil(rawVP * voteWeight / 10000 / 50);
        const vpAfterRaw = rawVP - usedPower;
        const vpCostPct = (usedPower / 100).toFixed(2);
        const vpAfter   = (vpAfterRaw / 100).toFixed(2);

        // Correct Blurt rshares formula:
        //   rshares = effective_vests_raw * usedPower / 10000
        // where effective_vests_raw = display_VESTS * 1e6 (6 decimal places in blockchain)
        const vestingShares    = parseFloat(acc.vesting_shares);
        const receivedVesting  = parseFloat(acc.received_vesting_shares || 0);
        const delegatedVesting = parseFloat(acc.delegated_vesting_shares || 0);
        const effectiveVests   = vestingShares + receivedVesting - delegatedVesting;

        const microVests = BigInt(Math.floor(effectiveVests * 1000000));
        const rs = (microVests * BigInt(usedPower)) / 10000n;

        const rcStr = fund.recent_claims;
        const rc = BigInt(typeof rcStr === 'string' ? (rcStr.split(' ')[0] || rcStr) : String(rcStr));
        const rb = parseFloat(fund.reward_balance); // in BLURT

        let voteValue = 0;
        if (rc > 0n) {
          // Total reward contribution added to the post by this vote (BLURT)
          // vote_value = reward_balance * rshares / recent_claims
          voteValue = (Number(rs) / Number(rc)) * rb;
        }

        // Vote op payload: voter + author + permlink + weight ≈ ~150 bytes
        const voteFee = estimateTxFee(1, 150);

        voteModal.estimatedValue = {
          vpCostPct,
          vpAfter,
          voteValue: voteValue.toFixed(4),
          fee: voteFee   // actual BLURT tx fee (flat + bandwidth)
        };
      } catch (e) {
        console.warn('Vote estimate calculation error:', e);
      }
    };

    const openVoteModal = (post) => {
      voteModal.post = post;
      voteModal.show = true;
      // Fetch current fee rates (once per session) then estimate
      fetchFeeInfo().then(() => estimateVote(voteModal.weight));
    };

    const triggerSupportLogic = async (post, weight) => {
       // 1. Fetch full post to get beneficiaries if needed
       let fullPost = post;
       if (!post.beneficiaries || post.beneficiaries.length === 0) {
         try {
           fullPost = await client.condenser.getContent(post.author, post.permlink);
         } catch (e) { console.error('Error fetching full post for beneficiaries:', e); }
       }
       
       const beneficiaries = fullPost.beneficiaries || [];
       
       // 2. Fetch replies to check for existing support comment
       let existingSupport = null;
       try {
         const replies = await client.condenser.getContentReplies(post.author, post.permlink);
         existingSupport = replies.find(r => {
            if (!r.body || !r.body.trim().startsWith('Supporting original content by @')) return false;
            // Compare beneficiaries
            const rBens = r.beneficiaries || [];
            if (rBens.length !== beneficiaries.length) return false;
            return beneficiaries.every(b => rBens.some(rb => rb.account === b.account && rb.weight === b.weight));
         });
       } catch (e) { console.error('Error fetching replies for support check:', e); }
       
       if (existingSupport) {
         // Vote on existing support comment
         const voteOp = ['vote', {
           voter: auth.user.username,
           author: existingSupport.author,
           permlink: existingSupport.permlink,
           weight
         }];
         try {
           await broadcast([voteOp]);
         } catch (err) { console.error('Error voting on existing support comment:', err); }
       } else {
         // Open support modal
         oldContentModal.author   = post.author;
         oldContentModal.permlink = post.permlink;
         oldContentModal.beneficiaries = beneficiaries;
         oldContentModal.originalPost = fullPost;
         oldContentModal.weight   = weight;
         oldContentModal.body     = 'Supporting original content by @' + post.author;
         oldContentModal.status   = '';
         oldContentModal.loading  = false;
         oldContentModal.show     = true;
       }
    };

    const submitVoteConfirmed = async () => {
      // Hide vote modal immediately so PIN modal isn't covered
      voteModal.show = false;

      if (checkLock(submitVoteConfirmed)) return;
      if (!auth.user || !voteModal.post) return;
      
      const post   = voteModal.post;
      const weight = Math.min(Math.max(Math.round(voteModal.weight), 1), 100) * 100; // 0-10000
      localStorage.setItem('bf-vote-weight', voteModal.weight);

      const op = ['vote', {
        voter: auth.user.username,
        author: post.author,
        permlink: post.permlink,
        weight
      }];
      try {
        await broadcast([op]);
        const voter    = auth.user.username;

        // Handle old content support
        const created = new Date(post.created.endsWith('Z') ? post.created : post.created + 'Z').getTime();
        const isOld   = (Date.now() - created) > (7 * 24 * 60 * 60 * 1000);
        
        if (isOld) {
          triggerSupportLogic(post, weight);
        }

        waitAndReload(
          view.value === 'topic',
          post.author,
          post.permlink,
          (c) => (c.active_votes || []).some(v => v.voter === voter && v.percent > 0),
          t('syncingWithBlockchain')
        );
      } catch (err) {
        console.error('Vote error:', err);
      }
    };

    const submitVote = async (post) => {
      if (!auth.user) { openLoginModal(); return; }

      // Unvote: quick confirm then broadcast
      if (hasVoted(post)) {
        if (!confirm(t('confirmUnvote'))) return;
        const op = ['vote', { voter: auth.user.username, author: post.author, permlink: post.permlink, weight: 0 }];
        try {
          await broadcast([op]);
          const voter = auth.user.username;
          waitAndReload(
            view.value === 'topic', post.author, post.permlink,
            (c) => !(c.active_votes || []).some(v => v.voter === voter && v.percent > 0),
            t('syncingWithBlockchain')
          );
        } catch (err) { console.error('Unvote error:', err); }
        return;
      }

      // New vote → open weight modal
      openVoteModal(post);
    };
    // ───────────────────────────────────────────────────────────────────────

    const submitSupportComment = async () => {
      if (checkLock(submitSupportComment)) return;
      if (!auth.user || !oldContentModal.author) return;
      oldContentModal.loading = true;
      oldContentModal.status = t('supporting');
      
      const permlink = genPermlink('support-' + oldContentModal.author);
      // Mirror beneficiaries (ensure they are sorted for comment_options)
      let beneficiaries = [...oldContentModal.beneficiaries].sort((a, b) => a.account.localeCompare(b.account));
      if (beneficiaries.length === 0) {
        beneficiaries = [{ account: oldContentModal.author, weight: 10000 }];
      }

      const op = ['comment', {
        parent_author: oldContentModal.author,
        parent_permlink: oldContentModal.permlink,
        author: auth.user.username,
        permlink,
        title: '',
        body: oldContentModal.body,
        json_metadata: JSON.stringify({ app: 'blurtforum/1.0', tags: [config.communityAccount] })
      }];

      const options = ['comment_options', {
        author: auth.user.username,
        permlink,
        max_accepted_payout: '1000000.000 BLURT',
        percent_steem_dollars: 10000,
        allow_votes: true,
        allow_curation_rewards: true,
        extensions: [[0, { beneficiaries }]]
      }];

      try {
        await broadcast([op, options]);
        
        oldContentModal.status = t('waitingForBlock');
        // Wait 5 seconds for block inclusion
        await new Promise(r => setTimeout(r, 5000));
        
        oldContentModal.status = t('votingOnSupport');
        const voteOp = ['vote', {
          voter: auth.user.username,
          author: auth.user.username,
          permlink,
          weight: oldContentModal.weight || 10000
        }];
        await broadcast([voteOp]);
        
        oldContentModal.status = t('supportSuccess');
        setTimeout(() => {
          oldContentModal.show = false;
          loadReplies(oldContentModal.author, oldContentModal.permlink);
        }, 1500);
      } catch (err) {
        console.error('Support error:', err);
        oldContentModal.status = 'Error: ' + err.message;
      }
      oldContentModal.loading = false;
    };

    const mutePost = async (post, mute = true) => {
      if (checkLock(() => mutePost(post, mute))) return;
      if (!auth.user || !canMute.value) return;
      if (mute && !confirm(t('confirmMute'))) return;
      
      const json = JSON.stringify([
        mute ? 'mutePost' : 'unmutePost',
        { community: config.communityAccount, account: post.author, permlink: post.permlink, notes: 'Muted via BlurtForum' }
      ]);
      
      const op = ['custom_json', {
        required_auths: [],
        required_posting_auths: [auth.user.username],
        id: 'community',
        json
      }];
      
      try {
        await broadcast([op]);
        waitAndReload(view.value === 'topic');
      } catch (err) {
        console.error('Mute error:', err);
      }
    };

    const startEditStructure = () => {
      structureForm.text = rawDescription.value;
      structureForm.error = '';
      editStructureMode.value = true;
    };

    const saveStructure = async () => {
      if (checkLock(saveStructure)) return;
      if (!auth.user || !canEditStructure.value) return;
      
      if (structureForm.text.length > 1000) {
        structureForm.error = 'Description too long (max 1000 chars). Save config in a post and use [[Forum config:author/permlink]] instead.';
        return;
      }

      structureForm.loading = true;
      structureForm.error = '';
      
      const op = ['custom_json', {
        required_auths: [],
        required_posting_auths: [auth.user.username],
        id: 'community',
        json: JSON.stringify(['updateProps', {
          community: config.communityAccount,
          props: { description: structureForm.text }
        }])
      }];

      try {
        await broadcast([op]);
        editStructureMode.value = false;
        // Wait 8 seconds for BC to catch up
        setTimeout(() => loadData(false), 8000);
      } catch (err) {
        console.error('Save structure error:', err);
        structureForm.error = err.message || 'Error saving layout';
      }
      structureForm.loading = false;
    };

    const hasVoted = (post) => {
      if (!auth.user) return false;
      return (post.active_votes || []).some(v => v.voter === auth.user.username && v.percent > 0);
    };

    const openPayoutModal = async (post) => {
      const dateObj = new Date(post.created.endsWith('Z') ? post.created : post.created + 'Z');
      dateObj.setDate(dateObj.getDate() + 7);
      
      // Sort votes by value (rshares) descending
      const sortedVotes = [...(post.active_votes || [])].sort((a, b) => {
        return parseFloat(b.rshares || 0) - parseFloat(a.rshares || 0);
      });

      payoutModal.post = {
        ...post,
        active_votes: sortedVotes,
        payoutDate: dateObj.toLocaleString()
      };
      payoutModal.beneficiaries = [];
      payoutModal.show = true;

      try {
        const fullPost = await client.condenser.getContent(post.author, post.permlink);
        if (fullPost && fullPost.beneficiaries) {
          payoutModal.beneficiaries = fullPost.beneficiaries;
        }
      } catch (e) { /* ignore */ }
    };

    const openNotifModal = async () => {
      if (!auth.user) return;
      notifModal.show = true;
      notifModal.loading = true;
      try {
        // Fetch standard notifications
        const list = await client.call('bridge', 'account_notifications', { account: auth.user.username, limit: 50 });
        const results = list || [];

        // Fetch recent transfers from history
        try {
          const history = await client.call('condenser_api', 'get_account_history', [auth.user.username, -1, 50]);
          if (history && Array.isArray(history)) {
            history.forEach(item => {
              const op = item[1].op;
              if (op[0] === 'transfer' && op[1].to === auth.user.username) {
                const tx = op[1];
                const notifId = 'tx-' + item[0];
                // Check if already in list (optional, but keep consistent)
                if (!results.find(n => n.id === notifId)) {
                  results.push({
                    id: notifId,
                    type: 'transfer',
                    author: tx.from,
                    date: item[1].timestamp,
                    msg: `Received ${tx.amount} from @${tx.from}` + (tx.memo ? `: ${tx.memo}` : ''),
                    url: `@${tx.from}`
                  });
                }
              }
            });
          }
        } catch (e) { console.warn('History fetch error:', e); }

        // Sort by date descending
        results.sort((a, b) => new Date(b.date) - new Date(a.date));

        notifModal.list = results;
        
        if (notifModal.list.length > 0) {
          // Use only numeric IDs for lastReadId tracking if possible, 
          // or just take the max from standard ones
          const numericIds = notifModal.list.filter(n => typeof n.id === 'number').map(n => n.id);
          if (numericIds.length > 0) {
            const maxId = Math.max(...numericIds);
            if (maxId > notifModal.lastReadId) {
              notifModal.lastReadId = maxId;
              localStorage.setItem('bf_last_notif_id', maxId.toString());
              notifModal.hasNew = false;
            }
          }
        }
      } catch (err) {
        console.error('Notif error:', err);
      } finally {
        notifModal.loading = false;
      }
    };

    const openNotification = async (notif) => {
      if (!notifModal.clickedIds.includes(notif.id)) {
        notifModal.clickedIds.push(notif.id);
        if (notifModal.clickedIds.length > 200) notifModal.clickedIds.shift();
        localStorage.setItem('bf_clicked_notif_ids', JSON.stringify(notifModal.clickedIds));
      }

      notifModal.show = false;
      
      // Parse URL from notification
      // Formats: @author/permlink, @author
      if (!notif.url) return;
      
      loading.value = true;
      try {
        const parts = notif.url.split('/');
        const author = parts[0].replace('@', '');
        const permlink = parts[1];

        if (permlink) {
          // It's a post or comment
          let content = await client.condenser.getContent(author, permlink);
          if (content && content.author) {
            // Find root to determine community and show full thread
            let root = content;
            if (content.parent_author) {
              const urlParts = content.url.split('#')[0].split('/');
              // Bridge API url usually: /category/@author/permlink
              if (urlParts.length >= 4) {
                const rootAuthor = urlParts[2].replace('@', '');
                const rootPermlink = urlParts[3];
                if (rootAuthor !== author || rootPermlink !== permlink) {
                  root = await client.condenser.getContent(rootAuthor, rootPermlink);
                }
              }
            }

            const targetCommunity = root.category;
            if (targetCommunity && targetCommunity.startsWith('blurt-') && targetCommunity !== config.communityAccount) {
              if (!config.lockedCommunity) {
                config.communityAccount = targetCommunity;
                selectedCommunity.value = targetCommunity;
                forumClient = new dblurt.Client([getForumUrl()]);
                client      = new dblurt.Client([getDataUrl()]);
                // Reload community data (moderators, etc)
                await loadData();
              }
            }
            
            targetNotifPermlink.value = permlink;
            openTopic(normalizePost(root));
          }
        } else {
          // It's a profile
          openProfile(author);
        }
      } catch (err) {
        console.error('Open notification error:', err);
      }
      loading.value = false;
    };
 
    const openLoginModal = () => {
      loginErr.value = '';
      loginForm.username = '';
      loginForm.key = '';
      showLoginModal.value = true;
    };
 
    const doKeyLogin = async () => {
      const username = loginForm.username.trim();
      const keyStr   = loginForm.key.trim();
      if (!username || !keyStr) { loginErr.value = 'Both fields are required.'; return; }
      loginBusy.value = true;
      loginErr.value = '';
      try {
        const privKey = dblurt.PrivateKey.from(keyStr);
        const pubKey  = privKey.createPublic().toString();
        const accounts = await client.condenser.getAccounts([username]);
        const acc = accounts && accounts[0];
        if (!acc) throw new Error('Account not found');
        const postingPubs = acc.posting.key_auths.map(k => k[0]);
        if (!postingPubs.includes(pubKey)) throw new Error('Key mismatch');
        
        if (loginForm.remember) {
          // Setup PIN using AuthService
          pinModal.tempUser = { username, key: keyStr, acc };
          pinModal.mode = 'setup';
          pinModal.value = '';
          pinModal.error = '';
          pinModal.show = true;
          showLoginModal.value = false;
        } else {
          completeLogin(username, keyStr, acc);
        }
      } catch (err) {
        console.error('Key login error:', err);
        loginErr.value = t('loginError');
      }
      loginBusy.value = false;
    };

    const handlePinSubmit = async () => {
      if (pinModal.value.length < 4) { pinModal.error = 'Min 4 digits'; return; }
      pinModal.loading = true;
      pinModal.error = '';

      // Small delay to allow UI to show spinner before CPU-heavy PBKDF2
      await new Promise(r => setTimeout(r, 50));
      
      try {
        if (pinModal.mode === 'setup') {
          const encrypted = AuthService.encryptKey(pinModal.tempUser.key, pinModal.value);
          const session = {
            username: pinModal.tempUser.username,
            key: encrypted,
            expires: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
          };
          localStorage.setItem('blurtforum_session', JSON.stringify(session));
          completeLogin(pinModal.tempUser.username, pinModal.tempUser.key, pinModal.tempUser.acc);
          pinModal.show = false;
        } else {
          // Unlock mode
          const sessionStr = localStorage.getItem('blurtforum_session');
          if (!sessionStr) return;
          const session = JSON.parse(sessionStr);
          
          let decrypted = null;
          if (AuthService.isEncrypted(session.key)) {
            decrypted = AuthService.decryptKey(session.key, pinModal.value);
          } else {
            // Support legacy (plain AES without PBKDF2) migration
            try {
              const bytes = CryptoJS.AES.decrypt(session.key, pinModal.value);
              decrypted = bytes.toString(CryptoJS.enc.Utf8);
            } catch (e) { /* fallback */ }
          }

          if (!decrypted || !decrypted.startsWith('5')) {
            throw new Error('Invalid PIN');
          }
          
          const accounts = await client.condenser.getAccounts([session.username]);
          if (accounts && accounts[0]) {
             completeLogin(session.username, decrypted, accounts[0]);
             // Migrate to new format if needed
             if (!AuthService.isEncrypted(session.key)) {
               const encrypted = AuthService.encryptKey(decrypted, pinModal.value);
               session.key = encrypted;
               localStorage.setItem('blurtforum_session', JSON.stringify(session));
             }
             if (auth.user) auth.user.locked = false;
             pinModal.show = false;
             
             if (resumeAction.value) {
               const fn = resumeAction.value;
               resumeAction.value = null;
               fn();
             }
          }
        }
      } catch (e) {
        pinModal.error = t('invalidPin');
        pinModal.value = '';
      } finally {
        pinModal.loading = false;
      }
    };

    const startEdit = (target) => {
      editModal.target = target;
      editModal.author = target.author;
      editModal.permlink = target.permlink;
      editModal.title = target.title || '';
      editModal.body = target.body;
      editModal.isPost = !target.parent_author;
      editModal.error = '';
      editModal.success = '';
      editModal.loading = false;
      editModal.show = true;
    };

    const submitEdit = async () => {
      if (checkLock(submitEdit)) return;
      if (!auth.user || !editModal.target) return;
      editModal.loading = true;
      editModal.error = '';
      editModal.success = '';
      
      let meta = editModal.target.json_metadata || '';
      if (typeof meta !== 'string') {
        try {
          meta = JSON.stringify(meta);
        } catch (e) {
          meta = '';
        }
      }

      const op = ['comment', {
        parent_author: editModal.target.parent_author || '',
        parent_permlink: editModal.target.parent_permlink || config.communityAccount,
        author: auth.user.username,
        permlink: editModal.permlink,
        title: editModal.title,
        body: editModal.body,
        json_metadata: meta
      }];
      
      try {
        await broadcast([op]);
        editModal.success = t('updateSuccess');
        const editedPermlink = editModal.permlink;
        const editedAuthor = editModal.author;
        const wasInTopic = view.value === 'topic';
        editModal.show = false;
        waitAndReload(wasInTopic, editedAuthor, editedPermlink);
      } catch (err) {
        console.error('Edit error:', err);
        editModal.error = t('updateError') + ' (' + (err.message || '') + ')';
      }
      editModal.loading = false;
    };


    const completeLogin = (username, key, acc) => {
      const lastVoteTime = new Date(acc.last_vote_time + 'Z').getTime();
      const now = new Date().getTime();
      const delta = (now - lastVoteTime) / 1000;
      let vp = acc.voting_power + (10000 * delta / 432000);
      vp = Math.min(vp / 100, 100).toFixed(2);

      const hasRewards = parsePayout(acc.reward_blurt_balance) > 0 || parsePayout(acc.reward_vesting_balance) > 0;

      auth.user = { 
        username, type: 'key', key, vp,
        rewardBlurt: acc.reward_blurt_balance,
        rewardVesting: acc.reward_vesting_balance,
        hasRewards,
        locked: false
      };
      showLoginModal.value = false;
      loginForm.key = '';
      loadUserCommunities(username);
      loadFollowingList(username);
      }; 
    const doWVLogin = async () => {
      const username = loginForm.username.trim().toLowerCase();
      if (!username) { loginErr.value = 'Username is required.'; return; }
      loginBusy.value = true;
      loginErr.value = '';
      try {
        if (!window.blurt_keychain) throw new Error('Polyfill not available');
        const memo = 'Login to BlurtForum ' + Date.now();
        await new Promise((resolve, reject) => {
          window.blurt_keychain.requestSignBuffer(username, memo, 'Posting', (res) => {
            if (res && res.success) resolve(res);
            else reject(new Error(res.message || 'WhaleVault sign error'));
          });
        });
        
        const accounts = await client.condenser.getAccounts([username]);
        const acc = accounts && accounts[0];
        let vp = 100;
        let hasRewards = false;
        let rewardBlurt = '0.000 BLURT';
        let rewardVesting = '0.000000 VESTS';

        if (acc) {
          const lastVoteTime = new Date(acc.last_vote_time + 'Z').getTime();
          const now = new Date().getTime();
          const delta = (now - lastVoteTime) / 1000;
          vp = acc.voting_power + (10000 * delta / 432000);
          vp = Math.min(vp / 100, 100).toFixed(2);
          hasRewards = parsePayout(acc.reward_blurt_balance) > 0 || parsePayout(acc.reward_vesting_balance) > 0;
          rewardBlurt = acc.reward_blurt_balance;
          rewardVesting = acc.reward_vesting_balance;
        }

        auth.user = { username, type: 'whalevault', key: null, vp, hasRewards, rewardBlurt, rewardVesting };
        // Unify session storage
        localStorage.setItem('blurtforum_session', JSON.stringify({ username, type: 'whalevault', expires: Date.now() + (24 * 60 * 60 * 1000) }));
        showLoginModal.value = false;
        loadUserCommunities(username);
        loadFollowingList(username);
      } catch (err) {
        console.error('WhaleVault login error:', err);
        loginErr.value = t('loginError') + ' ' + (err.message || err);
      }
      loginBusy.value = false;
    };

    const loadUserCommunities = async (username) => {
      try {
        console.log('Loading subscriptions for:', username);
        let subs = await client.call('bridge', 'list_all_subscriptions', { account: username });
        
        // Fallback for some nodes/client versions
        if (!subs || !subs.length) {
          console.log('No subscriptions found with named params, trying positional...');
          subs = await client.condenser.call('bridge', 'list_all_subscriptions', [username]);
        }

        console.log('Found subscriptions:', subs);
        if (subs && Array.isArray(subs)) {
          // list_all_subscriptions returns [community_name, title, role, cur-payout]
          userSubscriptions.value = subs.map(s => ({ account: s[0], title: s[1] || s[0] }));
        }
      } catch (err) {
        console.error('Error loading communities:', err);
      }
    };

    const logout = () => {
      auth.user = null;
      replyTarget.value = null;
      localStorage.removeItem('blurtforum_session');
    };
 
    const handleUrlChange = () => {
      const params = new URLSearchParams(window.location.search);
      const requestedView = params.get('view') || 'index';
      const requestedForumId = params.get('forum');
      const requestedAuthor = params.get('author');
      const requestedPermlink = params.get('permlink');
      const requestedUser = params.get('user');

      if (requestedView === 'index') {
        view.value = 'index';
        activeForum.value = null;
        activeTopic.value = null;
        // Optional: refresh 5 posts per forum
        const allForums = [];
        forumStructure.value.forEach(cat => cat.forums.forEach(f => allForums.push(f)));
        allForums.forEach(async (f) => {
          const p = { community: config.communityAccount, limit: 10, sort: 'activity' };
          if (f.targetTags.length > 0) p.tags_any = f.targetTags;
          try {
            const raw = await client.call('bridge', 'get_forum_posts', p);
            if (raw && raw.length > 0) {
              const normalized = raw.map(normalizePost);
              f.posts = normalized.filter(post => !post.isMuted || canMute.value).slice(0, 5);
            }
          } catch (e) { /* ignore */ }
        });
      } else if (requestedView === 'forum' && requestedForumId) {
        for (const cat of forumStructure.value) {
          const f = cat.forums.find(f => f.id === requestedForumId);
          if (f) {
            // Check if we are already viewing this forum to avoid double loading
            if (view.value === 'forum' && activeForum.value && activeForum.value.id === f.id && f.posts.length > 0) {
              return;
            }
            f.lastAuthor = "";
            f.lastPermlink = "";
            f.pageHistory = [];
            f.hasMore = true;
            activeForum.value = f;
            view.value = "forum";
            activeTopic.value = null;
            loadData("current", f);
            break;
          }
        }
      } else if (requestedView === 'topic' && requestedAuthor && requestedPermlink) {
        // If we are already on this topic, don't reload
        if (view.value === 'topic' && activeTopic.value && 
            activeTopic.value.author === requestedAuthor && 
            activeTopic.value.permlink === requestedPermlink) {
          return;
        }
        client.condenser.getContent(requestedAuthor, requestedPermlink).then(content => {
          if (content && content.author) {
            activeTopic.value = { ...normalizePost(content), beneficiaries: content.beneficiaries || [] };
            view.value = 'topic';
            loadReplies(content.author, content.permlink);
          }
        });
      } else if (requestedView === 'profile' && requestedUser) {
        if (view.value === 'profile' && profileUser.username === requestedUser) {
          return;
        }
        openProfile(requestedUser, false);
      }
    };

    const checkNewNotifications = async () => {
      if (!auth.user || notifModal.show) return;
      try {
        const list = await client.call('bridge', 'account_notifications', { account: auth.user.username, limit: 1 });
        if (list && list.length > 0 && list[0].id > notifModal.lastReadId) {
          notifModal.hasNew = true;
        }
      } catch (e) { /* ignore */ }
    };

    onMounted(() => {
      setTheme(theme.value);

      window.addEventListener('popstate', handleUrlChange);

      // Periodic check for notifications
      setInterval(checkNewNotifications, 60000); // every minute

      // Image lightbox click handler
      document.addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG' && e.target.closest('.post-body')) {
          openImgModal(e.target.src);
        }
      });
      
      // Restore session
      const saved = localStorage.getItem('blurtforum_session');
      if (saved) {
        try {
          const session = JSON.parse(saved);
          if (session.type === 'whalevault') {
            auth.user = { username: session.username, type: 'whalevault', key: null, vp: '…' };
            loadUserCommunities(session.username);
            loadFollowingList(session.username);
            // Refresh full data
            client.condenser.getAccounts([session.username]).then(accounts => {
              if (accounts && accounts[0]) {
                const acc = accounts[0];
                const lastVoteTime = new Date(acc.last_vote_time + 'Z').getTime();
                const now = new Date().getTime();
                const delta = (now - lastVoteTime) / 1000;
                let vp = acc.voting_power + (10000 * delta / 432000);
                vp = Math.min(vp / 100, 100).toFixed(2);
                const hasRewards = parsePayout(acc.reward_blurt_balance) > 0 || parsePayout(acc.reward_vesting_balance) > 0;
                auth.user = { 
                  username: session.username, type: 'whalevault', key: null, vp, 
                  hasRewards, rewardBlurt: acc.reward_blurt_balance, rewardVesting: acc.reward_vesting_balance 
                };
              }
            });
          } else {
            // Key based login - just restore session without prompt
            auth.user = { username: session.username, type: 'key', key: session.key, vp: '…', locked: true };
            loadUserCommunities(session.username);
            loadFollowingList(session.username);
            refreshUser();
          }
        } catch (e) { /* ignore */ }
      } else {
        // Check legacy session too (one-time migration)
        const legacy = localStorage.getItem('bf-session');
        if (legacy) {
          try {
            const session = JSON.parse(legacy);
            if (session.username && session.type === 'whalevault') {
              localStorage.setItem('blurtforum_session', legacy);
              location.reload();
            }
          } catch (e) { /* ignore */ }
        }
      }

      const params = new URLSearchParams(window.location.search);
      const comm = params.get('community');
      if (comm) {
        config.communityAccount = comm;
        config.lockedCommunity = true;
        // Correctly set selectedCommunity by checking known list
        const found = allCommunities.value.find(c => c.account === comm);
        if (found) {
          selectedCommunity.value = comm;
        } else {
          selectedCommunity.value = 'custom';
          customTag.value = comm;
        }
      } else {
        // Restore last community and forum if no specific URL
        const lastComm = localStorage.getItem('bf_last_community');
        if (lastComm) {
          config.communityAccount = lastComm;
          const found = allCommunities.value.find(c => c.account === lastComm);
          if (found) selectedCommunity.value = lastComm;
          else {
            selectedCommunity.value = 'custom';
            customTag.value = lastComm;
          }
        }
      }

      loadData().then(() => {
        // If view is index and we have a saved forum, open it
        const p = new URLSearchParams(window.location.search);
        if (!p.get('view') || p.get('view') === 'index') {
          const lastForumId = localStorage.getItem('bf_last_forum_id');
          if (lastForumId) {
            for (const cat of forumStructure.value) {
              const f = cat.forums.find(forum => forum.id === lastForumId);
              if (f) {
                openForum(f);
                break;
              }
            }
          }
        }
        handleUrlChange();
        
        // Start global activity check after initial load
        setTimeout(updateGlobalActivity, 2000);
        setInterval(updateGlobalActivity, 300000); // Every 5 minutes
      });

      // Periodic refresh of VP
      setInterval(() => {
        if (auth.user) {
          // just a rough estimation
          let val = parseFloat(auth.user.vp) + (0.01 / 43.2); // 20% per day = 0.01% per 43.2s
          if (val < 100) auth.user.vp = val.toFixed(2);
        }
      }, 30000);
    });

      window.app = { openProfile };

      return {      lang, setLang, langs, t, theme, setTheme, themes, config, view, loading, globalProps, forumStructure,
      activeForum, activeTopic, replies, repliesLoading, moderators, communityInfo,
      structureNote, selectedCommunity, customTag, allCommunities, auth, showLoginModal, loginTab,
      loginForm, loginErr, loginBusy, wvAvailable, replyTarget, replyForm,
      showNewPostForm, openNewPostForm, postForm, fmtDate, timeAgo, forumHasUnread, renderMD, isNestedReply, getParentBody,
      goHome, openForum, openTopic, handleCommunityChange, switchCommunity, openLoginModal,
      doKeyLogin, doWVLogin, logout, startReply, submitReply, submitPost, loadData,
      nextPage, prevPage,
      submitVote, hasVoted, openPayoutModal, payoutModal, openNotifModal, notifModal,
      openProfile, profileUser, profileTab, openNotification,
      userRole, canEditStructure, canMute, mutePost, editStructureMode, startEditStructure, saveStructure,
      structureForm, showStructureDocs,
      forumPagination, loadMorePosts,
      pinModal, handlePinSubmit,
      globalActivity, activityExpanded, activityFullList, mobileActivityExpanded, openActivity,
      editModal, startEdit, submitEdit,
      oldContentModal, submitSupportComment,
      voteModal, openVoteModal, submitVoteConfirmed, estimateVote,
      feeInfo, postFeeEstimate, replyFeeEstimate, schedulePostFeeUpdate, scheduleReplyFeeUpdate,
      bcWaitQueue, bcQueueExpanded,
      imgModal, openImgModal,
      statusModal, showStatus,
      claimRewards,
      postPreview, replyPreview, saveDraft, clearDraft,
      postImgUpload, replyImgUpload, onPostImagePick, onReplyImagePick, onPostPaste, onReplyPaste,
      rpcMenuOpen, rpcDataNode, rpcForumNode, rpcDataCustom, rpcForumCustom, applyRpcSettings,
      checkNewNotifications,
      getNotifIcon,
      loadTopicContext,
      isPostInCommunity,
      toggleFollow,
      explorationExpanded,
      explorationForm,
      toggleExploration,
      followingSet
    };
  }
}).mount('#app');
