/**
 * BlurtForum Utility Functions
 */
import type { ForumCategory, Forum } from '../types';
import { trackEvent } from './analytics';

type TranslateFn = (key: string) => string;

export const BFUtils = {
  fmtDate(s: string | undefined): string {
    if (!s) return '';
    try {
      return new Date(s.endsWith('Z') ? s : s + 'Z').toLocaleString();
    } catch {
      return s || '';
    }
  },

  timeAgo(s: string | undefined, tFunc?: TranslateFn): string {
    if (!s) return '';
    try {
      const date = new Date(s.endsWith('Z') ? s : s + 'Z');
      const diff = Math.floor((Date.now() - date.getTime()) / 1000);
      const t = tFunc ?? ((k: string) => k);

      if (diff < 60)     return `${diff}${t('secAgo')} ${t('ago')}`;
      if (diff < 3600)   return `${Math.floor(diff / 60)}${t('minAgo')} ${t('ago')}`;
      if (diff < 86400)  return `${Math.floor(diff / 3600)}${t('hourAgo')} ${t('ago')}`;
      if (diff < 604800) return `${Math.floor(diff / 86400)}${t('dayAgo')} ${t('ago')}`;
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  },

  genPermlink(title: string): string {
    const slug = (title || 'post')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 200);
    const permlink = `${slug}-${Date.now().toString(36)}`;
    trackEvent('generate_permlink', 'content', title);
    return permlink;
  },

  parsePayout(val: string | number | undefined): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseFloat(val.split(' ')[0]) || 0;
    return 0;
  },

  parseStructure(text: string | undefined): ForumCategory[] | null {
    if (!text) return null;
    const categories: ForumCategory[] = [];
    let currentCat: ForumCategory | null = null;
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
          const stableId = tags.length > 0 ? tags[0] : name.toLowerCase().replace(/[^a-z0-9]/g, '-');
          currentCat.forums.push({
            id: stableId,
            name,
            targetTags: tags,
            desc: parts[2] || '',
            posts: [],
            lastAuthor: '',
            lastPermlink: '',
            hasMore: true,
            pageHistory: [],
          });
        }
      }
    });
    return categories.length > 0 ? categories : null;
  },

  defaultStructure(): ForumCategory[] {
    const f = (id: string, name: string, targetTags: string[], desc = ''): Forum => ({
      id, name, targetTags, desc, posts: [], lastAuthor: '', lastPermlink: '', hasMore: true, pageHistory: [],
    });
    return [
      { name: 'General', forums: [
        f('f1', 'General Talk',       ['blurt-140455','blurt','blurtforum','general','talk'], 'General community discussions'),
        f('f2', 'Introductions',      ['introduceyourself','intro','hello'], 'Say hello to the community'),
      ]},
      { name: 'Arts & Media', forums: [
        f('f3', 'Art & Photography',  ['art','blurtart','photography','stockphotos']),
        f('f4', 'Videos & Podcasts',  ['video','podcast','music','gymmusic']),
        f('f5', 'Gaming',             ['games','game','arcadecolony']),
      ]},
      { name: 'News & World', forums: [
        f('f6', 'General News',       ['news','activistpost','centurywire','thepeoplesvoice']),
        f('f7', 'Politics & Society', ['politics','antiwar','war','truth','reclaimthenet','naturalnews']),
      ]},
      { name: 'Science & Tech', forums: [
        f('f8', 'Development',        ['dev','computing','ai','research']),
      ]},
      { name: 'Community & Meta', forums: [
        f('f9', 'Blurt Meta',         ['blurt','blurtecho','proposals','witness-category']),
        f('f10','Contests & Rewards', ['blurtcontests','rewards']),
      ]},
      { name: 'Regional', forums: [
        f('f11','Polska (Poland)',     ['polish','polska','kresy','strefa44']),
        f('f12','International',      ['kr','cn','deutsch','germany','indonesia','japan','blurtlatam','blurthispano']),
      ]},
    ];
  },
};
