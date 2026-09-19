<script setup lang="ts">
/**
 * Cinema mode's "browse" screen — a VOD-style grid, either:
 *  - category rows (posts containing embedded media, grouped by tag), or
 *  - the user's playlists (rows = playlists, cards = playlist tracks)
 * toggled via player.state.cinemaBrowseView.
 *
 * Enhanced with multi-tag fetching, multi-sort fallback (trending -> created),
 * and automatic deduplication per category.
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { Blockchain } from '../blockchain';
import { PostProcessor } from '../post-processor';
import { isHiddenFromViewer } from '../visibility';
import { state as playerState, playlistState, playTrack, togglePlay } from '../player/player';
import ForumMedia from '../player_blurt/components/ForumMedia.ce.vue';
import type { MediaTrack } from '../player/types';

const props = defineProps<{
  client: any;
  t: (k: string) => string;
  /** Reactive `{ user, accounts }` auth object from useAuth(), used to resolve the logged-in
   *  username for the "Feed" row and the per-person rows derived from it. */
  auth?: { user: { username: string } | null } | null;
  // Same moderation data useApp.ts's normalizePost wrapper uses - see comments-plugin.ts for the
  // identical pattern. Cinema pulls posts from many tags/accounts across possibly many
  // communities, so community-role bans (getMutedAccounts) only apply when a post's own
  // `category` matches config.communityAccount; the site-wide ban list and COAL apply always.
  getCanMute?: () => boolean;
  getCanBanUser?: () => boolean;
  getMutedAccounts?: () => Set<string>;
  getCoalMap?: () => Map<string, { reason: string; notes: string }>;
  config?: { communityAccount: string };
}>();

interface CinemaCard {
  post: { author: string; permlink: string; title: string; isCoal?: boolean; coalInfo?: { reason: string; notes: string } | null };
  track: MediaTrack;
}

type SortMethod = 'trending' | 'created' | 'hot' | 'feed' | 'posts';

interface CinemaRow {
  id: string;
  label: string;
  icon: string;
  /**
   * 'tag' (default): tags[] are post tags, fetched via getRankedPosts.
   * 'account': tags[0] is actually an account name, fetched via getAccountPosts
   *   (used for the "Feed" row — sort 'feed' on the logged-in user — and for
   *   the per-person rows derived from it — sort 'created' on that person).
   */
  sourceType?: 'tag' | 'account';
  /** Per-row page size override (tag rows keep the default PAGE_SIZE; feed/person rows
   *  request bigger pages since a large chunk of a person's posts has no media at all). */
  pageSize?: number;
  /** Primary and fallback tags to fetch videos from (or a single account name, see sourceType) */
  tags: string[];
  /** Order of sort methods to attempt for each tag (e.g. trending first, fallback to newest/created) */
  sorts: SortMethod[];
  cards: CinemaCard[];
  loading: boolean;
  rawCount: number;
  error: string | null;
  /** Index of current active tag from tags[] */
  currentTagIndex: number;
  /** Index of current active sort method from sorts[] */
  currentSortIndex: number;
  /** Pagination cursor for current tag/sort stream */
  cursor?: { author: string; permlink: string } | null;
  /** Set when all tags and sort methods for this row are fully exhausted */
  exhausted?: boolean;
  loadingMore?: boolean;
  /** Set of unique author/permlink identifiers to prevent duplicate cards */
  seenKeys: Set<string>;
}

// Small badge so a thumbnail's source is identifiable at a glance
const sourceBadge: Record<string, { label: string; icon: string }> = {
  youtube: { label: 'YT', icon: 'fa-brands fa-youtube' },
  peertube: { label: 'PT', icon: 'fa-solid fa-video' },
  audio: { label: 'MP3', icon: 'fa-solid fa-music' },
  webtorrent: { label: 'WT', icon: 'fa-solid fa-magnet' },
};

const cardSource = (card: CinemaCard) => {
  const src = card.track.sources?.[card.track.activeSourceIndex ?? 0] || card.track.sources?.[0];
  return src ? sourceBadge[src.type] : null;
};

// Expanded & optimized categories with primary + fallback tags, ranked by video density
const categories = ref<CinemaRow[]>([
  {
    id: 'video',
    label: 'Featured Videos',
    icon: 'fa-solid fa-film',
    tags: ['video', 'blurt-video', 'blurtmedia', 'vlog'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'vlogs',
    label: 'Vlogs & Stories',
    icon: 'fa-solid fa-video',
    tags: ['vlog', 'life', 'blog'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'blurtmedia',
    label: 'Blurt Originals',
    icon: 'fa-solid fa-fire',
    tags: ['blurtmedia', 'blurt-video', 'blurt'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'music',
    label: 'Music & Performance',
    icon: 'fa-solid fa-music',
    tags: ['music', 'song', 'livemusic', 'audio'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'gaming',
    label: 'Gaming & Esports',
    icon: 'fa-solid fa-gamepad',
    tags: ['gaming', 'game', 'play2earn', 'gameplay'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'crypto',
    label: 'Crypto & Finance',
    icon: 'fa-solid fa-coins',
    tags: ['crypto', 'bitcoin', 'blockchain', 'finances'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'movies',
    label: 'Cinema & Reviews',
    icon: 'fa-solid fa-clapperboard',
    tags: ['movies', 'cinema', 'film', 'movie'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'comedy',
    label: 'Comedy & Entertainment',
    icon: 'fa-solid fa-masks-theater',
    tags: ['comedy', 'fun', 'funny', 'humor'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'tech',
    label: 'Tech & Science',
    icon: 'fa-solid fa-microchip',
    tags: ['tech', 'technology', 'gadgets', 'tutorials'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'sport',
    label: 'Sports & Fitness',
    icon: 'fa-solid fa-futbol',
    tags: ['sport', 'sports', 'fitness', 'workout'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'food',
    label: 'Cooking & Food',
    icon: 'fa-solid fa-utensils',
    tags: ['food', 'cooking', 'recipe', 'foodie'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
  {
    id: 'podcasts',
    label: 'Podcasts & Shows',
    icon: 'fa-solid fa-podcast',
    tags: ['podcast', 'podcasts', 'interview', 'show'],
    sorts: ['trending', 'created'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set()
  },
]);

const PAGE_SIZE = 10;
const AUTO_FETCH_TARGET = 10;

/**
 * Advances category pointer to the next sort mode or tag when current stream is exhausted.
 */
function advanceCursorToNextMode(cat: CinemaRow): void {
  cat.cursor = null;
  cat.currentSortIndex++;

  // If we ran through all sorts for this tag, move to the next tag
  if (cat.currentSortIndex >= cat.sorts.length) {
    cat.currentSortIndex = 0;
    cat.currentTagIndex++;
  }

  // If we ran through all tags, mark row as fully exhausted
  if (cat.currentTagIndex >= cat.tags.length) {
    cat.exhausted = true;
  }
}

/**
 * Multi-tag & Multi-sort fetching loop with built-in deduplication.
 */
async function fetchMoreForCategory(cat: CinemaRow, target: number): Promise<void> {
  let emptyAttemptsInARow = 0;
  const MAX_EMPTY_ATTEMPTS = 5;

  while (cat.cards.length < target && !cat.exhausted) {
    if (cat.currentTagIndex >= cat.tags.length) {
      cat.exhausted = true;
      break;
    }

    const currentTag = cat.tags[cat.currentTagIndex];
    const currentSort = cat.sorts[cat.currentSortIndex];
    const pageSize = cat.pageSize ?? PAGE_SIZE;

    let raw: any[] = [];
    try {
      raw = cat.sourceType === 'account'
        ? await Blockchain.getAccountPosts(
            props.client,
            currentSort,
            currentTag, // account name, stashed in tags[0] for this sourceType
            pageSize,
            cat.cursor?.author,
            cat.cursor?.permlink
          )
        : await Blockchain.getRankedPosts(
            props.client,
            currentSort,
            currentTag,
            pageSize,
            cat.cursor?.author,
            cat.cursor?.permlink
          );
    } catch (e) {
      cat.error = e instanceof Error ? e.message : String(e);
      advanceCursorToNextMode(cat);
      continue;
    }

    // Drop cursor post returned by bridge API convention
    if (cat.cursor && raw.length && raw[0].author === cat.cursor.author && raw[0].permlink === cat.cursor.permlink) {
      raw = raw.slice(1);
    }

    if (!raw.length) {
      advanceCursorToNextMode(cat);
      emptyAttemptsInARow++;
      if (emptyAttemptsInARow >= MAX_EMPTY_ATTEMPTS) {
        cat.exhausted = true;
        break;
      }
      continue;
    }

    cat.rawCount += raw.length;
    const lastRaw = raw[raw.length - 1];
    cat.cursor = { author: lastRaw.author, permlink: lastRaw.permlink };

    let addedThisPage = 0;
    for (const r of raw) {
      const post = PostProcessor.normalizePost(r, {
        canMute: props.getCanMute?.(),
        mutedAccounts: props.getMutedAccounts?.(),
        coalMap: props.getCoalMap?.()
      });
      const postKey = `${post.author}/${post.permlink}`;

      // Deduplication check: skip if post is already present in this row
      if (cat.seenKeys.has(postKey)) {
        continue;
      }

      // Same visibility rule as everywhere else (see visibility.ts). Community-role bans/mutes
      // only make sense to enforce for posts that actually belong to the configured community -
      // a video tagged elsewhere isn't something this community's mods have any say over.
      const inThisCommunity = post.category === props.config?.communityAccount;
      const hidden = post.isGloballyBanned || (inThisCommunity && isHiddenFromViewer(post, {
        canBanUser: props.getCanBanUser?.() ?? false,
        canMute: props.getCanMute?.() ?? false
      }));
      if (hidden) continue;

      if (post.tracks && post.tracks.length) {
        const track = post.tracks[0] as unknown as MediaTrack;
        cat.seenKeys.add(postKey);
        cat.cards.push({
          post: { author: post.author, permlink: post.permlink, title: post.title, isCoal: post.isCoal, coalInfo: post.coalInfo },
          track,
        });
        addedThisPage++;
      }
    }

    if (cat.cards.length && !currentCard.value) {
      updateHero(cat.cards[0]);
    }

    // End of stream for current tag + sort method
    if (raw.length < pageSize) {
      advanceCursorToNextMode(cat);
    }

    if (addedThisPage === 0) {
      emptyAttemptsInARow++;
      if (emptyAttemptsInARow >= MAX_EMPTY_ATTEMPTS) {
        advanceCursorToNextMode(cat);
      }
    } else {
      emptyAttemptsInARow = 0;
    }
  }
}

const loadCategory = async (cat: CinemaRow): Promise<void> => {
  cat.loading = true;
  cat.error = null;
  cat.cards = [];
  cat.rawCount = 0;
  cat.cursor = null;
  cat.currentTagIndex = 0;
  cat.currentSortIndex = 0;
  cat.exhausted = false;
  cat.seenKeys = new Set<string>();
  await fetchMoreForCategory(cat, AUTO_FETCH_TARGET);
  cat.loading = false;
};

async function loadMoreForCategory(cat: CinemaRow): Promise<void> {
  if (cat.loadingMore || cat.exhausted) return;
  cat.loadingMore = true;
  try {
    await fetchMoreForCategory(cat, cat.cards.length + AUTO_FETCH_TARGET);
  } finally {
    cat.loadingMore = false;
  }
}

// --- "Feed" row: the classic profile feed (posts from followed accounts), same
// card/media filtering as tag categories, just sourced from the account instead of a tag.
function makeFeedRow(username: string): CinemaRow {
  return {
    id: 'feed',
    label: props.t('myFeed') || 'Feed',
    icon: 'fa-solid fa-house',
    sourceType: 'account',
    pageSize: 50,
    tags: [username],
    sorts: ['feed'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set(),
  };
}
const feedRow = ref<CinemaRow | null>(null);

// --- Per-person rows, derived from the feed itself: we walk the same classic feed
// (paginated independently of the Feed row above) purely to build an ordered, deduplicated
// list of followed authors — in the order they appear in the feed, i.e. by recency of their
// last activity. Someone followed but silent for a year simply never surfaces here, since
// their posts never come up while paging through the feed. Each new author becomes its own
// row (its own posts, newest first), fetched exactly like a tag category.
function makePersonRow(author: string): CinemaRow {
  return {
    id: `person-${author}`,
    label: `@${author}`,
    icon: 'fa-solid fa-user',
    sourceType: 'account',
    pageSize: 50,
    tags: [author],
    // NOTE: 'created' is NOT a valid sort for the bridge get_account_posts endpoint
    // (that's only for get_ranked_posts/tags) — this is why person rows were coming
    // back empty. 'posts' is the correct sort for "this account's own posts".
    sorts: ['posts'],
    cards: [], loading: true, rawCount: 0, error: null,
    currentTagIndex: 0, currentSortIndex: 0, cursor: null,
    exhausted: false, loadingMore: false, seenKeys: new Set(),
  };
}

const personRows = ref<CinemaRow[]>([]);
const personRowsLoading = ref(false);
const personRowsExhausted = ref(false);
const knownFeedAuthors = new Set<string>();
const feedListCursor = ref<{ author: string; permlink: string } | null>(null);
const FEED_LIST_PAGE_SIZE = 50;

/** Pulls one page of the classic feed and returns any newly-seen author names, in order. */
async function fetchNextFeedAuthorsPage(username: string): Promise<string[]> {
  let raw: any[] = [];
  try {
    raw = await Blockchain.getAccountPosts(
      props.client,
      'feed',
      username,
      FEED_LIST_PAGE_SIZE,
      feedListCursor.value?.author,
      feedListCursor.value?.permlink
    );
  } catch {
    personRowsExhausted.value = true;
    return [];
  }

  if (feedListCursor.value && raw.length && raw[0].author === feedListCursor.value.author && raw[0].permlink === feedListCursor.value.permlink) {
    raw = raw.slice(1);
  }

  if (!raw.length) {
    personRowsExhausted.value = true;
    return [];
  }

  const last = raw[raw.length - 1];
  feedListCursor.value = { author: last.author, permlink: last.permlink };
  if (raw.length < FEED_LIST_PAGE_SIZE) personRowsExhausted.value = true;

  const newAuthors: string[] = [];
  for (const post of raw) {
    if (!post.author || knownFeedAuthors.has(post.author)) continue;
    knownFeedAuthors.add(post.author);
    newAuthors.push(post.author);
  }
  return newAuthors;
}

/**
 * Called when the user scrolls past the last person row: fetches feed pages until it turns
 * up at least one not-yet-shown author (a page can consist entirely of authors we already
 * have a row for) or the feed itself runs out, then appends new person rows.
 */
async function loadMorePeople(): Promise<void> {
  const username = props.auth?.user?.username;
  if (!username || personRowsLoading.value || personRowsExhausted.value) return;
  personRowsLoading.value = true;
  try {
    let attempts = 0;
    while (attempts < 5 && !personRowsExhausted.value) {
      attempts++;
      const newAuthors = await fetchNextFeedAuthorsPage(username);
      if (newAuthors.length) {
        for (const author of newAuthors) {
          personRows.value.push(makePersonRow(author));
          // Read the just-pushed row back OUT of the reactive array (instead of using the
          // plain object reference we just created) before handing it to loadCategory().
          // Vue only tracks/triggers mutations that go through its reactive proxy; mutating
          // the raw pre-push object directly (as we used to) silently updates the data but
          // never notifies anything watching it, so a person row could finish loading with
          // 0 media cards and just sit there showing stale/incorrect content instead of
          // being properly hidden by visiblePersonRows the moment it's done.
          const reactiveRow = personRows.value[personRows.value.length - 1];
          loadCategory(reactiveRow);
        }
        break;
      }
    }
  } finally {
    personRowsLoading.value = false;
  }
}

/** Resets the Feed row + person rows, e.g. on mount or when the logged-in user changes. */
function resetFeedAndPeople(): void {
  const username = props.auth?.user?.username;
  feedListCursor.value = null;
  knownFeedAuthors.clear();
  personRows.value = [];
  personRowsExhausted.value = false;
  personRowsLoading.value = false;

  if (!username) {
    feedRow.value = null;
    return;
  }
  feedRow.value = makeFeedRow(username);
  loadCategory(feedRow.value);
  loadMorePeople();
}

watch(() => props.auth?.user?.username, () => resetFeedAndPeople());

// Playlists view mapping
const playlistRows = computed<CinemaRow[]>(() =>
  playlistState.playlists.map((pl) => ({
    id: pl.id,
    label: pl.name,
    icon: 'fa-solid fa-list',
    tags: [],
    sorts: [],
    loading: false,
    rawCount: pl.tracks.length,
    error: null,
    currentTagIndex: 0,
    currentSortIndex: 0,
    seenKeys: new Set(),
    cards: pl.tracks.map((track) => ({
      post: { author: track.author, permlink: track.permlink, title: track.title },
      track,
    })),
  }))
);

// Hide a person row entirely once it's done loading and turned up no media at all —
// we only want people whose feed actually has something playable. While still loading,
// keep it visible (with the spinner) so the row doesn't pop in/out.
const visiblePersonRows = computed<CinemaRow[]>(() =>
  personRows.value.filter((row) => row.loading || row.cards.length > 0)
);

const rows = computed<CinemaRow[]>(() => {
  if (playerState.cinemaBrowseView === 'playlists') return playlistRows.value;
  const feed = feedRow.value ? [feedRow.value] : [];
  return [...feed, ...categories.value, ...visiblePersonRows.value];
});

// Hero state & controls
const currentCard = ref<CinemaCard | null>(null);
const updateHero = (card: CinemaCard) => { currentCard.value = card; };

const isCardActive = (card: CinemaCard): boolean => {
  const current = playerState.currentTrack;
  if (!current) return false;
  return current.author === card.track.author && current.permlink === card.track.permlink && current.subId === card.track.subId;
};

const playCard = async (card: CinemaCard): Promise<void> => {
  updateHero(card);
  if (isCardActive(card)) {
    togglePlay();
  } else {
    await playTrack(card.track, true);
  }
  playerState.cinema = true;
  playerState.expanded = true;
  playerState.minimized = false;
};

watch(() => playerState.currentTrack, (track) => {
  if (!track) return;
  playerState.cinema = true;
  playerState.expanded = true;
  playerState.minimized = false;
});

onMounted(() => {
  categories.value.forEach(loadCategory);
  resetFeedAndPeople();
  playerState.hidden = true;
});

onUnmounted(() => {
  playerState.hidden = false;
  playerState.cinemaBrowseView = 'categories';
  peopleObserver?.disconnect();
});

// Infinite scroll for person rows: once the sentinel below the last one scrolls into view,
// pull the next feed page and append any newly-discovered authors as rows.
const peopleSentinel = ref<HTMLElement | null>(null);
let peopleObserver: IntersectionObserver | null = null;

watch(peopleSentinel, (el) => {
  peopleObserver?.disconnect();
  peopleObserver = null;
  if (!el) return;
  peopleObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadMorePeople();
  }, { rootMargin: '600px' });
  peopleObserver.observe(el);
});

// Keyboard & D-pad focus management
const gridEl = ref<HTMLElement | null>(null);
let hasAutoFocused = false;

watch(rows, () => {
  if (hasAutoFocused) return;
  nextTick(() => {
    if (hasAutoFocused) return;
    const first = gridEl.value?.querySelector<HTMLElement>('.cinema-card');
    if (first) {
      hasAutoFocused = true;
      first.focus({ preventScroll: true });
    }
  });
}, { deep: true, immediate: true });

watch(() => playerState.cinemaBrowseView, () => { hasAutoFocused = false; });
</script>

<template>
  <div ref="gridEl" class="cinema-index">

    <section class="cinema-hero" v-if="currentCard">
      <ForumMedia
        :key="currentCard.post.author + '/' + currentCard.post.permlink"
        class="cinema-hero-backdrop"
        :media="currentCard.track"
        mode="card"
        hide-buttons
        :author="currentCard.post.author"
        :permlink="currentCard.post.permlink"
        :title="currentCard.post.title"
        :t="t"
      />
      <div class="cinema-hero-content">
        <span v-if="currentCard.post.isCoal" class="cinema-coal-badge" :title="currentCard.post.coalInfo ? (currentCard.post.coalInfo.reason + ': ' + currentCard.post.coalInfo.notes) : ''">
          <i class="fa-solid fa-triangle-exclamation"></i> {{ t('coalWarningShort') }}
        </span>
        <h1 class="cinema-hero-title">{{ currentCard.post.title }}</h1>
        <div class="cinema-hero-meta">
          <span><i class="fa-solid fa-user-astronaut"></i> @{{ currentCard.post.author }}</span>
        </div>
        <button class="cinema-hero-play" @click="playCard(currentCard)">
          <i class="fa-solid fa-play"></i> {{ t('play') || 'Play' }}
        </button>
      </div>
    </section>

    <div v-if="playerState.cinemaBrowseView === 'playlists'" class="cinema-view-header">
      <button class="cinema-back-link" @click="playerState.cinemaBrowseView = 'categories'">
        <i class="fa-solid fa-arrow-left"></i> {{ t('categories') || 'Categories' }}
      </button>
      <h1 class="cinema-view-title">{{ t('playlists') || 'Playlists' }}</h1>
    </div>

    <div v-if="playerState.cinemaBrowseView === 'playlists' && !rows.length" class="cinema-empty">
      {{ t('noPlaylists') || 'You do not have any playlists yet.' }}
    </div>

    <template v-for="row in rows" :key="row.id">
      <section class="cinema-row">
        <h2 class="cinema-row-title"><i :class="row.icon"></i> {{ row.label }}</h2>

        <div v-if="row.loading" class="loader"><span class="spin"></span></div>

        <div v-else-if="row.error" class="cinema-empty">
          {{ t('error') || 'Error' }}: {{ row.error }}
        </div>

        <div v-else-if="!row.cards.length" class="cinema-empty">
          {{ playerState.cinemaBrowseView === 'playlists'
              ? (t('emptyPlaylist') || 'This playlist is empty.')
              : `${row.rawCount} ${t('postsFetched') || 'posts fetched'}, 0 ${t('withDetectedMedia') || 'with detected media'}` }}
        </div>

        <div v-else class="cinema-cards">
          <div v-for="card in row.cards" :key="card.post.author + '/' + card.post.permlink"
               class="cinema-card" tabindex="0" role="button"
               @click="playCard(card)"
               @mouseenter="updateHero(card)" @focus="updateHero(card)">
            <div class="cinema-card-thumb-wrap">
              <ForumMedia
                class="cinema-card-thumb"
                :media="card.track"
                mode="card"
                hide-buttons
                :author="card.post.author"
                :permlink="card.post.permlink"
                :title="card.post.title"
                :t="t"
              />
              <span v-if="cardSource(card)" class="cinema-card-badge" :title="cardSource(card)!.label">
                <i :class="cardSource(card)!.icon"></i> {{ cardSource(card)!.label }}
              </span>
              <span v-if="card.post.isCoal" class="cinema-coal-badge cinema-coal-badge--corner" :title="card.post.coalInfo ? (card.post.coalInfo.reason + ': ' + card.post.coalInfo.notes) : ''">
                <i class="fa-solid fa-triangle-exclamation"></i>
              </span>
            </div>
            <div class="cinema-card-info">
              <div class="cinema-card-title">{{ card.post.title }}</div>
              <div class="cinema-card-meta gs">@{{ card.post.author }}</div>
            </div>
          </div>

          <button
            v-if="playerState.cinemaBrowseView === 'categories' && !row.exhausted"
            class="cinema-card cinema-load-more-btn"
            :disabled="row.loadingMore"
            @click="loadMoreForCategory(row)"
          >
            <span v-if="row.loadingMore" class="spin"></span>
            <template v-else>
              <i class="fa-solid fa-plus"></i>
              <span>{{ t('loadMore') || 'Load More' }}</span>
            </template>
          </button>
        </div>
      </section>
    </template>

    <div
      v-if="playerState.cinemaBrowseView === 'categories' && personRows.length"
      ref="peopleSentinel"
      class="cinema-people-sentinel"
    >
      <span v-if="personRowsLoading" class="spin"></span>
    </div>
  </div>
</template>

<style scoped>
.cinema-index {
  width: 100%;
  min-height: 200px;
  padding: calc(var(--cinema-hero-h, 40vh) + 24px) 16px 40px;
  box-sizing: border-box;
}

.cinema-hero {
  position: fixed;
  top: 0;
  left: 72px;
  right: 0;
  height: var(--cinema-hero-h, 40vh);
  min-height: var(--cinema-hero-h-min, 260px);
  z-index: 10;
  border-radius: 0;
  overflow: hidden;
  margin-bottom: 0;
  display: flex;
  align-items: flex-end;
}
@media (max-width: 768px) {
  .cinema-hero { left: 0; height: var(--cinema-hero-h-mobile, 32vh); min-height: var(--cinema-hero-h-min-mobile, 220px); }
  .cinema-index { padding-top: calc(var(--cinema-hero-h-mobile, 32vh) + 20px); }
  .cinema-card { scroll-margin-top: calc(var(--cinema-hero-h-mobile, 32vh) + 20px + 50px); }
}
.cinema-hero-backdrop {
  position: absolute; inset: 0;
  display: block;
  filter: brightness(0.6);
  -webkit-mask-image: linear-gradient(to top, transparent 0, black 100px, black 100%);
  mask-image: linear-gradient(to top, transparent 0, black 100px, black 100%);
}
.cinema-hero-backdrop :deep(.media-placeholder) {
  width: 100%;
  height: 100%;
  aspect-ratio: unset;
  border-radius: 0;
  border: none;
}
.cinema-hero::after {
  content: "";
  position: absolute; inset: 0;
  background: linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 45%, transparent 75%);
}
.cinema-hero-content { position: relative; z-index: 1; padding: 28px; max-width: 640px; }
.cinema-hero-title { font-size: 1.6rem; font-weight: 700; color: #fff; line-height: 1.2; margin-bottom: 10px; text-shadow: 0 2px 12px rgba(0,0,0,0.5); }
.cinema-hero-meta { color: rgba(255,255,255,0.8); font-size: 0.85rem; margin-bottom: 16px; }
.cinema-hero-play {
  display: inline-flex; align-items: center; gap: 10px;
  background: var(--brand); color: #fff; border: none;
  padding: 10px 22px; border-radius: 6px; font-weight: 700; font-size: 0.9rem;
  cursor: pointer;
}
.cinema-hero-play:hover { filter: brightness(1.1); }

.cinema-view-header { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; }
.cinema-back-link {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--surface-2); border: 1px solid var(--surface-border);
  color: var(--text-strong); padding: 7px 14px; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.cinema-back-link:hover { background: var(--surface-border); }
.cinema-view-title { font-size: 1.2rem; font-weight: 700; color: var(--text-strong); }

.cinema-row { margin-bottom: 30px; }
.cinema-row-title {
  font-size: 15px;
  font-weight: bold;
  color: var(--text-strong);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.cinema-row-title i { color: var(--brand); }

.cinema-empty {
  font-size: 13px;
  color: var(--text-soft);
  opacity: 0.8;
  padding: 6px 4px;
}

.cinema-cards {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  overflow-y: visible;
  padding: 24px 20px;
}
.cinema-cards::-webkit-scrollbar { height: 6px; }
.cinema-cards::-webkit-scrollbar-thumb { background: var(--surface-border); border-radius: 3px; }

.cinema-card {
  flex: 0 0 240px;
  cursor: pointer;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 6px;
  overflow: hidden;
  transition: transform 0.15s ease;
  scroll-margin-top: calc(var(--cinema-hero-h, 40vh) + 24px + 50px);
}
.cinema-card:hover { transform: scale(1.04); outline: none; }
.cinema-card:focus-visible {
  transform: scale(1.1);
  outline: none;
  z-index: 5;
  position: relative;
  box-shadow: 0 0 0 4px var(--brand), 0 8px 30px rgba(0,0,0,0.6);
}

.cinema-card-thumb-wrap { position: relative; }
.cinema-card-thumb { display: block; border-radius: 0; border: none; pointer-events: none; }

.cinema-card-badge {
  position: absolute;
  top: 6px; left: 6px;
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(0,0,0,0.65);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 4px;
  letter-spacing: 0.3px;
  pointer-events: none;
}

/* COAL warning badge (coal.blurtwallet.com) - thumbnail/hero only get a small flag here, not
   the full blur+acknowledge treatment used for post/comment bodies (see style.css), since
   there's no long-form text to hide behind a click. */
.cinema-coal-badge {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--alert-error-text);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 4px;
  margin-bottom: 8px;
}
.cinema-coal-badge--corner {
  position: absolute;
  top: 6px; right: 6px;
  padding: 3px 6px;
  margin-bottom: 0;
  pointer-events: auto;
}

.cinema-card-info { padding: 8px 10px; }
.cinema-card-title {
  font-size: 12px; font-weight: bold; color: var(--card-title-color);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; line-height: 1.35; margin-bottom: 4px;
}
.cinema-card-meta { color: var(--card-muted-text); }

.cinema-load-more-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  aspect-ratio: 240 / 175;
  background: var(--surface-2);
  border: 1px dashed var(--card-border);
  color: var(--text-soft);
  font-size: 12px;
  font-weight: 600;
}
.cinema-load-more-btn:hover:not(:disabled) { background: var(--surface-3); color: var(--text-strong); border-color: var(--brand); }
.cinema-load-more-btn i { font-size: 18px; }
.cinema-load-more-btn:disabled { cursor: default; opacity: 0.7; }

.cinema-people-sentinel {
  display: flex;
  justify-content: center;
  padding: 20px 0 40px;
  min-height: 30px;
}
</style>