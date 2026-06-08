<script setup lang="ts">
import type { Forum, Post } from '../../types';

defineProps<{
  view: string;
  activeForum: Forum | null;
  activeTopic: Post | null;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  goHome: [];
  openForum: [f: Forum];
}>();
</script>

<template>
  <div class="mobile-context">
    <!-- Breadcrumb (Topic Title only) -->
    <div class="mc-title-box forumline" v-if="view === 'topic' && activeTopic">
      <div class="mc-breadcrumb">
        <span class="active-topic-title">{{ activeTopic.title }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mobile-context {
  margin-top: 5px;
  margin-bottom: 5px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mc-title-box {
  padding: 8px 10px;
  background: var(--bg-r1);
  border-left: 2px solid var(--primary);
}

.mc-breadcrumb {
  font-size: 11px;
  color: var(--text);
  line-height: 1.4;
}

.active-topic-title {
  font-weight: bold;
}
</style>
