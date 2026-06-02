<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { MediaTrack } from '../../types';

const props = defineProps<{
  show: boolean;
  track: MediaTrack | null;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [name: string, color: string, track: MediaTrack | null];
}>();

const name = ref('');
const color = ref('#1a9b78');
const colors = ['#1a9b78', '#f5a623', '#e55353', '#5b8dd9', '#9b59b6', '#f39c12', '#7a8290'];
const inputRef = ref<HTMLInputElement | null>(null);

function handleConfirm() {
  if (name.value.trim()) {
    emit('confirm', name.value.trim(), color.value, props.track);
    name.value = '';
    emit('close');
  }
}

onMounted(() => {
  inputRef.value?.focus();
});
</script>

<template>
<div v-if="show" class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box" style="width: 360px;">
    <div class="modal-header">
      <span style="display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-list-plus"></i> {{ t('createPlaylist') || 'Create Playlist' }}
      </span>
      <button class="modal-close" @click="emit('close')">×</button>
    </div>
    <div class="modal-body">
      <div v-if="track" style="font-size:11px; color:var(--text-muted); margin-bottom:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        🎵 {{ t('adding') || 'Adding' }}: {{ track.title }}
      </div>

      <div style="margin-bottom:16px;">
        <label class="form-label">{{ t('playlistName') || 'Playlist Name' }}</label>
        <input ref="inputRef" type="text" v-model="name" class="pl-create-input" 
               style="width:100%; height:38px; margin-bottom:12px;"
               :placeholder="t('enterName') || 'Enter name...'"
               @keyup.enter="handleConfirm" />
        
        <label class="form-label">{{ t('color') || 'Color' }}</label>
        <div class="pl-color-dots" style="margin-top:8px;">
          <div v-for="c in colors" :key="c" class="pl-color-dot"
               :class="{ selected: color === c }" :style="{ background: c }"
               @click="color = c"></div>
        </div>
      </div>

      <div style="display:flex; gap:10px; margin-top:20px;">
        <button class="btn btn-primary" style="flex:1; padding:8px;" @click="handleConfirm" :disabled="!name.trim()">
          <i class="fa-solid fa-check"></i> {{ t('confirm') || 'Confirm' }}
        </button>
        <button class="btn btn-ghost" @click="emit('close')">{{ t('cancel') }}</button>
      </div>
    </div>
  </div>
</div>
</template>
