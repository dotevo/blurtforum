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
      let processedText = this.autoEmbed(text);

      // 2. Parse Markdown
      let html = marked.parse(processedText, { breaks: true, gfm: true });

      // 3. Process mentions
      html = html.replace(/(^|[^a-zA-Z0-9_!#$%&*@/])@([a-z0-9.-]+[a-z0-9])/g, '$1<a href="#" class="mention" data-user="$2">@$2</a>');

      // 4. Sanitize HTML
      return DOMPurify.sanitize(html, {
        ADD_TAGS: ['iframe'],
        ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'style', 'sandbox']
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
      // Regex to find potential URLs (simple version to catch them inside markdown too)
      const urlRegex = /(https?:\/\/[^\s\)]+)/g;
      const matches = line.match(urlRegex);
      
      if (!matches) return line;

      let embedsForThisLine = '';
      for (let rawUrl of matches) {
        // Clean URL from trailing markdown/punctuation characters
        const cleanUrl = rawUrl.replace(/[).,;]$/, '');
        
        if (!embeddedUrls.has(cleanUrl)) {
          const embed = this.getEmbedCode(cleanUrl);
          if (embed) {
            // Add double newline to ensure the embed is a separate block 
            // and doesn't break following markdown elements like images or paragraphs.
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
   * Returns embed HTML for a given URL if supported
   */
  getEmbedCode(url) {
    let embedHtml = '';
    let found = false;

    // YouTube (standard, be, and shorts)
    const ytMatch = url.match(/^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) {
      embedHtml = `<div class="embed-container"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
      found = true;
    }

    // TikTok
    if (!found) {
      const tiktokMatch = url.match(/^https?:\/\/(?:www\.)?tiktok\.com\/@[^\/]+\/video\/(\d+)/);
      if (tiktokMatch) {
        embedHtml = `<div class="embed-vertical"><iframe src="https://www.tiktok.com/embed/v2/${tiktokMatch[1]}" frameborder="0" allowfullscreen></iframe></div>`;
        found = true;
      }
    }

    // X (Twitter)
    if (!found) {
      const xMatch = url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^\/]+\/status\/(\d+)/);
      if (xMatch) {
        embedHtml = `<div class="embed-container"><iframe src="https://platform.twitter.com/embed/Tweet.html?id=${xMatch[1]}" frameborder="0" scrolling="no" style="width: 100%; height: 400px;"></iframe></div>`;
        found = true;
      }
    }

    // Suno.ai
    if (!found) {
      const sunoMatch = url.match(/^https?:\/\/(?:www\.)?suno\.com\/(?:song|s)\/([a-zA-Z0-9_-]+)/);
      if (sunoMatch) {
        embedHtml = `<div class="embed-suno"><iframe src="https://suno.com/embed/${sunoMatch[1]}" frameborder="0" allowfullscreen></iframe></div>`;
        found = true;
      }
    }

    // PeerTube (blurt.media and others)
    if (!found) {
      // Support patterns like /w/ID or /videos/watch/ID or /videos/watch/playlist/ID
      const peertubeMatch = url.match(/^https?:\/\/([a-zA-Z0-9.-]+)\/(?:w|videos\/watch)\/([a-zA-Z0-9-]+)/);
      if (peertubeMatch) {
        const host = peertubeMatch[1];
        const videoId = peertubeMatch[2];
        embedHtml = `<div class="embed-container"><iframe src="https://${host}/videos/embed/${videoId}" frameborder="0" allowfullscreen sandbox="allow-same-origin allow-scripts allow-popups allow-forms"></iframe></div>`;
        found = true;
      }
    }

    if (found) {
      return `<div class="embed-wrapper">${embedHtml}<div class="embed-source"><a href="${url}" target="_blank" rel="noopener noreferrer">Source: ${url}</a></div></div>`;
    }

    return null;
  }
};

// Export for use in app.js
if (typeof window !== 'undefined') {
  window.renderMarkdown = (text) => Parser.render(text);
}
