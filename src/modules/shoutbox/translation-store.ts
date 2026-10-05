import type { Translation } from './types';

/**
 * modules/shoutbox/translation-store.ts
 *
 * Local persistent cache for shared translations, backed by IndexedDB
 * rather than localStorage. Translation bodies are full post/comment
 * text in another language — potentially many KB each, across however
 * many posts a reader visits — and localStorage's real-world cap is only
 * ~5-10MB shared with everything ELSE the app keeps there (prefs, the
 * shoutbox's own chat history, cookie-consent state, …). IndexedDB has no
 * such shared, tiny budget (practical limits run into the hundreds of
 * MB, often GB, and are per-origin rather than shared app-wide state), so
 * translations get their own store rather than competing for
 * localStorage headroom with everything else.
 *
 * Keyed by `${contentId}::${targetLang}` — ONE cached translation per
 * (post-or-comment, target language), not per engine. If a later
 * translation for the same key arrives (e.g. someone re-translates after
 * the first attempt was poor), it simply overwrites the previous entry;
 * there's no multi-version history here, same trade-off ChatMessage
 * history makes for simplicity.
 *
 * Certificates are NOT duplicated here — a Translation's `certId` is
 * resolved against ShoutboxStore's existing certificate cache (see
 * shoutbox.ts), exactly like chat messages already do. There's only one
 * kind of certificate in this module regardless of what it's vouching
 * for (a chat message or a translation), so there's no reason to store
 * it twice under two different modules.
 */

const DB_NAME = 'bf-translations';
const DB_VERSION = 1;
const STORE = 'translations';

function keyFor(contentId: string, targetLang: string): string {
  return `${contentId}::${targetLang}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'key' });
        os.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

interface StoredRow {
  key: string;
  ts: number;
  translation: Translation;
  /** Last time this entry was actually READ — by us showing it to a
   *  viewer, or by us serving it to another peer's translation_request
   *  (see shoutbox.ts) — as opposed to `ts`, which is when the
   *  translation was originally produced and never changes. Eviction
   *  below is LRU on THIS field, not `ts`: a translation nobody's looked
   *  at in months should go before one that's six months older but got
   *  read yesterday. Separate from the signed `Translation` object
   *  itself, which must stay exactly as it was signed — this is purely
   *  local bookkeeping about OUR OWN usage, never transmitted. */
  lastAccessedTs: number;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getTranslation(contentId: string, targetLang: string): Promise<Translation | null> {
  try {
    const key = keyFor(contentId, targetLang);
    const row = await withStore<StoredRow | undefined>('readonly', (store) => reqToPromise(store.get(key)));
    if (!row) return null;
    // Fire-and-forget: refresh recency on every successful read (whether
    // that read is us displaying it to our own viewer, or us answering
    // someone else's translation_request — both go through this same
    // function, so "seeding" something keeps it alive exactly like
    // reading it yourself would). Never blocks the caller on this write.
    void touchTranslation(key);
    return row.translation;
  } catch {
    return null; // IndexedDB unavailable (very old browser / private-mode edge case) — treat as cache miss
  }
}

async function touchTranslation(key: string): Promise<void> {
  try {
    await withStore('readwrite', async (store) => {
      const row = await reqToPromise(store.get(key) as IDBRequest<StoredRow | undefined>);
      if (!row) return;
      row.lastAccessedTs = Date.now();
      store.put(row);
    });
  } catch { /* best-effort — worst case this entry just looks less-recently-used than it really is */ }
}

export async function putTranslation(t: Translation): Promise<void> {
  try {
    await withStore('readwrite', (store) => {
      const now = Date.now();
      const row: StoredRow = { key: keyFor(t.contentId, t.targetLang), ts: t.ts, translation: t, lastAccessedTs: now };
      store.put(row);
      return Promise.resolve();
    });
    await evictIfOverBudget();
  } catch {
    /* non-fatal — the translation still displays for this page view from memory, just won't persist */
  }
}

async function allRows(): Promise<StoredRow[]> {
  try {
    const rows = await withStore<StoredRow[]>('readonly', (store) => reqToPromise(store.getAll() as IDBRequest<StoredRow[]>));
    // Older rows written before this field existed won't have it — treat
    // as "never accessed", i.e. first in line for eviction, rather than
    // crashing the sort below on `undefined - undefined`.
    return rows.map((r) => ({ ...r, lastAccessedTs: r.lastAccessedTs ?? 0 }));
  } catch {
    return [];
  }
}

export async function allTranslations(): Promise<Translation[]> {
  return (await allRows()).map((r) => r.translation);
}

export interface CacheStats {
  count: number;
  bytes: number;
}

/** Approximate size via JSON length — exact enough for a "clear cache if
 *  this gets too big" UI, not meant to be a precise byte accounting. */
export async function getCacheStats(): Promise<CacheStats> {
  const all = await allTranslations();
  let bytes = 0;
  for (const t of all) bytes += JSON.stringify(t).length;
  return { count: all.length, bytes };
}

export async function clearCache(): Promise<void> {
  try {
    await withStore('readwrite', (store) => { store.clear(); return Promise.resolve(); });
  } catch { /* nothing to clear if IndexedDB never opened */ }
}

const MAX_BYTES_KEY = 'bf_translation_cache_max_bytes';
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8MB of translated text is a LOT of posts/comments

export function getMaxCacheBytes(): number {
  const raw = localStorage.getItem(MAX_BYTES_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

export function setMaxCacheBytes(n: number): void {
  localStorage.setItem(MAX_BYTES_KEY, String(Math.max(0, Math.floor(n))));
}

/** Evicts the LEAST-RECENTLY-USED entries until the store fits back under
 *  the configured budget — true LRU on `lastAccessedTs`, not on how long
 *  ago the translation was originally produced. This is what makes a
 *  popular post's translation survive: every peer that reads it (or
 *  seeds it to someone else, see getTranslation's doc comment above)
 *  refreshes its recency, so it keeps getting pushed to the back of the
 *  eviction queue for as long as anyone's actually using it. Something
 *  nobody has touched in a long time is exactly what SHOULD go first,
 *  regardless of whether it happens to be old or recent by creation
 *  date. Runs after every write rather than on a schedule — writes are
 *  infrequent (one per newly-cached translation) so this is cheap in
 *  practice. */
async function evictIfOverBudget(): Promise<void> {
  const max = getMaxCacheBytes();
  const rows = await allRows();
  let bytes = rows.reduce((sum, r) => sum + JSON.stringify(r.translation).length, 0);
  if (bytes <= max) return;
  const sorted = [...rows].sort((a, b) => a.lastAccessedTs - b.lastAccessedTs); // least-recently-used first
  const toDelete: string[] = [];
  for (const r of sorted) {
    if (bytes <= max) break;
    bytes -= JSON.stringify(r.translation).length;
    toDelete.push(r.key);
  }
  if (!toDelete.length) return;
  try {
    await withStore('readwrite', (store) => {
      for (const k of toDelete) store.delete(k);
      return Promise.resolve();
    });
  } catch { /* best-effort */ }
}

export const TranslationStore = {
  get: getTranslation,
  put: putTranslation,
  all: allTranslations,
  stats: getCacheStats,
  clear: clearCache,
  getMaxBytes: getMaxCacheBytes,
  setMaxBytes: setMaxCacheBytes,
};
