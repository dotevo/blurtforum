<script setup lang="ts">
defineProps<{
  pinModal: { show: boolean; mode: string; value: string; error: string; loading: boolean };
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();
</script>

<template>
<!-- PIN MODAL -->
<div v-if="pinModal.show" class="modal-overlay" @click.self="!pinModal.loading && (emit('close'))">
  <div class="modal-box" style="width: 320px;">
    <div class="modal-header">
      {{ pinModal.mode === 'setup' ? t('setPin') : t('enterPin') }}
      <button v-if="!pinModal.loading" class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body" style="text-align: center;">
      <p class="gs" style="margin-bottom: 10px;">{{ pinModal.mode === 'setup' ? t('pinSetupDesc') : t('pinEnterDesc') }}</p>
      
      <div v-if="pinModal.loading" style="padding: 20px;">
        <span class="spin" style="width:30px; height:30px; border-width:3px;"></span>
      </div>
      <template v-else>
        <input type="password" v-model="pinModal.value" :placeholder="t('pinPlaceholder')" maxlength="6"
               @keyup.enter="emit('submit')"
               style="width:100%; padding:10px; text-align:center; font-size:24px; letter-spacing:8px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text);"
               autofocus>
        <div v-if="pinModal.error" class="alert alert-error" style="margin-top:10px; padding:5px 10px;">{{ pinModal.error }}</div>
        <button class="btn btn-primary" style="width:100%; margin-top:15px; padding:10px;" 
                @click="emit('submit')" :disabled="pinModal.value.length < 4">OK</button>
      </template>
    </div>
  </div>
</div>
</template>
