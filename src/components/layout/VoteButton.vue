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

<style scoped>
.vote-btn { 
  cursor: pointer; 
  color: var(--text-muted); 
  font-size: 14px; 
  user-select: none; 
  transition: all 0.2s ease; 
  display: inline-flex; 
  align-items: center; 
  justify-content: center; 
  gap: 4px;
  line-height: 1; 
  padding: 2px 6px;
  border-radius: 4px;
}
.vote-btn:hover { color: var(--primary); transform: scale(1.1); background: var(--bg-r3); }
.vote-btn.active { color: var(--accent-active); filter: drop-shadow(0 0 3px var(--accent-active)); transform: scale(1.1); font-weight: bold; }
.vote-btn i { filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2)); }

.vote-count {
  font-size: 10px;
  font-weight: bold;
}
</style>
