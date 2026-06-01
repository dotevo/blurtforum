<script setup lang="ts">
defineProps<{
  t: (k: string) => string;
}>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
<!-- STRUCTURE DOCS MODAL -->
<div class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box" style="width: 500px;">
    <div class="modal-header">
      {{ t('structureDocs') }}
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body">
      <p>{{ t('structureHelp') }}</p>
      <pre style="background: var(--bg-page); padding: 10px; margin: 10px 0; border: 1px solid var(--border-main); overflow-x: auto; font-family: var(--mono);">
## Category Name
> Forum Name | tag1, tag2 | Optional Description
> Another Forum | tag3 | etc.

## Another Category
> General | blurt-123 | Catch-all for this community
      </pre>
      <p class="gs">{{ t('structureExample') }}</p>
      <div class="alert alert-info">
        Each category starts with <code>## </code>. Each forum starts with <code>&gt; </code> followed by <code>Name | Tags | Description</code>.
      </div>
    </div>
  </div>
</div>
</template>
