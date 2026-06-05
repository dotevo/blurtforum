<script setup lang="ts">
import type { UserSubscription } from '../../types';

defineProps<{
  selectedCommunity: string;
  allCommunities: UserSubscription[];
  customTag: string;
  communityAccount: string;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  'update:selectedCommunity': [value: string];
  'update:customTag': [value: string];
  handleCommunityChange: [];
  openCommunities: [];
}>();
</script>

<template>
<!-- COMMUNITY SELECTOR -->
<div class="community-bar forumline">
  <span style="font-weight: bold; color: var(--primary);">{{ t('community') }}:</span>
  <select :value="selectedCommunity" @change="emit('update:selectedCommunity', ($event.target as HTMLSelectElement).value); emit('handleCommunityChange')">
    <option v-for="c in allCommunities" :key="c.account" :value="c.account">{{ c.title }} ({{ c.account }})</option>
    <option value="custom">— {{ t('custom') }} —</option>
  </select>
  <template v-if="selectedCommunity==='custom'">
    <input type="text" :value="customTag" @input="emit('update:customTag', ($event.target as HTMLInputElement).value)" :placeholder="t('enterTag')" @keyup.enter="emit('handleCommunityChange')" style="width:150px;">
    <button class="btn btn-sm" @click="emit('handleCommunityChange')">OK</button>
  </template>
  <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
    <button class="btn btn-sm btn-ghost" @click="emit('openCommunities')">
      <i class="fa-solid fa-magnifying-glass"></i> {{ t('exploreCommunities') }}
    </button>
  </div>
  <span class="gs" style="margin-left:auto; font-weight: bold;">{{ t('currentCommunity') }}: {{ communityAccount }}</span>
</div>
</template>

