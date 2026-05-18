/**
 * BlurtForum — complete Blurt blockchain forum frontend
 */
const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;
 
function parseStructure(text) {
  if (!text || !text.trim()) return null;
  const lines = text.split('\n');
  const categories = [];
  let currentCat = null;
  let fid = 0;
 
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#!') || line.startsWith('//')) continue;
 
    if (line.startsWith('## ')) {
      currentCat = { name: line.slice(3).trim(), forums: [] };
      categories.push(currentCat);
    } else if (line.startsWith('> ') && currentCat) {
      const parts = line.slice(2).split('|').map(s => s.trim());
      const name = parts[0] || 'Forum';
      const tags = (parts[1] || '').split(',').map(s => s.trim()).filter(Boolean);
      const desc = parts[2] || '';
      currentCat.forums.push({
        id: `f${++fid}`,
        name,
        targetTags: tags.length ? tags : [],
        desc,
        posts: [],
        lastAuthor: '',
        lastPermlink: '',
        hasMore: true
      });
    }
  }
  return categories.length > 0 ? categories : null;
}
 
function defaultStructure() {
  return [
    {
      name: 'Daily & Life',
      forums: [
        { id:'f1', name:'Daily Activity',     targetTags:['actifit','mydailypost','blurtlife','life'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true },
        { id:'f2', name:'Social & Family',    targetTags:['introduceyourself','parenting','moms','love','motivation'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true }
      ]
    },
    {
      name: 'Arts & Media',
      forums: [
        { id:'f3', name:'Art & Photography',  targetTags:['art','blurtart','photography','stockphotos'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true },
        { id:'f4', name:'Videos & Podcasts',  targetTags:['video','podcast','music','gymmusic'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true },
        { id:'f5', name:'Gaming',             targetTags:['games','game','arcadecolony'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true }
      ]
    },
    {
      name: 'News & World',
      forums: [
        { id:'f6', name:'General News',       targetTags:['news','activistpost','centurywire','thepeoplesvoice'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true },
        { id:'f7', name:'Politics & Society', targetTags:['politics','antiwar','war','truth','reclaimthenet','naturalnews'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true }
      ]
    },
    {
      name: 'Science & Tech',
      forums: [
        { id:'f8', name:'Development',        targetTags:['dev','computing','ai','research'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true }
      ]
    },
    {
      name: 'Community & Meta',
      forums: [
        { id:'f9', name:'Blurt Meta',         targetTags:['blurt','blurtecho','proposals','witness-category'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true },
        { id:'f10', name:'Contests & Rewards',targetTags:['blurtcontests','rewards'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true }
      ]
    },
    {
      name: 'Regional',
      forums: [
        { id:'f11', name:'Polska (Poland)',   targetTags:['polish','polska','kresy','strefa44'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true },
        { id:'f12', name:'International',     targetTags:['kr','cn','deutsch','germany','indonesia','japan','blurtlatam','blurthispano'], desc:'', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true }
      ]
    }
  ];
}
 
function genPermlink(title) {
  const slug = (title || 'post')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 200);
  return `${slug}-${Date.now().toString(36)}`;
}
 
function renderMarkdown(text) {
  if (!text) return '';
  try {
    // Basic mention linking: @username -> link to profile
    // We do this before marked to avoid issues with code blocks if possible, 
    // but better after if we want to respect code blocks.
    // However, a simple replacement on the final HTML might be easier if we are careful.
    let html = marked.parse(text, { breaks: true, gfm: true });
    
    // Simple regex for @username, avoiding things like email addresses
    // Matches @ followed by alphanum, dots, or dashes, starting with a letter.
    html = html.replace(/(^|[^a-zA-Z0-9_!#$%&*@/])@([a-z0-9.-]+[a-z0-9])/g, '$1<a href="#" class="mention" onclick="event.preventDefault(); if(window.app && window.app.openProfile) window.app.openProfile(\'$2\')">@$2</a>');

    return DOMPurify.sanitize(html);
  } catch (e) {
    console.error('Markdown error:', e);
    return text;
  }
}

function parsePayout(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val.split(' ')[0]) || 0;
  return 0;
}
 
createApp({
  setup() {
    const langs = ['en', 'pl', 'eo'];
    const browserLang = navigator.language.slice(0, 2).toLowerCase();
    const lang = ref(langs.includes(browserLang) ? browserLang : 'en');
    const setLang = (l) => { lang.value = l; document.documentElement.lang = l; };
    const t = (k) => (TR[lang.value] || TR.en)[k] || k;

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
    const rpcDataNode  = ref(localStorage.getItem('bf-rpc-data')  || 'https://blurtrpc.dagobert.uk');
    
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
      loading: false,
      filterCommunity: true
    });
    const profileTab = ref('posts');

    const pinModal = reactive({ show: false, mode: 'setup', value: '', error: '', tempUser: null });
    const editModal = reactive({ show: false, loading: false, isPost: false, author: '', permlink: '', title: '', body: '', error: '', success: '', target: null });

    const auth = reactive({ user: null });
    
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
    const oldContentModal = reactive({ show: false, loading: false, author: '', permlink: '', body: '', status: '' });
    const imgModal = reactive({ show: false, src: '' });
    const openImgModal = (src) => {
      imgModal.src = src;
      imgModal.show = true;
    };
 
    const fmtDate = (s) => new Date(s.endsWith('Z') ? s : s + 'Z').toLocaleString();

    const timeAgo = (s) => {
      if (!s) return '';
      const date = new Date(s.endsWith('Z') ? s : s + 'Z');
      const diff = Math.floor((Date.now() - date.getTime()) / 1000);
      if (diff < 60)     return `${diff}s ago`;
      if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
      if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
      return date.toLocaleDateString();
    };

    const forumHasUnread = (forum) => {
      const topPosts = forum.posts.slice(0, 5);
      if (topPosts.length === 0) return false;
      // If last post is by our user, it's read
      if (topPosts[0].author === auth.user?.username) return false;
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

        const rawPosts = await forumClient.call('bridge', 'get_forum_posts', params);
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
      const isRead = !!readStatus[`${p.author}/${p.permlink}`];
      
      const isUnread = !isRead && p.author !== auth.user?.username;

      // Muting logic
      const isMuted = p.stats?.is_muted || p.stats?.hide || false;

      // Payout status logic: on Blurt content pays out after 7 days.
      const createdDate = new Date(p.created.endsWith('Z') ? p.created : p.created + 'Z');
      const now = new Date();
      const ageDays = (now - createdDate) / (1000 * 60 * 60 * 24);
      
      let isPaid = total > 0 || ageDays > 7.5; 
      if (p.cashout_time && p.cashout_time.startsWith('1970')) isPaid = true;

      return {
        author: p.author,
        permlink: p.permlink,
        title: p.title || '(no title)',
        body: p.body,
        created: p.created,
        url: p.url, 
        category: p.category, 
        lastActivity: p.last_activity || p.created,
        lastAuthor: p.last_activity_author,
        isUnread,
        isRead,
        isMuted,
        isPaid,
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
            if (forum.targetTags.length > 0 && forum.targetTags.some(tag => post.tags.includes(tag))) {
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
            author: r.author,
            permlink: r.permlink,
            parent_author: r.parent_author,
            parent_permlink: r.parent_permlink,
            body: r.body,
            created: r.created,
            depth,
            pendingPayout: parsePayout(r.pending_payout_value),
            totalPayout: parsePayout(r.total_payout_value),
            payout: parsePayout(r.total_payout_value) + parsePayout(r.pending_payout_value),
            vote_count: r.active_votes ? r.active_votes.length : (r.net_votes || 0),
            active_votes: r.active_votes || [],
            net_rshares: parseFloat(r.net_rshares || 0),
            beneficiaries: r.beneficiaries || [],
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

      activeForum.value = forum;
      view.value = "forum";
      activeTopic.value = null;
      showNewPostForm.value = false;
      syncUrl();
      loadData("current", forum);
    };
 
    const markTopicAsRead = (topic) => {
      if (!topic) return;
      const readStatus = JSON.parse(localStorage.getItem('bf_read_status_v2') || '{}');
      readStatus[`${topic.author}/${topic.permlink}`] = 1;
      localStorage.setItem('bf_read_status_v2', JSON.stringify(readStatus));
      topic.isRead = true;
      topic.isUnread = false;
    };

    const openTopic = (topic) => {
      activeTopic.value = { ...topic, beneficiaries: topic.beneficiaries || [] };
      bodyCache[`${topic.author}/${topic.permlink}`] = topic.body;
      view.value = 'topic';
      loadReplies(topic.author, topic.permlink);
      syncUrl();

      markTopicAsRead(activeTopic.value);

      // Fetch full content in background to get beneficiaries
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
        const accounts = await client.condenser.getAccounts([username]);
        if (accounts && accounts[0]) {
          const acc = accounts[0];
          profileUser.data = acc;

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
        profileUser.posts = history.filter(p => p.author === username).map(p => {
          let tags = [];
          try { tags = JSON.parse(p.json_metadata || '{}').tags || []; } catch (e) { /* ignore */ }
          return {
            ...p,
            tags,
            payout: parsePayout(p.total_payout_value) + parsePayout(p.pending_payout_value)
          };
        });
        
        const comments = await client.condenser.call('bridge', 'get_account_posts', [{ account: username, sort: 'comments', limit: 20 }]);
        if (comments) {
          profileUser.comments = comments.map(c => {
            let tags = [];
            try { tags = JSON.parse(c.json_metadata || '{}').tags || []; } catch (e) { /* ignore */ }
            return {
              ...c,
              tags,
              payout: parsePayout(c.total_payout_value) + parsePayout(c.pending_payout_value)
            };
          });
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
      const hashBytes = new Uint8Array(hashHex.match(/.{2}/g).map(b => parseInt(b, 16)));

      let sigHex;
      if (auth.user.type === 'key') {
        const privKey = dblurt.PrivateKey.from(auth.user.key);
        const sig = privKey.sign(hashBytes);
        // Keep full 65-byte signature (130 hex) including recovery byte
        sigHex = typeof sig.toString === 'function' ? sig.toString() : Array.from(sig).map(b => b.toString(16).padStart(2,'0')).join('');
      } else {
        // WhaleVault: sign the hash hex with posting key
        sigHex = await new Promise((resolve, reject) => {
          if (!window.blurt_keychain) { reject(new Error('WhaleVault not available')); return; }
          window.blurt_keychain.requestSignBuffer(auth.user.username, hashHex, 'posting', (res) => {
            if (res && res.success) resolve(res.result || '');
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
        
        auth.user.rewardBlurt = '0.000 BLURT';
        auth.user.rewardVesting = '0.000000 VESTS';
        auth.user.hasRewards = false;
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
    };

    // ── Blockchain wait queue ───────────────────────────────────────────────
    const bcWaitQueue = ref([]);
    const bcQueueExpanded = ref(false);
    let _bcId = 0;

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
      await new Promise(r => setTimeout(r, 800));
      const idx = bcWaitQueue.value.findIndex(e => e.id === id);
      if (idx >= 0) bcWaitQueue.value.splice(idx, 1);
      // Collapse the expand state once queue empties
      if (bcWaitQueue.value.length === 0) bcQueueExpanded.value = false;
    };
    // ───────────────────────────────────────────────────────────────────────
 
    const submitReply = async () => {
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

    const estimateVote = async (weight) => {
      if (!auth.user) return;
      voteModal.estimating = true;
      voteModal.estimatedValue = null;
      try {
        const accounts = await client.condenser.getAccounts([auth.user.username]);
        const acc = accounts && accounts[0];
        if (!acc) return;

        // Current raw VP (0-10000)
        const lastVoteTime = new Date(acc.last_vote_time + 'Z').getTime();
        const delta = (Date.now() - lastVoteTime) / 1000;
        const rawVP = Math.min(acc.voting_power + Math.floor(10000 * delta / 432000), 10000);

        // VP cost: Blurt uses same formula as Steem/Hive
        // used_power = ceil(rawVP * weight / 10000 / 50)  (50 full votes/day regen equivalent)
        const voteWeight = weight * 100; // 0-10000
        const usedPower = Math.ceil(rawVP * voteWeight / 10000 / 50);
        const vpAfterRaw = rawVP - usedPower;
        const vpCostPct = (usedPower / 100).toFixed(2);
        const vpAfter   = (vpAfterRaw / 100).toFixed(2);

        // Estimate BLURT value
        let voteValue = null;
        try {
          const fund = await client.condenser.call('condenser_api', 'get_reward_fund', ['post']);
          if (fund) {
            const vestingShares    = parseFloat(acc.vesting_shares);
            const receivedVesting  = parseFloat(acc.received_vesting_shares || 0);
            const delegatedVesting = parseFloat(acc.delegated_vesting_shares || 0);
            const effectiveVests   = vestingShares + receivedVesting - delegatedVesting;

            // rshares = effective_vests * used_power / 10000
            const rshares       = effectiveVests * usedPower / 10000;
            const rewardBalance = parseFloat(fund.reward_balance);
            const recentClaims  = parseFloat(fund.recent_claims);
            if (recentClaims > 0) {
              voteValue = (rshares / recentClaims) * rewardBalance;
            }
          }
        } catch (e) { /* reward fund unavailable */ }

        voteModal.estimatedValue = {
          vpCostPct,
          vpAfter,
          voteValue: voteValue !== null ? voteValue.toFixed(4) : null
        };
      } catch (e) {
        console.warn('Vote estimate error:', e);
      }
      voteModal.estimating = false;
    };

    const openVoteModal = (post) => {
      voteModal.post = post;
      voteModal.show = true;
      // Estimate with current weight
      estimateVote(voteModal.weight);
    };

    const submitVoteConfirmed = async () => {
      if (!auth.user || !voteModal.post) return;
      const post   = voteModal.post;
      const weight = Math.min(Math.max(Math.round(voteModal.weight), 1), 100) * 100; // 0-10000
      localStorage.setItem('bf-vote-weight', voteModal.weight);
      voteModal.show = false;

      const op = ['vote', {
        voter: auth.user.username,
        author: post.author,
        permlink: post.permlink,
        weight
      }];
      try {
        await broadcast([op]);
        const voter    = auth.user.username;
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

      // Check if post is older than 7 days → support modal
      const created = new Date(post.created.endsWith('Z') ? post.created : post.created + 'Z').getTime();
      const isOld   = (Date.now() - created) > (7 * 24 * 60 * 60 * 1000);
      if (isOld) {
        oldContentModal.author   = post.author;
        oldContentModal.permlink = post.permlink;
        oldContentModal.body     = 'Supporting original content by @' + post.author;
        oldContentModal.status   = '';
        oldContentModal.loading  = false;
        oldContentModal.show     = true;
        return;
      }

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
      if (!auth.user || !oldContentModal.author) return;
      oldContentModal.loading = true;
      oldContentModal.status = t('supporting');
      
      const permlink = genPermlink('support-' + oldContentModal.author);
      const beneficiaries = [{ account: oldContentModal.author, weight: 10000 }];

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
          weight: 10000
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
      if (!auth.user || !canMute.value) return;
      if (mute && !confirm(t('confirmMute'))) return;
      
      const json = JSON.stringify([
        mute ? 'mutePost' : 'unmutePost',
        { community: config.communityAccount, account: post.author, author: post.author, permlink: post.permlink, notes: 'Muted via BlurtForum' }
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
      
      payoutModal.post = {
        ...post,
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
          // Setup PIN
          pinModal.tempUser = { username, key: keyStr, acc };
          pinModal.mode = 'setup';
          pinModal.value = '';
          pinModal.error = '';
          pinModal.show = true;
        } else {
          completeLogin(username, keyStr, acc);
        }
      } catch (err) {
        console.error('Key login error:', err);
        loginErr.value = t('loginError');
      }
      loginBusy.value = false;
    };

    const handlePinSubmit = () => {
      if (pinModal.value.length < 4) { pinModal.error = 'Min 4 digits'; return; }
      
      if (pinModal.mode === 'setup') {
        const encrypted = CryptoJS.AES.encrypt(pinModal.tempUser.key, pinModal.value).toString();
        const session = {
          username: pinModal.tempUser.username,
          key: encrypted,
          expires: Date.now() + (12 * 60 * 60 * 1000) // 12 hours
        };
        localStorage.setItem('blurtforum_session', JSON.stringify(session));
        completeLogin(pinModal.tempUser.username, pinModal.tempUser.key, pinModal.tempUser.acc);
        pinModal.show = false;
      } else {
        // Unlock mode
        const session = JSON.parse(localStorage.getItem('blurtforum_session'));
        try {
          const decrypted = CryptoJS.AES.decrypt(session.key, pinModal.value).toString(CryptoJS.enc.Utf8);
          if (!decrypted) throw new Error('Invalid PIN');
          
          (async () => {
            const accounts = await client.condenser.getAccounts([session.username]);
            if (accounts && accounts[0]) {
               completeLogin(session.username, decrypted, accounts[0]);
               pinModal.show = false;
            }
          })();
        } catch (e) {
          pinModal.error = t('invalidPin');
        }
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
      if (!auth.user || !editModal.target) return;
      editModal.loading = true;
      editModal.error = '';
      editModal.success = '';
      
      const op = ['comment', {
        parent_author: editModal.target.parent_author || '',
        parent_permlink: editModal.target.parent_permlink || config.communityAccount,
        author: auth.user.username,
        permlink: editModal.permlink,
        title: editModal.title,
        body: editModal.body,
        json_metadata: editModal.target.json_metadata || ''
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
        hasRewards
      };
      showLoginModal.value = false;
      loginForm.key = '';
      loadUserCommunities(username);
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
          if (session.expires > Date.now()) {
            if (session.type === 'whalevault') {
              auth.user = { username: session.username, type: 'whalevault', key: null, vp: '…' };
              loadUserCommunities(session.username);
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
              pinModal.mode = 'unlock';
              pinModal.show = true;
            }
          } else {
            localStorage.removeItem('blurtforum_session');
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
              // Small hack to re-run session logic after migration
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
      }

      loadData().then(() => {
        handleUrlChange();
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
      editModal, startEdit, submitEdit,
      oldContentModal, submitSupportComment,
      voteModal, openVoteModal, submitVoteConfirmed, estimateVote,
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
      isPostInCommunity
    };
  }
}).mount('#app');
