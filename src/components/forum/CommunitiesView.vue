<script setup lang="ts">
import type { Community, UserSubscription } from '../../types';

defineProps<{
  communityList: Community[];
  communityLoading: boolean;
  communityQuery: string;
  communityHasMore: boolean;
  userSubscriptions: UserSubscription[];
  t: (k: string) => string;
  fmtDate: (s: string) => string;
}>();

const emit = defineEmits<{
  fetchMore: [];
  toggleSub: [name: string];
  switchCommunity: [name: string];
  'update:communityQuery': [value: string];
}>();
</script>

<template>
    
      <div class="forumline" style="margin-bottom: 20px; padding: 15px;">
        <div style="display: flex; gap: 10px; align-items: center;">
          <input type="text" :value="communityQuery" @input="emit('update:communityQuery', ($event.target as HTMLInputElement).value)" :placeholder="t('searchCommunities')" 
                 @keyup.enter="emit('fetchMore')" style="flex: 1; padding: 8px;">
          <button class="btn" @click="emit('fetchMore')">
            <i class="fa-solid fa-magnifying-glass"></i>
          </button>
        </div>
      </div>

      <div class="community-grid">
        <div v-for="c in communityList" :key="c.name" class="forumline community-card">
          <div class="community-card-header">
            <div class="avatar-sm" :style="{backgroundImage: 'url(' + (c.avatar_url || 'https://imgp.blurt.blog/profileimage/' + c.name + '/64x64') + ')'}"></div>
            <div class="community-card-info">
              <div class="community-card-title" @click="emit('switchCommunity', c.name)">{{ c.title }}</div>
              <div class="community-card-name">@{{ c.name }}</div>
            </div>
          </div>
          <div class="community-card-about">{{ c.about }}</div>
          <div class="community-card-meta">
            <span :title="t('subscribers')"><i class="fa-solid fa-users"></i> {{ c.subscribers }}</span>
            <span :title="t('activeAuthors')"><i class="fa-solid fa-pen-nib"></i> {{ c.num_authors }}</span>
            <span v-if="(c.sum_pending ?? 0) > 0" :title="t('pendingRewards')"><i class="fa-solid fa-coins"></i> {{ ((c.sum_pending as number) / 1000).toFixed(0) }} $</span>
            <span v-if="c.lang" :title="t('language')"><i class="fa-solid fa-language"></i> {{ c.lang.toUpperCase() }}</span>
          </div>
          <div class="gs" style="font-size: 10px; margin-top: 4px;">{{ t('created') }}: {{ fmtDate(c.created_at || '') }}</div>
          <div class="community-card-actions">
            <button class="btn btn-sm" :class="userSubscriptions.some(s => s.account === c.name) ? 'btn-ghost' : 'btn-main'"
                    @click="emit('toggleSub', c.name)">
              <i class="fa-solid" :class="userSubscriptions.some(s => s.account === c.name) ? 'fa-minus' : 'fa-plus'"></i>
              {{ userSubscriptions.some(s => s.account === c.name) ? t('unsubscribe') : t('subscribe') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="communityLoading" style="text-align: center; padding: 20px;">
        <div class="spin" style="width: 32px; height: 32px; margin: 0 auto;"></div>
      </div>
      <div v-else-if="communityHasMore" style="text-align: center; padding: 20px;">
        <button class="btn" @click="emit('fetchMore')">{{ t('showMore') }}</button>
      </div>
    
 
</template>
