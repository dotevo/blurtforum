/**
 * BlurtForum Parser — Markdown and Rich Media Embedding
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { MediaTrack } from '../types';

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

      const tokenize = (content: string) => {
        const id = `XBFMEDIATKNX${tokenCounter++}X`;
        tokens[id] = content;
        return id;
      };

      let processedText = text;

      // 1. Extract explicit <iframe> tags FIRST
      processedText = processedText.replace(/<iframe[^>]+src=["']([^"']+)["'][^>]*>.*?<\/iframe>/gi, (match, src) => {
        const media = this.detectMedia(src);
        if (media) {
          return tokenize(this.getExperimentalPlaceholder(media.type, media.id, media.host || '', context));
        }
        return tokenize(this.getIframePlaceholder(src));
      });

      // 2. Extract raw media links
      const lines = processedText.split('\n');
      const processedLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('XBFMEDIATKNX') || trimmed.startsWith('![') || (trimmed.startsWith('[') && !trimmed.startsWith('[['))) return line;
        
        const urlRegex = /(https?:\/\/[^\s\)]+)/g;
        return line.replace(urlRegex, (url) => {
          const cleanUrl = url.replace(/[).,;]$/, '');
          const media = this.detectMedia(cleanUrl);
          if (media) {
            return tokenize(this.getExperimentalPlaceholder(media.type, media.id, media.host || '', context));
          }
          return url;
        });
      });
      processedText = processedLines.join('\n');

      // 3. Handle explicit [[MEDIA:...]] syntax
      processedText = processedText.replace(/\[\[MEDIA:([^:]+):([^:\]]+):([^:\]]*)\]\]/g, (_match, type, id, host) => {
        return tokenize(this.getExperimentalPlaceholder(type, id, host, context));
      });

      // 4. Fix for nested image URLs (Proxy bypass)
      processedText = processedText.replace(/!\[(.*?)\]\((https?:\/\/.*?\/)(https?:\/\/.*?)\)/g, (match, alt, proxy, nested) => {
        return `![${alt}](${nested})`;
      });

      // 5. Render Markdown
      let html = marked.parse(processedText, { breaks: true, gfm: true }) as string;

      // 6. Restore Tokens
      Object.entries(tokens).forEach(([token, replacement]) => {
        html = html.split(token).join(replacement);
      });

      // 7. Mentions
      html = html.replace(
        /(^|[^a-zA-Z0-9_!#$%&*@/])@([a-z0-9.-]+[a-z0-9])/g,
        '$1<a href="#" class="mention" data-user="$2">@$2</a>'
      );

      // 8. Sanitize
      return DOMPurify.sanitize(html, {
        ADD_TAGS: ['button', 'img', 'forum-media', 'forum-iframe'],
        ADD_ATTR: [
          'allow', 'allowfullscreen', 'frameborder', 'scrolling', 'style', 'sandbox',
          'data-type', 'data-id', 'data-host', 'data-title', 'data-author',
          'data-src', 'data-cover', 'src', 'alt', 'data-permlink', 'class',
          'data-pending', 'mode'
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
    if (ytMatch) return { type: 'youtube', id: ytMatch[1] };
    const sunoSongMatch = text.match(/https?:\/\/(?:www\.)?suno\.com\/song\/([a-zA-Z0-9-]+)/);
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

    // Combined regex for all supported media links
    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    const matches = text.matchAll(urlRegex);
    
    for (const match of matches) {
      const url = match[0].replace(/[).,;]$/, '');
      const media = this.detectMedia(url);
      if (media && !seen.has(`${media.type}:${media.id}`)) {
        seen.add(`${media.type}:${media.id}`);
        results.push(media);
      }
    }
    
    // Explicit syntax
    const explicitMatches = text.matchAll(/\[\[MEDIA:([^:]+):([^:\]]+):([^:\]]*)\]\]/g);
    for (const match of explicitMatches) {
      const [, type, id, host] = match;
      if (!seen.has(`${type}:${id}`)) {
        seen.add(`${type}:${id}`);
        results.push({ type, id, host });
      }
    }

    return results;
  },

  getExperimentalPlaceholder(type: string, id: string, host: string, context: ParseContext | null = null): string {
    const title = (context?.title || 'Media Content').replace(/"/g, '&quot;');
    const author = context?.author || 'post';
    const permlink = context?.permlink || '';
    const isPending = (type === 'audio' && id.length < 30) || (type === 'peertube');

    return `<div class="forum-media-card-wrapper">
              <forum-media data-type="${type}" data-id="${id}" data-host="${host}" 
                 data-title="${title}" data-author="${author}" data-permlink="${permlink}"
                 data-pending="${isPending}"
                 mode="card"></forum-media>
            </div>`;
  },
};
