<script setup lang="ts">
import { ref, reactive } from 'vue';

const props = defineProps<{
  show: boolean;
  username: string;
  authority: 'Active' | 'Posting';
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [key: string];
}>();

const key = ref('');
const error = ref('');

const handleSubmit = () => {
  if (!key.value) {
    error.value = 'Key is required';
    return;
  }
  emit('submit', key.value);
  key.value = '';
  error.value = '';
};
</script>

<template>
<div v-if="show" class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box">
    <div class="modal-header">
      {{ t('authRequired') || 'Authority Required' }}
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body">
      <div style="margin-bottom: 15px;">
        <i class="fa-solid fa-shield-halved" style="color: var(--primary); font-size: 24px; display: block; margin-bottom: 10px; text-align: center;"></i>
        <p style="font-size: 14px; text-align: center;">
          {{ t('provideKeyFor') || 'Please provide your' }} <strong>{{ authority }}</strong> {{ t('keyForAccount') || 'key for' }} <strong>@{{ username }}</strong>
        </p>
        <p class="gs" style="font-size: 11px; text-align: center; color: #DD6900;">
          {{ t('keyNotStored') || 'This key will not be stored and is used only for this transaction.' }}
        </p>
      </div>

      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <div style="margin-bottom: 15px;">
        <label class="form-label">{{ authority }} {{ t('privateKey') }}</label>
        <input type="password" v-model="key" :placeholder="authority + ' key (5...)'"
               @keyup.enter="handleSubmit"
               style="width:100%; padding: 10px; border: 1px solid #999; border-radius: 4px; box-sizing: border-box;">
      </div>

      <div style="display: flex; gap: 10px;">
        <button class="btn btn-primary" style="flex: 1; padding: 12px;" @click="handleSubmit">
          <i class="fa-solid fa-paper-plane"></i> {{ t('confirmAndSend') || 'Confirm & Send' }}
        </button>
        <button class="btn btn-ghost" style="padding: 12px;" @click="emit('close')">{{ t('cancel') }}</button>
      </div>
    </div>
  </div>
</div>
</template>
