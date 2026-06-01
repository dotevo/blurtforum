<script setup lang="ts">
import type { Post, Beneficiary } from '../../types';

defineProps<{
  payoutModal: {
    show: boolean;
    post: Partial<Post & { payoutDate?: string }>;
    beneficiaries: Beneficiary[];
  };
  t: (k: string) => string;
  fmtDate: (s: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  openProfile: [username: string];
}>();
</script>

<template>
<!-- PAYOUT MODAL -->
<div v-if="payoutModal.show" class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box">
    <div class="modal-header">
      {{ t('payoutDetails') }}
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body">
      <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #D1D7DC;">
        <div style="font-weight: bold; color: var(--primary);">{{ t('payoutStatus') }}</div>
        <div v-if="payoutModal.post.isPaid" class="alert alert-success" style="margin-top: 5px;">
          {{ t('paidOn') }}: {{ payoutModal.post.payoutDate }}
        </div>
        <div v-else class="alert alert-info" style="margin-top: 5px;">
          {{ t('pendingPayout') }}: {{ (payoutModal.post.pendingPayout || 0).toFixed(3) }} BLURT<br>
          <span class="gs">{{ t('expectedOn') }}: {{ payoutModal.post.payoutDate }}</span>
        </div>
      </div>
      <div v-if="payoutModal.beneficiaries && payoutModal.beneficiaries.length" style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid var(--border-main);">
        <div style="font-weight: bold; color: var(--primary); margin-bottom: 8px;">{{ t('beneficiaries') }}</div>
        <div style="border: 1px solid var(--border-main); background: var(--bg-r1); border-radius: 4px; overflow: hidden;">
          <div v-for="b in payoutModal.beneficiaries" :key="b.account"
               style="padding: 6px 10px; border-bottom: 1px solid var(--border-main); display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: bold;"><a href="#" @click.prevent="emit('openProfile', b.account); emit('close')">@{{ b.account }}</a></span>
            <span class="gs">{{ ((b.weight || 0) / 100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>
      <div style="font-weight: bold; color: var(--primary); margin-bottom: 8px;">{{ t('voters') }} ({{ (payoutModal.post.active_votes || []).length }})</div>
      <div style="max-height: 300px; overflow-y: auto; border: 1px solid var(--border-main); background: var(--bg-r1); border-radius: 4px;">
        <div v-for="v in payoutModal.post.active_votes" :key="v.voter"
             style="padding: 5px 10px; border-bottom: 1px solid var(--border-main); display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: bold;"><a href="#" @click.prevent="emit('openProfile', v.voter); emit('close')">@{{ v.voter }}</a></span>
          <span class="gs">
            {{ (v.percent / 100).toFixed(0) }}%
            <template v-if="(payoutModal.post.net_rshares ?? 0) > 0">
              ({{ ((v.rshares ?? 0) / (payoutModal.post.net_rshares ?? 0) * (payoutModal.post.payout || 0)).toFixed(3) }} B)
            </template>
          </span>
        </div>
        <div v-if="!(payoutModal.post.active_votes || []).length" style="padding: 10px; text-align: center; color: var(--text-muted);">{{ t('noVotes') }}</div>
      </div>
    </div>
  </div>
</div>
</template>
