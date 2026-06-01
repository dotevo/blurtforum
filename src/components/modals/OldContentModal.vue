<script setup lang="ts">
import type { Beneficiary } from '../../types';

defineProps<{
  oldContentModal: {
    show: boolean; loading: boolean; author: string;
    body: string; status: string; beneficiaries: Beneficiary[];
  };
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();
</script>

<template>
<!-- OLD CONTENT SUPPORT MODAL -->
<div v-if="oldContentModal.show" class="modal-overlay" @click.self="!oldContentModal.loading && (emit('close'))">
  <div class="modal-box" style="width: 500px;">
    <div class="modal-header">
      {{ t('oldContentTitle') }}
      <button class="modal-close" @click="emit('close')" :disabled="oldContentModal.loading">✕</button>
    </div>
    <div class="modal-body">
      <div class="alert alert-info" style="margin-bottom: 15px;">{{ t('oldContentDesc') }}</div>
      <div class="gs" style="margin-bottom: 15px; padding: 8px 12px; background: var(--bg-page); border: 1px solid var(--border-main); border-radius: 4px;">
        {{ t('oldContentBeneficiary').replace('{author}', oldContentModal.author) }}
        <div v-if="oldContentModal.beneficiaries && oldContentModal.beneficiaries.length > 0" 
             style="margin-top: 8px; font-size: 11px; border-top: 1px solid var(--border-main); padding-top: 8px;">
          <strong>{{ t('beneficiaries') }}:</strong>
          <span v-for="(b, bi) in oldContentModal.beneficiaries" :key="b.account">
            @{{ b.account }} ({{ (b.weight/100).toFixed(0) }}%)<span v-if="bi < oldContentModal.beneficiaries.length - 1">, </span>
          </span>
        </div>
      </div>
      <div style="margin-bottom: 15px;">
        <label class="form-label">{{ t('writeReply') }}</label>
        <textarea v-model="oldContentModal.body" :placeholder="t('supportCommentPlaceholder')" :disabled="oldContentModal.loading"
                  style="width:100%; height:100px; font-family:var(--sans); font-size:12px; padding:10px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text);"></textarea>
      </div>
      <div v-if="oldContentModal.status" class="alert" :class="oldContentModal.status.startsWith('Error') ? 'alert-error' : 'alert-info'" style="margin-bottom: 15px;">
        <span v-if="oldContentModal.loading" class="spin" style="margin-right:8px;"></span>{{ oldContentModal.status }}
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-primary" @click="emit('submit')" :disabled="oldContentModal.loading || !oldContentModal.body.trim()">
          <span v-if="oldContentModal.loading" class="spin"></span>{{ t('send') }}
        </button>
        <button class="btn btn-ghost" @click="emit('close')" :disabled="oldContentModal.loading">{{ t('cancel') }}</button>
      </div>
    </div>
  </div>
</div>
</template>
