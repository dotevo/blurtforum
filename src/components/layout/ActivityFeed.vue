<script setup lang="ts">
import type { ActivityItem } from '../../types';
import ActivityItemWidget from './ActivityItemWidget.vue';
import { computed } from 'vue';

const props = defineProps<{
  globalActivity: ActivityItem[];
  activityTab: string;
  activityExpanded?: boolean;
  activityFullList?: boolean;
  t: (k: string) => string;
  timeAgo: (s: string) => string;
  mobile?: boolean;
}>();

const emit = defineEmits<{
  'update:activityTab': [value: string];
  'update:activityExpanded': [value: boolean];
  'update:activityFullList': [value: boolean];
  openActivity: [act: ActivityItem];
}>();

const filteredActivity = computed(() => {
  return props.globalActivity.filter(a => props.activityTab === 'posts' ? a.is_post : !a.is_post);
});

const unreadComments = computed(() => props.globalActivity.filter(a => !a.is_post && !a.isRead).length);
const unreadPosts = computed(() => props.globalActivity.filter(a => a.is_post && !a.isRead).length);

const displayList = computed(() => {
  if (props.mobile) return filteredActivity.value.slice(0, 15);
  return filteredActivity.value.slice(0, props.activityFullList ? 20 : 3);
});
</script>

<template>
  <div class="activity-feed" :class="{ 'is-mobile': mobile }">
    <!-- Tabs -->
    <div class="af-tabs">
      <button class="af-tab-btn" :class="{ active: activityTab === 'comments' }" @click="emit('update:activityTab', 'comments')">
        <i class="fa-solid fa-comments hide-on-mobile"></i>
        {{ t('comments') }} <span class="tab-count" v-if="unreadComments > 0">({{ unreadComments }})</span>
      </button>
      <button class="af-tab-btn" :class="{ active: activityTab === 'posts' }" @click="emit('update:activityTab', 'posts')">
        <i class="fa-solid fa-file-lines hide-on-mobile"></i>
        {{ t('posts') }} <span class="tab-count" v-if="unreadPosts > 0">({{ unreadPosts }})</span>
      </button>
      
      <div class="af-spacer"></div>

      <button v-if="!mobile" class="btn btn-xs btn-ghost af-toggle-btn" @click="emit('update:activityExpanded', !activityExpanded)">
        {{ activityExpanded ? t('hide') : t('show') + ' (' + filteredActivity.length + ')' }}
      </button>
    </div>

    <!-- List -->
    <div class="af-content" v-if="mobile || activityExpanded">
      <ActivityItemWidget
        v-for="act in displayList"
        :key="act.id"
        :act="act"
        :t="t"
        :time-ago="timeAgo"
        @open="emit('openActivity', $event)"
      />
      
      <div v-if="!mobile && filteredActivity.length > 3" class="af-footer">
        <a href="#" @click.prevent="emit('update:activityFullList', !activityFullList)" class="af-more-link">
          {{ activityFullList ? t('showLess') : t('showMore') + ' (' + (filteredActivity.length - 3) + ')' }}
        </a>
      </div>

      <div v-if="displayList.length === 0" class="af-empty">
        {{ t('noActivity') || 'No recent activity' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-feed {
  display: flex;
  flex-direction: column;
  background: var(--bg-white);
}

.af-tabs {
  display: flex;
  gap: 5px;
  background: var(--bg-r1);
  padding: 4px;
  border-radius: 6px;
  align-items: center;
}

.af-tab-btn {
  flex: 1;
  background: var(--bg-r3) !important;
  border: 1px solid var(--border-main) !important;
  padding: 8px !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  color: var(--text-muted) !important;
  border-radius: 4px !important;
  cursor: pointer !important;
  transition: all 0.2s;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 6px !important;
  margin: 0 !important;
}

.af-tab-btn:hover {
  border-color: var(--primary) !important;
  color: var(--text) !important;
  background: var(--bg-r2) !important;
}

.af-tab-btn.active {
  background: var(--primary) !important;
  border-color: var(--primary) !important;
  color: #fff !important;
}

.tab-count {
  font-size: 10px;
  opacity: 0.9;
  margin-left: 4px;
}

.af-spacer {
  flex: 1;
}

.af-toggle-btn {
  padding: 4px 10px;
  font-size: 10px;
  border-radius: 4px;
  background: var(--bg-white);
  border: 1px solid var(--border-main);
  color: var(--primary);
  cursor: pointer;
}

.af-content {
  border-top: 1px solid var(--border-main);
  max-height: 400px;
  overflow-y: auto;
}

.af-footer {
  padding: 10px;
  text-align: center;
  background: var(--bg-r2);
}

.af-more-link {
  font-size: 11px;
  font-weight: bold;
  color: var(--primary);
  text-decoration: underline;
}

.af-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

/* Desktop specific adjustments */
.activity-feed:not(.is-mobile) {
  border: 1px solid var(--primary);
  border-radius: 6px;
  overflow: hidden;
}

.activity-feed:not(.is-mobile) .af-tabs {
  border-radius: 0;
  background: var(--bg-r3);
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-main);
}

.activity-feed:not(.is-mobile) .af-tab-btn {
  flex: 0 0 auto !important;
  min-width: 130px !important;
}

.activity-feed:not(.is-mobile) .af-tab-btn.active {
  background: var(--primary);
}

/* Mobile specific */
.is-mobile .af-content {
  border-top: none;
  max-height: none;
  overflow-y: visible;
}

.hide-on-mobile {
  display: none;
}

@media (min-width: 901px) {
  .hide-on-mobile {
    display: inline-block;
  }
}
</style>
