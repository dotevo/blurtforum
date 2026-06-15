<script setup lang="ts">
import { computed } from 'vue';
import { state, playTrack, togglePlay, addToQueue } from '../../modules/player';
import type { Post } from '../../types';
import ForumMedia from './ForumMedia.ce.vue';

const props = defineProps<{
  post: Post;
  t: (k: string) => string;
}>();

const isActive = computed(() => {
  const current = state.currentTrack;
  if (!current) return false;
  return (current.author === props.post.author && current.permlink === props.post.permlink);
});

const currentInPost = computed(() => {
  const current = state.currentTrack;
  if (current && current.author === props.post.author && current.permlink === props.post.permlink) {
    return current;
  }
  return props.post.media || props.post.tracks?.[0] || null;
});

const isPlaying = computed(() => isActive.value && state.playing);

const handlePlay = async () => {
  if (isPlaying.value) {
    togglePlay();
  } else {
    // Micro mode logic: pick best source
    if (currentInPost.value) await playTrack(currentInPost.value, false);
  }
};

const handleSwitch = async () => {
  const current = state.currentTrack;
  
  if (!isActive.value || !current || current.sources.length <= 1) {
    await handlePlay();
    return;
  }

  // Cycle through sources of the active track
  const currentIdx = current.activeSourceIndex || 0;
  const nextIdx = (currentIdx + 1) % current.sources.length;
  
  console.log(`[BFPlayer] Switching source for ${props.post.author}/${props.post.permlink} from ${currentIdx} to ${nextIdx}`);
  
  // We call playTrack with isManual = true to force the player to use our specific choice
  await playTrack(current, true, nextIdx);
};

const handleQueue = () => {
  if (currentInPost.value) addToQueue(currentInPost.value);
};

const hasMirrors = computed(() => (currentInPost.value?.sources?.length || 0) > 1);

</script>

<template>
  <div v-if="post.tracks && post.tracks.length" class="forum-media-container mode-micro">
    <!-- Hidden tracks for registration -->
    <template v-if="post.tracks && post.tracks.length">
      <ForumMedia 
        v-for="m in post.tracks" 
        :key="`${post.author}/${post.permlink}/${m.sources[0]?.id || m.subId}`"
        :media="m"
        mode="unvisible"
      />
    </template>

    <div class="forum-media-micro">
      <!-- PLAY / PAUSE -->
      <span class="media-icon" @click.stop="handlePlay" :title="post.title" :class="{ 'is-active': isActive, 'is-playing': isPlaying }">
        <i :class="isPlaying ? 'fa-solid fa-pause' : (currentInPost?.sources[0]?.type === 'audio' ? 'fa-solid fa-music' : 'fa-solid fa-circle-play')"></i>
      </span>

      <!-- SWITCH (only if mirrors exist) -->
      <span v-if="hasMirrors" class="media-icon" @click.stop="handleSwitch" title="Switch source/mirror">
        <i class="fa-solid fa-shuffle"></i>
      </span>

      <!-- QUEUE -->
      <span class="media-icon" @click.stop="handleQueue" title="Add to queue">
        <i class="fa-solid fa-plus"></i>
      </span>
    </div>
  </div>
</template>

<style scoped>
.forum-media-container.mode-micro {
  display: inline-block;
  vertical-align: middle;
  width: auto;
}
.forum-media-micro {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 8px;
}
.media-icon {
  cursor: pointer;
  color: var(--primary, #006699);
  opacity: 0.7;
  transition: all 0.2s;
  font-size: 14px;
}
.media-icon:hover { opacity: 1; transform: scale(1.1); }
.media-icon.is-active { color: var(--accent); opacity: 1; }
</style>
