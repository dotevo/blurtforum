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
  payout?: number;
  voteCount?: number;
  voted?: boolean;
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
        ADD_TAGS: ['iframe', 'button', 'img'],
        ADD_ATTR: [
          'allow', 'allowfullscreen', 'frameborder', 'scrolling', 'style', 'sandbox',
          'data-type', 'data-id', 'data-host', 'data-title', 'data-author',
          'data-src', 'data-cover', 'data-pending', 'src', 'alt'
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

  async resolveMedia(track: MediaTrack): Promise<MediaTrack> {
    if (track.type === 'audio' && !track.src && track.id && track.id.length < 30) {
      try {
        const url = `https://suno.com/s/${track.id}`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        const text = await response.text();
        const uuidMatch = text.match(/song\/([a-f0-9-]{36})/i);
        if (uuidMatch) {
          const uuid = uuidMatch[1];
          return { ...track, id: uuid, src: `https://cdn1.suno.ai/${uuid}.mp3`, cover: `https://cdn2.suno.ai/image_large_${uuid}.jpeg` };
        }
      } catch (e) { console.error('Parser: Resolution failed', e); }
    }
    // Resolution for PeerTube thumbnails (e.g. blurt.media)
    if (track.type === 'peertube' && !track.cover) {
      try {
        const apiUrl = `https://${track.host}/api/v1/videos/${track.id}`;
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (data.thumbnailPath) {
          track.cover = `https://${track.host}${data.thumbnailPath}`;
        }
      } catch (e) { /* ignore */ }
    }
    return track;
  },

  getExperimentalPlaceholder(type: string, id: string, host: string, context: ParseContext | null = null): string {
    let thumb = '';
    let isPending = false;
    let src = '';
    let cover = '';

    if (type === 'youtube') {
      thumb = `https://img.youtube.com/vi/${id}/0.jpg`;
    } else if (type === 'audio') {
      if (id.length >= 36) {
        thumb = `https://cdn2.suno.ai/image_large_${id}.jpeg`;
        src = `https://cdn1.suno.ai/${id}.mp3`;
        cover = thumb;
      } else if (id.length < 30) {
        isPending = true;
      } else {
        try { src = atob(id); } catch { src = id; }
      }
    } else if (type === 'peertube') {
      if (cover) {
        thumb = cover;
      } else {
        // Fallback placeholder while resolving
        thumb = ''; 
      }
    }

    const sourceLabel = isPending ? 'resolving...' : (host || type);
    const title = (context?.title || 'Media Content').replace(/'/g, '&apos;');
    const author = context?.author || 'post';
    const permlink = context?.permlink || '';
    const payout = context?.payout || 0;
    const voteCount = context?.voteCount || 0;
    const voted = context?.voted || false;

    return `<div class="media-placeholder ${isPending ? 'is-resolving' : ''}" 
                 style="${thumb ? 'background-image:url(' + thumb + ')' : ''}" 
                 data-type="${type}" data-id="${id}" data-host="${host}" 
                 data-src="${src}" data-cover="${cover}" data-pending="${isPending}">
<div class="media-placeholder-overlay">
<div class="media-placeholder-actions">
<button class="btn btn-primary bf-placeholder-play" 
        data-type="${type}" data-id="${id}" data-host="${host}" data-title="${title}" data-author="${author}" 
        data-permlink="${permlink}" data-payout="${payout}" data-votecount="${voteCount}" data-voted="${voted}"
        data-src="${src}" data-cover="${cover}">
<i class="fa-solid fa-play"></i> Play
</button>
<button class="btn btn-ghost bf-placeholder-queue" 
        data-type="${type}" data-id="${id}" data-host="${host}" data-title="${title}" data-author="${author}" 
        data-permlink="${permlink}" data-payout="${payout}" data-votecount="${voteCount}" data-voted="${voted}"
        data-src="${src}" data-cover="${cover}">
<i class="fa-solid fa-plus"></i> Queue
</button>
<button class="btn btn-ghost bf-placeholder-embed" data-type="${type}" data-id="${id}" data-host="${host}">
<i class="fa-solid fa-code"></i> Embed
</button>
</div>
<div class="gs" style="color:#fff; font-size:10px; margin-top:5px; text-transform:uppercase; letter-spacing:1px;">${sourceLabel}</div>
</div>
</div>`;
  },
};
