<script setup lang="ts">
import type { ActivityItem, AuthUser } from '../../types';
import ActivityFeed from './ActivityFeed.vue';

defineProps<{
  auth: { user: AuthUser | null };
  globalActivity: ActivityItem[];
  activityTab: string;
  activityExpanded: boolean;
  activityFullList: boolean;
  t: (k: string) => string;
  timeAgo: (s: string) => string;
}>();

const emit = defineEmits<{
  'update:activityTab': [value: string];
  'update:activityExpanded': [value: boolean];
  'update:activityFullList': [value: boolean];
  openActivity: [act: ActivityItem];
}>();
</script>

<template>
<!-- GLOBAL ACTIVITY FEED -->
<div v-if="auth.user && globalActivity.length > 0" class="global-activity-container">
  <div class="catHead activity-title">
    <i class="fa-solid fa-rss"></i> {{ t('globalActivity') }}
  </div>
  <ActivityFeed
    :global-activity="globalActivity"
    :activity-tab="activityTab"
    :activity-expanded="activityExpanded"
    :activity-full-list="activityFullList"
    :t="t"
    :time-ago="timeAgo"
    @update:activity-tab="emit('update:activityTab', $event)"
    @update:activity-expanded="emit('update:activityExpanded', $event)"
    @update:activity-full-list="emit('update:activityFullList', $event)"
    @open-activity="emit('openActivity', $event)"
  />
</div>
</template>

<style scoped>
.global-activity-container {
  margin: 0 15px 15px;
}

.activity-title {
  padding: 6px 12px;
  border-radius: 6px 6px 0 0;
  border: 1px solid var(--primary);
  border-bottom: none;
}
</style>
