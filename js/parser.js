/**
 * BlurtForum Parser — Markdown and Rich Media Embedding
 */

const Parser = {
  /**
   * Main entry point for rendering markdown with rich media embeds
   */
  render(text, context = null) {
    if (!text) return '';
    try {
      let processedText = this.autoEmbed(text);
      let html = marked.parse(processedText, { breaks: true, gfm: true });

      // Replace [[MEDIA:...]] with generic placeholders
      html = html.replace(/\[\[MEDIA:([^:]+):([^:\]]+):([^:\]]*)\]\]/g, (match, type, id, host) => {
        return this.getExperimentalPlaceholder(type, id, host, context);
      });

      html = html.replace(/(^|[^a-zA-Z0-9_!#$%&*@/])@([a-z0-9.-]+[a-z0-9])/g, '$1<a href="#" class="mention" data-user="$2">@$2</a>');

      return DOMPurify.sanitize(html, {
        ADD_TAGS: ['iframe', 'button'],
        ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'style', 'sandbox', 
                  'data-type', 'data-id', 'data-host', 'data-title', 'data-author', 'data-src', 'data-cover', 'data-pending']
      });
    } catch (e) {
      console.error('Parser error:', e);
      return text;
    }
  },

  autoEmbed(text) {
    const lines = text.split('\n');
    const embeddedUrls = new Set();
    const processedLines = lines.map(line => {
      if (line.trim().startsWith('<') || line.trim().startsWith('[[')) return line;
      const urlRegex = /(https?:\/\/[^\s\)]+)/g;
      const matches = line.match(urlRegex);
      if (!matches) return line;
      let embedsForThisLine = '';
      for (let rawUrl of matches) {
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

  /**
   * Detects media and returns GENERIC types only: 'audio', 'youtube', 'peertube'
   */
  detectMedia(text) {
    if (!text) return null;
    
    // 1. YouTube
    const ytMatch = text.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) return { type: 'youtube', id: ytMatch[1] };

    // 2. Suno.ai (Resolved)
    const sunoSongMatch = text.match(/https?:\/\/(?:www\.)?suno\.com\/song\/([a-zA-Z0-9-]+)/);
    if (sunoSongMatch) return { 
      type: 'audio', 
      id: sunoSongMatch[1], 
      src: `https://cdn1.suno.ai/${sunoSongMatch[1]}.mp3`, 
      cover: `https://cdn2.suno.ai/image_large_${sunoSongMatch[1]}.jpeg` 
    };
    
    // 3. Suno.ai (Share - Pending)
    const sunoShareMatch = text.match(/https?:\/\/(?:www\.)?suno\.com\/s\/([a-zA-Z0-9]+)/);
    if (sunoShareMatch) return { type: 'audio', id: sunoShareMatch[1], pending: true };

    // 4. PeerTube
    const ptMatch = text.match(/https?:\/\/([a-zA-Z0-9.-]+)\/(?:w|videos\/watch)\/([a-zA-Z0-9-]+)/);
    if (ptMatch) return { type: 'peertube', id: ptMatch[2], host: ptMatch[1] };

    // 5. Direct Audio Files
    const audioMatch = text.match(/https?:\/\/[^\s\)]+\.(mp3|wav|ogg|m4a|flac)(\?.*)?/i);
    if (audioMatch) {
      const url = audioMatch[0].replace(/[).,;]$/, '');
      return { type: 'audio', id: btoa(url), src: url };
    }
    return null;
  },

  getEmbedCode(url) {
    const media = this.detectMedia(url);
    if (!media) return null;

    if (window.BFPlayer && window.BFPlayer.state.enabled) {
      // Internal tag used for rendering experimental placeholders
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

  async resolveMedia(track) {
    // If it's a Suno share (we know this by the ID length or a flag if we had one, but let's be smart)
    if (track.type === 'audio' && !track.src && track.id && track.id.length < 30) {
      try {
        const url = `https://suno.com/s/${track.id}`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        const text = await response.text();
        const uuidMatch = text.match(/song\/([a-f0-9-]{36})/i);
        if (uuidMatch) {
          const uuid = uuidMatch[1];
          return {
            ...track,
            id: uuid,
            src: `https://cdn1.suno.ai/${uuid}.mp3`,
            cover: `https://cdn2.suno.ai/image_large_${uuid}.jpeg`
          };
        }
      } catch (e) { console.error('Parser: Resolution failed', e); }
    }
    return track;
  },

  getExperimentalPlaceholder(type, id, host, context = null) {
    const media = this.detectMedia(context?.body?.includes(id) ? id : `fakeurl.com/${type}/${id}`); 
    // Fallback: detect from just the type/id if URL detection is too specific
    let thumb = '';
    let isPending = false;
    let src = '';
    let cover = '';

    if (type === 'youtube') thumb = `https://img.youtube.com/vi/${id}/0.jpg`;
    else if (type === 'audio') {
      if (id.length >= 36) { // Looks like a UUID
        thumb = `https://cdn2.suno.ai/image_large_${id}.jpeg`;
        src = `https://cdn1.suno.ai/${id}.mp3`;
        cover = thumb;
      } else if (id.length < 30) {
        isPending = true;
      } else {
        try { src = atob(id); } catch(e) { src = id; }
      }
    }
    
    const sourceLabel = isPending ? 'resolving...' : (host || type);
    const title = (context?.title || 'Media Content').replace(/'/g, "&apos;");
    const author = context?.author || 'post';

    return `<div class="media-placeholder ${isPending ? 'is-resolving' : ''}" 
                 style="${thumb ? 'background-image:url('+thumb+')' : ''}" 
                 data-type="${type}" data-id="${id}" data-host="${host}" 
                 data-src="${src}" data-cover="${cover}" data-pending="${isPending}">
<div class="media-placeholder-overlay">
<div class="media-placeholder-actions">
<button class="btn btn-primary bf-placeholder-play" data-type="${type}" data-id="${id}" data-host="${host}" data-title="${title}" data-author="${author}" data-src="${src}" data-cover="${cover}">
<i class="fa-solid fa-play"></i> Play
</button>
<button class="btn btn-ghost bf-placeholder-queue" data-type="${type}" data-id="${id}" data-host="${host}" data-title="${title}" data-author="${author}" data-src="${src}" data-cover="${cover}">
<i class="fa-solid fa-plus"></i> Queue
</button>
<button class="btn btn-ghost bf-placeholder-embed" data-type="${type}" data-id="${id}" data-host="${host}">
<i class="fa-solid fa-code"></i> Embed
</button>
</div>
<div class="gs" style="color:#fff; font-size:10px; margin-top:5px; text-transform:uppercase; letter-spacing:1px;">${sourceLabel}</div>
</div>
</div>`;
  }
};

if (typeof window !== 'undefined') {
  window.renderMarkdown = (text, context = null) => Parser.render(text, context);
}
