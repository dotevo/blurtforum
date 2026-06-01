<script setup lang="ts">
import type { MediaTrack } from '../../types';

defineProps<{
  player: {
    state: {
      enabled: boolean; active: boolean; playing: boolean; loading: boolean;
      minimized: boolean; expanded: boolean; expandedHeight: number;
      expandedTab: 'video' | 'queue' | string; currentTrack: MediaTrack | null;
      queue: MediaTrack[]; autoQueue: MediaTrack[]; history: MediaTrack[];
      progress: number; duration: number; volume: number; experimental: boolean;
    };
    initResize: (e: MouseEvent | TouchEvent) => void;
    playTrack: (track: MediaTrack) => void;
    playNext: () => void;
    playPrev: () => void;
    togglePlay: () => void;
    scrollToCurrent: () => void;
  };
  vw: number;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  playerSeek: [event: MouseEvent];
  initResize: [event: MouseEvent | TouchEvent];
  playTrack: [track: MediaTrack];
  playNext: [];
  playPrev: [];
  togglePlay: [];
  removeFromQueue: [index: number];
  toggleExperimental: [val: boolean];
  openProfile: [username: string];
}>();
</script>

<template>
<!-- MEDIA PLAYER PiP -->
<div v-if="player.state.active" 
     class="media-player-pip" 
     :class="{ minimized: player.state.minimized, expanded: player.state.expanded }"
     :style="{ height: (player.state.expanded && !player.state.minimized) ? player.state.expandedHeight + 'px' : '' }">
  
  <!-- Resize Handle -->
  <div v-if="player.state.expanded && !player.state.minimized" 
       class="player-resizer" 
       @mousedown="player.initResize"
       @touchstart="player.initResize">
    <div class="resizer-bar"></div>
  </div>

  <!-- Restore Button (visible only when minimized) -->
  <button v-if="player.state.minimized" class="player-restore-btn" @click="player.state.minimized = false">
    <i class="fa-solid fa-play"></i> {{ player.state.currentTrack?.title }}
  </button>

  <div class="player-content">
    
    <!-- Mobile Tabs -->
    <div v-if="player.state.expanded" class="player-mobile-tabs show-mobile">
      <button class="player-tab-btn" :class="{ active: player.state.expandedTab === 'video' }" @click="player.state.expandedTab = 'video'">
        <i class="fa-solid fa-video"></i> {{ t('video') }}
      </button>
      <button class="player-tab-btn" :class="{ active: player.state.expandedTab === 'queue' }" @click="player.state.expandedTab = 'queue'; player.scrollToCurrent()">
        <i class="fa-solid fa-list-ul"></i> {{ t('queue') }}
      </button>    </div>

    <!-- Expanded View (Video & Queue) -->
    <div class="player-expanded-body" :class="{ 'player-hidden': !player.state.expanded }">
      <div class="player-expanded-main" :class="{ 'mobile-hide': vw <= 800 && player.state.expandedTab !== 'video' }">
        <!-- Video Container YouTube -->
        <div class="player-video-frame" :class="{ 'v-hide': player.state.currentTrack?.type !== 'youtube' }">
          <div id="bf-yt-player-target"></div>
        </div>
        <!-- Video Container PeerTube -->
        <div class="player-video-frame" :class="{ 'v-hide': player.state.currentTrack?.type !== 'peertube' }">
          <iframe id="bf-pt-player-iframe"
                  :key="player.state.currentTrack?.id"
                  :src="player.state.currentTrack?.type === 'peertube' ? 'https://' + player.state.currentTrack.host + '/videos/embed/' + player.state.currentTrack.id + '?api=1&autoplay=1' : ''" 
                  frameborder="0" allowfullscreen sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                  allow="autoplay"></iframe>
        </div>
        <!-- Audio Cover/Visualizer -->
        <div class="player-audio-visual" v-show="player.state.currentTrack?.type === 'audio'">
          <img v-if="player.state.currentTrack?.cover" 
               :src="player.state.currentTrack.cover" 
               class="player-cover-art"
               @error="($event.target as HTMLImageElement | null) && (($event.target as HTMLImageElement).style.display = 'none')">
          <i v-else class="fa-solid fa-music"></i>
          <div class="gs" style="margin-top:10px">{{ t('playing') || 'Playing' }}</div>
        </div>
      </div>
      
      <!-- Queue Sidebar -->
      <div class="player-queue-panel" :class="{ 'mobile-hide': vw <= 800 && player.state.expandedTab !== 'queue' }">
        <div class="queue-header hide-mobile">{{ t('queue') }} ({{ player.state.queue.length + player.state.autoQueue.length }})</div>
        <div class="queue-list">
          <!-- History -->
          <div v-if="player.state.history.length > 0" class="queue-section-header">{{ t('queueHistory') }}</div>
          <div v-for="(track, idx) in player.state.history" :key="'h-'+idx" class="queue-item history">
            <span class="queue-idx"><i class="fa-solid fa-clock-rotate-left"></i></span>
            <div class="queue-info" @click="player.playTrack(track)">
              <div class="queue-title">{{ track.title }}</div>
              <div class="queue-author">@{{ track.author }}</div>
            </div>
          </div>

          <!-- Manual Queue -->
          <div id="current-queue-anchor"></div>
          <div v-if="player.state.queue.length > 0" class="queue-section-header">{{ t('queueManual') }}</div>
          <div v-for="(track, idx) in player.state.queue" :key="'q-'+idx" class="queue-item manual">
            <span class="queue-idx">P</span>
            <div class="queue-info" @click="player.playTrack(track)">
              <div class="queue-title">{{ track.title }}</div>
              <div class="queue-author">@{{ track.author }}</div>
            </div>
          </div>

          <!-- Auto Queue -->
          <div v-if="player.state.autoQueue.length > 0" class="queue-section-header">{{ t('queueAutoplay') }}</div>
          <div v-for="(track, idx) in player.state.autoQueue" :key="'a-'+idx" 
               class="queue-item" :class="{ active: idx === 0 }">
            <span class="queue-idx">
              <i v-if="idx === 0" 
                 :class="player.state.playing ? 'fa-solid fa-volume-high' : 'fa-solid fa-play'"
                 style="color: var(--accent)"></i>
              <span v-else>{{ idx + 1 }}</span>
            </span>
            <div class="queue-info" @click="player.playTrack(track)">
              <div class="queue-title">{{ track.title }}</div>
              <div class="queue-author">@{{ track.author }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Progress Bar -->
    <div class="player-progress-container" @click="($event: MouseEvent) => emit('playerSeek', $event)">
      <div class="player-progress-fill" :style="{ width: player.state.progress + '%' }"></div>
    </div>

    <div class="player-main-row">
      <!-- Info -->
      <div class="player-info" @click="player.state.expanded = !player.state.expanded" style="cursor:pointer">
        <div class="player-title">{{ player.state.currentTrack?.title }}</div>
        <div class="player-author">@{{ player.state.currentTrack?.author }}</div>
      </div>

      <!-- Controls -->
      <div class="player-controls">
        <button class="player-btn" @click="player.playPrev()" title="Prev"><i class="fa-solid fa-backward-step"></i></button>
        <button class="player-btn btn-main" @click="player.togglePlay()">
          <span v-if="player.state.loading" class="spin" style="margin:0"></span>
          <i v-else :class="player.state.playing ? 'fa-solid fa-pause' : 'fa-solid fa-play'"></i>
        </button>
        <button class="player-btn" @click="player.playNext()" title="Next"><i class="fa-solid fa-forward-step"></i></button>
      </div>

      <!-- Extra -->
      <div class="player-extra hide-mobile">
        <div class="player-volume">
          <i class="fa-solid fa-volume-high"></i>
          <input type="range" min="0" max="1" step="0.05" v-model.number="player.state.volume">
        </div>
        <button class="player-btn" @click="player.state.expanded = !player.state.expanded" :title="player.state.expanded ? 'Shrink' : 'Expand'">
          <i :class="player.state.expanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
        </button>
        <button class="player-btn" @click="player.state.minimized = true">
          <i class="fa-solid fa-chevron-down"></i>
        </button>
      </div>
      
      <!-- Mobile toggle -->
      <div class="show-mobile" style="display:flex; gap:5px;">
        <button class="player-btn" @click="player.state.expanded = !player.state.expanded">
          <i :class="player.state.expanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
        </button>
        <button class="player-btn" @click="player.state.minimized = true">
          <i class="fa-solid fa-chevron-down"></i>
        </button>
      </div>
    </div>
  </div>
</div>
</template>
