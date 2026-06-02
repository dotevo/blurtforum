<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { MediaTrack } from '../../types';
import type { BFPlayerAPI, Playlist } from '../../modules/player';

const props = defineProps<{
  player: BFPlayerAPI;
  vw: number;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  playerSeek: [pct: number];
  openProfile: [username: string];
  openTopic: [post: { author: string; permlink: string }];
  openPlaylistModal: [track: MediaTrack | null];
  submitVote: [post: any];
  openPayoutModal: [post: any];
}>();

// ── Hover progress ──────────────────────────────────────────────────────────
const hoverProgressPct = ref<number | null>(null);
const hoverProgressTime = ref<number | null>(null);

function handleProgressClick(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  const pct = (e.offsetX / el.offsetWidth) * 100;
  emit('playerSeek', pct);
}
function handleProgressHover(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  hoverProgressPct.value = (e.offsetX / el.offsetWidth) * 100;
  hoverProgressTime.value = (hoverProgressPct.value / 100) * props.player.state.duration;
}

const displayedAutoQueue = computed(() => {
  return props.player.state.autoQueue.filter(t => t.id !== props.player.state.currentTrack?.id);
});

// ── Time formatting ─────────────────────────────────────────────────────────
function formatTime(seconds: number | null | undefined): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
  return pl.tracks.some(t => t.id === track.id);
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
  emit('openPlaylistModal', dropdownTrack.value);
  closePlaylistDropdown();
}

function handleDocumentClick(): void { closePlaylistDropdown(); }

function confirmDeletePlaylist(id: string, name: string): void {
  if (window.confirm(`Delete playlist "${name}"?`)) props.player.deletePlaylist(id);
}
onMounted(() => document.addEventListener('click', handleDocumentClick));
onUnmounted(() => document.removeEventListener('click', handleDocumentClick));
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
          <img v-if="player.state.currentTrack?.cover" :src="player.state.currentTrack.cover" class="bfp-cover-img" alt="" />
          <div v-else class="bfp-cover-placeholder"><i class="fa-solid fa-music"></i></div>
        </div>
        <div class="bfp-minimized-info">
          <div class="bfp-minimized-title">{{ player.state.currentTrack?.title || 'Brak utworu' }}</div>
          <div class="bfp-minimized-author">{{ player.state.currentTrack ? '@' + player.state.currentTrack.author : 'Otwórz playlisty' }}</div>
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
        <img v-if="player.state.currentTrack?.cover" :src="player.state.currentTrack.cover" class="bfp-cover-img" alt="Cover" />
        <div v-else class="bfp-cover-placeholder">
          <i v-if="player.state.currentTrack?.type === 'youtube'" class="fa-brands fa-youtube"></i>
          <i v-else-if="player.state.currentTrack?.type === 'peertube'" class="fa-solid fa-video"></i>
          <i v-else class="fa-solid fa-music"></i>
        </div>
        <span class="bfp-media-badge" :class="`bfp-media-badge--${player.state.currentTrack?.type}`">
          {{ typeLabel[player.state.currentTrack?.type ?? ''] }}
        </span>
        <div class="bfp-cover-eq" v-if="player.state.playing && !player.state.loading">
          <span></span><span></span><span></span>
        </div>
        <div class="bfp-cover-spinner" v-if="player.state.loading">
          <i class="fa-solid fa-spinner fa-spin"></i>
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
              <span class="vote-btn" 
                    :class="{ active: player.state.currentTrack.voted }" 
                    @click.stop="emit('submitVote', { author: player.state.currentTrack.author, permlink: player.state.currentTrack.permlink })"
                    style="font-size: 14px;">
                <i class="fa-solid fa-caret-up"></i>
                <span style="font-size: 10px; font-weight: bold; margin-left: 2px;">{{ player.state.currentTrack.voteCount || 0 }}</span>
              </span>
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

      <div class="bfp-controls">
        <button class="bfp-btn" @click="player.playPrev()" title="Previous"><i class="fa-solid fa-backward-step"></i></button>
        <button class="bfp-btn bfp-btn--play" @click="player.togglePlay()" :title="player.state.playing ? 'Pause' : 'Play'">
          <i class="fa-solid fa-spinner fa-spin" v-if="player.state.loading"></i>
          <i class="fa-solid fa-pause" v-else-if="player.state.playing"></i>
          <i class="fa-solid fa-play"  v-else></i>
        </button>
        <button class="bfp-btn" @click="player.playNext()" :title="(player.state.queue.length === 0 && displayedAutoQueue.length === 0) ? 'Zatrzymaj' : 'Next'">
          <i class="fa-solid" :class="(player.state.queue.length === 0 && displayedAutoQueue.length === 0) ? 'fa-xmark' : 'fa-forward-step'"></i>
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

  <div class="bfp-panel-content">
    
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
          <span class="vote-btn" 
                :class="{ active: player.state.currentTrack.voted }" 
                @click.stop="emit('submitVote', { author: player.state.currentTrack.author, permlink: player.state.currentTrack.permlink })">
            <i class="fa-solid fa-caret-up"></i>
            <span style="font-size: 10px; font-weight: bold; margin-left: 2px;">{{ player.state.currentTrack.voteCount || 0 }}</span>
          </span>
        </div>
      </div>

      <div class="bfp-video-wrap">
        <div :class="{ 'bfp-media-hidden': player.state.currentTrack?.type !== 'youtube' }" class="bfp-video-iframe-wrap">
          <div id="bf-yt-player-target" style="width:100%; height:100%;"></div>
        </div>
        
        <div :class="{ 'bfp-media-hidden': player.state.currentTrack?.type !== 'peertube' }" class="bfp-video-iframe-wrap">
          <iframe
            id="bf-pt-player-iframe"
            class="bfp-video-iframe"
            :key="player.state.currentTrack?.id"
            :src="player.state.currentTrack?.type === 'peertube' ? `https://${player.state.currentTrack.host}/videos/embed/${player.state.currentTrack.id}?api=1${player.state.isAutoStarting ? '&autoplay=1' : ''}` : ''"
            frameborder="0" allowfullscreen 
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            allow="autoplay"
          ></iframe>
        </div>

        <div :class="{ 'bfp-media-hidden': player.state.currentTrack?.type !== 'audio' }" class="bfp-video-audio-placeholder">
          <img v-if="player.state.currentTrack?.cover" :src="player.state.currentTrack.cover" class="bfp-placeholder-cover" alt="Cover" />
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
        <button v-if="vw <= 900" class="bfp-tab" :class="{ active: player.state.expandedTab === 'video' }" @click="player.state.expandedTab = 'video'">
          <i class="fa-solid fa-tv"></i> {{ t('video') }}
        </button>
        <button class="bfp-tab" :class="{ active: player.state.expandedTab === 'queue' }"
                @click="player.state.expandedTab = 'queue'; player.scrollToCurrent()">
          <i class="fa-solid fa-list-ul"></i> {{ t('queue') }}
          <span class="bfp-tab-count" v-if="player.state.queue.length + displayedAutoQueue.length > 0">
            {{ player.state.queue.length + displayedAutoQueue.length }}
          </span>
        </button>
        <button class="bfp-tab" :class="{ active: player.state.expandedTab === 'playlists' }" @click="player.state.expandedTab = 'playlists'">
          <i class="fa-solid fa-list"></i> {{ t('playlists') || 'Playlists' }}
          <span class="bfp-tab-count" v-if="player.playlistState.playlists.length > 0">{{ player.playlistState.playlists.length }}</span>
        </button>
        <div class="bfp-panel-header-spacer"></div>
        <button class="bfp-btn bfp-panel-close" @click="player.state.expanded = false" aria-label="Close panel">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="bfp-panel-body queue-list" v-show="player.state.expandedTab === 'queue'">

    <div class="pq-section-label pq-label--history" v-if="player.state.history.length > 0">
      <i class="fa-solid fa-clock-rotate-left"></i> {{ t('history') }}
    </div>
    <div v-for="(track, idx) in player.state.history" :key="'h-'+track.id+idx"
         class="pq-item pq-item--history" @click="player.playTrack(track, false, -1, true)" :title="'Replay: ' + track.title">
      <div class="pq-timeline-col">
        <div class="pq-dot pq-dot--history"><i class="fa-solid fa-check"></i></div>
        <div class="pq-line"></div>
      </div>
      <div class="pq-card">
        <img v-if="track.cover" :src="track.cover" class="pq-thumb" alt="" />
        <div v-else class="pq-thumb pq-thumb--placeholder"><i class="fa-solid fa-music"></i></div>
        <div class="pq-info">
          <div class="pq-title">{{ track.title }}</div>
          <div class="pq-meta">
            <span>@{{ track.author }}</span>
            <span class="pq-type-badge" :class="`pq-type-badge--${track.type}`">{{ typeLabel[track.type] }}</span>
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
            <span class="pq-type-badge" :class="`pq-type-badge--${player.state.currentTrack.type}`">{{ typeLabel[player.state.currentTrack.type] }}</span>
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
    <div v-for="(track, idx) in player.state.queue" :key="'q-'+track.id+idx"
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
            <span class="pq-type-badge" :class="`pq-type-badge--${track.type}`">{{ typeLabel[track.type] }}</span>
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
    <div v-for="(track, idx) in displayedAutoQueue" :key="'a-'+track.id+idx"
         class="pq-item pq-item--auto" @click="player.playTrack(track)">
      <div class="pq-timeline-col">
        <div class="pq-dot pq-dot--auto"><span>{{ idx + 1 }}</span></div>
        <div class="pq-line" v-if="idx < displayedAutoQueue.length - 1"></div>
      </div>
      <div class="pq-card">
        <img v-if="track.cover" :src="track.cover" class="pq-thumb" alt="" />
        <div v-else class="pq-thumb pq-thumb--placeholder"><i class="fa-solid fa-music"></i></div>
        <div class="pq-info">
          <div class="pq-title">{{ track.title }}</div>
          <div class="pq-meta">
            <span>@{{ track.author }}</span>
            <span class="pq-type-badge" :class="`pq-type-badge--${track.type}`">{{ typeLabel[track.type] }}</span>
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
          <button class="pl-new-btn" @click="emit('openPlaylistModal', player.state.currentTrack || null)">
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
          <div v-for="(track, idx) in getActivePlaylist()?.tracks || []" :key="'plt-'+track.id"
               class="pl-track-row" @click="player.playPlaylist(activePlaylistId!, idx)">
            <div class="pl-track-num">{{ idx + 1 }}</div>
            <div class="pl-track-play"><i class="fa-solid fa-play" style="font-size:10px"></i></div>
            <img v-if="track.cover" :src="track.cover" class="pl-track-thumb" alt="" />
            <div v-else class="pl-track-thumb pl-track-thumb--placeholder"><i class="fa-solid fa-music"></i></div>
            <div class="pl-track-info">
              <div class="pl-track-title">{{ track.title }}</div>
              <div class="pl-track-meta">
                @{{ track.author }} · {{ formatRelativeTime(track.addedAt) }} ·
                <span class="pq-type-badge" :class="`pq-type-badge--${track.type}`">{{ typeLabel[track.type] }}</span>
              </div>
            </div>
            <div class="pl-track-actions">
              <a v-if="track.permlink" href="#" class="pq-action pq-action--link" @click.stop.prevent="emit('openTopic', { author: track.author!, permlink: track.permlink! })" title="Open post"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
              <button class="pl-action-btn delete" @click.stop="player.removeTrackFromPlaylist(activePlaylistId!, track.id)"><i class="fa-solid fa-xmark"></i></button>
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
       v-if="pl.tracks.some(t => t.id === dropdownTrack?.id)"></i>
  </div>
  <div class="pl-dropdown-sep"></div>
  <div class="pl-dropdown-item pl-dropdown-new" @click="createAndAddFromDropdown()">
    <i class="fa-solid fa-plus"></i> <span>New playlist</span>
  </div>
</div>
</template>