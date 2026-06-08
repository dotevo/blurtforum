<script setup lang="ts">
import type { Post } from '../../types';

defineProps<{
  post: Post | Partial<Post>;
  precision?: number;
  showCurrency?: boolean;
}>();

const emit = defineEmits<{
  click: [post: Post | Partial<Post>];
}>();
</script>

<template>
  <span class="badge payout-link" 
        :class="post.isPaid ? 'badge-green' : 'badge-blue'" 
        @click.stop="emit('click', post)">
    {{ (post.payout || 0).toFixed(precision !== undefined ? precision : 2) }} {{ showCurrency ? 'BLURT' : 'B' }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-block;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: bold;
  border-radius: 4px;
  cursor: pointer;
}
.badge-blue {
  background: var(--primary);
  color: #fff;
}
.badge-green {
  background: #27ae60;
  color: #fff;
}
.payout-link:hover {
  opacity: 0.8;
}
</style>
