<script setup lang="ts">
import type { ActivityItem } from '../../types';

defineProps<{
  act: ActivityItem;
  t: (k: string) => string;
  timeAgo: (s: string) => string;
}>();

const emit = defineEmits<{
  open: [act: ActivityItem];
}>();
</script>

<template>
  <div class="activity-item" :class="{ 'is-unread': !act.isRead }" @click="emit('open', act)">
    <div class="ai-dot" v-if="!act.isRead"></div>
    <div class="ai-main">
      <div class="ai-header">
        <b class="ai-author">@{{ act.author }}</b>
        <span class="ai-action gs">{{ act.is_post ? t('newPostIn') : t('newCommentIn') }}</span>
        <span class="ai-comm">{{ act.community_title }}</span>
      </div>
      <div class="ai-body">
        <span class="ai-title" v-if="act.title">"{{ act.title }}"</span>
        <span class="ai-time gs">{{ timeAgo(act.created) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-item {
  padding: 10px 15px;
  border-bottom: 1px solid var(--bg-r1);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  transition: background 0.2s;
}

.activity-item:hover {
  background: var(--bg-r1);
}

.activity-item.is-unread {
  background: var(--bg-r3);
}

.ai-dot {
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
}

.ai-main {
  flex: 1;
  min-width: 0;
}

.ai-header {
  font-size: 12px;
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.ai-author {
  color: var(--primary);
}

.is-unread .ai-author {
  font-weight: 900;
}

.ai-comm {
  background: var(--primary);
  color: #fff;
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  font-weight: bold;
}

.ai-body {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.ai-title {
  font-size: 11px;
  font-style: italic;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.is-unread .ai-title {
  color: var(--text);
  font-weight: 500;
}

.ai-time {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}
</style>
