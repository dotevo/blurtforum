/**
 * BlurtForum Parser — Markdown and Rich Media Embedding
 */

const Parser = {
  /**
   * Main entry point for rendering markdown with rich media embeds
   */
  render(text) {
    if (!text) return '';
    try {
      // 1. Process auto-embeds for links found in text
      // We use a special placeholder format to avoid Markdown interference
      let processedText = this.autoEmbed(text);

      // 2. Parse Markdown
      let html = marked.parse(processedText, { breaks: true, gfm: true });

      // 3. Post-process: Replace [[MEDIA:...]] with actual HTML
      html = html.replace(/\[\[MEDIA:([^:]+):([^:\]]+):([^:\]]*)\]\]/g, (match, type, id, host) => {
        return this.getExperimentalPlaceholder(type, id, host);
      });

      // 4. Process mentions
      html = html.replace(/(^|[^a-zA-Z0-9_!#$%&*@/])@([a-z0-9.-]+[a-z0-9])/g, '$1<a href="#" class="mention" data-user="$2">@$2</a>');

      // 5. Sanitize HTML
      return DOMPurify.sanitize(html, {
        ADD_TAGS: ['iframe', 'button'],
        ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'style', 'sandbox', 
                  'data-type', 'data-id', 'data-host', 'data-title', 'data-author']
      });
    } catch (e) {
      console.error('Parser error:', e);
      return text;
    }
  },

  /**
   * Recognizes links within the text and prepends embed codes to their lines
   */
  autoEmbed(text) {
    const lines = text.split('\n');
    const embeddedUrls = new Set();
    
    const processedLines = lines.map(line => {
      // Avoid embedding inside already detected code blocks or tags
      if (line.trim().startsWith('<') || line.trim().startsWith('[[')) return line;

      const urlRegex = /(https?:\/\/[^\s\)]+)/g;
      const matches = line.match(urlRegex);
      
      if (!matches) return line;

      let embedsForThisLine = '';
      for (let rawUrl of matches) {
        const cleanUrl = rawUrl.replace(/[).,;]$/, '');
        
        if (!embeddedUrls.has(cleanUrl)) {
          const embed = this.getEmbedCode(cleanUrl);
          if (embed) {
            embedsForThisLine += embed + '\n\n';
            embeddedUrls.add(cleanUrl);
          }
        }
      }
      
      return embedsForThisLine + line;
    });
    
    return processedLines.join('\n');
  },

  /**
   * Returns embed HTML or Placeholder tag for a given URL
   */
  getEmbedCode(url) {
    // YouTube
    const ytMatch = url.match(/^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) {
      if (window.BFPlayer && window.BFPlayer.state.enabled) {
        return `[[MEDIA:youtube:${ytMatch[1]}:]]`;
      }
      return `<div class="embed-container"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    }

    // Suno.ai
    const sunoMatch = url.match(/^https?:\/\/(?:www\.)?suno\.com\/(?:song|s)\/([a-zA-Z0-9_-]+)/);
    if (sunoMatch) {
      if (window.BFPlayer && window.BFPlayer.state.enabled) {
        return `[[MEDIA:suno:${sunoMatch[1]}:]]`;
      }
      return `<div class="embed-suno"><iframe src="https://suno.com/embed/${sunoMatch[1]}" frameborder="0" allowfullscreen></iframe></div>`;
    }

    // PeerTube
    const peertubeMatch = url.match(/^https?:\/\/([a-zA-Z0-9.-]+)\/(?:w|videos\/watch)\/([a-zA-Z0-9-]+)/);
    if (peertubeMatch) {
      const host = peertubeMatch[1];
      const videoId = peertubeMatch[2];
      if (window.BFPlayer && window.BFPlayer.state.enabled) {
        return `[[MEDIA:peertube:${videoId}:${host}]]`;
      }
      return `<div class="embed-container"><iframe src="https://${host}/videos/embed/${videoId}" frameborder="0" allowfullscreen sandbox="allow-same-origin allow-scripts allow-popups allow-forms"></iframe></div>`;
    }

    // TikTok
    const tiktokMatch = url.match(/^https?:\/\/(?:www\.)?tiktok\.com\/@[^\/]+\/video\/(\d+)/);
    if (tiktokMatch) {
      return `<div class="embed-wrapper"><div class="embed-vertical"><iframe src="https://www.tiktok.com/embed/v2/${tiktokMatch[1]}" frameborder="0" allowfullscreen></iframe></div></div>`;
    }

    // X (Twitter)
    const xMatch = url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^\/]+\/status\/(\d+)/);
    if (xMatch) {
      return `<div class="embed-wrapper"><div class="embed-container"><iframe src="https://platform.twitter.com/embed/Tweet.html?id=${xMatch[1]}" frameborder="0" scrolling="no" style="width: 100%; height: 400px;"></iframe></div></div>`;
    }

    return null;
  },

  /**
   * Generates the final HTML for experimental player placeholder
   */
  getExperimentalPlaceholder(type, id, host) {
    const thumb = type === 'youtube' ? `https://img.youtube.com/vi/${id}/0.jpg` : '';
    const sourceLabel = host || type;

    return `<div class="media-placeholder" style="${thumb ? 'background-image:url('+thumb+')' : ''}">
<div class="media-placeholder-overlay">
<div class="media-placeholder-actions">
<button class="btn btn-primary bf-placeholder-play" data-type="${type}" data-id="${id}" data-host="${host}" data-title="Media Content">
<i class="fa-solid fa-play"></i> Play
</button>
<button class="btn btn-ghost bf-placeholder-queue" data-type="${type}" data-id="${id}" data-host="${host}" data-title="Media Content">
<i class="fa-solid fa-plus"></i> Queue
</button>
</div>
<div class="gs" style="color:#fff; font-size:10px; margin-top:5px; text-transform:uppercase; letter-spacing:1px;">${sourceLabel}</div>
</div>
</div>`;
  }
};

// Export for use in app.js
if (typeof window !== 'undefined') {
  window.renderMarkdown = (text) => Parser.render(text);
}
