<script setup lang="ts">
defineProps<{
  structureForm: { text: string; loading: boolean; error: string };
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  save: [];
  showDocs: [];
}>();
</script>

<template>
<!-- LAYOUT EDITOR MODAL -->
<div class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box" style="width: 600px;">
    <div class="modal-header">
      {{ t('editStructure') }}
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body">
      <div style="margin-bottom: 15px;">
        <label class="form-label">{{ t('structureDocs') }} (Community Description)</label>
        <textarea v-model="structureForm.text" style="width: 100%; height: 300px; font-family: var(--mono); padding: 10px; border: 1px solid var(--input-border); background: var(--input-bg); color: var(--text);"></textarea>
      </div>
      <div v-if="structureForm.error" class="alert alert-error">{{ structureForm.error }}</div>
      <div style="display: flex; gap: 10px;">
        <button class="btn btn-primary" @click="emit('save')" :disabled="structureForm.loading">
          <span v-if="structureForm.loading" class="spin"></span>{{ t('save') }}
        </button>
        <button class="btn btn-ghost" @click="emit('close')">{{ t('cancel') }}</button>
        <button class="btn btn-sm btn-hdr" style="margin-left: auto;" @click="emit('close')">ℹ️ Help</button>
      </div>
    </div>
  </div>
</div>
</template>
