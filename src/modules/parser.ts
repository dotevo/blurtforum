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
      // Fix for nested image URLs like ![](https://imgp.blurt.blog/.../https://...)
      let processedText = text.replace(/!\[(.*?)\]\((https?:\/\/.*?\/)(https?:\/\/.*?)\)/g, (match, alt, proxy, nested) => {
        return `![${alt}](${nested})`;
      });
      
      processedText = this.autoEmbed(processedText);
      let html = marked.parse(processedText, { breaks: true, gfm: true }) as string;

      html = html.replace(/\[\[MEDIA:([^:]+):([^:\]]+):([^:\]]*)\]\]/g, (_match, type, id, host) =>
        this.getExperimentalPlaceholder(type, id, host, context)
      );
      html = html.replace(
        /(^|[^a-zA-Z0-9_!#$%&*@/])@([a-z0-9.-]+[a-z0-9])/g,
        '$1<a href="#" class="mention" data-user="$2">@$2</a>'
      );

      return DOMPurify.sanitize(html, {
        ADD_TAGS: ['iframe', 'button', 'img', 'forum-media'],
        ADD_ATTR: [
          'allow', 'allowfullscreen', 'frameborder', 'scrolling', 'style', 'sandbox',
          'data-type', 'data-id', 'data-host', 'data-title', 'data-author',
          'data-src', 'data-cover', 'src', 'alt', 'data-permlink', 'class'
        ],
      });
    } catch (e) {
      console.error('Parser error:', e);
      return text;
    }
  },

  autoEmbed(text: string): string {
    const lines = text.split('\n');
    const embeddedUrls = new Set<string>();
    const processedLines = lines.map(line => {
      if (line.trim().startsWith('<') || line.trim().startsWith('[[')) return line;
      const urlRegex = /(https?:\/\/[^\s\)]+)/g;
      const matches = line.match(urlRegex);
      if (!matches) return line;
      let embedsForThisLine = '';
      for (const rawUrl of matches) {
        const cleanUrl = rawUrl.replace(/[).,;]$/, '');
        if (!embeddedUrls.has(cleanUrl)) {
          const embed = this.getEmbedCode(cleanUrl);
          if (embed) { embedsForThisLine += embed + '\n\n'; embeddedUrls.add(cleanUrl); }
        }
      }
      return embedsForThisLine + line;
    });
    return processedLines.join('\n');
  },

  /** Detects media type from text — returns generic: 'audio', 'youtube', 'peertube' */
  detectMedia(text: string | undefined): MediaTrack | null {
    if (!text) return null;

    // YouTube
    const ytMatch = text.match(
      /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/
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
    const ptMatch = text.match(/https?:\/\/([a-zA-Z0-9.-]+)\/(?:w|videos\/watch)\/([a-zA-Z0-9-]+)/);
    if (ptMatch) return { type: 'peertube', id: ptMatch[2], host: ptMatch[1] };

    // Direct audio files
    const audioMatch = text.match(/https?:\/\/[^\s\)]+\.(mp3|wav|ogg|m4a|flac)(\?.*)?/i);
    if (audioMatch) {
      const url = audioMatch[0].replace(/[).,;]$/, '');
      return { type: 'audio', id: btoa(url), src: url };
    }

    return null;
  },

  getEmbedCode(url: string): string | null {
    const media = this.detectMedia(url);
    if (!media) return null;

    // Check if BFPlayer is enabled (window global injected by player module)
    if ((window as Record<string, unknown>)['__bfPlayerEnabled']) {
      return `[[MEDIA:${media.type}:${media.id}:${media.host || ''}]]`;
    }

    if (media.type === 'youtube') {
      return `<div class="embed-container"><iframe src="https://www.youtube.com/embed/${media.id}" frameborder="0" allowfullscreen></iframe></div>`;
    }
    if (media.type === 'audio' && media.src) {
      return `<div class="embed-audio"><audio controls src="${media.src}"></audio></div>`;
    }
    if (media.type === 'peertube') {
      return `<div class="embed-container"><iframe src="https://${media.host}/videos/embed/${media.id}" frameborder="0" allowfullscreen sandbox="allow-same-origin allow-scripts allow-popups allow-forms"></iframe></div>`;
    }
    return null;
  },

  getExperimentalPlaceholder(type: string, id: string, host: string, context: ParseContext | null = null): string {
    const title = (context?.title || 'Media Content').replace(/"/g, '&quot;');
    const author = context?.author || 'post';
    const permlink = context?.permlink || '';

    // Audio tracks with short IDs (Suno share) and PeerTube tracks without covers require resolution.
    const isPending = (type === 'audio' && id.length < 30) || (type === 'peertube');

    return `<div class="forum-media-card-wrapper">
              <forum-media data-type="${type}" data-id="${id}" data-host="${host}" 
                 data-title="${title}" data-author="${author}" data-permlink="${permlink}"
                 data-pending="${isPending}"
                 mode="card"></forum-media>
            </div>`;
  },
};
