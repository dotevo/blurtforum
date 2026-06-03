<script setup lang="ts">
defineProps<{
  voted: boolean;
  count: number;
}>();

const emit = defineEmits<{
  vote: [];
}>();
</script>

<template>
  <span 
    class="vote-btn" 
    :class="{ active: voted }" 
    @click.stop="emit('vote')"
  >
    <i class="fa-solid fa-caret-up"></i>
    <span class="vote-count">{{ count }}</span>
  </span>
</template>

<style>
.vote-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.2s;
  color: var(--text-muted);
  font-size: 14px;
}

.vote-btn:hover {
  background: var(--bg-r3);
  opacity: 0.8;
}

.vote-btn.active {
  color: var(--success-text);
  font-weight: bold;
}

.vote-count {
  font-size: 10px;
  font-weight: bold;
}
</style>
