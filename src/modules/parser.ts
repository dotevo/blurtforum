/**
 * BlurtForum Parser — Markdown and Rich Media Embedding
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface ParseContext {
  title?: string;
  author?: string;
  permlink?: string;
  body?: string;
}

export const Parser = {
  /** Main entry point: renders markdown with rich media embeds */
  render(text: string, context: ParseContext | null = null): string {
    if (!text) return '';
    try {
      const tokens: Record<string, string> = {};
      let tokenCounter = 0;
      let currentGroup = '';
      const typeCounters: Record<string, number> = {};
      const seenMedia = new Set<string>();

      const tokenize = (content: string) => {
        const id = `XBFTOKEN${tokenCounter++}X`;
        tokens[id] = content;
        return id;
      };

      const slugify = (str: string) => str.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

      let processedText = text;

      // 0. Protect HTML tags that often wrap Markdown
      // We tokenize them so marked treats the content between them as Markdown
      const tagsToTokenize = ['center', 'sub', 'sup', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'blockquote', 'p'];
      tagsToTokenize.forEach(tag => {
        const startRegex = new RegExp(`<${tag}(?:\\s+[^>]*)?>`, 'gi');
        const endRegex = new RegExp(`</${tag}>`, 'gi');
        processedText = processedText.replace(startRegex, (m) => tokenize(m));
        processedText = processedText.replace(endRegex, (m) => tokenize(m));
      });

      // 1. Protect existing Markdown links and images from auto-embedding
      const mdLinkRegex = /(!?\[.*?\]\(\s*https?:\/\/[^\s\)]+\s*\))/g;
      const mdTokens: Record<string, string> = {};
      let mdTokenCounter = 0;
      processedText = processedText.replace(mdLinkRegex, (match) => {
        const id = `XBFMDTKN${mdTokenCounter++}X`;
        mdTokens[id] = match;
        return id;
      });

      // 2. Tokenize explicit <iframe> tags
      processedText = processedText.replace(/<iframe[^>]+src=["']([^"']+)["'][^>]*>.*?<\/iframe>/gi, (match, src) => {
        const media = this.detectMedia(src);
        if (media) {
          const mediaKey = `${media.type}:${media.id}`;
          if (seenMedia.has(mediaKey)) return match;
          seenMedia.add(mediaKey);
          typeCounters[media.type] = (typeCounters[media.type] || 0) + 1;
          return tokenize(this.getExperimentalPlaceholder(media.type, media.id, media.host || '', context, currentGroup, typeCounters[media.type]));
        }
        return tokenize(this.getIframePlaceholder(src));
      });

      // 3. Process line by line for headers and raw links
      const lines = processedText.split('\n');
      let finalLines: string[] = [];

      for (let line of lines) {
        const trimmed = line.trim();
        
        // Header tracking
        const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
          currentGroup = slugify(headerMatch[2]);
          finalLines.push(line);
          continue;
        }

        // Auto-embed raw media links and auto-link images
        const urlRegex = /(https?:\/\/[^\s\)\>\]<"']+)/g;
        line = line.replace(urlRegex, (url) => {
          const cleanUrl = url.replace(/[).,;]$/, '');
          
          // Media Check
          const media = this.detectMedia(cleanUrl);
          if (media) {
            const mediaKey = `${media.type}:${media.id}`;
            if (seenMedia.has(mediaKey)) return url; // Already embedded
            seenMedia.add(mediaKey);
            typeCounters[media.type] = (typeCounters[media.type] || 0) + 1;
            return tokenize(this.getExperimentalPlaceholder(media.type, media.id, media.host || '', context, currentGroup, typeCounters[media.type]));
          }
          
          // Image Check (naked URLs)
          if (/\.(png|jpg|jpeg|gif|webp|svg)(?:\?.*)?$/i.test(cleanUrl)) {
            return `![image](${cleanUrl})`;
          }

          return url;
        });

        // Explicit [[MEDIA:...]]
        line = line.replace(/\[\[MEDIA:([^:]+):([^:\]]+):([^:\]]*)\]\]/g, (_match, type, id, host) => {
          const mediaKey = `${type}:${id}`;
          if (seenMedia.has(mediaKey)) return '';
          seenMedia.add(mediaKey);
          typeCounters[type] = (typeCounters[type] || 0) + 1;
          return tokenize(this.getExperimentalPlaceholder(type, id, host, context, currentGroup, typeCounters[type]));
        });

        finalLines.push(line);
      }

      processedText = finalLines.join('\n');

      // 4. Restore MD links BEFORE parsing markdown so marked can handle them
      Object.entries(mdTokens).forEach(([token, replacement]) => {
        processedText = processedText.split(token).join(replacement);
      });

      // 4.5. Fix for nested image URLs (Proxy bypass)
      const unproxy = (url: string): string => {
        const lastHttp = url.lastIndexOf('http');
        if (lastHttp > 0) return url.substring(lastHttp);
        return url;
      };

      processedText = processedText.replace(/!\[(.*?)\]\((https?:\/\/.*?)\)/g, (_match, alt, url) => {
        return `![${alt}](${unproxy(url)})`;
      });

      // 5. Render Markdown
      let html = marked.parse(processedText, { breaks: true, gfm: true }) as string;

      // 6. Restore Media and HTML Tokens
      let iterations = 0;
      while (html.includes('XBFTOKEN') && iterations < 5) {
        Object.entries(tokens).forEach(([token, replacement]) => {
            html = html.split(token).join(replacement);
        });
        iterations++;
      }

      // 7. Mentions
      html = html.replace(
        /(^|[^a-zA-Z0-9_!#$%&*@/])@([a-z0-9.-]+[a-z0-9])/g,
        '$1<a href="#" class="mention" data-user="$2">@$2</a>'
      );

      // 8. Sanitize
      return DOMPurify.sanitize(html, {
        ADD_TAGS: ['button', 'img', 'forum-media', 'forum-iframe', 'sub', 'sup', 'center'],
        ADD_ATTR: [
          'allow', 'allowfullscreen', 'frameborder', 'scrolling', 'style', 'sandbox',
          'data-type', 'data-id', 'data-host', 'data-title', 'data-author',
          'data-src', 'data-cover', 'src', 'alt', 'data-permlink', 'class',
          'data-pending', 'mode', 'data-group', 'data-index'
        ],
      });
    } catch (e) {
      console.error('Parser error:', e);
      return text;
    }
  },

  getIframePlaceholder(url: string): string {
    return `<div class="forum-media-card-wrapper">
              <forum-iframe data-src="${url}"></forum-iframe>
            </div>`;
  },

  /** Detects media type from text */
  detectMedia(text: string | undefined): any | null {
    if (!text) return null;
    const ytMatch = text.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|v\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) {
      const id = ytMatch[1];
      return { type: 'youtube', id, thumb: `https://img.youtube.com/vi/${id}/0.jpg` };
    }
    const sunoSongMatch = text.match(/https?:\/\/(?:www\.)?suno.com\/song\/([a-zA-Z0-9-]+)/);
    if (sunoSongMatch) return { type: 'audio', id: sunoSongMatch[1], src: `https://cdn1.suno.ai/${sunoSongMatch[1]}.mp3`, cover: `https://cdn2.suno.ai/image_large_${sunoSongMatch[1]}.jpeg` };
    const sunoShareMatch = text.match(/https?:\/\/(?:www\.)?suno\.com\/s\/([a-zA-Z0-9]+)/);
    if (sunoShareMatch) return { type: 'audio', id: sunoShareMatch[1], pending: true };
    const ptMatch = text.match(/https?:\/\/([a-zA-Z0-9.-]+)\/(?:w|videos\/watch|videos\/embed)\/([a-zA-Z0-9-]+)/);
    if (ptMatch) return { type: 'peertube', id: ptMatch[2], host: ptMatch[1] };
    const audioMatch = text.match(/https?:\/\/[^\s\)]+\.(mp3|wav|ogg|m4a|flac)(\?.*)?/i);
    if (audioMatch) {
      const url = audioMatch[0].replace(/[).,;]$/, '');
      return { type: 'audio', id: btoa(url), src: url };
    }
    return null;
  },

  /** Extracts all unique media items from text using a robust regex-based approach */
  extractAllMedia(text: string | undefined): any[] {
    if (!text) return [];
    const results: any[] = [];
    const seen = new Set<string>();
    let currentGroup = '';
    const typeCounters: Record<string, number> = {};

    const slugify = (str: string) => str.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Track headers to maintain context
      const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        currentGroup = slugify(headerMatch[2]);
      }

      // 1. Skip links that are inside Markdown link syntax [text](url)
      // First, find all such links and temporarily remove them or ignore their URLs
      let processedLine = trimmed.replace(/!?(?:\[.*?\]\(\s*https?:\/\/[^\s\)]+\s*\))/g, ' [MDLINK] ');

      // 2. Detect links in processed line
      const urlRegex = /(?:https?:\/\/[^\s\)\>\]<"']+)/g;
      const matches = processedLine.matchAll(urlRegex);
      for (const match of matches) {
        const url = match[0].replace(/[).,;]$/, '');
        const media = this.detectMedia(url);
        if (media) {
          const key = `${media.type}:${media.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            typeCounters[media.type] = (typeCounters[media.type] || 0) + 1;
            results.push({ ...media, group: currentGroup, typeIndex: typeCounters[media.type] });
          }
        }
      }

      // 3. Explicit syntax
      const explicitMatches = trimmed.matchAll(/\[\[MEDIA:([^:]+):([^:\]]+):([^:\]]*)\]\]/g);
      for (const match of explicitMatches) {
        const [, type, id, host] = match;
        const key = `${type}:${id}`;
        if (!seen.has(key)) {
          seen.add(key);
          typeCounters[type] = (typeCounters[type] || 0) + 1;
          results.push({ type, id, host, group: currentGroup, typeIndex: typeCounters[type] });
        }
      }
    }

    return results;
  },

  getExperimentalPlaceholder(type: string, id: string, host: string, context: ParseContext | null = null, group: string = '', index: number = 0): string {
    const title = (context?.title || 'Media Content').replace(/"/g, '&quot;');
    const author = context?.author || 'post';
    const permlink = context?.permlink || '';
    const isPending = (type === 'audio' && id.length < 30) || (type === 'peertube');

    return `<div class="forum-media-card-wrapper">
              <forum-media data-type="${type}" data-id="${id}" data-host="${host}" 
                 data-title="${title}" data-author="${author}" data-permlink="${permlink}"
                 data-pending="${isPending}" data-group="${group}" data-index="${index}"
                 mode="card"></forum-media>
            </div>`;
  },
};
