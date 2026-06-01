<script setup lang="ts">
defineProps<{
  editModal: {
    show: boolean; loading: boolean; isPost: boolean;
    title: string; body: string; error: string; success: string;
  };
  t: (k: string) => string;
  renderMD: (s: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  submitEdit: [];
}>();
</script>

<template>
<!-- EDIT MODAL -->
<div v-if="editModal.show" class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box" style="width: 700px;">
    <div class="modal-header">
      {{ editModal.isPost ? t('editPost') : t('editComment') }}
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body">
      <div v-if="editModal.isPost" style="margin-bottom:15px">
        <label class="form-label">{{ t('postTitle') }}</label>
        <input type="text" v-model="editModal.title"
               style="width:100%; padding:10px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text);">
      </div>
      <div style="margin-bottom:15px">
        <label class="form-label">{{ t('postBody') }} (Markdown)</label>
        <textarea v-model="editModal.body" style="width:100%; height:350px; font-family:var(--sans); font-size:12px; padding:10px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text);"></textarea>
      </div>
      <div v-if="editModal.error" class="alert alert-error">{{ editModal.error }}</div>
      <div v-if="editModal.success" class="alert alert-success">{{ editModal.success }}</div>
      <div style="display:flex; gap:10px">
        <button class="btn btn-primary" @click="emit('submitEdit')" :disabled="editModal.loading">
          <span v-if="editModal.loading" class="spin"></span>{{ t('update') }}
        </button>
        <button class="btn btn-ghost" @click="emit('close')">{{ t('cancel') }}</button>
      </div>
    </div>
  </div>
</div>
</template>
