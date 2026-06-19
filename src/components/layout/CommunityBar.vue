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
<div class="community-bar">
  <div class="cb-label hide-on-mobile">
    <span style="font-weight: bold; color: var(--primary);">{{ t('community') }}:</span>
  </div>

  <div class="cb-selectors">
    <div class="cb-main-row">
      <select :value="selectedCommunity" @change="emit('update:selectedCommunity', ($event.target as HTMLSelectElement).value); emit('handleCommunityChange')">
        <option v-for="c in allCommunities" :key="c.account" :value="c.account">{{ c.title }} ({{ c.account }})</option>
        <option value="custom">— {{ t('custom') }} —</option>
      </select>

      <a :href="'?community=' + communityAccount + '&view=communities'" class="btn btn-sm btn-ghost cb-search-btn" @click.prevent="emit('openCommunities')" :title="t('exploreCommunities')" style="display: inline-flex; align-items: center; justify-content: center; text-decoration: none;">
        <i class="fa-solid fa-magnifying-glass"></i>
      </a>
    </div>

    <div v-if="selectedCommunity==='custom'" class="cb-custom-tag">
      <input type="text" :value="customTag" @input="emit('update:customTag', ($event.target as HTMLInputElement).value)" :placeholder="t('enterTag')" @keyup.enter="emit('handleCommunityChange')">
      <button class="btn btn-sm btn-primary" @click="emit('handleCommunityChange')">OK</button>
    </div>
  </div>

  <span class="gs cb-active-label hide-on-mobile" style="margin-left:auto; font-weight: bold;">
    {{ t('currentCommunity') }}: {{ communityAccount }}
  </span>
</div>
</template>

<style scoped>
.community-bar {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 10px 15px;
  background: var(--bg-r3);
  margin: 15px;
  border: 1px solid var(--primary);
  border-radius: 6px;
}

.cb-selectors {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.cb-main-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.cb-main-row select {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text);
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 4px;
  outline: none;
}

.cb-search-btn {
  flex-shrink: 0;
}

.cb-custom-tag {
  display: flex;
  gap: 6px;
}

.cb-custom-tag input {
  flex: 1;
  background: var(--bg-white);
  border: 1px solid var(--input-border);
  color: var(--text);
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 4px;
}

.hide-on-mobile {
  display: none;
}

@media (min-width: 901px) {
  .hide-on-mobile {
    display: inline;
  }
  .cb-selectors {
    flex-direction: row;
    align-items: center;
    flex: 0 1 auto;
  }
}

@media (max-width: 900px) {
  .community-bar {
    margin: 10px;
    padding: 8px 10px;
  }
}
</style>

