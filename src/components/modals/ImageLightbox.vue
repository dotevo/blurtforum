<script setup lang="ts">
defineProps<{
  imgModal: { show: boolean; src: string };
  t: (k: string) => string;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
<!-- IMAGE LIGHTBOX -->
<div v-if="imgModal.show" class="modal-overlay" @click.self="emit('close')" style="background: rgba(0,0,0,0.9); z-index: 3000;">
  <div style="position: relative; max-width: 98vw; max-height: 98vh; display: flex; align-items: center; justify-content: center;">
    <button class="modal-close" @click="emit('close')" 
            style="position: fixed; top: 20px; right: 20px; font-size: 30px; background: rgba(0,0,0,0.5); width: 45px; height: 45px; border-radius: 50%; display: flex; align-items: center; justify-content: center; z-index: 3100; color: #fff; border: 2px solid #fff;">✕</button>
    <img :src="imgModal.src" style="max-width: 100%; max-height: 98vh; object-fit: contain; box-shadow: 0 0 30px rgba(0,0,0,1);">
  </div>
</div>
</template>
