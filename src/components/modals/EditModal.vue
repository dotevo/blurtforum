<script setup lang="ts">
import PostEditor from '../layout/PostEditor.vue';
import type { AuthUser } from '../../types';

defineProps<{
  editModal: {
    show: boolean; loading: boolean; isPost: boolean;
    title: string; body: string; error: string; success: string;
  };
  auth: { user: AuthUser | null };
  t: (k: string) => string;
  renderMD: (s: string) => string;
  imgUpload?: boolean;
  feeEstimate?: string | null;
}>();

const emit = defineEmits<{
  close: [];
  submitEdit: [data: any];
  imagePick: [event: Event];
  paste: [event: ClipboardEvent];
}>();
</script>

<template>
<!-- EDIT MODAL -->
<div v-if="editModal.show" class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box" style="width: 800px; max-width: 95vw;">
    <div class="modal-header">
      {{ editModal.isPost ? t('editPost') : t('editComment') }}
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body" style="padding: 0;">
      <PostEditor
        mode="edit"
        :auth="auth"
        :t="t"
        :renderMD="renderMD"
        :loading="editModal.loading"
        :error="editModal.error"
        :success="editModal.success"
        :initialTitle="editModal.isPost ? editModal.title : ''"
        :initialBody="editModal.body"
        :imgUpload="imgUpload"
        :feeEstimate="feeEstimate"
        :hideBeneficiary="true"
        @submit="(data) => emit('submitEdit', data)"
        @cancel="emit('close')"
        @imagePick="(e) => emit('imagePick', e)"
        @paste="(e) => emit('paste', e)"
        style="border: none;"
      />
    </div>
  </div>
</div>
</template>
