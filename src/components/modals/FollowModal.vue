<script setup lang="ts">
defineProps<{
  followModal: { show: boolean; user: string; isFollowing: boolean };
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();
</script>

<template>
<!-- FOLLOW CONFIRMATION MODAL -->
<div v-if="followModal.show" class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box">
    <div class="modal-header">
      {{ followModal.isFollowing ? t('unfollow') : t('follow') }}
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body" style="text-align: center;">
      <div style="margin-bottom: 20px; font-size: 14px;">
        {{ followModal.isFollowing ? t('confirmUnfollow').replace('{user}', followModal.user) : t('confirmFollow').replace('{user}', followModal.user) }}
      </div>
      <div style="display: flex; gap: 10px; justify-content: center;">
        <button class="btn btn-accent" @click="emit('confirm')" style="min-width: 100px;">OK</button>
        <button class="btn btn-ghost" @click="emit('close')" style="min-width: 100px;">{{ t('cancel') }}</button>
      </div>
    </div>
  </div>
</div>
</template>
