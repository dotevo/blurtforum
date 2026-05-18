/**
 * Utility functions for BlurtForum
 */

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
    let html = marked.parse(text, { breaks: true, gfm: true });
    html = html.replace(/(^|[^a-zA-Z0-9_!#$%&*@/])@([a-z0-9.-]+[a-z0-9])/g, '$1<a href="#" class="mention" data-user="$2">@$2</a>');
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

// Global mention detector for sanitized DOMPurify content
document.addEventListener('click', (e) => {
  const target = e.target.closest('.mention');
  if (target) {
    e.preventDefault();
    const username = target.getAttribute('data-user');
    if (username && window.app && typeof window.app.openProfile === 'function') {
      window.app.openProfile(username);
    }
  }
});
