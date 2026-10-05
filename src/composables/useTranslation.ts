import { reactive } from 'vue';
import { Shoutbox } from '../modules/shoutbox/shoutbox';
import { TranslationStore, type CacheStats } from '../modules/shoutbox/translation-store';
import { translateText } from '../modules/shoutbox/translation-providers';
import { translationPrefs } from '../modules/shoutbox/translation-prefs';

/**
 * composables/useTranslation.ts
 *
 * Orchestrates the opt-in post/comment translation feature on top of the
 * shoutbox's existing P2P connection (see modules/shoutbox/shoutbox.ts) —
 * deliberately NOT a second PeerJS room. For any given piece of content:
 *
 *   1. Check our own local cache (IndexedDB, translation-store.ts) — free,
 *      instant, no network.
 *   2. Ask the room whether some other peer already has it cached
 *      (Shoutbox.requestTranslation) — still no translation-provider call,
 *      just reusing someone else's prior work.
 *   3. Only if nobody has it: run it through the chosen provider
 *      ourselves, then share the result (Shoutbox.publishTranslation) so
 *      the NEXT reader gets step 1 or 2 instead of repeating step 3.
 *
 * Every entry in `results` is keyed by `${contentId}::${targetLang}` and
 * shared module-wide (like Shoutbox.messages itself) — two components
 * rendering the same post each get the same reactive entry rather than
 * independently re-fetching.
 */

export type TranslationStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

export interface TranslationResultEntry {
  status: TranslationStatus;
  body?: string;
  /** Blurt account that produced/shared this translation, or null for a
   *  locally-produced-but-unshared result (not logged in — see
   *  Shoutbox.publishTranslation's own doc comment on why that still
   *  displays locally without being attributed/shared). */
  translator?: string | null;
  engine?: string;
}

const results = reactive<Record<string, TranslationResultEntry>>({});

function keyFor(contentId: string, targetLang: string): string {
  return `${contentId}::${targetLang}`;
}

export function useTranslation() {
  function entryFor(contentId: string, targetLang: string): TranslationResultEntry {
    const k = keyFor(contentId, targetLang);
    if (!results[k]) results[k] = { status: 'idle' };
    return results[k];
  }

  /** Cache-only check — no network, no provider call. Used to decide
   *  whether to show the small "a translation exists" indicator icon
   *  without doing any work yet (see TranslatedBody.vue). */
  async function peekCache(contentId: string, targetLang: string, isTranslatorHidden?: (u: string) => boolean): Promise<boolean> {
    const entry = entryFor(contentId, targetLang);
    if (entry.status === 'ready') return true;
    const cached = await TranslationStore.get(contentId, targetLang);
    if (cached && !(isTranslatorHidden && isTranslatorHidden(cached.translator))) {
      entry.body = cached.body; entry.translator = cached.translator; entry.engine = cached.engine; entry.status = 'ready';
      return true;
    }
    return false;
  }

  /** Full fetch-or-translate flow — see this file's header comment for
   *  the three-step order. Safe to call repeatedly for the same key:
   *  it's a no-op once status is 'ready' or 'loading'. `isTranslatorHidden`
   *  lets the caller apply the SAME moderation (site-wide ban / community
   *  mute) used for ordinary posts to a translation's attributed author —
   *  a translation from a banned/muted account is skipped exactly as if
   *  it didn't exist, and the flow falls through to the next source. */
  async function ensureTranslation(
    contentId: string,
    targetLang: string,
    originalBody: string,
    isTranslatorHidden?: (u: string) => boolean
  ): Promise<void> {
    const entry = entryFor(contentId, targetLang);
    if (entry.status === 'ready' || entry.status === 'loading') return;
    if (!translationPrefs.enabled) { entry.status = 'unavailable'; return; }

    entry.status = 'loading';
    try {
      const cached = await TranslationStore.get(contentId, targetLang);
      if (cached && !(isTranslatorHidden && isTranslatorHidden(cached.translator))) {
        entry.body = cached.body; entry.translator = cached.translator; entry.engine = cached.engine; entry.status = 'ready';
        return;
      }

      const fromPeer = await Shoutbox.requestTranslation(contentId, targetLang);
      if (fromPeer && !(isTranslatorHidden && isTranslatorHidden(fromPeer.translator))) {
        entry.body = fromPeer.body; entry.translator = fromPeer.translator; entry.engine = fromPeer.engine; entry.status = 'ready';
        return;
      }

      const translated = await translateText(originalBody, targetLang, translationPrefs.engine);
      if (!translated) { entry.status = 'error'; return; }

      const shared = await Shoutbox.publishTranslation(contentId, targetLang, translationPrefs.engine, translated);
      entry.body = translated;
      entry.engine = translationPrefs.engine;
      // Not logged in (or the PIN prompt was declined) → publishTranslation
      // returns false and nothing was broadcast or cached for anyone else;
      // this reader still sees their own translation, just unattributed
      // and not shared — translator stays null rather than a username, so
      // the UI never shows a false "translated by @..." credit for it.
      entry.translator = shared ? (await TranslationStore.get(contentId, targetLang))?.translator ?? null : null;
      entry.status = 'ready';
    } catch (e) {
      console.warn('[useTranslation] failed for', contentId, targetLang, e);
      entry.status = 'error';
    }
  }

  async function cacheStats(): Promise<CacheStats> {
    return TranslationStore.stats();
  }

  async function clearCache(): Promise<void> {
    await TranslationStore.clear();
    for (const k of Object.keys(results)) delete results[k];
  }

  function setMaxCacheBytes(n: number): void {
    TranslationStore.setMaxBytes(n);
  }

  return {
    prefs: translationPrefs,
    entryFor,
    peekCache,
    ensureTranslation,
    cacheStats,
    clearCache,
    setMaxCacheBytes,
    getMaxCacheBytes: TranslationStore.getMaxBytes,
  };
}
