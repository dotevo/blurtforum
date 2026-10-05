/**
 * modules/shoutbox/translation-providers.ts
 *
 * Non-AI machine-translation backends. Deliberately NOT an LLM: a free
 * LLM tier's EU/EEA commercial-use exclusions, training-on-your-input
 * terms, and tiny site-wide (not per-user) quotas make it a poor fit for
 * an always-on forum feature — see the chat history where these were
 * compared. Both engines below are free, keyless, and CORS-friendly
 * enough to call directly from the browser.
 *
 *  - MyMemory: official-ish free API, but caps each individual request at
 *    500 bytes of source text, so anything longer has to be chunked (see
 *    chunkText below) and re-joined.
 *  - Google (unofficial `translate_a/single` endpoint): not officially
 *    documented/supported, but it's what libraries like `googletrans`
 *    use, has far more language coverage, and tolerates much larger
 *    requests. Offered as an alternative engine specifically because the
 *    user wanted its wider language support — MyMemory remains the
 *    "safe default" since it's the actually-supported option.
 */

export type TranslationEngine = 'mymemory' | 'google';

const MYMEMORY_MAX_BYTES = 480; // stay under the real 500-byte cap with a little headroom
const GOOGLE_MAX_BYTES = 4500; // generous but still chunked — very long posts shouldn't risk a single giant request failing outright

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Splits `text` into chunks no larger than `maxBytes`, preferring to
 * break on paragraph boundaries, then sentence boundaries, then finally
 * a hard character cut if a single "sentence" is still too long (e.g. a
 * long code block or URL with no punctuation). Never splits mid
 * multi-byte character.
 */
export function chunkText(text: string, maxBytes: number): string[] {
  if (byteLength(text) <= maxBytes) return text.length ? [text] : [];

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  const flush = () => { if (current) { chunks.push(current); current = ''; } };

  const pushPiece = (piece: string) => {
    if (byteLength(current ? current + '\n\n' + piece : piece) <= maxBytes) {
      current = current ? current + '\n\n' + piece : piece;
      return;
    }
    flush();
    if (byteLength(piece) <= maxBytes) { current = piece; return; }
    // Still too big on its own — split by sentence.
    const sentences = piece.split(/(?<=[.!?])\s+/);
    let sCurrent = '';
    for (const s of sentences) {
      if (byteLength(sCurrent ? sCurrent + ' ' + s : s) <= maxBytes) {
        sCurrent = sCurrent ? sCurrent + ' ' + s : s;
        continue;
      }
      if (sCurrent) chunks.push(sCurrent);
      if (byteLength(s) <= maxBytes) { sCurrent = s; continue; }
      // A single "sentence" with no punctuation is still too long — hard
      // cut by characters, re-checking byte length since multi-byte
      // characters mean character count != byte count.
      let rest = s;
      while (byteLength(rest) > maxBytes) {
        let cut = maxBytes;
        while (byteLength(rest.slice(0, cut)) > maxBytes) cut--;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      sCurrent = rest;
    }
    if (sCurrent) current = sCurrent;
  };

  for (const p of paragraphs) pushPiece(p);
  flush();
  return chunks;
}

async function translateViaMyMemory(text: string, target: string, source: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(source)}|${encodeURIComponent(target)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  const translated = data?.responseData?.translatedText;
  if (typeof translated !== 'string') throw new Error('MyMemory: unexpected response shape');
  return translated;
}

async function translateViaGoogle(text: string, target: string, source: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const data = await res.json();
  // Response shape: [[[translatedChunk, originalChunk, ...], ...], ...]
  const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
  const translated = segments.map((seg: unknown[]) => (typeof seg[0] === 'string' ? seg[0] : '')).join('');
  if (!translated) throw new Error('Google: unexpected response shape');
  return translated;
}

/** Translates arbitrarily long text by chunking it to fit the chosen
 *  engine's per-request limit, translating each chunk, and rejoining
 *  with the same paragraph breaks chunkText split on. `source` defaults
 *  to 'auto' for Google (which supports language auto-detection) and
 *  'en' for MyMemory (which doesn't — 'auto' as a langpair source isn't
 *  reliably honored there, so a fixed guess is the pragmatic default;
 *  callers that know the real source language should pass it). */
export async function translateText(text: string, target: string, engine: TranslationEngine, source?: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';

  if (engine === 'google') {
    const chunks = chunkText(trimmed, GOOGLE_MAX_BYTES);
    const results: string[] = [];
    for (const c of chunks) results.push(await translateViaGoogle(c, target, source ?? 'auto'));
    return results.join('\n\n');
  }

  const chunks = chunkText(trimmed, MYMEMORY_MAX_BYTES);
  const results: string[] = [];
  for (const c of chunks) results.push(await translateViaMyMemory(c, target, source ?? 'en'));
  return results.join('\n\n');
}
