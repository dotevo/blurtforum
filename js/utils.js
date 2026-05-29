const BFUtils = {
  fmtDate(s) {
    if (!s) return '';
    try {
      return new Date(s.endsWith('Z') ? s : s + 'Z').toLocaleString();
    } catch (e) { return s || ''; }
  },

  timeAgo(s, tFunc) {
    if (!s) return '';
    try {
      const date = new Date(s.endsWith('Z') ? s : s + 'Z');
      const diff = Math.floor((Date.now() - date.getTime()) / 1000);
      
      const t = tFunc || ((k) => k);

      if (diff < 60)     return `${diff}${t('secAgo') || 's'} ${t('ago') || 'ago'}`;
      if (diff < 3600)   return `${Math.floor(diff / 60)}${t('minAgo') || 'm'} ${t('ago') || 'ago'}`;
      if (diff < 86400)  return `${Math.floor(diff / 3600)}${t('hourAgo') || 'h'} ${t('ago') || 'ago'}`;
      if (diff < 604800) return `${Math.floor(diff / 86400)}${t('dayAgo') || 'd'} ${t('ago') || 'ago'}`;
      return date.toLocaleDateString();
    } catch (e) { return ''; }
  },

  genPermlink(title) {
    const slug = (title || 'post')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 200);
    return `${slug}-${Date.now().toString(36)}`;
  },

  parsePayout(val) {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseFloat(val.split(' ')[0]) || 0;
    return 0;
  },

  parseStructure(text) {
    if (!text) return null;
    const categories = [];
    let currentCat = null;
    const lines = text.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('##')) {
        currentCat = { name: trimmed.replace('##', '').trim(), forums: [] };
        categories.push(currentCat);
      } else if (trimmed.startsWith('>') && currentCat) {
        const parts = trimmed.substring(1).split('|').map(s => s.trim());
        if (parts.length >= 2) {
          const name = parts[0];
          const tags = parts[1].split(',').map(t => t.trim().toLowerCase());
          // Stable ID based on tags or name slug
          const stableId = tags.length > 0 ? tags[0] : name.toLowerCase().replace(/[^a-z0-9]/g, '-');
          
          currentCat.forums.push({
            id: stableId,
            name,
            targetTags: tags,
            desc: parts[2] || '',
            posts: [], lastAuthor: '', lastPermlink: '', hasMore: true, pageHistory: []
          });
        }
      }
    });
    return categories.length > 0 ? categories : null;
  },

  defaultStructure() {
    return [
      {
        name: 'General',
        forums: [
          { id:'f1', name:'General Talk',       targetTags:['blurt-140455','blurt','blurtforum','general','talk'], desc:'General community discussions', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true },
          { id:'f2', name:'Introductions',      targetTags:['introduceyourself','intro','hello'], desc:'Say hello to the community', posts:[], lastAuthor: '', lastPermlink: '', hasMore: true }
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
};

// Global mention detector for sanitized DOMPurify content
document.addEventListener('click', (e) => {
  const target = e.target.closest('.mention');
  if (target) {
    e.preventDefault();
    const username = target.getAttribute('data-user');
    if (window.app && typeof window.app.openProfile === 'function') {
      window.app.openProfile(username);
    }
  }
});

// Legacy global functions for compatibility
const genPermlink = BFUtils.genPermlink;
const parsePayout = BFUtils.parsePayout;
const parseStructure = BFUtils.parseStructure;
const defaultStructure = BFUtils.defaultStructure;
