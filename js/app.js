/**
 * BlurtForum — complete Blurt blockchain forum frontend
 */
const { createApp, ref, reactive, computed, onMounted } = Vue;
 
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
        posts: []
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
        { id:'f1', name:'Daily Activity',     targetTags:['actifit','mydailypost','blurtlife','life'], desc:'', posts:[] },
        { id:'f2', name:'Social & Family',    targetTags:['introduceyourself','parenting','moms','love','motivation'], desc:'', posts:[] }
      ]
    },
    {
      name: 'Arts & Media',
      forums: [
        { id:'f3', name:'Art & Photography',  targetTags:['art','blurtart','photography','stockphotos'], desc:'', posts:[] },
        { id:'f4', name:'Videos & Podcasts',  targetTags:['video','podcast','music','gymmusic'], desc:'', posts:[] },
        { id:'f5', name:'Gaming',             targetTags:['games','game','arcadecolony'], desc:'', posts:[] }
      ]
    },
    {
      name: 'News & World',
      forums: [
        { id:'f6', name:'General News',       targetTags:['news','activistpost','centurywire','thepeoplesvoice'], desc:'', posts:[] },
        { id:'f7', name:'Politics & Society', targetTags:['politics','antiwar','war','truth','reclaimthenet','naturalnews'], desc:'', posts:[] }
      ]
    },
    {
      name: 'Science & Tech',
      forums: [
        { id:'f8', name:'Development',        targetTags:['dev','computing','ai','research'], desc:'', posts:[] }
      ]
    },
    {
      name: 'Community & Meta',
      forums: [
        { id:'f9', name:'Blurt Meta',         targetTags:['blurt','blurtecho','proposals','witness-category'], desc:'', posts:[] },
        { id:'f10', name:'Contests & Rewards',targetTags:['blurtcontests','rewards'], desc:'', posts:[] }
      ]
    },
    {
      name: 'Regional',
      forums: [
        { id:'f11', name:'Polska (Poland)',   targetTags:['polish','polska','kresy','strefa44'], desc:'', posts:[] },
        { id:'f12', name:'International',     targetTags:['kr','cn','deutsch','germany','indonesia','japan','blurtlatam','blurthispano'], desc:'', posts:[] }
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
  // Basic XSS protection: escape < and >
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  return html
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
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
      { id: 'subsilver', label: 'Classic' },
      { id: 'modern',    label: 'Modern' },
      { id: 'deepnight', label: 'Night' },
      { id: 'ocean',     label: 'Ocean' }
    ];
    const theme = ref(localStorage.getItem('bf-theme') || 'subsilver');
    const setTheme = (id) => {
      theme.value = id;
      localStorage.setItem('bf-theme', id);
      document.body.className = `theme-${id}`;
    };
 
    const config = reactive({
      communityAccount: 'blurt-179874',
      nodes: ['https://rpc.beblurt.com', 'https://rpc.blurt.world'],
      lockedCommunity: false
    });
 
    let client = new dblurt.Client(config.nodes);
 
    const view         = ref('index');
    const loading      = ref(true);
    const repliesLoading = ref(false);
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
      visibleCount: 10
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
    const selectedCommunity = ref('blurt-179874');
    const customTag = ref('');
    const userSubscriptions = ref([]);

    const allCommunities = computed(() => {
      const defaults = [
        { account: 'blurt-179874', title: 'Blurt Polska' },
        { account: 'blurt-129105', title: 'Blurt Market' }
      ];
      const combined = [...defaults];
      userSubscriptions.value.forEach(s => {
        if (!combined.find(c => c.account === s.account)) combined.push(s);
      });
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
    const showLoginModal = ref(false);
    const loginTab  = ref('key');
    const loginForm = reactive({ username: '', key: '', remember: false });
    const loginErr  = ref('');
    const loginBusy = ref(false);
    const wvAvailable = computed(() => typeof window.whalevault !== 'undefined');
 
    const replyTarget = ref(null);
    const replyForm   = reactive({ body: '', loading: false, error: '', success: '', beneficiary: { account: '', weight: '' } });
 
    const showNewPostForm = ref(false);
    const postForm = reactive({ title: '', body: '', loading: false, error: '', success: '', devTip: localStorage.getItem('blurtforum_devtip') !== 'false', beneficiary: { account: '', weight: '' } });

    const payoutModal = reactive({ show: false, post: {}, beneficiaries: [] });
    const notifModal = reactive({ show: false, loading: false, list: [] });
    const oldContentModal = reactive({ show: false, loading: false, author: '', permlink: '', body: '', status: '' });
 
    const fmtDate = (s) => new Date(s.endsWith('Z') ? s : s + 'Z').toLocaleString();
    const renderMD = renderMarkdown;
    const isNestedReply = (r) => {
      if (!activeTopic.value) return false;
      return !(r.parent_author === activeTopic.value.author &&
               r.parent_permlink === activeTopic.value.permlink);
    };
    const getParentBody = (r) => bodyCache[`${r.parent_author}/${r.parent_permlink}`] || '';
 
    const loadData = async (append = false) => {
      if (append) forumPagination.loading = true; else loading.value = true;
      structureNote.value = false;
 
      try {
        if (!append) {
          const props = await client.condenser.getDynamicGlobalProperties();
          globalProps.value = props;
 
          moderators.value = [];
          communityInfo.value = {};
          forumPagination.lastAuthor = '';
          forumPagination.lastPermlink = '';
          forumPagination.hasMore = true;
          forumPagination.fetchedCount = 0;
          forumPagination.visibleCount = 10;
        }

        // Fetch Community Details (Nexus)
        try {
          if (config.communityAccount.startsWith('blurt-')) {
            const cc = await client.nexus.getCommunity(config.communityAccount);
            if (cc) {
              communityInfo.value = {
                title: cc.title || config.communityAccount,
                about: cc.about || ''
              };
              rawDescription.value = cc.description || '';
              const parsed = parseStructure(cc.description);
              if (parsed) {
                if (!append) forumStructure.value = parsed;
              } else if (!append) {
                forumStructure.value = defaultStructure();
                structureNote.value = true;
              }
              if (cc.team) {
                moderators.value = cc.team.map(m => ({ account: m[0], role: m[1], title: m[2] || '' }));
              }
            }
          } else {
            if (!append) {
              forumStructure.value = defaultStructure();
              structureNote.value = true;
            }
          }
        } catch (e) {
          console.warn('Nexus getCommunity error:', e.message);
          if (!append && !forumStructure.value.length) {
            forumStructure.value = defaultStructure();
            structureNote.value = true;
          }
        }

        // Fetch Accounts (Condenser) for title/about fallback
        try {
          const accounts = await client.condenser.getAccounts([config.communityAccount]);
          const acc = accounts && accounts[0];
          if (acc && (!communityInfo.value || !communityInfo.value.title)) {
            let meta = {};
            try { meta = JSON.parse(acc.posting_json_metadata || acc.json_metadata || '{}'); } catch (err) { /* ignore */ }
            const profile = meta.profile || {};
            communityInfo.value = {
              title: profile.name || acc.name,
              about: profile.about || ''
            };
          }
        } catch (e) { console.warn('Condenser getAccounts error:', e.message); }

        // Fetch Roles (Bridge)
        try {
          if (moderators.value.length === 0) {
            const roles = await client.condenser.call('bridge', 'list_community_roles', [{ community: config.communityAccount }]);
            if (Array.isArray(roles) && roles.length > 0) {
              moderators.value = roles.map(r => ({ account: r[0], role: r[1], title: r[2] || '' }));
            }
          }
        } catch (e) { console.warn('Bridge list_community_roles error:', e.message); }

        if (!append) {
          // Ensure "Other" section exists
          let hasOther = false;
          for (const cat of forumStructure.value) {
            for (const forum of cat.forums) {
              if (forum.targetTags.length === 0 || forum.name.toLowerCase().includes('other') || forum.name.toLowerCase().includes('inne')) {
                hasOther = true;
                break;
              }
            }
          }
          if (!hasOther) {
            const otherCat = {
              name: 'General',
              forums: [{
                id: 'f-other',
                name: 'Other / Inne',
                targetTags: [],
                desc: 'Posts that do not fit elsewhere',
                posts: []
              }]
            };
            forumStructure.value.push(otherCat);
          }
          forumStructure.value.forEach(cat => cat.forums.forEach(f => f.posts = []));
        }

        let catchAllForum = null;
        for (const cat of forumStructure.value) {
          for (const forum of cat.forums) {
             if (forum.targetTags.length === 0 || forum.name.toLowerCase().includes('other') || forum.name.toLowerCase().includes('inne')) {
               catchAllForum = forum;
               break;
             }
          }
        }
 
        // Initial load: Render 1st batch immediately, then background
        const query = { tag: config.communityAccount, limit: 100 };
        if (forumPagination.lastAuthor) {
          query.start_author = forumPagination.lastAuthor;
          query.start_permlink = forumPagination.lastPermlink;
        }

        const rawPosts = await client.condenser.getDiscussions('created', query);
        if (!rawPosts || rawPosts.length === 0) {
          forumPagination.hasMore = false;
        } else {
          const slice = (forumPagination.fetchedCount > 0 || append) ? rawPosts.slice(1) : rawPosts;
          processBatch(slice, catchAllForum);
          forumPagination.fetchedCount += slice.length;
          
          if (!append && forumPagination.hasMore && forumPagination.fetchedCount < 300) {
            forumPagination.bgLoading = true;
            (async () => {
              while (forumPagination.fetchedCount < 300 && forumPagination.hasMore) {
                const q = { tag: config.communityAccount, limit: 100, start_author: forumPagination.lastAuthor, start_permlink: forumPagination.lastPermlink };
                const res = await client.condenser.getDiscussions('created', q);
                if (!res || res.length <= 1) { forumPagination.hasMore = false; break; }
                const s = res.slice(1);
                processBatch(s, catchAllForum);
                forumPagination.fetchedCount += s.length;
              }
              forumPagination.bgLoading = false;
            })();
          }
        }
 
      } catch (err) {
        console.error('loadData error:', err);
        if (!forumStructure.value.length) forumStructure.value = defaultStructure();
        structureNote.value = true;
      }
      loading.value = false;
      forumPagination.loading = false;
    };

    const normalizePost = (p) => {
      let tags = [];
      try { tags = JSON.parse(p.json_metadata || '{}').tags || []; } catch (e) { /* ignore */ }
      return {
        author: p.author,
        permlink: p.permlink,
        title: p.title || '(no title)',
        body: p.body,
        created: p.created,
        parent_author: p.parent_author || '',
        parent_permlink: p.parent_permlink || '',
        pendingPayout: parsePayout(p.pending_payout_value),
        totalPayout: parsePayout(p.total_payout_value),
        payout: parsePayout(p.total_payout_value) + parsePayout(p.pending_payout_value),
        vote_count: p.active_votes ? p.active_votes.length : (p.net_votes || 0),
        active_votes: p.active_votes || [],
        net_rshares: parseFloat(p.net_rshares || 0),
        beneficiaries: p.beneficiaries || [],
        json_metadata: p.json_metadata,
        tags
      };
    };

    const processBatch = (slice, catchAllForum) => {
      if (slice.length === 0) return;
      const last = slice[slice.length - 1];
      forumPagination.lastAuthor = last.author;
      forumPagination.lastPermlink = last.permlink;
      if (slice.length < 99) forumPagination.hasMore = false;

      slice.forEach(p => {
        const post = normalizePost(p);
        bodyCache[`${p.author}/${p.permlink}`] = p.body;

        let assigned = false;
        for (const cat of forumStructure.value) {
          for (const forum of cat.forums) {
            if (forum === catchAllForum) continue;
            if (forum.targetTags.length > 0 && forum.targetTags.some(tag => post.tags.includes(tag))) {
              if (!forum.posts.find(fp => fp.permlink === post.permlink && fp.author === post.author)) {
                forum.posts.push(post);
              }
              assigned = true;
            }
          }
        }

        if (!assigned && catchAllForum) {
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
        
        if (!forumPagination.hasMore) return;
        
        const prevCount = activeForum.value.posts.length;
        await loadData(true);
        attempts++;
        
        if (activeForum.value.posts.length > prevCount) {
          forumPagination.visibleCount += 10;
          return;
        }
      }
    };

 
    const loadReplies = async (author, permlink) => {
      repliesLoading.value = true;
      replies.value = [];
      replyTarget.value = null;
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
      replies.value = flat.sort((a, b) => new Date(a.created) - new Date(b.created));
      repliesLoading.value = false;
    };
 
    const syncUrl = () => {
      const params = new URLSearchParams();
      params.set('community', config.communityAccount);
      if (view.value !== 'index') params.set('view', view.value);
      
      if (view.value === 'topic' && activeTopic.value) {
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
      activeForum.value = forum;
      view.value = 'forum';
      activeTopic.value = null;
      showNewPostForm.value = false;
      syncUrl();
    };
 
    const openTopic = (topic) => {
      activeTopic.value = { ...topic, beneficiaries: topic.beneficiaries || [] };
      bodyCache[`${topic.author}/${topic.permlink}`] = topic.body;
      view.value = 'topic';
      loadReplies(topic.author, topic.permlink);
      syncUrl();

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
          profileUser.data = accounts[0];
          const bp = parseFloat(accounts[0].vesting_shares || 0) * 
                     (parseFloat(globalProps.value.total_vesting_fund_blurt || 0) / 
                      parseFloat(globalProps.value.total_vesting_shares || 1));
          profileUser.data.walletValue = (parseFloat(accounts[0].balance || 0) + bp).toFixed(3);
          
          try {
            const meta = JSON.parse(accounts[0].posting_json_metadata || accounts[0].json_metadata || '{}');
            profileUser.data.about = meta.profile ? meta.profile.about : '';
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
 
    const handleCommunityChange = () => {
      const tag = selectedCommunity.value === 'custom' ? customTag.value.trim() : selectedCommunity.value;
      if (!tag) return;
      config.communityAccount = tag;
      client = new dblurt.Client(config.nodes);
      goHome();
      loadData();
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
 
    const startReply = (target) => {
      replyTarget.value = target;
      replyForm.body = '';
      replyForm.error = '';
      replyForm.success = '';
    };

    const bcWait = reactive({ active: false, progress: 0, label: '' });

    const waitAndReload = async (isTopic, author = null, permlink = null, pollFn = null, label = null) => {
      bcWait.active = true;
      bcWait.progress = 0;
      bcWait.label = label || t('waitingForBlock');

      const maxMs = 15000;
      const pollMs = 1500;
      const start = Date.now();
      let lastContent = null;

      if (author && permlink) {
        while (Date.now() - start < maxMs) {
          bcWait.progress = Math.min(((Date.now() - start) / maxMs) * 90, 90);
          await new Promise(r => setTimeout(r, pollMs));
          try {
            const c = await client.condenser.getContent(author, permlink);
            if (c && c.author) {
              lastContent = c;
              if (!pollFn || pollFn(c)) break;
            }
          } catch (e) { /* ignore */ }
        }
      } else {
        while (Date.now() - start < 4000) {
          bcWait.progress = Math.min(((Date.now() - start) / 4000) * 90, 90);
          await new Promise(r => setTimeout(r, 300));
        }
      }

      bcWait.progress = 95;
      if (isTopic && activeTopic.value) {
        await loadReplies(activeTopic.value.author, activeTopic.value.permlink);
        // Refresh main post too if we polled it
        if (lastContent && activeTopic.value &&
            lastContent.author === activeTopic.value.author &&
            lastContent.permlink === activeTopic.value.permlink) {
          const refreshed = normalizePost(lastContent);
          activeTopic.value = { ...activeTopic.value, ...refreshed };
        } else if (activeTopic.value) {
          // Always re-fetch main post when in topic view
          try {
            const fresh = await client.condenser.getContent(activeTopic.value.author, activeTopic.value.permlink);
            if (fresh && fresh.author) activeTopic.value = { ...activeTopic.value, ...normalizePost(fresh) };
          } catch (e) { /* ignore */ }
        }
      } else {
        await loadData();
      }
      bcWait.progress = 100;
      await new Promise(r => setTimeout(r, 200));
      bcWait.active = false;
      bcWait.progress = 0;
    };
 
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

      const options = ['comment_options', {
        author: auth.user.username,
        permlink: op[1].permlink,
        max_accepted_payout: '1000000.000 BLURT',
        percent_steem_dollars: 10000,
        allow_votes: true,
        allow_curation_rewards: true,
        extensions: [[0, { beneficiaries }]]
      }];

      try {
        await broadcast([op, options]);
        replyForm.success = t('replySuccess');
        replyForm.body = '';
        replyTarget.value = null;
        waitAndReload(true, auth.user.username, op[1].permlink);
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
      const extraTags = activeForum.value.targetTags.filter(t => t !== config.communityAccount);
      const tags = [config.communityAccount, ...extraTags].slice(0, 5);

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

      const options = ['comment_options', {
        author: auth.user.username,
        permlink: op[1].permlink,
        max_accepted_payout: '1000000.000 BLURT',
        percent_steem_dollars: 10000,
        allow_votes: true,
        allow_curation_rewards: true,
        extensions: [[0, { beneficiaries }]]
      }];

      try {
        await broadcast([op, options]);
        postForm.success = t('postSuccess');
        postForm.title = '';
        postForm.body = '';
        showNewPostForm.value = false;
        waitAndReload(false, auth.user.username, op[1].permlink);
      } catch (err) {
        console.error('Post error:', err);
        postForm.error = t('postError') + ' (' + (err.message || '') + ')';
      }
      postForm.loading = false;
    };

    const submitVote = async (post) => {
      if (!auth.user) { openLoginModal(); return; }
      
      // Check if post is older than 7 days
      const created = new Date(post.created.endsWith('Z') ? post.created : post.created + 'Z').getTime();
      const isOld = (Date.now() - created) > (7 * 24 * 60 * 60 * 1000);

      if (isOld) {
        oldContentModal.author = post.author;
        oldContentModal.permlink = post.permlink;
        oldContentModal.body = 'Supporting original content by @' + post.author;
        oldContentModal.status = '';
        oldContentModal.loading = false;
        oldContentModal.show = true;
        return;
      }

      let weight = 10000;
      if (hasVoted(post)) {
        if (!confirm(t('confirmUnvote'))) return;
        weight = 0;
      }

      const op = ['vote', {
        voter: auth.user.username,
        author: post.author,
        permlink: post.permlink,
        weight
      }];
      try {
        await broadcast([op]);
        const voter = auth.user.username;
        const isUnvote = weight === 0;
        waitAndReload(
          view.value === 'topic',
          post.author,
          post.permlink,
          (c) => {
            const votes = c.active_votes || [];
            return isUnvote
              ? !votes.some(v => v.voter === voter && v.percent > 0)
              : votes.some(v => v.voter === voter && v.percent > 0);
          },
          t('syncingWithBlockchain')
        );
      } catch (err) {
        console.error('Vote error:', err);
      }
    };

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
        { community: config.communityAccount, author: post.author, permlink: post.permlink, notes: 'Muted via BlurtForum' }
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
      const isPaid = post.totalPayout > 0;
      const dateObj = new Date(post.created.endsWith('Z') ? post.created : post.created + 'Z');
      dateObj.setDate(dateObj.getDate() + 7);
      
      payoutModal.post = {
        ...post,
        isPaid,
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
        const list = await client.condenser.call('bridge', 'get_notifications', [{ account: auth.user.username, limit: 30 }]);
        notifModal.list = list || [];
      } catch (err) {
        console.error('Notif error:', err);
      }
      notifModal.loading = false;
    };

    const openNotification = async (notif) => {
      notifModal.show = false;
      loading.value = true;
      
      try {
        let content = await client.condenser.getContent(notif.author, notif.permlink);
        if (content && content.author) {
          let root = content;
          if (content.parent_author) {
             const parts = content.url.split('#')[0].split('/');
             // url format: /category/@author/permlink
             const rootAuthor = parts[2].replace('@', '');
             const rootPermlink = parts[3];
             root = await client.condenser.getContent(rootAuthor, rootPermlink);
          }
          
          let targetCommunity = root.category;
          if (targetCommunity && targetCommunity.startsWith('blurt-') && targetCommunity !== config.communityAccount) {
            if (config.lockedCommunity) {
               console.log('Cannot switch community, locked to:', config.communityAccount);
            } else {
               config.communityAccount = targetCommunity;
               client = new dblurt.Client(config.nodes);
               await loadData();
            }
          }
          
          openTopic(normalizePost(content));
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

      auth.user = { username, type: 'key', key, vp };
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
        if (acc) {
          const lastVoteTime = new Date(acc.last_vote_time + 'Z').getTime();
          const now = new Date().getTime();
          const delta = (now - lastVoteTime) / 1000;
          vp = acc.voting_power + (10000 * delta / 432000);
          vp = Math.min(vp / 100, 100).toFixed(2);
        }

        auth.user = { username, type: 'whalevault', key: null, vp };
        // WhaleVault session doesn't need PIN as keys aren't stored
        localStorage.setItem('bf-session', JSON.stringify({ username, type: 'whalevault', expires: Date.now() + (24 * 60 * 60 * 1000) }));
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
        const subs = await client.condenser.call('bridge', 'list_communities', { last: '', limit: 100, query: username });
        if (subs && Array.isArray(subs)) {
          userSubscriptions.value = subs.map(s => ({ account: s.name, title: s.title }));
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
 
    onMounted(() => {
      setTheme(theme.value);
      
      // Restore session
      const saved = localStorage.getItem('blurtforum_session');
      if (saved) {
        const session = JSON.parse(saved);
        if (session.expires > Date.now()) {
          if (session.type === 'whalevault') {
            auth.user = { username: session.username, type: 'whalevault', key: null, vp: '…' };
            loadUserCommunities(session.username);
          } else {
            pinModal.mode = 'unlock';
            pinModal.show = true;
          }
        } else {
          localStorage.removeItem('blurtforum_session');
        }
      }

      const params = new URLSearchParams(window.location.search);
      const comm = params.get('community');
      if (comm) {
        config.communityAccount = comm;
        config.lockedCommunity = true;
        selectedCommunity.value = 'custom';
        customTag.value = comm;
      }

      const requestedView = params.get('view');
      const requestedAuthor = params.get('author');
      const requestedPermlink = params.get('permlink');
      const requestedUser = params.get('user');

      loadData().then(() => {
        if (requestedView === 'topic' && requestedAuthor && requestedPermlink) {
           client.condenser.getContent(requestedAuthor, requestedPermlink).then(content => {
              if (content && content.author) openTopic(normalizePost(content));
           });
        } else if (requestedView === 'profile' && requestedUser) {
           openProfile(requestedUser);
        }
      });
    });

 
    return {
      lang, setLang, langs, t, theme, setTheme, themes, config, view, loading, globalProps, forumStructure,
      activeForum, activeTopic, replies, repliesLoading, moderators, communityInfo,
      structureNote, selectedCommunity, customTag, allCommunities, auth, showLoginModal, loginTab,
      loginForm, loginErr, loginBusy, wvAvailable, replyTarget, replyForm,
      showNewPostForm, postForm, fmtDate, renderMD, isNestedReply, getParentBody,
      goHome, openForum, openTopic, handleCommunityChange, openLoginModal,
      doKeyLogin, doWVLogin, logout, startReply, submitReply, submitPost, loadData,
      submitVote, hasVoted, openPayoutModal, payoutModal, openNotifModal, notifModal,
      openProfile, profileUser, profileTab, openNotification,
      userRole, canEditStructure, canMute, mutePost, editStructureMode, startEditStructure, saveStructure,
      structureForm, showStructureDocs,
      forumPagination, loadMorePosts,
      pinModal, handlePinSubmit,
      editModal, startEdit, submitEdit,
      oldContentModal, submitSupportComment,
      bcWait
    };
  }
}).mount('#app');
