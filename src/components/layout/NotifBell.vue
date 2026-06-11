<script setup lang="ts">
defineProps<{
  hasNew: boolean;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
}>();

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <div class="notif-bell" :class="[size || 'md', { 'has-new': hasNew, 'is-loading': loading }]" @click="emit('click')">
    <i v-if="loading" class="fa-solid fa-circle-notch spin"></i>
    <i v-else class="fa-solid fa-bell"></i>
  </div>
</template>

<style scoped>
.notif-bell {
  position: relative;
  cursor: pointer;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
}

.notif-bell:hover {
  color: var(--primary);
}

.notif-bell.sm { font-size: 14px; }
.notif-bell.md { font-size: 18px; }
.notif-bell.lg { font-size: 24px; }

.notif-bell.has-new::after {
  content: '';
  position: absolute;
  background: var(--accent, #ff4400);
  border-radius: 50%;
  border: 1.5px solid var(--nav-bg);
}

.notif-bell.sm.has-new::after { width: 6px; height: 6px; top: -1px; right: -1px; }
.notif-bell.md.has-new::after { width: 8px; height: 8px; top: -2px; right: -2px; }
.notif-bell.lg.has-new::after { width: 10px; height: 10px; top: -3px; right: -3px; }

/* Optional animation for new notifications */
.notif-bell.has-new i {
  animation: bell-ring 2s infinite;
}

@keyframes bell-ring {
  0% { transform: rotate(0); }
  5% { transform: rotate(15deg); }
  10% { transform: rotate(-15deg); }
  15% { transform: rotate(10deg); }
  20% { transform: rotate(-10deg); }
  25% { transform: rotate(0); }
  100% { transform: rotate(0); }
}
</style>
