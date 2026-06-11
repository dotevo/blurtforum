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
  cover?: string;
}

export const Parser = {
  /** Main entry point: renders markdown with rich media embeds */
  render(text: string, context: ParseContext | null = null): string {
    if (!text) return '';
    try {
      const tokens: Record<string, string> = {};
      let tokenCounter = 0;

      // Helper to store a component and return a safe token
      // Alphanumeric tokens are ignored by Markdown's formatting and auto-linkers
      const tokenize = (content: string) => {
        const id = `XBFMEDIATKNX${tokenCounter++}X`;
        tokens[id] = content;
        return id;
      };

      let processedText = text;

      // 1. Extract explicit <iframe> tags FIRST
      // This hides the URLs inside src from both marked and autoEmbed
      processedText = processedText.replace(/<iframe[^>]+src=["']([^"']+)["'][^>]*>.*?<\/iframe>/gi, (match, src) => {
        const media = this.detectMedia(src);
        if (media) {
          // If it's a known media source, we can skip the iframe gate and show card immediately
          return tokenize(this.getExperimentalPlaceholder(media.type, media.id, media.host || '', context, media.cover));
        }
        return tokenize(this.getIframePlaceholder(src));
      });

      // 2. Extract raw media links (line-based detection)
      const lines = processedText.split('\n');
      const processedLines = lines.map(line => {
        const trimmed = line.trim();
        // Skip if line is already a token or looks like a markdown image/link start
        if (trimmed.startsWith('XBFMEDIATKNX') || trimmed.startsWith('![') || (trimmed.startsWith('[') && !trimmed.startsWith('[['))) return line;
        
        const urlRegex = /(https?:\/\/[^\s\)]+)/g;
        return line.replace(urlRegex, (url) => {
          const cleanUrl = url.replace(/[).,;]$/, '');
          const media = this.detectMedia(cleanUrl);
          if (media) {
            return tokenize(this.getExperimentalPlaceholder(media.type, media.id, media.host || '', context, media.cover));
          }
          return url;
        });
      });
      processedText = processedLines.join('\n');

      // 3. Handle explicit [[MEDIA:...]] syntax if any
      processedText = processedText.replace(/\[\[MEDIA:([^:]+):([^:\]]+):([^:\]]*)\]\]/g, (_match, type, id, host) => {
        return tokenize(this.getExperimentalPlaceholder(type, id, host, context));
      });

      // 4. Fix for nested image URLs
      processedText = processedText.replace(/!\[(.*?)\]\((https?:\/\/.*?\/)(https?:\/\/.*?)\)/g, (match, alt, proxy, nested) => {
        return `![${alt}](${nested})`;
      });

      // 5. Render Markdown
      let html = marked.parse(processedText, { breaks: true, gfm: true }) as string;

      // 6. Restore Tokens (inject Custom Elements back into HTML)
      Object.entries(tokens).forEach(([token, replacement]) => {
        // Use split/join for global string replacement
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

  /** Detects media type from text — returns generic: 'audio', 'youtube', 'peertube' */
  detectMedia(text: string | undefined): MediaTrack | null {
    if (!text) return null;

    // YouTube
    const ytMatch = text.match(
      /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|v\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/
    );
    if (ytMatch) return { type: 'youtube', id: ytMatch[1] };

    // Suno.ai (Resolved)
    const sunoSongMatch = text.match(/https?:\/\/(?:www\.)?suno\.com\/song\/([a-zA-Z0-9-]+)/);
    if (sunoSongMatch) return {
      type: 'audio',
      id: sunoSongMatch[1],
      src: `https://cdn1.suno.ai/${sunoSongMatch[1]}.mp3`,
      cover: `https://cdn2.suno.ai/image_large_${sunoSongMatch[1]}.jpeg`,
    };

    // Suno.ai (Share — pending resolution)
    const sunoShareMatch = text.match(/https?:\/\/(?:www\.)?suno\.com\/s\/([a-zA-Z0-9]+)/);
    if (sunoShareMatch) return { type: 'audio', id: sunoShareMatch[1], pending: true };

    // PeerTube (including blurt.media)
    const ptMatch = text.match(/https?:\/\/([a-zA-Z0-9.-]+)\/(?:w|videos\/watch|videos\/embed)\/([a-zA-Z0-9-]+)/);
    if (ptMatch) return { type: 'peertube', id: ptMatch[2], host: ptMatch[1] };

    // Direct audio files
    const audioMatch = text.match(/https?:\/\/[^\s\)]+\.(mp3|wav|ogg|m4a|flac)(\?.*)?/i);
    if (audioMatch) {
      const url = audioMatch[0].replace(/[).,;]$/, '');
      return { type: 'audio', id: btoa(url), src: url };
    }

    return null;
  },

  getExperimentalPlaceholder(type: string, id: string, host: string, context: ParseContext | null = null, cover?: string): string {
    const title = (context?.title || 'Media Content').replace(/"/g, '&quot;');
    const author = context?.author || 'post';
    const permlink = context?.permlink || '';
    const finalCover = cover || context?.cover || '';

    // Audio tracks with short IDs (Suno share) and PeerTube tracks without covers require resolution.
    const isPending = (type === 'audio' && id.length < 30) || (type === 'peertube');

    return `<div class="forum-media-card-wrapper">
              <forum-media data-type="${type}" data-id="${id}" data-host="${host}" 
                 data-title="${title}" data-author="${author}" data-permlink="${permlink}"
                 data-cover="${finalCover}"
                 data-pending="${isPending}"
                 mode="card"></forum-media>
            </div>`;
  },
};
