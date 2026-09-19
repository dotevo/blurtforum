/**
 * COAL list (coal.blurtwallet.com) integration.
 *
 * COAL tracks accounts that are "slippery" - spammers, impersonators, etc.
 * Unlike community mutes or the site-wide ban list, COAL entries are NOT
 * hidden: their posts/comments stay visible (so nobody accidentally
 * upvotes them without knowing), just flagged with a warning badge, and
 * comments are collapsed by default.
 *
 * The list is fairly large and only needs to be "fresh enough", so it's
 * fetched at most once every CACHE_TTL_MS and cached in localStorage. A
 * failed fetch falls back to whatever was last cached rather than showing
 * nothing.
 */

export interface CoalEntry {
  reason: string;
  notes: string;
}

const COAL_URL = 'https://coal.blurtwallet.com/';
const CACHE_KEY = 'bf_coal_list_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day - per product decision, don't refresh more often

interface CachePayload {
  ts: number;
  entries: [string, CoalEntry][];
}

function readCache(): CachePayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return parsed as CachePayload;
  } catch {
    return null;
  }
}

function writeCache(entries: [string, CoalEntry][]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), entries } as CachePayload));
  } catch {
    /* localStorage full/unavailable - fine, just skip caching */
  }
}

/**
 * Returns a Map of lowercase username -> CoalEntry.
 * Uses the local cache if it's younger than CACHE_TTL_MS; otherwise fetches
 * fresh data from COAL and refreshes the cache. On fetch failure, falls
 * back to a stale cache if one exists, or an empty map otherwise.
 */
export async function loadCoalList(): Promise<Map<string, CoalEntry>> {
  const cached = readCache();
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return new Map(cached.entries);
  }

  try {
    const res = await fetch(COAL_URL);
    if (!res.ok) throw new Error(`COAL fetch failed: ${res.status}`);
    const data = await res.json();
    const entries: [string, CoalEntry][] = (Array.isArray(data) ? data : [])
      .filter((e: any) => e && typeof e.name === 'string')
      .map((e: any) => [
        String(e.name).toLowerCase(),
        { reason: e.reason || '', notes: e.notes || '' }
      ]);
    writeCache(entries);
    return new Map(entries);
  } catch (err) {
    console.warn('COAL list fetch error, falling back to cache:', (err as Error).message);
    return cached ? new Map(cached.entries) : new Map();
  }
}
