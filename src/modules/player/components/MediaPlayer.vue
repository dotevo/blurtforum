<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { registerDockedBarElement } from '../../floating-stack';
import ScrollableTabs from '../../ui/ScrollableTabs.vue';
import WebtorrentVideo from './WebtorrentVideo.vue';
import WebtorrentStorage from './WebtorrentStorage.vue';
import WebtorrentInfoTab from './WebtorrentInfoTab.vue';
import type { MediaTrack, BFPlayerAPI, Playlist } from '../types';
import { currentSource, CINEMA_HIDE_NATIVE_CONTROLS, stopAll, SUNO_EMBED_BASE } from '../player';
import { isTVPlatform } from '../../native/platform-info';
import { activeProfile } from '../../device-profiles/device-profiles';

const props = defineProps<{
  player: BFPlayerAPI;
  t: (k: string) => string;
}>();

const vw = ref(typeof window !== 'undefined' ? window.innerWidth : 1200);

// Mobile: expanded mode always opens on the video, regardless of whichever
// tab was last selected — a settings/comments tab replaces the video
// entirely on narrow screens (see .bfp-media-hidden), so defaulting to
// anything else would open on a blank video area.
watch(() => props.player.state.expanded, (isExpanded) => {
  if (isExpanded && vw.value <= 900) props.player.state.expandedTab = 'video';
});

const handleResize = () => { vw.value = window.innerWidth; };

function exitCinema(): void {
  // No PiP yet -- leaving fullscreen shouldn't leave something playing (or
  // about to start -- see mediaGeneration in player.ts) invisibly in the
  // background with nothing on screen able to stop it. A straight
  // togglePlay() isn't enough here: it only actually pauses once the
  // type-specific player object exists, and while that's still
  // initializing it just kicks off another init attempt instead -- stopAll()
  // is a real, unconditional stop.
  stopAll();
  props.player.state.expanded = false;
  props.player.state.cinema = false;
}

const emit = defineEmits<{
  /** A track's title/author area, or the "open" link, was clicked — host app decides what that means (e.g. open the source post). */
  trackClick: [track: MediaTrack];
}>();

defineSlots<{
  'track-actions'(props: { track: MediaTrack; zone: 'mini' | 'expanded' | 'cinema' }): unknown;
}>();

// ── Playlists ───────────────────────────────────────────────────────────────
// "New playlist" used to be a modal (PlaylistModal.vue). It's now an inline
// form within the Playlists tab body itself -- see the pl-create-form
// template below -- so all it needs is open/prefill state, no separate
// component with its own show/close plumbing.
const playlistModal = reactive({
  show: false,
  track: null as MediaTrack | null,
});
const newPlaylistName = ref('');
const newPlaylistColor = ref('#1a9b78');
const newPlaylistColors = ['#1a9b78', '#f5a623', '#e55353', '#5b8dd9', '#9b59b6', '#f39c12', '#7a8290'];

function openPlaylistCreateForm(track: MediaTrack | null): void {
  playlistModal.track = track;
  playlistModal.show = true;
  newPlaylistName.value = '';
  newPlaylistColor.value = newPlaylistColors[0];
}

const handlePlaylistConfirm = () => {
  if (!newPlaylistName.value.trim()) return;
  const pl = props.player.createPlaylist(newPlaylistName.value.trim(), newPlaylistColor.value);
  if (pl && playlistModal.track) props.player.addTrackToPlaylist(pl.id, playlistModal.track);
  playlistModal.show = false;
};

// ── Hover progress ──────────────────────────────────────────────────────────
const hoverProgressPct = ref<number | null>(null);
const hoverProgressTime = ref<number | null>(null);

function handleProgressClick(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  const pct = (e.offsetX / el.offsetWidth) * 100;
  props.player.seek(pct);
}

// The seek bar is a plain div (role="slider" alone doesn't make anything
// keyboard-focusable, an explicit tabindex is required) with its own
// Left/Right handling -- standard slider semantics, and left untouched by
// the global cinema D-pad navigator (see modules/cinema/dpad-nav.ts),
// which only takes over arrow keys when they'd otherwise do nothing useful.
function handleProgressKeydown(e: KeyboardEvent): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const duration = props.player.state.duration || 0;
  if (!duration) return;
  const deltaPct = (5 / duration) * 100; // 5 seconds, same step as most players' arrow-key seek
  const next = props.player.state.progress + (e.key === 'ArrowRight' ? deltaPct : -deltaPct);
  props.player.seek(Math.min(100, Math.max(0, next)));
}

function handleProgressHover(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  hoverProgressPct.value = (e.offsetX / el.offsetWidth) * 100;
  hoverProgressTime.value = (hoverProgressPct.value / 100) * props.player.state.duration;
}

const displayedAutoQueue = computed(() => {
  return props.player.state.autoQueue
});

const hasNext = computed(() => {
  return props.player.state.queue.length > 0 || displayedAutoQueue.value.length > 0;
});

// ── Time formatting ─────────────────────────────────────────────────────────
function formatTime(seconds: number | null | undefined): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const getBestType = (track: MediaTrack) => {
  if (!track.sources?.length) return 'audio';
  const priorities = ['youtube', 'audio', 'peertube'];
  for (const type of priorities) {
    const s = track.sources.find(s => s.type === type);
    if (s) return s.type;
  }
  return track.sources[0].type;
};

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7)  return `${d}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ── Media type badge labels ─────────────────────────────────────────────────
const typeLabel: Record<string, string> = { youtube: 'YT', peertube: 'PT', audio: 'MP3' };

// Applies each contribution's own optional `visible` predicate (see
// PlayerTabContribution in types.ts) -- e.g. the Comments tab hiding itself
// for a TV device-profile with showComments off. Generic: this component
// has no idea why a given tab is or isn't visible, only that it should
// respect what the contribution says.
const visibleExpandedTabs = computed(() => props.player.getExpandedTabs().filter(tab => tab.visible?.() !== false));

// Cinema mode hides the normal tab-bar header entirely and instead surfaces
// a small set of icon buttons that each open the same slide-in tabs panel.
// Native tabs (queue/playlists/settings) aren't in player.getExpandedTabs()
// -- that only holds plugin-registered ones (e.g. Comments) -- so build the
// combined list here instead of only using plugin tabs.
const cinemaPanelTabs = computed(() => [
  { id: 'queue', label: props.t('queue') || 'Queue', icon: 'fa-solid fa-list-ol' },
  { id: 'playlists', label: props.t('playlists') || 'Playlists', icon: 'fa-solid fa-layer-group' },
  { id: 'settings', label: props.t('settings') || 'Settings', icon: 'fa-solid fa-gear' },
  ...(currentSource.value?.type === 'webtorrent' ? [{ id: 'webtorrent-info', label: props.t('torrentInfo') || 'Torrent info', icon: 'fa-solid fa-circle-info' }] : []),
  ...visibleExpandedTabs.value,
]);

// Every source shares this same transport row (play/pause/prev/next/volume/
// seek) -- a source's own registered cinema buttons/widgets (see
// registerPlayerButton/registerPlayerWidget in player.ts, used by
// WebtorrentVideo.vue) supplement this row, they never replace it. (History:
// this briefly excluded webtorrent on the theory that its own overlay was a
// full replacement -- it wasn't; that silently removed the only way to
// pause, seek, or change volume for webtorrent in cinema mode.)
const showOwnCinemaControls = computed(() => true);

// Cinema mode's floating chrome (top bar, side icons, bottom bar) auto-hides
// after a few seconds of no activity -- the actual timer lives in player.ts
// (player.showCinemaControls() / player.state.cinemaControlsVisible) so that
// anything else contributing controls (e.g. WebtorrentVideo.vue teleporting
// its own overlay in) shares the exact same timer instead of running its own.

// mousemove over a YouTube/PeerTube iframe never reaches our document at
// all (separate browsing context, doesn't bubble) -- so hovering/clicking
// inside the video would otherwise leave our controls stuck hidden after
// the timeout with no way to bring them back except moving the mouse
// somewhere outside the iframe. `blur` on window fires reliably the instant
// focus moves into an iframe (e.g. clicking its pause button), which is the
// one cross-iframe signal we can actually observe.
//
// The same "focus moved into the iframe" moment also breaks D-pad/keyboard
// nav *permanently*, not just once: our own onCinemaControlsKeydown only
// ever runs for keydown events our document actually receives, and once an
// iframe has focus, every subsequent arrow-key press goes to the iframe's
// own document instead -- completely invisible to us, with nothing left to
// preventDefault() the browser's default (scrolling the page). Since our
// own overlay controls are always shown instead of the iframe's native ones
// (CINEMA_HIDE_NATIVE_CONTROLS), there's nothing useful happening inside the
// iframe that focus should stay on, so pulling it back onto our own play
// button the instant this happens is what actually keeps the remote/keyboard
// usable for the rest of the session instead of just for the first few
// seconds before anything is clicked.
function onWindowBlur(): void {
  props.player.showCinemaControls();
  if (props.player.state.cinema) focusCinemaPlayButton();
}
onMounted(() => window.addEventListener('blur', onWindowBlur));
onUnmounted(() => window.removeEventListener('blur', onWindowBlur));

// Left/right/up/down D-pad and keyboard navigation across cinema mode's
// controls (this zone, the rail, the browse grid) is handled globally and
// uniformly by modules/cinema/dpad-nav.ts -- see its file comment for why
// a bespoke per-zone handler here couldn't reach any of that (no hand-off
// to/from the rail or grid, and any keydown while focus wasn't exactly one
// of this zone's own buttons fell through to the browser's default page
// scroll with no preventDefault() in sight).

// The moment cinema fullscreen opens (or a new track starts while already
// in cinema, e.g. picked from the queue), put focus on the play/pause
// button -- otherwise D-pad/keyboard arrows have nothing focused to act on
// at all until the person happens to click something by hand first.
function focusCinemaPlayButton(): void {
  nextTick(() => {
    (document.querySelector<HTMLElement>('.bfp-panel--cinema .bfp-cinema-controls-row .bfp-btn--play'))?.focus();
  });
}
watch(() => props.player.state.cinema, (v) => { if (v) focusCinemaPlayButton(); });
watch(() => props.player.state.currentTrack, () => { if (props.player.state.cinema) focusCinemaPlayButton(); });

// Cinema mode: a single click on the video itself is overloaded with two
// jobs depending on state --
//  - if a side panel (comments/queue/playlists/settings) is open, the click
//    just dismisses it (matches clicking outside any other panel to close
//    it) rather than also toggling playback, which would be a surprising
//    double-effect from one click;
//  - otherwise it's a plain play/pause toggle, like YouTube/Netflix.
function handleCinemaVideoClick(): void {
  if (props.player.state.expandedTab !== 'video') {
    props.player.state.expandedTab = 'video';
    return;
  }
  props.player.togglePlay();
}

// Escape always closes whatever's currently open on top of the video --
// the side panel tab (comments/queue/playlists/settings) first. Every
// panel in the app is expected to collapse on Escape; this is cinema
// mode's version of that same rule.
function onPanelKeydown(e: KeyboardEvent): void {
  props.player.showCinemaControls();
  if (e.key !== 'Escape') return;
  if (props.player.state.cinema && props.player.state.expandedTab !== 'video') {
    e.preventDefault();
    props.player.state.expandedTab = 'video';
  }
}


const brokenImages = ref(new Set<string>());

function handleImgError(url: string) {
  if (url) brokenImages.value.add(url);
}

function getTrackCover(track: MediaTrack | null): string {
  if (!track) return '';
  const idx = typeof track.activeSourceIndex !== 'undefined' && track.activeSourceIndex !== -1 ? track.activeSourceIndex : 0;
  const source = track.sources[idx];
  
  // 1. Prioritize active source thumb (from ForumMedia registration)
  let url = source?.thumb || '';
  
  // 2. Auto-generate YT thumb if missing from the specific source object
  if (!url && source?.type === 'youtube' && source.id) {
    url = `https://img.youtube.com/vi/${source.id}/0.jpg`;
  }

  // 3. Fallback to general track cover (might be from another source or markdown)
  if (!url) url = track.cover || '';

  if (url && (url.length < 5 || brokenImages.value.has(url))) return '';
  return url;
}

const effectiveCover = computed(() => {
  return getTrackCover(props.player.state.currentTrack);
});

// ── Playlists ───────────────────────────────────────────────────────────────
const activePlaylistId = ref<string | null>(null);
const editingPlaylistName = ref(false);
const editNameValue = ref('');

function getActivePlaylist(): Playlist | null {
  return props.player.playlistState.playlists.find(p => p.id === activePlaylistId.value) || null;
}

function startEditName(): void {
  const pl = getActivePlaylist();
  if (!pl) return;
  editNameValue.value = pl.name;
  editingPlaylistName.value = true;
}

function saveEditName(): void {
  const pl = getActivePlaylist();
  if (!pl) return;
  if (editNameValue.value.trim()) props.player.renamePlaylist(pl.id, editNameValue.value.trim());
  editingPlaylistName.value = false;
}

function isCurrentInActivePlaylist(): boolean {
  const pl = getActivePlaylist();
  const track = props.player.state.currentTrack;
  if (!pl || !track) return false;
  return pl.tracks.some(t => t.author === track.author && t.permlink === track.permlink);
}

// ── Playlist dropdown ───────────────────────────────────────────────────────
const dropdownVisible = ref(false);
const dropdownTrack = ref<MediaTrack | null>(null);
const dropdownX = ref(0);
const dropdownY = ref(0);

function openPlaylistDropdown(track: MediaTrack, e: MouseEvent): void {
  dropdownTrack.value = track;
  dropdownVisible.value = true;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropdownY.value = rect.top;
  dropdownX.value = rect.right;
}

// ── Mirror Switcher ─────────────────────────────────────────────────────────
const mirrorSwitcherVisible = ref(false);

function switchSource(index: number): void {
  if (!props.player.state.currentTrack) return;
  props.player.state.currentTrack.activeSourceIndex = index;
  props.player.playTrack(props.player.state.currentTrack, true);
  mirrorSwitcherVisible.value = false;
}

// ── Mirror Priorities ───────────────────────────────────────────────────────
const defaultPriorities = ['youtube', 'audio', 'peertube'];
const priorities = ref<string[]>(JSON.parse(localStorage.getItem('bf-player-priorities') || JSON.stringify(defaultPriorities)));

function savePriorities(): void {
  localStorage.setItem('bf-player-priorities', JSON.stringify(priorities.value));
}

function movePriority(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= priorities.value.length) return;
  const item = priorities.value.splice(index, 1)[0];
  priorities.value.splice(target, 0, item);
  savePriorities();
}

function closePlaylistDropdown(): void {
  dropdownVisible.value = false;
  dropdownTrack.value = null;
}

function addToPlaylistFromDropdown(playlistId: string): void {
  if (!dropdownTrack.value) return;
  props.player.addTrackToPlaylist(playlistId, dropdownTrack.value);
  closePlaylistDropdown();
}

function createAndAddFromDropdown(): void {
  if (!dropdownTrack.value) return;
  props.player.state.expanded = true;
  props.player.state.expandedTab = 'playlists';
  openPlaylistCreateForm(dropdownTrack.value);
  closePlaylistDropdown();
}

function handleDocumentClick(): void { closePlaylistDropdown(); }

function confirmDeletePlaylist(id: string, name: string): void {
  if (window.confirm(`Delete playlist "${name}"?`)) props.player.deletePlaylist(id);
}
onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  window.addEventListener('resize', handleResize);
});
onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
  window.removeEventListener('resize', handleResize);
});

// Real measurement of the docked (non-expanded, non-cinema) bar's height
// for modules/floating-stack.ts -- see registerDockedBarElement's own
// comment there for why this replaced a guessed constant. Bound to the
// .bfp-bar root element in the template below via `ref="bfpBarEl"`.
const bfpBarEl = ref<HTMLElement | null>(null);
registerDockedBarElement(bfpBarEl);
</script>

<template>
<div
  v-if="!player.state.hidden && !player.state.cinema"
  ref="bfpBarEl"
  class="bfp-bar"
  :class="{
    'bfp-bar--minimized': player.state.minimized,
    'bfp-bar--loading':   player.state.loading
  }"
>

  <div
    class="bfp-progress-wrap"
    @click="handleProgressClick"
    @mousemove="handleProgressHover"
    @mouseleave="hoverProgressPct = null"
    role="slider"
    :aria-valuenow="Math.round(player.state.progress)"
    aria-valuemin="0" aria-valuemax="100"
  >
    <div class="bfp-progress-fill" :style="{ width: player.state.progress + '%' }"></div>
    <div class="bfp-progress-thumb" :style="{ left: player.state.progress + '%' }"></div>
    <div
      class="bfp-progress-tooltip"
      v-if="hoverProgressPct !== null"
      :style="{ left: Math.min(Math.max(hoverProgressPct, 3), 97) + '%' }"
    >{{ formatTime(hoverProgressTime) }}</div>
  </div>

  <div class="bfp-bar-inner">

    <template v-if="player.state.minimized">
      <button class="bfp-btn bfp-btn--play" @click="if(!player.state.currentTrack) { player.state.minimized = false; player.state.expanded = true; player.state.expandedTab = 'playlists'; } else player.togglePlay()">
        <div class="bfp-cover bfp-cover--minimized">
          <img v-if="effectiveCover" :src="effectiveCover" class="bfp-cover-img" alt="" @error="handleImgError(effectiveCover)" />
          <div v-else class="bfp-cover-placeholder"><i class="fa-solid fa-music"></i></div>
        </div>
        <div class="bfp-minimized-info">
          <div class="bfp-minimized-title">{{ player.state.currentTrack?.title || t('noTracks') || 'No track' }}</div>
          <div class="bfp-minimized-author">{{ player.state.currentTrack ? '@' + player.state.currentTrack.author : t('playlists') }}</div>
        </div>
        <i v-if="player.state.currentTrack" class="fa-solid" :class="player.state.playing ? 'fa-pause' : 'fa-play'" style="margin: 0 15px;"></i>
        <i v-else class="fa-solid fa-layer-group" style="margin: 0 15px;"></i>
      </button>
      <button class="bfp-btn" @click="player.state.minimized = false; if(!player.state.currentTrack) { player.state.expanded = true; player.state.expandedTab = 'playlists'; }" title="Maximize"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></button>
    </template>

    <template v-else>
      <div
        class="bfp-cover"
        @click="player.state.expanded = !player.state.expanded; if(player.state.expanded) { player.state.expandedTab = 'queue'; player.scrollToCurrent(); }"
        :title="player.state.expanded ? 'Close panel' : 'Open queue'"
      >
        <img v-if="effectiveCover" :src="effectiveCover" class="bfp-cover-img" alt="" @error="handleImgError(effectiveCover)" />
        <div v-else class="bfp-cover-placeholder">
          <i v-if="currentSource?.type === 'youtube'" class="fa-brands fa-youtube"></i>
          <i v-else-if="currentSource?.type === 'peertube'" class="fa-solid fa-video"></i>
          <i v-else class="fa-solid fa-music"></i>
        </div>
        <span v-if="currentSource" class="bfp-media-badge" :class="`bfp-media-badge--${currentSource.type}`">
          {{ typeLabel[currentSource.type] }}
        </span>

        <div class="bfp-cover-spinner" v-if="player.state.loading">
          <i class="fa-solid fa-spinner fa-spin"></i>
        </div>

        <button v-if="player.state.currentTrack && player.state.currentTrack.sources.length > 1" 
                class="bfp-mirror-toggle" @click.stop="mirrorSwitcherVisible = !mirrorSwitcherVisible"
                :class="{ active: mirrorSwitcherVisible }"
                title="Switch mirror/source">
          <i class="fa-solid fa-plus"></i>
        </button>
      </div>

      <div v-if="mirrorSwitcherVisible" class="bfp-mirror-overlay" @click.stop>
        <div class="bfp-mirror-header">
          <strong>Sources</strong>
          <button @click="mirrorSwitcherVisible = false"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="bfp-mirror-body">
          <div v-for="(s, idx) in player.state.currentTrack?.sources" :key="idx" 
               class="bfp-mirror-row" :class="{ active: player.state.currentTrack?.activeSourceIndex === idx }"
               @click="switchSource(idx)">
            <i v-if="s.type === 'youtube'" class="fa-brands fa-youtube"></i>
            <i v-else-if="s.type === 'peertube'" class="fa-solid fa-video"></i>
            <i v-else class="fa-solid fa-music"></i>
            <span>{{ s.host || typeLabel[s.type] }}</span>
            <i v-if="player.state.currentTrack?.activeSourceIndex === idx" class="fa-solid fa-check ms-auto"></i>
          </div>
        </div>
      </div>

      <div class="bfp-info">
        <div class="bfp-info-top">
          <div class="bfp-track-title">{{ player.state.currentTrack?.title || 'No title' }}</div>
          <div class="bfp-info-spacer"></div>
          <div class="bfp-post-stats" v-if="player.state.currentTrack">
            <slot name="track-actions" :track="player.state.currentTrack" zone="mini"></slot>
            <a
              href="#"
              class="bfp-post-link" @click.stop.prevent="emit('trackClick', player.state.currentTrack!)" title="Open"
            ><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
          </div>
        </div>
        <div class="bfp-track-meta">
          <a class="bfp-author" href="#" @click.prevent="emit('trackClick', player.state.currentTrack!)">
            @{{ player.state.currentTrack?.author }}
          </a>
          <span class="bfp-meta-sep">·</span>
          <span class="bfp-time" v-if="player.state.duration > 0">
            {{ formatTime(player.state.duration * player.state.progress / 100) }}
            <span class="bfp-time-sep">/</span>
            {{ formatTime(player.state.duration) }}
          </span>
          <span class="bfp-time" v-else-if="player.state.loading">Loading…</span>
        </div>
      </div>

      <div class="bfp-ctrl-sep"></div>

      <div class="bfp-controls">
        <button class="bfp-btn bfp-btn-mode" @click="player.togglePlayMode()" :title="'Mode: ' + player.state.playMode">
          <i v-if="player.state.playMode === 'sequential'" class="fa-solid fa-list-ol"></i>
          <i v-else-if="player.state.playMode === 'shuffle'" class="fa-solid fa-shuffle active"></i>
          <i v-else-if="player.state.playMode === 'repeat-all'" class="fa-solid fa-repeat active"></i>
          <i v-else-if="player.state.playMode === 'repeat-one'" class="fa-solid fa-arrows-rotate active" style="position:relative;">
            <span style="position:absolute; font-size:7px; top:50%; left:50%; transform:translate(-50%, -50%); font-weight:900; margin-top:1px">1</span>
          </i>
        </button>
        <div class="bfp-ctrl-sep"></div>
        <button class="bfp-btn" @click="player.playPrev()" title="Previous"><i class="fa-solid fa-backward-step"></i></button>
        <button class="bfp-btn bfp-btn--play" @click="player.togglePlay()" :title="player.state.playing ? 'Pause' : 'Play'">
          <i class="fa-solid fa-spinner fa-spin" v-if="player.state.loading"></i>
          <i class="fa-solid fa-pause" v-else-if="player.state.playing"></i>
          <i class="fa-solid fa-play"  v-else></i>
        </button>
        <button class="bfp-btn" @click="player.playNext()" :title="!hasNext ? 'Stop' : 'Next'">
          <i class="fa-solid" :class="!hasNext ? 'fa-xmark' : 'fa-forward-step'"></i>
        </button>
      </div>

      <div class="bfp-vol">
        <button
          class="bfp-btn bfp-vol-icon"
          @click="player.state.volume = player.state.volume > 0 ? 0 : 0.7"
          :title="player.state.volume === 0 ? 'Unmute' : 'Mute'"
        >
          <i class="fa-solid fa-volume-xmark" v-if="player.state.volume === 0"></i>
          <i class="fa-solid fa-volume-high"  v-else-if="player.state.volume > 0.5"></i>
          <i class="fa-solid fa-volume-low"   v-else></i>
        </button>
        <input type="range" min="0" max="1" step="0.01" class="bfp-vol-slider" v-model.number="player.state.volume"
               :style="`background: linear-gradient(to right, var(--bfp-accent) ${player.state.volume * 100}%, rgba(255,255,255,0.15) ${player.state.volume * 100}%)`" />
      </div>

      <button
        class="bfp-btn bfp-expand-btn"
        @click="player.state.expanded = !player.state.expanded; if(player.state.expanded) { player.state.expandedTab = 'queue'; player.scrollToCurrent(); }"
        :class="{ active: player.state.expanded }"
        title="Expand panel"
      >
        <i class="fa-solid fa-chevron-up" v-if="!player.state.expanded"></i>
        <i class="fa-solid fa-chevron-down" v-else></i>
      </button>

      <button class="bfp-btn bfp-expand-btn" @click="player.state.minimized = true" title="Minimize">
        <i class="fa-solid fa-minus"></i>
      </button>

    </template>
  </div></div><div
  class="bfp-panel"
  :class="{ 'bfp-panel--hidden': !player.state.expanded || player.state.minimized, 'bfp-panel--cinema': player.state.cinema, 'bfp-cinema-tab-open': player.state.cinema && player.state.expandedTab !== 'video', 'bfp-cinema-controls-hidden': player.state.cinema && !player.state.cinemaControlsVisible }"
  :style="{ height: player.state.expandedHeight + 'px' }"
  @mousemove="player.showCinemaControls()"
  @touchstart.passive="player.showCinemaControls()"
  @keydown="onPanelKeydown"
  @click="player.showCinemaControls()"
>

  <div class="bfp-panel-resize"
       @mousedown="player.initResize($event)"
       @touchstart.prevent="player.initResize($event)"
       title="Drag to resize"></div>

  <div class="bfp-panel-content" :class="'bfp-panel-content--' + player.state.expandedTab">
    
    <div class="bfp-panel-video" :class="{ 'bfp-media-hidden': !player.state.cinema && vw <= 900 && player.state.expandedTab !== 'video' }"
         :style="vw > 900 ? { flex: '1 1 0' } : {}">
      
      <div class="bfp-video-header">
        <button v-if="player.state.cinema" class="bfp-cinema-back-btn"
                @click="exitCinema"
                :title="t('backToLibrary') || 'Back to library'">
          <i class="fa-solid fa-arrow-left"></i> {{ t('backToLibrary') || 'Powrót do biblioteki' }}
        </button>
        <div class="bfp-video-header-info">
          <div class="bfp-video-header-title">{{ player.state.currentTrack?.title }}</div>
          <div class="gs" style="font-size: 10px;">@{{ player.state.currentTrack?.author }}</div>
        </div>
        <div class="bfp-video-header-stats" v-if="player.state.currentTrack && !player.state.cinema">
          <slot name="track-actions" :track="player.state.currentTrack" zone="expanded"></slot>
        </div>
      </div>

      <div class="bfp-video-wrap">
        <div :class="{ 'bfp-media-hidden': currentSource?.type !== 'youtube' }" class="bfp-video-iframe-wrap">
          <div id="bf-yt-player-target" style="width:100%; height:100%;"></div>
        </div>
        
        <div :class="{ 'bfp-media-hidden': currentSource?.type !== 'peertube' }" class="bfp-video-iframe-wrap">
          <iframe
            id="bf-pt-player-iframe"
            class="bfp-video-iframe"
            :key="currentSource?.id"
            :src="currentSource?.type === 'peertube' ? `https://${currentSource.host}/videos/embed/${currentSource.id}?api=1${player.state.isAutoStarting ? '&autoplay=1' : ''}${(CINEMA_HIDE_NATIVE_CONTROLS && player.state.cinema) ? '&controls=0&title=0&warningTitle=0&peertubeLink=0' : ''}` : ''"
            frameborder="0" allowfullscreen 
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            allow="autoplay"
          ></iframe>
        </div>

        <div :class="{ 'bfp-media-hidden': currentSource?.type !== 'suno' }" class="bfp-video-iframe-wrap">
          <iframe
            id="bf-suno-player-iframe"
            class="bfp-video-iframe"
            :key="currentSource?.id"
            :src="currentSource?.type === 'suno' ? `${SUNO_EMBED_BASE}/${currentSource.id}${player.state.isAutoStarting ? '?autoplay=1' : ''}` : ''"
            frameborder="0"
            allow="autoplay"
          ></iframe>
        </div>

        <!-- Cinema mode + native controls disabled: a transparent shield
             over the iframe. Without it, clicking the video to reveal our
             chrome can also trigger the iframe's own built-in click-to-pause
             (YouTube/PeerTube still do this even with controls=0). It just
             absorbs the click (does nothing with it) and forwards activity
             to showCinemaControls -- our own buttons render above it
             (higher z-index) so they're never blocked by this. -->
        <div
          v-if="player.state.cinema && CINEMA_HIDE_NATIVE_CONTROLS && (currentSource?.type === 'youtube' || currentSource?.type === 'peertube')"
          class="bfp-iframe-shield"
          @mousemove="player.showCinemaControls()"
          @click="player.showCinemaControls(); handleCinemaVideoClick()"
          @touchstart.passive="player.showCinemaControls()"
        ></div>

        <WebtorrentVideo :t="t" />

        <!-- Panel-toggle icons: always shown regardless of source, parked on
             the left edge so they never collide with YouTube/PeerTube's own
             native controls (which tend to live bottom/top) or with our own
             playback bar below (audio/webtorrent only). -->
        <div v-if="player.state.cinema" class="bfp-cinema-side-actions">
          <button v-for="tab in cinemaPanelTabs" :key="'ov-' + tab.id" class="bfp-cinema-overlay-btn"
                  :class="{ active: player.state.expandedTab === tab.id }"
                  @click="player.state.expandedTab = player.state.expandedTab === tab.id ? 'video' : tab.id"
                  :title="tab.label">
            <i :class="tab.icon"></i>
          </button>
        </div>

        <!-- Bottom chrome. player.getPlayerWidgets()/getPlayerButtons() let a
             source-specific component (see WebtorrentVideo.vue) register its
             own controls into the left-hand transport cluster below, or a
             full-width bar above the seek bar (piece map), instead of
             reimplementing an overlay + auto-hide timer of its own. Mounted
             directly, never Teleported, so a source's own internal
             positioning (e.g. a dropdown using `position: fixed`) is never
             at the mercy of backdrop-filter/transform on some ancestor it
             didn't choose. -->
        <div v-show="player.state.cinema" class="bfp-cinema-controls">
          <div class="bfp-cinema-extra-progress">
            <component v-for="w in player.getPlayerWidgets('cinema-progress')" :key="w.id"
                       :is="w.component" v-bind="w.props ? w.props() : {}" />
          </div>

          <div
            v-if="showOwnCinemaControls"
            class="bfp-cinema-progress"
            tabindex="0"
            @click="handleProgressClick"
            @keydown="handleProgressKeydown"
            @mousemove="handleProgressHover"
            @mouseleave="hoverProgressPct = null"
            role="slider"
            :aria-valuenow="Math.round(player.state.progress)"
            aria-valuemin="0" aria-valuemax="100"
          >
            <div class="bfp-cinema-progress-fill" :style="{ width: player.state.progress + '%' }"></div>
            <div class="bfp-cinema-progress-thumb" :style="{ left: player.state.progress + '%' }"></div>
            <div class="bfp-progress-tooltip" v-if="hoverProgressPct !== null"
                 :style="{ left: Math.min(Math.max(hoverProgressPct, 3), 97) + '%' }">{{ formatTime(hoverProgressTime) }}</div>
          </div>

          <div class="bfp-cinema-controls-row">
            <div v-if="showOwnCinemaControls" class="bfp-cinema-controls-left">
              <button class="bfp-btn" @click="player.playPrev()" title="Previous"><i class="fa-solid fa-backward-step"></i></button>
              <button class="bfp-btn bfp-btn--play" @click="player.togglePlay()" :title="player.state.playing ? 'Pause' : 'Play'">
                <i class="fa-solid fa-spinner fa-spin" v-if="player.state.loading"></i>
                <i class="fa-solid fa-pause" v-else-if="player.state.playing"></i>
                <i class="fa-solid fa-play"  v-else></i>
              </button>
              <button class="bfp-btn" @click="player.playNext()" :title="!hasNext ? 'Stop' : 'Next'">
                <i class="fa-solid" :class="!hasNext ? 'fa-xmark' : 'fa-forward-step'"></i>
              </button>
              <div class="bfp-vol">
                <button class="bfp-btn bfp-vol-icon" @click="player.state.volume = player.state.volume > 0 ? 0 : 0.7">
                  <i class="fa-solid fa-volume-xmark" v-if="player.state.volume === 0"></i>
                  <i class="fa-solid fa-volume-high"  v-else-if="player.state.volume > 0.5"></i>
                  <i class="fa-solid fa-volume-low"   v-else></i>
                </button>
                <input type="range" min="0" max="1" step="0.01" class="bfp-vol-slider" v-model.number="player.state.volume"
                       :style="`background: linear-gradient(to right, var(--bfp-accent) ${player.state.volume * 100}%, rgba(255,255,255,0.3) ${player.state.volume * 100}%)`" />
              </div>
              <span class="bfp-cinema-time gs" v-if="player.state.duration > 0">
                {{ formatTime(player.state.duration * player.state.progress / 100) }} / {{ formatTime(player.state.duration) }}
              </span>

              <!-- A source's own controls (e.g. WebTorrent's torrent-info/
                   download buttons and its peers/speed/subtitles widget) join
                   this same left-hand cluster, right after the standard
                   transport controls -- see registerPlayerButton/
                   registerPlayerWidget in player.ts. Deliberately NOT on the
                   right: that's where the track-actions slot and the
                   slide-out panel toggles live, and D-pad navigation flows
                   left-to-right through whichever cluster it's already in, so
                   keeping everything playback-related in one group here
                   keeps it reachable without jumping across the row. -->
              <button v-for="b in player.getPlayerButtons('cinema')" :key="b.id" class="bfp-btn bfp-cinema-extra-btn"
                      :class="{ 'bfp-cinema-extra-btn--active': b.active?.() }" @click="b.onClick()" :title="b.label">
                <i :class="b.icon"></i>
                <span v-if="b.badge?.()" class="bfp-cinema-extra-badge">{{ b.badge() }}</span>
              </button>
              <component v-for="w in player.getPlayerWidgets('cinema-left')" :key="w.id"
                         :is="w.component" v-bind="w.props ? w.props() : {}" />
            </div>

            <div class="bfp-cinema-track-actions" v-if="player.state.currentTrack">
              <slot name="track-actions" :track="player.state.currentTrack" zone="cinema"></slot>
            </div>
          </div>
        </div>

        <div :class="{ 'bfp-media-hidden': currentSource?.type !== 'audio' }" class="bfp-video-audio-placeholder"
             @click="player.state.cinema && (player.showCinemaControls(), handleCinemaVideoClick())"
             @mousemove="player.state.cinema && player.showCinemaControls()">
          <img v-if="effectiveCover" :src="effectiveCover" class="bfp-placeholder-cover" alt="" @error="handleImgError(effectiveCover)" />
          <div v-else class="bfp-placeholder-icon"><i class="fa-solid fa-music" style="font-size:48px; opacity:0.3;"></i></div>
          <div class="bfp-placeholder-info">
            <div class="bfp-placeholder-title">{{ player.state.currentTrack?.title }}</div>
            <div class="bfp-placeholder-author">@{{ player.state.currentTrack?.author }}</div>
          </div>
          <div class="bfp-placeholder-eq" v-if="player.state.playing">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="vw > 900 && !player.state.cinema" class="bfp-tabs-resize" @mousedown="player.initTabsResize($event)" @touchstart.prevent="player.initTabsResize($event)" title="Drag to resize"></div>

    <div class="bfp-panel-tabs" :style="vw > 900 ? { flex: '0 0 ' + player.state.tabsWidth + 'px' } : {}">
      <button v-if="player.state.cinema" class="bfp-cinema-tab-close" @click="player.state.expandedTab = 'video'" aria-label="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="bfp-panel-header">
        <ScrollableTabs>
          <button v-if="vw <= 900" class="bfp-tab" :class="{ active: player.state.expandedTab === 'video' }" @click="player.state.expandedTab = 'video'">
            <i class="fa-solid fa-tv"></i> <span>{{ t('video') }}</span>
          </button>
          <button class="bfp-tab" :class="{ active: player.state.expandedTab === 'queue' }"
                  @click="player.state.expandedTab = 'queue'; player.scrollToCurrent()">
            <i class="fa-solid fa-list-ol"></i> <span>{{ t('queue') }}</span>
            <span class="bfp-tab-count" v-if="player.state.queue.length + displayedAutoQueue.length > 0">
              {{ player.state.queue.length + displayedAutoQueue.length }}
            </span>
          </button>
          <button class="bfp-tab" :class="{ active: player.state.expandedTab === 'playlists' }" @click="player.state.expandedTab = 'playlists'">
            <i class="fa-solid fa-layer-group"></i> <span>{{ t('playlists') || 'Playlists' }}</span>
            <span class="bfp-tab-count" v-if="player.playlistState.playlists.length > 0">{{ player.playlistState.playlists.length }}</span>
          </button>
          <button class="bfp-tab" :class="{ active: player.state.expandedTab === 'settings' }" @click="player.state.expandedTab = 'settings'">
            <i class="fa-solid fa-gear"></i> <span>{{ t('settings') }}</span>
          </button>
          <button v-if="currentSource?.type === 'webtorrent'" class="bfp-tab" :class="{ active: player.state.expandedTab === 'webtorrent-info' }" @click="player.state.expandedTab = 'webtorrent-info'">
            <i class="fa-solid fa-circle-info"></i> <span>{{ t('torrentInfo') || 'Torrent info' }}</span>
          </button>
          <button v-for="tab in visibleExpandedTabs" :key="tab.id" class="bfp-tab"
                  :class="{ active: player.state.expandedTab === tab.id }" @click="player.state.expandedTab = tab.id">
            <i :class="tab.icon"></i> <span>{{ tab.label }}</span>
          </button>
        </ScrollableTabs>
        <button class="bfp-btn bfp-panel-close" @click="player.state.cinema ? exitCinema() : (player.state.expanded = false)" aria-label="Close panel">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="bfp-panel-body" v-if="player.state.expandedTab === 'settings'">
        <div class="bfp-settings-header">
          <strong>{{ t('mediaPriorities') || 'Media Mirror Priorities' }}</strong>
        </div>
        <div class="bfp-settings-body">
          <p class="gs" style="margin-bottom:15px; font-size:11px; opacity:0.8;">{{ t('dragToReorder') || 'Order sources by preference (top = highest priority):' }}</p>
          <div class="bfp-priority-list">
            <div v-for="(type, idx) in priorities" :key="type" class="bfp-priority-item">
              <i v-if="type === 'youtube'" class="fa-brands fa-youtube" style="color:#ff0000; width:16px;"></i>
              <i v-else-if="type === 'peertube'" class="fa-solid fa-video" style="color:#f1680d; width:16px;"></i>
              <i v-else class="fa-solid fa-music" style="color:var(--bfp-accent); width:16px;"></i>
              <span style="flex:1; font-weight:600;">{{ typeLabel[type] }}</span>
              <div class="bfp-priority-actions">
                <button :disabled="idx === 0" @click="movePriority(idx, -1)"><i class="fa-solid fa-chevron-up"></i></button>
                <button :disabled="idx === priorities.length - 1" @click="movePriority(idx, 1)"><i class="fa-solid fa-chevron-down"></i></button>
              </div>
            </div>
          </div>
        </div>

        <template v-if="!isTVPlatform || activeProfile?.isAdmin">
          <div class="bfp-settings-header" style="margin-top:18px;">
            <strong>{{ t('webtorrent') || 'WebTorrent' }}</strong>
          </div>
          <div class="bfp-settings-body">
            <WebtorrentStorage :t="t" />
          </div>
        </template>
        <p v-else class="gs" style="margin-top:18px; padding: 8px 0; opacity: 0.7;">
          <i class="fa-solid fa-lock"></i> {{ t('webtorrentAdminOnly') || 'WebTorrent settings are only available for the administrator profile.' }}
        </p>
      </div>

      <div class="bfp-panel-body" v-if="player.state.expandedTab === 'webtorrent-info'">
        <WebtorrentInfoTab :t="t" />
      </div>

      <div class="bfp-panel-body queue-list" v-show="player.state.expandedTab === 'queue'">

    <div class="pq-section-label pq-label--history" v-if="player.state.history.length > 0">
      <i class="fa-solid fa-clock-rotate-left"></i> {{ t('history') }}
    </div>
    <div v-for="(track, idx) in player.state.history" :key="'h-'+track.author + '-' + track.permlink+idx"
         class="pq-item pq-item--history" @click="player.playTrack(track, false, -1, true)" :title="'Replay: ' + track.title">
      <div class="pq-timeline-col">
        <div class="pq-dot pq-dot--history"><i class="fa-solid fa-check"></i></div>
        <div class="pq-line"></div>
      </div>
      <div class="pq-card">
        <img v-if="getTrackCover(track)" :src="getTrackCover(track)" class="pq-thumb" alt="" @error="handleImgError(getTrackCover(track))" />
        <div v-else class="pq-thumb pq-thumb--placeholder"><i class="fa-solid fa-music"></i></div>
        <div class="pq-info">
          <div class="pq-title">{{ track.title }}</div>
          <div class="pq-meta">
            <span>@{{ track.author }}</span>
            <span class="pq-type-badge" :class="`pq-type-badge--${getBestType(track)}`">{{ typeLabel[getBestType(track)] }}</span>
          </div>
        </div>
        <div class="pq-actions">
          <a v-if="track.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('trackClick', track)" title="Open"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
          <button class="pq-action" @click.stop="player.playTrack(track, false, -1, true)" title="Replay"><i class="fa-solid fa-rotate-right"></i></button>
          <button class="pq-action pq-action--playlist" @click.stop="openPlaylistDropdown(track, $event)" title="Add to playlist"><i class="fa-solid fa-list-ul"></i></button>
        </div>
      </div>
    </div>

    <div id="current-queue-anchor"></div>

    <div class="pq-section-label pq-label--now" v-if="player.state.currentTrack">
      <i class="fa-solid fa-play"></i> {{ t('playing') || 'Now playing' }}
    </div>
    <div class="pq-item pq-item--now" v-if="player.state.currentTrack">
      <div class="pq-timeline-col">
        <div class="pq-dot pq-dot--now">
          <i class="fa-solid fa-spinner fa-spin" v-if="player.state.loading"></i>
          <i class="fa-solid fa-play" v-else></i>
        </div>
        <div class="pq-line pq-line--now"></div>
      </div>
      <div class="pq-card pq-card--now">
        <img v-if="getTrackCover(player.state.currentTrack)" :src="getTrackCover(player.state.currentTrack)" class="pq-thumb pq-thumb--now" alt="" />
        <div v-else class="pq-thumb pq-thumb--placeholder pq-thumb--now"><i class="fa-solid fa-music"></i></div>
        <div class="pq-info">
          <div class="pq-now-badge">▶ NOW</div>
          <div class="pq-title pq-title--now">{{ player.state.currentTrack.title }}</div>
          <div class="pq-meta">
            <span>@{{ player.state.currentTrack.author }}</span>
            <span v-if="currentSource" class="pq-type-badge" :class="`pq-type-badge--${currentSource.type}`">{{ typeLabel[currentSource.type] }}</span>
          </div>

        </div>
        <div class="pq-equalizer" v-if="player.state.playing && !player.state.loading">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="pq-actions">
          <a v-if="player.state.currentTrack.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('trackClick', player.state.currentTrack!)" title="Open"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
          <button class="pq-action pq-action--playlist" @click.stop="openPlaylistDropdown(player.state.currentTrack, $event)" title="Add to playlist"><i class="fa-solid fa-list-ul"></i></button>
        </div>
      </div>
    </div>

    <div class="pq-section-label pq-label--manual" v-if="player.state.queue.length > 0">
      <i class="fa-solid fa-hand-pointer"></i> {{ t('queueManual') || 'Up next' }}
      <button class="pq-section-clear" @click="player.state.queue = []" title="Clear queue">{{ t('clear') || 'Clear' }}</button>
    </div>
    <div v-for="(track, idx) in player.state.queue" :key="'q-'+track.author + '-' + track.permlink+idx"
         class="pq-item pq-item--manual" :class="{ 'pq-item--next': idx === 0 }">
      <div class="pq-timeline-col">
        <div class="pq-dot pq-dot--manual"><span>{{ idx + 1 }}</span></div>
        <div class="pq-line" v-if="idx < player.state.queue.length - 1 || displayedAutoQueue.length > 0"></div>
      </div>
      <div class="pq-card" @click="player.playTrack(track, true, idx)">
        <img v-if="track.cover" :src="track.cover" class="pq-thumb" alt="" />
        <div v-else class="pq-thumb pq-thumb--placeholder"><i class="fa-solid fa-music"></i></div>
        <div class="pq-info">
          <div class="pq-title">{{ track.title }}</div>
          <div class="pq-meta">
            <span>@{{ track.author }}</span>
            <span class="pq-type-badge" :class="`pq-type-badge--${getBestType(track)}`">{{ typeLabel[getBestType(track)] }}</span>
          </div>
        </div>
        <div class="pq-actions">
          <a v-if="track.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('trackClick', track)" title="Open"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
          <button class="pq-action" @click.stop="player.playTrack(track, true, idx)" title="Play now"><i class="fa-solid fa-play"></i></button>
          <button class="pq-action pq-action--playlist" @click.stop="openPlaylistDropdown(track, $event)"><i class="fa-solid fa-list-ul"></i></button>
          <button class="pq-action pq-action--remove" @click.stop="player.state.queue.splice(idx, 1)" title="Remove"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
    </div>

    <div class="pq-section-label pq-label--auto" v-if="displayedAutoQueue.length > 0">
      <i class="fa-solid fa-shuffle"></i> {{ t('queueAutoplay') || 'Autoplay' }}
    </div>
    <div v-for="(track, idx) in displayedAutoQueue" :key="'a-'+track.author + '-' + track.permlink+idx"
         class="pq-item pq-item--auto" @click="player.playTrack(track)">
      <div class="pq-timeline-col">
        <div class="pq-dot pq-dot--auto"><span>{{ idx + 1 }}</span></div>
        <div class="pq-line" v-if="idx < displayedAutoQueue.length - 1"></div>
      </div>
      <div class="pq-card">
        <img v-if="getTrackCover(track)" :src="getTrackCover(track)" class="pq-thumb" alt="" @error="handleImgError(getTrackCover(track))" />
        <div v-else class="pq-thumb pq-thumb--placeholder"><i class="fa-solid fa-music"></i></div>
        <div class="pq-info">
          <div class="pq-title">{{ track.title }}</div>
          <div class="pq-meta">
            <span>@{{ track.author }}</span>
            <span class="pq-type-badge" :class="`pq-type-badge--${getBestType(track)}`">{{ typeLabel[getBestType(track)] }}</span>
          </div>
        </div>
        <div class="pq-actions">
          <a v-if="track.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('trackClick', track)" title="Open"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
          <button class="pq-action pq-action--playlist" @click.stop="openPlaylistDropdown(track, $event)"><i class="fa-solid fa-list-ul"></i></button>
        </div>
      </div>
    </div>

    <div class="pq-empty" v-if="!player.state.currentTrack && !player.state.queue.length && !displayedAutoQueue.length">
      <i class="fa-solid fa-headphones" style="font-size:32px; opacity:0.2;"></i>
      <div>{{ t('queueEmpty') || 'Queue is empty' }}</div>
    </div>
  </div><div class="bfp-panel-body" v-show="player.state.expandedTab === 'playlists'">
    <div class="pl-wrap">

      <template v-if="!activePlaylistId">
        <div class="pl-header">
          <span class="pl-header-title"><i class="fa-solid fa-layer-group"></i> {{ t('playlists') || 'Playlists' }}</span>
          <button class="pl-new-btn" @click="openPlaylistCreateForm(player.state.currentTrack || null)">
            <i class="fa-solid fa-plus"></i> {{ t('new') || 'New' }}
          </button>
        </div>

        <div v-if="playlistModal.show" class="pl-create-form">
          <div v-if="playlistModal.track" class="gs" style="margin-bottom:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            🎵 {{ t('adding') || 'Adding' }}: {{ playlistModal.track.title }}
          </div>
          <label class="form-label">{{ t('playlistName') || 'Playlist Name' }}</label>
          <input type="text" v-model="newPlaylistName" class="pl-create-input"
                 style="width:100%; height:38px; margin-bottom:12px;"
                 :placeholder="t('enterName') || 'Enter name...'"
                 @keyup.enter="handlePlaylistConfirm" />

          <label class="form-label">{{ t('color') || 'Color' }}</label>
          <div class="pl-color-dots" style="margin-top:8px; margin-bottom:14px;">
            <div v-for="c in newPlaylistColors" :key="c" class="pl-color-dot"
                 :class="{ selected: newPlaylistColor === c }" :style="{ background: c }"
                 @click="newPlaylistColor = c"></div>
          </div>

          <div style="display:flex; gap:10px;">
            <button class="btn btn-primary" style="flex:1; padding:8px;" @click="handlePlaylistConfirm" :disabled="!newPlaylistName.trim()">
              <i class="fa-solid fa-check"></i> {{ t('confirm') || 'Confirm' }}
            </button>
            <button class="btn btn-ghost" @click="playlistModal.show = false">{{ t('cancel') }}</button>
          </div>
        </div>

        <div class="pl-list">
          <div v-for="pl in player.playlistState.playlists" :key="pl.id" class="pl-row">
            <div class="pl-dot" :style="{ background: pl.color }"></div>
            <div class="pl-row-name" @click="activePlaylistId = pl.id">{{ pl.name }}</div>
            <div class="pl-row-meta">{{ pl.tracks.length }} track{{ pl.tracks.length !== 1 ? 's' : '' }}</div>
            <div class="pl-row-actions">
              <button class="pl-action-btn play" @click.stop="player.playPlaylist(pl.id)" title="Play all"><i class="fa-solid fa-play"></i></button>
              <button class="pl-action-btn delete" @click.stop="confirmDeletePlaylist(pl.id, pl.name)" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
          <div class="pq-empty" v-if="player.playlistState.playlists.length === 0">
            <i class="fa-solid fa-layer-group" style="font-size:28px; opacity:0.2;"></i>
            <div>{{ t('playlistEmpty') || 'No playlists — click "+ New"' }}</div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="pl-inner-header">
          <button class="pl-back-btn" @click="activePlaylistId = null"><i class="fa-solid fa-arrow-left"></i></button>
          <div class="pl-inner-name" v-if="!editingPlaylistName"
               @dblclick="startEditName()"
               :style="{ borderLeft: '3px solid ' + (getActivePlaylist()?.color ?? '#ccc') }">
            {{ getActivePlaylist()?.name }}
          </div>
          <input v-else class="pl-inner-name-input" v-model="editNameValue"
                 @blur="saveEditName()" @keyup.enter="saveEditName()" @keyup.escape="editingPlaylistName = false" />
          <button class="pl-play-all" v-if="getActivePlaylist()?.tracks.length" @click="player.playPlaylist(activePlaylistId!)">
            <i class="fa-solid fa-play"></i> Play
          </button>
        </div>

        <div class="pl-track-list">
          <div v-for="(track, idx) in getActivePlaylist()?.tracks || []" :key="'plt-'+track.author + '-' + track.permlink"
               class="pl-track-row" @click="player.playPlaylist(activePlaylistId!, idx)">
            <div class="pl-track-num">{{ idx + 1 }}</div>
            <div class="pl-track-play"><i class="fa-solid fa-play" style="font-size:10px"></i></div>
            <img v-if="track.cover" :src="track.cover" class="pl-track-thumb" alt="" />
            <div v-else class="pl-track-thumb pl-track-thumb--placeholder"><i class="fa-solid fa-music"></i></div>
            <div class="pl-track-info">
              <div class="pl-track-title">{{ track.title }}</div>
              <div class="pl-track-meta">
                @{{ track.author }} · {{ formatRelativeTime(track.addedAt) }} ·
                <span class="pq-type-badge" :class="`pq-type-badge--${getBestType(track)}`">{{ typeLabel[getBestType(track)] }}</span>
              </div>
            </div>
            <div class="pl-track-actions">
              <a v-if="track.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('trackClick', track)" title="Open"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
              <button class="pl-action-btn delete" @click.stop="player.removeTrackFromPlaylist(activePlaylistId!, track.author, track.permlink)"><i class="fa-solid fa-xmark"></i></button>
            </div>
          </div>

          <button class="pl-add-current" v-if="player.state.currentTrack"
                  @click="player.addTrackToPlaylist(activePlaylistId!, player.state.currentTrack)"
                  :disabled="isCurrentInActivePlaylist()">
            <i class="fa-solid fa-plus"></i>
            {{ isCurrentInActivePlaylist() ? (t('alreadyInPlaylist') || '✓ Already in playlist') : (t('addCurrentTrack') || '+ Add current track') }}
          </button>

          <div class="pq-empty" v-if="!getActivePlaylist()?.tracks.length">
            <i class="fa-solid fa-music" style="font-size:24px; opacity:0.2;"></i>
            <div>{{ t('playlistEmpty') || 'Playlist is empty' }}</div>
          </div>
        </div>
      </template>
    </div></div>
        <div v-for="tab in visibleExpandedTabs" :key="'body-' + tab.id" class="bfp-panel-body" v-show="player.state.expandedTab === tab.id">
      <component :is="tab.component" :track="player.state.currentTrack" :player="player" :t="t" v-bind="tab.props || {}" />
    </div>
    </div>
    </div></div><div class="pl-dropdown" v-if="dropdownVisible"
     :style="{ top: dropdownY + 'px', left: dropdownX + 'px' }"
     @click.stop>
  <div class="pl-dropdown-title">Add to playlist</div>
  <div v-for="pl in player.playlistState.playlists" :key="'dd-'+pl.id"
       class="pl-dropdown-item" @click="addToPlaylistFromDropdown(pl.id)">
    <div class="pl-dropdown-dot" :style="{ background: pl.color }"></div>
    <span>{{ pl.name }}</span>
    <i class="fa-solid fa-check" style="margin-left:auto; color:var(--brand);"
       v-if="pl.tracks.some(t => t.author === dropdownTrack?.author && t.permlink === dropdownTrack?.permlink)"></i>
  </div>
  <div class="pl-dropdown-sep"></div>
  <div class="pl-dropdown-item pl-dropdown-new" @click="createAndAddFromDropdown()">
    <i class="fa-solid fa-plus"></i> <span>New playlist</span>
  </div>
</div>

</template>

<style>
/* ═══════════════════════════════════════════════════════════════════════
   BFP PLAYER — bar + panel styles
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Variables (inherit from theme) ─────────────────────────────────────── */
.bfp-bar, .bfp-panel {
  --bfp-bg:      var(--surface-nav, #1a1a2e);
  --bfp-border:  var(--surface-border, rgba(255,255,255,0.08));
  --bfp-text:    var(--text-strong, #e0e0e0);
  --bfp-muted:   var(--text-soft, rgba(255,255,255,0.45));
  --bfp-accent:  var(--brand, #1a9b78);
  --bfp-hover:   rgba(255,255,255,0.06);
  --bfp-radius:  6px;
  --bfp-h:       72px;
  --bfp-prog-h:  4px;
}

/* ── Bar ─────────────────────────────────────────────────────────────────── */
.bfp-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  z-index: 1000;
  background: var(--bfp-bg);
  border-top: 1px solid var(--bfp-border);
  display: flex;
  flex-direction: column;
  box-shadow: 0 -4px 24px rgba(0,0,0,0.35);
  transition: background 0.3s;
  user-select: none;
}
.bfp-bar--loading { opacity: 0.9; }

/* ── Minimized Pill ──────────────────────────────────────────────────────── */
.bfp-bar--minimized {
  bottom: 20px;
  left: auto;
  right: 20px;
  width: auto;
  max-width: 320px;
  height: 48px;
  border-radius: 24px;
  border: 1px solid var(--bfp-accent);
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  overflow: hidden;
  background: var(--bfp-bg);
}
.bfp-bar--minimized .bfp-progress-wrap { display: none; }
.bfp-bar--minimized .bfp-bar-inner { height: 100%; padding: 0 10px 0 0 !important; gap: 0; }
.bfp-bar--minimized .bfp-btn--play { 
  width: auto; height: 100%; border-radius: 0; 
  background: transparent; color: var(--bfp-text);
  justify-content: flex-start; padding: 0 15px 0 0 !important;
}
.bfp-bar--minimized .bfp-btn--play:hover { background: var(--bfp-hover); }

.bfp-cover--minimized { width: 48px; height: 100%; border-radius: 0; margin-right: 10px; flex-shrink: 0; }

.bfp-minimized-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  max-width: 180px;
  text-align: left;
}
.bfp-minimized-title {
  font-size: 11px; font-weight: 700; color: var(--bfp-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bfp-minimized-author { font-size: 9px; color: var(--bfp-muted); }

/* ── Progress ────────────────────────────────────────────────────────────── */
.bfp-progress-wrap {
  height: var(--bfp-prog-h);
  background: rgba(255,255,255,0.1);
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition: height 0.15s;
}
.bfp-progress-wrap:hover { height: 7px; }
.bfp-progress-fill {
  height: 100%;
  background: var(--bfp-accent);
  border-radius: 0 2px 2px 0;
  pointer-events: none;
  transition: width 0.3s linear;
}
.bfp-progress-thumb {
  position: absolute;
  top: 50%; transform: translate(-50%, -50%);
  width: 12px; height: 12px;
  background: var(--bfp-accent);
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
.bfp-progress-wrap:hover .bfp-progress-thumb { opacity: 1; }
.bfp-progress-tooltip {
  position: absolute;
  bottom: 12px;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.85);
  color: #fff;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  pointer-events: none;
  white-space: nowrap;
}

/* ── Bar inner ───────────────────────────────────────────────────────────── */
.bfp-bar-inner {
  display: flex;
  align-items: center;
  height: var(--bfp-h);
  padding: 0 10px;
  gap: 8px;
}

/* ── Cover ───────────────────────────────────────────────────────────────── */
.bfp-cover {
  width: 52px; height: 52px;
  flex-shrink: 0;
  border-radius: var(--bfp-radius);
  overflow: hidden;
  position: relative;
  cursor: pointer;
  background: rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: center;
}
.bfp-cover-img { width: 100%; height: 100%; object-fit: cover; }
.bfp-cover-placeholder { color: var(--bfp-muted); font-size: 20px; }
.bfp-media-badge {
  position: absolute;
  bottom: 2px; right: 2px;
  font-size: 8px; font-weight: 800; letter-spacing: 0.5px;
  padding: 1px 3px;
  border-radius: 2px;
  line-height: 1.2;
  opacity: 0.9;
}
.bfp-media-badge--youtube  { background: #ff0000; color: #fff; }
.bfp-media-badge--audio    { background: var(--bfp-accent); color: #fff; }
.bfp-media-badge--peertube { background: #f1680d; color: #fff; }

/* Equaliser animation on cover */
.bfp-cover-eq {
  position: absolute;
  inset: 0;
  display: flex; align-items: flex-end; justify-content: center;
  gap: 2px; padding-bottom: 6px;
  pointer-events: none;
}
.bfp-cover-eq span {
  width: 3px; background: var(--bfp-accent);
  border-radius: 2px;
  animation: bfp-eq 0.9s ease-in-out infinite alternate;
}
.bfp-cover-eq span:nth-child(1) { height: 8px; animation-delay: 0s;    }
.bfp-cover-eq span:nth-child(2) { height: 14px; animation-delay: 0.15s; }
.bfp-cover-eq span:nth-child(3) { height: 10px; animation-delay: 0.3s;  }
@keyframes bfp-eq { to { height: 4px; } }

.bfp-cover-spinner { position: absolute; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; color: #fff; }

.bfp-mirror-toggle {
  position: absolute; top: 2px; right: 2px;
  width: 18px; height: 18px; border-radius: 4px;
  background: var(--bfp-accent); color: #fff;
  border: none; cursor: pointer; font-size: 10px;
  display: flex; align-items: center; justify-content: center;
  z-index: 10; opacity: 0.8; transition: opacity 0.2s, transform 0.2s;
  box-shadow: 0 2px 5px rgba(0,0,0,0.3);
}
.bfp-mirror-toggle:hover, .bfp-mirror-toggle.active { opacity: 1; transform: scale(1.1); }

.bfp-mirror-overlay {
  position: absolute;
  bottom: 100%;
  left: 0;
  width: 220px;
  background: var(--bfp-bg);
  border: 1px solid var(--bfp-border);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  box-shadow: 0 -5px 15px rgba(0,0,0,0.3);
  z-index: 1000;
  display: flex;
  flex-direction: column;
}

.bfp-mirror-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--bfp-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255,255,255,0.03);
}

.bfp-mirror-header strong { font-size: 12px; opacity: 0.8; }
.bfp-mirror-header button { 
  background: none; border: none; color: var(--bfp-muted); 
  cursor: pointer; font-size: 14px; 
}

.bfp-mirror-body {
  max-height: 200px;
  overflow-y: auto;
}

.bfp-mirror-row {
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.bfp-mirror-row:hover { background: var(--bfp-hover); }
.bfp-mirror-row.active { background: color-mix(in srgb, var(--bfp-accent) 12%, transparent); color: var(--bfp-accent); font-weight: 600; }
.bfp-mirror-row i { width: 16px; text-align: center; }
.ms-auto { margin-left: auto; }

/* ── Track info ──────────────────────────────────────────────────────────── */
.bfp-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; justify-content: center; }
.bfp-info-top { display: flex; align-items: center; gap: 10px; }
.bfp-info-spacer { flex: 1; min-width: 10px; }

.bfp-track-title {
  font-size: 14px; font-weight: 700;
  color: var(--bfp-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bfp-post-stats { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.bfp-post-stats .badge { font-size: 10px; padding: 1px 5px; }
.bfp-post-stats .bfp-post-link { font-size: 13px; color: var(--bfp-muted); }
.bfp-post-stats .bfp-post-link:hover { color: var(--bfp-text); }

.bfp-track-meta {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--bfp-muted);
}
.bfp-author { color: var(--bfp-accent); text-decoration: none; font-weight: 600; }
.bfp-author:hover { text-decoration: underline; }
.bfp-meta-sep { opacity: 0.4; }
.bfp-time { font-variant-numeric: tabular-nums; font-size: 10px; }
.bfp-time-sep { margin: 0 2px; opacity: 0.4; }

/* ── Controls ────────────────────────────────────────────────────────────── */
.bfp-controls { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.bfp-btn {
  background: none; border: none; cursor: pointer;
  color: var(--bfp-muted);
  padding: 6px 8px;
  border-radius: var(--bfp-radius);
  display: flex; align-items: center; justify-content: center;
  transition: color 0.15s, background 0.15s;
  font-size: 16px; line-height: 1;
}
.bfp-btn:hover { color: var(--bfp-text); background: var(--bfp-hover); }
.bfp-btn--play {
  background: var(--bfp-accent);
  color: #fff;
  width: 38px; height: 38px;
  border-radius: 50%;
  font-size: 14px;
}
.bfp-btn--play:hover { opacity: 0.85; color: #fff; background: var(--bfp-accent); }

.bfp-ctrl-sep { width: 1px; height: 24px; background: var(--bfp-border); margin: 0 10px; }
/* ── Volume ──────────────────────────────────────────────────────────────── */
.bfp-vol { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.bfp-vol-icon { font-size: 14px; }
.bfp-vol-slider {
  -webkit-appearance: none; appearance: none;
  width: 72px; height: 3px;
  background: rgba(255,255,255,0.15);
  border-radius: 2px; cursor: pointer; outline: none;
}
.bfp-vol-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 12px; height: 12px;
  background: var(--bfp-accent); border-radius: 50%;
}
.bfp-vol-slider::-moz-range-thumb {
  width: 12px; height: 12px;
  background: var(--bfp-accent); border-radius: 50%; border: none;
}
/* D-pad focus on a plain range input looks identical to unfocused
   otherwise -- and "editing" (Enter pressed, Left/Right now adjusts the
   value instead of moving focus elsewhere, see dpad-nav.ts) needs its own
   distinct, unmissable state so it's obvious arrows won't move on. */
.bfp-vol-slider:focus-visible { box-shadow: 0 0 0 3px var(--bfp-accent); border-radius: 4px; }
.bfp-vol-slider.dpad-editing {
  background: rgba(255,255,255,0.3);
  box-shadow: 0 0 0 3px var(--bfp-accent), 0 0 14px 2px var(--bfp-accent);
}
.bfp-vol-slider.dpad-editing::-webkit-slider-thumb { width: 16px; height: 16px; }
.bfp-vol-slider.dpad-editing::-moz-range-thumb { width: 16px; height: 16px; }
.bfp-expand-btn { font-size: 13px; padding: 6px 7px; }
.bfp-expand-btn.active { color: var(--bfp-accent); }

/* ── Panel ───────────────────────────────────────────────────────────────── */
.bfp-panel {
  position: fixed;
  bottom: 0; /* Seal the gap by starting from the bottom */
  left: 0; right: 0;
  z-index: 999;
  background: var(--bfp-bg);
  border-top: 1px solid var(--bfp-border);
  display: flex; flex-direction: column;
  box-shadow: 0 -8px 40px rgba(0,0,0,0.5);
  transition: background 0.3s, transform 0.3s ease, opacity 0.3s ease;
  /* Use padding to account for the bar height, bar will sit on top (higher z-index) */
  padding-bottom: calc(var(--bfp-h) + var(--bfp-prog-h));
  box-sizing: border-box;
}
/* Ensure panel stays in DOM but hidden visually to keep iframes playing */
.bfp-panel--hidden {
  transform: translateY(100%) !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* Fullscreen presentation of the same panel/video (no remount). The docked
   .bfp-bar is never shown in cinema mode any more (see the `v-if` on
   .bfp-bar below) — playback controls live inside this panel itself
   (.bfp-cinema-controls) — so, unlike the collapsed/docked panel above,
   there's no bar to reserve bottom space for here. */
.bfp-panel--cinema {
  top: 0 !important;
  height: 100vh !important;
  padding-bottom: 0 !important;
  box-shadow: none;
}
.bfp-panel--cinema .bfp-panel-content { position: relative; }
.bfp-panel--cinema .bfp-panel-resize { display: none; }
.bfp-panel--cinema .bfp-panel-video { flex: 5; }
.bfp-panel--cinema .bfp-panel-tabs { display: none; }
.bfp-panel--cinema .bfp-panel-header { display: none; }
.bfp-panel--cinema.bfp-cinema-tab-open .bfp-panel-tabs {
  display: flex;
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: min(380px, calc(100% - 44px));
  z-index: 20;
  box-shadow: -10px 0 30px rgba(0,0,0,0.4);
}
.bfp-cinema-tab-close {
  position: absolute;
  top: 10px; right: 10px;
  z-index: 21;
  width: 32px; height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.35);
  /* Hardcoded white, not var(--bfp-text) -- same bug and same reasoning as
     .bfp-cinema-back-btn just above: a fixed dark translucent circle needs
     a fixed light text color regardless of theme. Unlike the back button,
     there's no guaranteed-white ancestor to inherit from here (this button
     floats independently over both the video and the tab panel), so this
     one states it directly rather than relying on inheritance. */
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}

.bfp-cinema-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-radius: 20px;
  border: none;
  background: rgba(255,255,255,0.12);
  backdrop-filter: blur(4px);
  /* No color here -- inherits #fff from .bfp-panel--cinema .bfp-video-header
     (see that rule) on purpose. This button used to hardcode
     `color: var(--bfp-text)`, which -- being a rule directly on the
     element -- won over that inherited white regardless of selector
     specificity, silently opting this one button out of a contrast fix
     already applied to the rest of the cinema header. For light themes
     (dark --bfp-text) that meant dark text on a barely-there translucent
     white pill sitting over actual video content: exactly the reported
     "can barely see the back button" bug. */
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  margin-right: 14px;
  flex-shrink: 0;
}
.bfp-cinema-back-btn:hover { background: rgba(255,255,255,0.22); }

.bfp-iframe-shield {
  position: absolute;
  inset: 0;
  z-index: 4;
  background: transparent;
  cursor: pointer;
}

.bfp-cinema-controls {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  z-index: 6;
  padding: 24px 24px 16px;
  background: linear-gradient(0deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 65%, transparent 100%);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.bfp-cinema-progress {
  position: relative;
  width: 100%;
  height: 5px;
  background: rgba(255,255,255,0.2);
  border-radius: 3px;
  cursor: pointer;
  margin-bottom: 14px;
}
.bfp-cinema-progress-fill { height: 100%; background: var(--bfp-accent); border-radius: 3px; }
.bfp-cinema-progress-thumb {
  position: absolute; top: 50%; width: 12px; height: 12px; border-radius: 50%;
  background: #fff; transform: translate(-50%, -50%);
  box-shadow: 0 0 8px rgba(0,0,0,0.5);
}
.bfp-cinema-controls-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.bfp-cinema-controls-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bfp-cinema-track-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.bfp-cinema-track-actions:empty { display: none; }
.bfp-cinema-extra-btn {
  position: relative;
  background: rgba(0,0,0,.55);
  border: 1px solid rgba(255,255,255,.15);
  border-radius: 6px;
  width: 30px;
  height: 30px;
  font-size: 13px;
}
.bfp-cinema-extra-btn:hover { background: rgba(0,0,0,.75); color: #fff; }
.bfp-cinema-extra-btn--active {
  background: rgba(35,130,90,.75);
  border-color: rgba(126,232,201,.5);
}
.bfp-cinema-extra-btn--active:hover { background: rgba(35,150,100,.85); }
.bfp-cinema-extra-badge {
  position: absolute;
  bottom: -6px;
  right: -6px;
  background: #1b8a5a;
  color: #fff;
  border-radius: 8px;
  font-size: 9px;
  line-height: 1;
  padding: 2px 4px;
}
/* Sits above the main progress bar -- e.g. WebTorrent's piece map (see
   WebtorrentVideo.vue), a full-width supplementary bar, not more buttons in
   a row, hence its own zone rather than joining .bfp-cinema-controls-left. */
.bfp-cinema-extra-progress:empty { display: none; }
.bfp-cinema-extra-progress { width: 100%; margin-bottom: 8px; }
.bfp-cinema-time { color: #ddd; font-size: 12px; margin-left: 6px; }
.bfp-cinema-controls .bfp-btn { color: #fff; }
.bfp-cinema-controls .bfp-vol-slider { width: 80px; }
/* D-pad/keyboard nav needs a focus indicator visible from across a room,
   not the browser's faint default outline against a dark video backdrop. */
.bfp-panel--cinema button:focus-visible,
.bfp-panel--cinema [role="button"]:focus-visible,
.bfp-panel--cinema select:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--bfp-accent, var(--brand)), 0 0 12px 2px var(--bfp-accent, var(--brand));
  border-radius: 6px;
}

.bfp-cinema-side-actions {
  position: absolute;
  left: 16px; top: 50%;
  transform: translateY(-50%);
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border-radius: 26px;
  background: rgba(0,0,0,0.35);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.bfp-cinema-overlay-btn {
  width: 42px; height: 42px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.12);
  color: #fff;
  font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.2s, color 0.2s;
  flex-shrink: 0;
}
.bfp-cinema-overlay-btn:hover, .bfp-cinema-overlay-btn:focus-visible { background: rgba(255,255,255,0.25); outline: none; }
.bfp-cinema-overlay-btn.active { background: var(--bfp-accent); color: #1a1206; }

/* Hide inactive media containers without display:none to keep them alive */
.bfp-media-hidden {
  position: absolute !important;
  visibility: hidden !important;
  pointer-events: none !important;
  z-index: -1 !important;
  width: 1px !important; height: 1px !important;
  overflow: hidden !important;
  border: none !important;
}

.bfp-panel-content {
  display: flex;
  flex: 1;
  min-height: 0;
}
.bfp-panel-video {
  flex: 3;
  background: var(--bfp-bg);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.bfp-panel-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--bfp-border);
  background: var(--bfp-bg);
  min-width: 320px;
}

.bfp-tabs-resize {
  width: 6px; flex-shrink: 0;
  cursor: ew-resize;
  background: transparent;
  position: relative;
}
.bfp-tabs-resize::after {
  content: '';
  position: absolute;
  left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 2px; height: 32px;
  background: var(--bfp-border);
  border-radius: 1px;
}
.bfp-tabs-resize:hover::after { background: var(--bfp-accent); }

@media (max-width: 900px) {
  .bfp-panel-content { flex-direction: column; }
  .bfp-panel-tabs { border-left: none; min-width: 0; }
  .bfp-panel-video { flex: 1; }
}

.bfp-panel-resize {
  height: 6px; width: 100%;
  cursor: ns-resize;
  background: transparent;
  flex-shrink: 0;
  position: relative;
}
.bfp-panel-resize::after {
  content: '';
  position: absolute;
  top: 2px; left: 50%; transform: translateX(-50%);
  width: 32px; height: 2px;
  background: rgba(255,255,255,0.12);
  border-radius: 1px;
}
.bfp-panel-resize:hover::after { background: var(--bfp-accent); }

/* ── Panel header / tabs ─────────────────────────────────────────────────── */
.bfp-panel-header {
  display: flex; align-items: center;
  border-bottom: 1px solid var(--bfp-border);
  flex-shrink: 0; padding: 0;
}
.bfp-settings-header {
  padding: 12px 15px; border-bottom: 1px solid var(--bfp-border);
  display: flex; align-items: center; justify-content: space-between;
}
.bfp-settings-body { padding: 15px; flex: 1; overflow-y: auto; }

.bfp-priority-list { display: flex; flex-direction: column; gap: 8px; }
.bfp-priority-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  background: var(--bfp-hover); border: 1px solid var(--bfp-border); border-radius: 6px;
  font-size: 13px;
}
.bfp-priority-actions { display: flex; gap: 4px; }
.bfp-priority-actions button {
  background: rgba(255,255,255,0.05); border: 1px solid var(--bfp-border);
  color: var(--bfp-text); border-radius: 4px; padding: 4px 8px; cursor: pointer;
  transition: all 0.2s;
}
.bfp-priority-actions button:hover:not(:disabled) { background: var(--bfp-accent); border-color: var(--bfp-accent); color: #fff; }
.bfp-priority-actions button:disabled { opacity: 0.2; cursor: default; }

/* ── Optimized Spinners ──────────────────────────────────────────────────── */
.fa-spin {
  animation: fa-spin 1s infinite linear;
}
@keyframes fa-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.bfp-cover-spinner { 
  position: absolute; inset: 0; 
  background: rgba(0,0,0,0.5); 
  display: flex; align-items: center; justify-content: center; 
  color: #fff; 
  z-index: 5;
}
.bfp-cover-spinner .fa-spinner {
  font-size: 24px;
}

.bfp-btn--play .fa-spinner {
  font-size: 16px;
}
.bfp-tab {
  background: none; border: none; cursor: pointer;
  color: var(--bfp-muted);
  font-size: 12px; font-weight: 600;
  padding: 10px 14px;
  display: flex; align-items: center; gap: 5px;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
  white-space: nowrap;
}
.bfp-tab:hover { color: var(--bfp-text); }
.bfp-tab.active { color: var(--bfp-accent); border-bottom-color: var(--bfp-accent); }
.bfp-tab-count {
  background: var(--bfp-accent);
  color: #fff; font-size: 9px; font-weight: 800;
  padding: 1px 5px; border-radius: 8px; line-height: 1.4;
}

/* ── Panel body ──────────────────────────────────────────────────────────── */
.bfp-panel-body {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.12) transparent;
}
.bfp-panel-body::-webkit-scrollbar { width: 4px; }
.bfp-panel-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }

/* ── Video panel ─────────────────────────────────────────────────────────── */
.bfp-video-wrap {
  flex: 1; width: 100%; display: flex; flex-direction: column;
  position: relative; background: #000; min-height: 0;
}

.bfp-video-iframe-wrap, .bfp-video-iframe { width: 100%; height: 100% !important; border: none; display: block; flex: 1; }
.bfp-video-audio-placeholder {
  height: 100%; width: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; padding: 20px; overflow: hidden;
}
.bfp-placeholder-cover { 
  max-width: 90%;
  max-height: 70%; 
  object-fit: contain;
  border-radius: 8px; 
  box-shadow: 0 4px 20px rgba(0,0,0,0.5); 
}
.bfp-placeholder-info { text-align: center; }
.bfp-placeholder-title { font-weight: 600; font-size: 16px; color: var(--bfp-text); margin-bottom: 4px; }
.bfp-placeholder-author { font-size: 13px; color: var(--bfp-muted); }
.bfp-placeholder-eq {
  display: flex; align-items: flex-end; gap: 3px; height: 30px;
}
.bfp-placeholder-eq span {
  width: 4px; background: var(--bfp-accent); border-radius: 2px;
  animation: bfp-eq 0.9s ease-in-out infinite alternate;
}
.bfp-placeholder-eq span:nth-child(1) { animation-delay: 0s;    }
.bfp-placeholder-eq span:nth-child(2) { animation-delay: 0.1s;  }
.bfp-placeholder-eq span:nth-child(3) { animation-delay: 0.2s;  }
.bfp-placeholder-eq span:nth-child(4) { animation-delay: 0.3s;  }
.bfp-placeholder-eq span:nth-child(5) { animation-delay: 0.4s;  }

/* ═══════════════════════════════════════════════════════════════════════
   QUEUE TIMELINE (pq-*)
   ═══════════════════════════════════════════════════════════════════════ */

.pq-section-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; font-weight: 800; letter-spacing: 0.8px;
  text-transform: uppercase; color: var(--bfp-muted);
  padding: 12px 12px 4px 14px;
}
.pq-section-clear {
  margin-left: auto; background: none; border: none; cursor: pointer;
  font-size: 10px; color: var(--bfp-muted); padding: 0 4px;
}
.pq-section-clear:hover { color: #e55353; }
.pq-label--now    { color: var(--bfp-accent); }
.pq-label--manual { color: #f5a623; }
.pq-label--auto   { color: var(--bfp-muted); }

/* Row */
.pq-item {
  display: flex; align-items: stretch;
  padding: 0 8px 0 4px;
  cursor: pointer;
  transition: background 0.12s;
  min-height: 56px;
}
.pq-item:hover { background: var(--bfp-hover); }
.pq-item--now   { cursor: default; }
.pq-item--next  { background: rgba(26,155,120,0.05); }
.pq-item--auto  { opacity: 0.7; }

/* Timeline column */
.pq-timeline-col {
  display: flex; flex-direction: column;
  align-items: center; width: 32px; flex-shrink: 0;
  padding: 6px 0;
}
.pq-dot {
  width: 22px; height: 22px; flex-shrink: 0;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 700;
  z-index: 1;
}
.pq-dot--now     { background: var(--bfp-accent); color: #fff; font-size: 10px; }
.pq-dot--manual  { background: #f5a623; color: #fff; }
.pq-dot--auto    { background: rgba(255,255,255,0.12); color: var(--bfp-muted); }
.pq-dot--history { background: rgba(255,255,255,0.06); color: var(--bfp-muted); font-size: 8px; }
.pq-line {
  flex: 1; width: 2px; margin-top: 3px;
  background: rgba(255,255,255,0.07);
  border-radius: 1px;
}
.pq-line--now { background: rgba(26,155,120,0.25); }

/* Card */
.pq-card {
  flex: 1; display: flex; align-items: center;
  gap: 8px; padding: 6px 4px;
  min-width: 0;
}
.pq-card--now { background: rgba(26,155,120,0.05); border-radius: 6px; }

/* Thumb */
.pq-thumb {
  width: 40px; height: 40px;
  border-radius: 4px; object-fit: cover; flex-shrink: 0;
}
.pq-thumb--now { width: 48px; height: 48px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
.pq-thumb--placeholder {
  background: rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: center;
  color: var(--bfp-muted); font-size: 14px;
}

/* Info */
.pq-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pq-title {
  font-size: 12px; font-weight: 600; color: var(--bfp-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pq-title--now { font-size: 13px; color: #fff; }
.pq-meta { font-size: 10px; color: var(--bfp-muted); display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.pq-now-badge {
  font-size: 9px; font-weight: 900; letter-spacing: 1px;
  color: var(--bfp-accent); text-transform: uppercase;
}
.pq-type-badge {
  font-size: 8px; font-weight: 800; padding: 0 4px;
  border-radius: 2px; letter-spacing: 0.5px; opacity: 0.9;
}
.pq-type-badge--youtube  { background: rgba(255,0,0,0.2); color: #ff4d4d; }
.pq-type-badge--audio    { background: rgba(26,155,120,0.2); color: var(--bfp-accent); }
.pq-type-badge--peertube { background: rgba(241,104,13,0.2); color: #f1680d; }

/* Equalizer in card */
.pq-equalizer {
  display: flex; align-items: flex-end; gap: 2px; height: 20px; flex-shrink: 0;
}
.pq-equalizer span {
  width: 3px; background: var(--bfp-accent); border-radius: 2px;
  animation: bfp-eq 0.9s ease-in-out infinite alternate;
}
.pq-equalizer span:nth-child(1) { animation-delay: 0s;   }
.pq-equalizer span:nth-child(2) { animation-delay: 0.15s;}
.pq-equalizer span:nth-child(3) { animation-delay: 0.3s; }
.pq-equalizer span:nth-child(4) { animation-delay: 0.45s;}

/* Actions */
.pq-actions {
  display: flex; align-items: center; gap: 2px;
  opacity: 0; transition: opacity 0.15s;
}
.pq-item:hover .pq-actions,
.pq-item--now .pq-actions { opacity: 1; }
.pq-action {
  background: none; border: none; cursor: pointer;
  color: var(--bfp-muted); font-size: 12px;
  padding: 5px 6px; border-radius: 4px;
  text-decoration: none; display: flex; align-items: center;
  transition: color 0.15s, background 0.15s;
}
.pq-action:hover { color: var(--bfp-text); background: var(--bfp-hover); }
.pq-action--remove:hover { color: #e55353; }
.pq-action--link  { font-size: 11px; }
.pq-action--playlist:hover { color: var(--bfp-accent); }

/* Empty state */
.pq-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 40px 20px;
  color: var(--bfp-muted); font-size: 13px;
}

/* ═══════════════════════════════════════════════════════════════════════
   PLAYLISTS (pl-*)
   ═══════════════════════════════════════════════════════════════════════ */

.pl-wrap { height: 100%; display: flex; flex-direction: column; }
.pl-header {
  display: flex; align-items: center; padding: 10px 14px;
  border-bottom: 1px solid var(--bfp-border); flex-shrink: 0;
}
.pl-header-title { font-size: 12px; font-weight: 700; color: var(--bfp-text); flex: 1; display: flex; align-items: center; gap: 6px; }
.pl-new-btn {
  background: var(--bfp-accent); color: #fff; border: none; cursor: pointer;
  font-size: 11px; font-weight: 700; padding: 5px 10px;
  border-radius: 4px; display: flex; align-items: center; gap: 4px;
  transition: opacity 0.15s;
}
.pl-new-btn:hover { opacity: 0.85; }

.pl-create-form {
  padding: 12px 14px;
  border-bottom: 1px solid var(--bfp-border);
  background: rgba(255,255,255,0.03);
}
.pl-create-input {
  flex: 1; background: rgba(255,255,255,0.06); border: 1px solid var(--bfp-border);
  color: var(--bfp-text); padding: 5px 8px; border-radius: 4px; font-size: 12px;
  outline: none;
}
.pl-create-input:focus { border-color: var(--bfp-accent); }
.pl-color-dots { display: flex; gap: 4px; flex-shrink: 0; }
.pl-color-dot {
  width: 16px; height: 16px; border-radius: 50%; cursor: pointer;
  border: 2px solid transparent; transition: border-color 0.15s, transform 0.15s;
}
.pl-color-dot.selected { border-color: #fff; transform: scale(1.2); }
.pl-color-dot:hover { transform: scale(1.15); }

.pl-list { flex: 1; overflow-y: auto; }
.pl-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  transition: background 0.12s;
}
.pl-row:hover { background: var(--bfp-hover); }
.pl-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.pl-row-name { flex: 1; font-size: 13px; font-weight: 600; color: var(--bfp-text); }
.pl-row-meta { font-size: 10px; color: var(--bfp-muted); white-space: nowrap; }
.pl-row-actions { display: flex; gap: 4px; opacity: 1; }
.pl-action-btn {
  background: none; border: none; cursor: pointer;
  color: var(--bfp-muted); font-size: 11px; padding: 4px 6px;
  border-radius: 3px; transition: color 0.15s, background 0.15s;
}
.pl-action-btn:hover { color: var(--bfp-text); background: var(--bfp-hover); }
.pl-action-btn.play:hover { color: var(--bfp-accent); }
.pl-action-btn.delete:hover { color: #e55353; }

/* Playlist detail */
.pl-inner-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-bottom: 1px solid var(--bfp-border); flex-shrink: 0;
}
.pl-back-btn {
  background: none; border: none; cursor: pointer;
  color: var(--bfp-muted); font-size: 15px; padding: 6px;
  border-radius: 4px; transition: color 0.15s;
}
.pl-back-btn:hover { color: var(--bfp-text); }
.pl-inner-name {
  flex: 1; font-size: 13px; font-weight: 700; color: var(--bfp-text);
  padding-left: 8px; cursor: pointer; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.pl-inner-name:hover { color: var(--bfp-accent); }
.pl-inner-name-input {
  flex: 1; background: rgba(255,255,255,0.06);
  border: 1px solid var(--bfp-accent); color: var(--bfp-text);
  padding: 4px 8px; border-radius: 4px; font-size: 13px; font-weight: 700; outline: none;
}
.pl-play-all {
  background: var(--bfp-accent); color: #fff; border: none; cursor: pointer;
  font-size: 11px; font-weight: 700; padding: 5px 10px; border-radius: 4px;
  display: flex; align-items: center; gap: 4px; white-space: nowrap;
  transition: opacity 0.15s;
}
.pl-play-all:hover { opacity: 0.85; }

.pl-track-list { flex: 1; overflow-y: auto; }
.pl-track-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  transition: background 0.12s;
  position: relative;
}
.pl-track-row:hover { background: var(--bfp-hover); }
.pl-track-num {
  font-size: 11px; color: var(--bfp-muted);
  width: 16px; text-align: right; flex-shrink: 0;
}
.pl-track-play {
  position: absolute; left: 10px;
  opacity: 0; transition: opacity 0.15s;
  color: var(--bfp-accent); font-size: 10px;
}
.pl-track-row:hover .pl-track-play { opacity: 1; }
.pl-track-row:hover .pl-track-num  { opacity: 0; }
.pl-track-thumb {
  width: 36px; height: 36px; border-radius: 4px;
  object-fit: cover; flex-shrink: 0;
}
.pl-track-thumb--placeholder {
  background: rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: center;
  color: var(--bfp-muted); font-size: 12px;
}
.pl-track-info { flex: 1; min-width: 0; }
.pl-track-title { font-size: 12px; font-weight: 600; color: var(--bfp-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-track-meta { font-size: 10px; color: var(--bfp-muted); display: flex; gap: 5px; align-items: center; }
.pl-track-actions { display: flex; gap: 2px; opacity: 1; }
.pl-add-current {
  width: calc(100% - 24px); margin: 10px 12px;
  background: rgba(26,155,120,0.1); border: 1px dashed var(--bfp-accent);
  color: var(--bfp-accent); padding: 8px; border-radius: 5px;
  font-size: 12px; cursor: pointer; transition: background 0.15s;
}
.pl-add-current:hover { background: rgba(26,155,120,0.2); }
.pl-add-current:disabled { opacity: 0.4; cursor: default; }

/* Expanded Video Info (Header inside panel) */
.bfp-video-header {
  padding: 8px 15px;
  background: var(--bfp-bg);
  border-bottom: 1px solid var(--bfp-border);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.bfp-panel--cinema .bfp-panel-video { position: relative; }
.bfp-panel--cinema .bfp-video-header,
.bfp-panel--cinema .bfp-video-header .gs { color: #fff; }
.bfp-panel--cinema .bfp-video-header {
  position: absolute;
  top: 0; left: 0; right: 0;
  z-index: 7;
  background: linear-gradient(180deg, rgba(0,0,0,0.75) 0%, transparent 100%);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: none;
  transition: opacity 0.25s ease;
}
.bfp-panel--cinema .bfp-cinema-side-actions,
.bfp-panel--cinema .bfp-cinema-controls {
  transition: opacity 0.25s ease;
}
.bfp-panel--cinema.bfp-cinema-controls-hidden .bfp-video-header,
.bfp-panel--cinema.bfp-cinema-controls-hidden .bfp-cinema-side-actions,
.bfp-panel--cinema.bfp-cinema-controls-hidden .bfp-cinema-controls {
  opacity: 0;
  pointer-events: none;
}
.bfp-video-header-info { min-width: 0; flex: 1; }
.bfp-video-header-title { font-weight: 700; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bfp-video-header-stats { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.bfp-video-header-stats .badge { font-size: 10px; padding: 2px 6px; }

/* Dropdown */
.pl-dropdown {
  position: fixed; z-index: 9999;
  background: var(--surface-nav, #1e1e2e);
  border: 1px solid var(--bfp-border);
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  min-width: 180px; max-width: 240px;
  transform: translateX(-100%) translateY(-50%);
}
.pl-dropdown-title {
  font-size: 10px; font-weight: 800; letter-spacing: 0.8px;
  text-transform: uppercase; color: var(--bfp-muted);
  padding: 8px 12px 4px;
}
.pl-dropdown-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; cursor: pointer; font-size: 12px;
  color: var(--bfp-text); transition: background 0.12s;
}
.pl-dropdown-item:hover { background: var(--bfp-hover); }
.pl-dropdown-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.pl-dropdown-sep { height: 1px; background: var(--bfp-border); margin: 3px 0; }
.pl-dropdown-new { color: var(--bfp-accent); font-weight: 600; }

/* ── Mobile tweaks ───────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .bfp-panel-content { flex-direction: column-reverse; height: 100%; min-height: 0; }
  .bfp-panel-tabs { border-left: none; min-width: 0; flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .bfp-panel-video { flex: 1; min-height: 0; z-index: 1; position: relative; }
  
  /* When video tab is active, the tabs container should shrink to header height */
  .bfp-panel-content--video .bfp-panel-tabs { flex: 0 0 auto; }
  /* When other tabs are active, video is already hidden via .bfp-media-hidden */
  
  .bfp-panel-header { z-index: 10; position: relative; background: var(--bfp-bg); }

  .bfp-post-stats .badge { display: none !important; }
  .bfp-info-spacer { display: none; }
}

@media (max-width: 480px) {
  .bfp-tab { min-width: 40px; }
  .bfp-tab i { margin-right: 0 !important; font-size: 14px; }
}

@media (max-width: 600px) {
  .bfp-bar { --bfp-h: 60px; }
  .bfp-vol, .bfp-ctrl-sep { display: none; }
  .bfp-info { flex: 1; margin-right: 5px; }
  .bfp-track-title { font-size: 12px; }
  .bfp-track-meta { font-size: 9px; gap: 4px; }
  .bfp-time { font-size: 9px; white-space: nowrap; }

  .bfp-controls { gap: 2px; }
  .bfp-btn { padding: 4px 6px; font-size: 14px; }
  .bfp-btn--play { width: 32px; height: 32px; font-size: 12px; }
  .bfp-expand-btn { padding: 4px 6px; font-size: 14px; }

  .bfp-cover { width: 44px; height: 44px; }

  /* Panel Header Mobile Fixes */
  .bfp-tab { padding: 0 6px !important; font-size: 10px !important; }
  .bfp-tab i { font-size: 12px; margin-right: 2px !important; }
  .bfp-tab-count { padding: 1px 3px; font-size: 8px; }
  .bfp-panel-close { padding: 4px 8px !important; }
}
/* ── Minimized Pill Fix ─────────────────────────────────────────────────── */
.bfp-bar--minimized .bfp-bar-inner { padding: 0 10px 0 0 !important; }
.bfp-bar--minimized .bfp-btn--play { padding: 0 10px 0 0 !important; }
.bfp-bar--minimized .bfp-btn { margin-right: 5px; }

/* Persistent actions in queue list */
.pq-actions { opacity: 1 !important; }
</style>
