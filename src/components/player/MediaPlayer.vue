<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import ScrollableTabs from '../layout/ScrollableTabs.vue';
import VoteButton from '../layout/VoteButton.vue';
import PlaylistModal from '../modals/PlaylistModal.vue';
import type { MediaTrack, BFPlayerAPI, Playlist, MediaEntryMirror } from '../../types';
import { currentSource } from '../../modules/player';

const props = defineProps<{
  player: BFPlayerAPI;
  t: (k: string) => string;
}>();

const vw = ref(typeof window !== 'undefined' ? window.innerWidth : 1200);
const handleResize = () => { vw.value = window.innerWidth; };

const emit = defineEmits<{
  openProfile: [username: string];
  openTopic: [post: { author: string; permlink: string }];
  submitVote: [post: any];
  openPayoutModal: [post: any];
}>();

// ── Playlists ───────────────────────────────────────────────────────────────
const playlistModal = reactive({
  show: false,
  track: null as MediaTrack | null
});

const handlePlaylistConfirm = (name: string, color: string, track: MediaTrack | null) => {
  const pl = props.player.createPlaylist(name, color);
  if (pl && track) props.player.addTrackToPlaylist(pl.id, track);
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
  const priorities = ['audio', 'peertube', 'youtube'];
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

const brokenImages = ref(new Set<string>());
function handleImgError(url: string) {
  if (url) brokenImages.value.add(url);
}

function getTrackCover(track: MediaTrack | null): string {
  if (!track) return '';
  const source = track.sources[track.activeSourceIndex || 0];
  const url = source?.thumb || track.cover || '';
  if (url && (url.length < 5 || brokenImages.value.has(url))) return '';
  return url;
}

const effectiveCover = computed(() => {
  return getTrackCover(props.player.state.currentTrack);
});

// ── Playlists ───────────────────────────────────────────────────────────────
const activePlaylistId = ref<string | null>(null);
const showCreateForm = ref(false);
const newPlaylistName = ref('');
const newPlaylistColor = ref('#1a9b78');
const editingPlaylistName = ref(false);
const editNameValue = ref('');
const plNameInput = ref<HTMLInputElement | null>(null);

const playlistColors = ['#1a9b78', '#f5a623', '#e55353', '#5b8dd9', '#9b59b6', '#f39c12', '#7a8290'];

function getActivePlaylist(): Playlist | null {
  return props.player.playlistState.playlists.find(p => p.id === activePlaylistId.value) || null;
}

function createAndClose(): void {
  const name = newPlaylistName.value.trim();
  if (!name) return;
  props.player.createPlaylist(name, newPlaylistColor.value);
  newPlaylistName.value = '';
  showCreateForm.value = false;
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
  props.player.playTrack(props.player.state.currentTrack);
  mirrorSwitcherVisible.value = false;
}

// ── Mirror Priorities ───────────────────────────────────────────────────────
const defaultPriorities = ['audio', 'peertube', 'youtube'];
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
  playlistModal.track = dropdownTrack.value;
  playlistModal.show = true;
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
</script>

<template>
<div
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
        <i v-else class="fa-solid fa-list" style="margin: 0 15px;"></i>
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

        <div class="bfp-cover-eq" v-if="player.state.playing && !player.state.loading">
          <span></span><span></span><span></span>
        </div>
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
          <template v-if="player.state.currentTrack?.permlink">
            <div class="bfp-post-stats">
              <span class="badge payout-link" 
                    :class="(player.state.currentTrack.payout || 0) > 0 ? 'badge-green' : 'badge-blue'"
                    @click.stop="emit('openPayoutModal', { author: player.state.currentTrack.author, permlink: player.state.currentTrack.permlink, payout: player.state.currentTrack.payout })">
                {{ (player.state.currentTrack.payout || 0).toFixed(2) }} B
              </span>
              <VoteButton 
                :voted="!!player.state.currentTrack.voted" 
                :count="player.state.currentTrack.voteCount || 0" 
                @vote="emit('submitVote', { author: player.state.currentTrack.author, permlink: player.state.currentTrack.permlink })" 
              />
              <a
                href="#"
                class="bfp-post-link" @click.stop.prevent="emit('openTopic', { author: player.state.currentTrack!.author!, permlink: player.state.currentTrack!.permlink! })" title="Open post"
              ><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
            </div>
          </template>
        </div>
        <div class="bfp-track-meta">
          <a class="bfp-author" href="#" @click.prevent="emit('openProfile', player.state.currentTrack!.author!)">
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
  :class="{ 'bfp-panel--hidden': !player.state.expanded || player.state.minimized }"
  :style="{ height: player.state.expandedHeight + 'px' }"
>

  <div class="bfp-panel-resize"
       @mousedown="player.initResize($event)"
       @touchstart.prevent="player.initResize($event)"
       title="Drag to resize"></div>

  <div class="bfp-panel-content" :class="'bfp-panel-content--' + player.state.expandedTab">
    
    <div class="bfp-panel-video" :class="{ 'bfp-media-hidden': vw <= 900 && player.state.expandedTab !== 'video' }">
      
      <div class="bfp-video-header">
        <div class="bfp-video-header-info">
          <div class="bfp-video-header-title">{{ player.state.currentTrack?.title }}</div>
          <div class="gs" style="font-size: 10px;">@{{ player.state.currentTrack?.author }}</div>
        </div>
        <div class="bfp-video-header-stats" v-if="player.state.currentTrack?.permlink">
          <span class="badge payout-link" 
                :class="(player.state.currentTrack.payout || 0) > 0 ? 'badge-green' : 'badge-blue'"
                @click.stop="emit('openPayoutModal', { author: player.state.currentTrack.author, permlink: player.state.currentTrack.permlink, payout: player.state.currentTrack.payout })">
            {{ (player.state.currentTrack.payout || 0).toFixed(2) }} B
          </span>
          <VoteButton 
            :voted="!!player.state.currentTrack.voted" 
            :count="player.state.currentTrack.voteCount || 0" 
            @vote="emit('submitVote', { author: player.state.currentTrack.author, permlink: player.state.currentTrack.permlink })" 
          />
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
            :src="currentSource?.type === 'peertube' ? `https://${currentSource.host}/videos/embed/${currentSource.id}?api=1${player.state.isAutoStarting ? '&autoplay=1' : ''}` : ''"
            frameborder="0" allowfullscreen 
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            allow="autoplay"
          ></iframe>
        </div>

        <div :class="{ 'bfp-media-hidden': currentSource?.type !== 'audio' }" class="bfp-video-audio-placeholder">
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

    <div class="bfp-panel-tabs">
      <div class="bfp-panel-header">
        <ScrollableTabs>
          <button v-if="vw <= 900" class="bfp-tab" :class="{ active: player.state.expandedTab === 'video' }" @click="player.state.expandedTab = 'video'">
            <i class="fa-solid fa-tv"></i> <span>{{ t('video') }}</span>
          </button>
          <button class="bfp-tab" :class="{ active: player.state.expandedTab === 'queue' }"
                  @click="player.state.expandedTab = 'queue'; player.scrollToCurrent()">
            <i class="fa-solid fa-list-ul"></i> <span>{{ t('queue') }}</span>
            <span class="bfp-tab-count" v-if="player.state.queue.length + displayedAutoQueue.length > 0">
              {{ player.state.queue.length + displayedAutoQueue.length }}
            </span>
          </button>
          <button class="bfp-tab" :class="{ active: player.state.expandedTab === 'playlists' }" @click="player.state.expandedTab = 'playlists'">
            <i class="fa-solid fa-list"></i> <span>{{ t('playlists') || 'Playlists' }}</span>
            <span class="bfp-tab-count" v-if="player.playlistState.playlists.length > 0">{{ player.playlistState.playlists.length }}</span>
          </button>
          <button class="bfp-tab" :class="{ active: player.state.expandedTab === 'settings' }" @click="player.state.expandedTab = 'settings'">
            <i class="fa-solid fa-gear"></i> <span>{{ t('settings') }}</span>
          </button>
        </ScrollableTabs>
        <button class="bfp-btn bfp-panel-close" @click="player.state.expanded = false" aria-label="Close panel">
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
          <a v-if="track.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('openTopic', { author: track.author!, permlink: track.permlink! })" title="Open post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
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
        <img v-if="player.state.currentTrack.cover" :src="player.state.currentTrack.cover" class="pq-thumb pq-thumb--now" alt="" />
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
          <a v-if="player.state.currentTrack.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('openTopic', { author: player.state.currentTrack.author!, permlink: player.state.currentTrack.permlink! })" title="Open post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
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
          <a v-if="track.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('openTopic', { author: track.author!, permlink: track.permlink! })" title="Open post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
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
          <a v-if="track.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('openTopic', { author: track.author!, permlink: track.permlink! })" title="Open post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
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
          <span class="pl-header-title"><i class="fa-solid fa-list"></i> {{ t('playlists') || 'Playlists' }}</span>
          <button class="pl-new-btn" @click="playlistModal.track = player.state.currentTrack || null; playlistModal.show = true;">
            <i class="fa-solid fa-plus"></i> {{ t('new') || 'New' }}
          </button>
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
            <i class="fa-solid fa-list" style="font-size:28px; opacity:0.2;"></i>
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
              <a v-if="track.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('openTopic', { author: track.author!, permlink: track.permlink! })" title="Open post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
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
    </div></div></div></div></div><div class="pl-dropdown" v-if="dropdownVisible"
     :style="{ top: dropdownY + 'px', left: dropdownX + 'px' }"
     @click.stop>
  <div class="pl-dropdown-title">Add to playlist</div>
  <div v-for="pl in player.playlistState.playlists" :key="'dd-'+pl.id"
       class="pl-dropdown-item" @click="addToPlaylistFromDropdown(pl.id)">
    <div class="pl-dropdown-dot" :style="{ background: pl.color }"></div>
    <span>{{ pl.name }}</span>
    <i class="fa-solid fa-check" style="margin-left:auto; color:var(--primary);"
       v-if="pl.tracks.some(t => t.author === dropdownTrack?.author && t.permlink === dropdownTrack?.permlink)"></i>
  </div>
  <div class="pl-dropdown-sep"></div>
  <div class="pl-dropdown-item pl-dropdown-new" @click="createAndAddFromDropdown()">
    <i class="fa-solid fa-plus"></i> <span>New playlist</span>
  </div>
</div>

<PlaylistModal
  :show="playlistModal.show"
  :track="playlistModal.track"
  :t="t"
  @close="playlistModal.show = false"
  @confirm="handlePlaylistConfirm"
/>
</template>

<style>
/* ═══════════════════════════════════════════════════════════════════════
   BFP PLAYER — bar + panel styles
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Variables (inherit from theme) ─────────────────────────────────────── */
.bfp-bar, .bfp-panel {
  --bfp-bg:      var(--nav-bg, #1a1a2e);
  --bfp-border:  var(--border-main, rgba(255,255,255,0.08));
  --bfp-text:    var(--text, #e0e0e0);
  --bfp-muted:   var(--text-muted, rgba(255,255,255,0.45));
  --bfp-accent:  var(--primary, #1a9b78);
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
  background: rgba(0,0,0,0.45);
  display: flex; align-items: flex-end; justify-content: center;
  gap: 2px; padding-bottom: 6px;
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
.bfp-mirror-row.active { background: rgba(var(--bfp-accent-rgb, 26, 155, 120), 0.1); color: var(--bfp-accent); font-weight: 600; }
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
.bfp-post-stats .payout-link { font-size: 10px; padding: 1px 5px; }
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
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px;
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
.bfp-video-header-info { min-width: 0; flex: 1; }
.bfp-video-header-title { font-weight: 700; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bfp-video-header-stats { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.bfp-video-header-stats .badge { font-size: 10px; padding: 2px 6px; }

/* Dropdown */
.pl-dropdown {
  position: fixed; z-index: 9999;
  background: var(--nav-bg, #1e1e2e);
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

  .bfp-post-stats .payout-link,
  .bfp-post-stats .vote-btn { display: none !important; }
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
