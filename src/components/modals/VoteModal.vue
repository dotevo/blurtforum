<script setup lang="ts">
import type { Post } from '../../types';

defineProps<{
  voteModal: {
    show: boolean; post: Post | null; weight: number;
    estimatedValue: { vpCostPct: string; vpAfter: string; voteValue: string; fee: string } | null;
    estimating: boolean;
  };
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
  estimateVote: [weight: number];
}>();
</script>

<template>
<!-- VOTE WEIGHT MODAL -->
<div v-if="voteModal.show" class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box" style="width: 360px;">
    <div class="modal-header">
      <span style="display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-caret-up"></i> {{ t('voteWeight') }}
      </span>
      <button class="modal-close" @click="emit('close')">×</button>
    </div>
    <div class="modal-body">
      <!-- Post being voted -->
      <div v-if="voteModal.post" style="font-size:11px; color:var(--text-soft); margin-bottom:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ✍ {{ voteModal.post.title || ('@' + voteModal.post.author) }}
      </div>

      <!-- COAL warning: author is flagged as "slippery" (spam/impersonation) on coal.blurtwallet.com.
           Content stays visible/votable - this is just so a voter doesn't upvote it by accident. -->
      <div v-if="voteModal.post && voteModal.post.isCoal" class="alert alert-info" style="border-color:var(--alert-error-text); margin-bottom:14px; font-size:12px;">
        <div style="font-weight:bold; margin-bottom:4px;"><i class="fa-solid fa-triangle-exclamation"></i> {{ t('coalVoteWarningTitle') }}</div>
        <div>{{ voteModal.post.coalInfo?.reason }}<span v-if="voteModal.post.coalInfo?.notes"> — {{ voteModal.post.coalInfo?.notes }}</span></div>
        <a href="https://coal.blurtwallet.com/" target="_blank" rel="noopener" style="text-decoration:underline;">{{ t('coalVoteWarningLink') }}</a>
      </div>

      <!-- Slider -->
      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
          <label class="form-label" style="margin:0;">{{ t('strength') }}</label>
          <span style="font-size:20px; font-weight:bold; color:var(--brand);">{{ voteModal.weight }}%</span>
        </div>
        <input type="range" min="1" max="100" v-model.number="voteModal.weight"
               @input="emit('estimateVote', voteModal.weight)"
               class="vote-slider"
               :style="`background: linear-gradient(to right, var(--brand) ${voteModal.weight}%, var(--surface-4) ${voteModal.weight}%)`">
        <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-soft); margin-top:2px;">
          <span>1%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
      </div>

      <!-- Estimated values -->
      <div class="vote-estimate-box">
        <div v-if="voteModal.estimating" style="text-align:center; padding:10px;">
          <span class="spin"></span> {{ t('loading') }}
        </div>
        <template v-else-if="voteModal.estimatedValue">
          <div class="vote-est-row">
            <span>⚡ {{ t('vpCost') }}</span>
            <strong>−{{ voteModal.estimatedValue.vpCostPct }}%</strong>
          </div>
          <div class="vote-est-row">
            <span>🔋 {{ t('vpAfter') }}</span>
            <strong>{{ voteModal.estimatedValue.vpAfter }}%</strong>
          </div>
          <div v-if="voteModal.estimatedValue.voteValue !== null" class="vote-est-row" style="border-top:1px solid var(--surface-border); margin-top:6px; padding-top:6px;">
            <span>💰 {{ t('estValue') }}</span>
            <strong style="color:var(--brand);">~{{ voteModal.estimatedValue.voteValue }} BLURT</strong>
          </div>
          <div class="vote-est-row" style="opacity: 0.8; font-size: 11px;">
            <span>💸 {{ t('voteFee') }}</span>
            <span>~{{ voteModal.estimatedValue.fee }} BLURT</span>
          </div>
        </template>
        <div v-else style="text-align:center; font-size:11px; opacity:0.5; padding:8px;">—</div>
      </div>

      <div class="dpad-row" style="display:flex; gap:10px; margin-top:16px;">
        <button class="btn btn-primary" style="flex:1; padding:8px;" @click="emit('confirm')">
          <i class="fa-solid fa-caret-up"></i> {{ t('vote') || 'Vote' }} {{ voteModal.weight }}%
        </button>
        <button class="btn btn-ghost" @click="emit('close')">{{ t('cancel') }}</button>
      </div>
    </div>
  </div>
</div>
</template>

<style scoped>
/* ===== VOTE WEIGHT MODAL ===== */
.vote-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 8px;
  border-radius: 4px;
  outline: none;
  cursor: pointer;
  display: block;
}
.vote-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--brand);
  border: 2px solid var(--surface-1);
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  cursor: pointer;
}
.vote-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--brand);
  border: 2px solid var(--surface-1);
  cursor: pointer;
}
.vote-estimate-box {
  background: var(--surface-3);
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 13px;
}
.vote-est-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  color: var(--text-strong);
}
.vote-est-row span { color: var(--text-soft); }


/* ===== Moved from global style.css (component-specific) ===== */
/* ===== VOTE WEIGHT MODAL ===== */
.vote-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 8px;
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
  display: block;
}
.vote-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--vote-thumb-bg);
  border: 2px solid var(--vote-thumb-border);
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  cursor: pointer;
}
.vote-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--vote-thumb-bg);
  border: 2px solid var(--vote-thumb-border);
  cursor: pointer;
}
.vote-estimate-box {
  background: var(--vote-box-bg);
  border: 1px solid var(--vote-box-border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  font-size: 13px;
}
.vote-est-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  color: var(--vote-row-text);
}
.vote-est-row span { color: var(--vote-row-muted); }
</style>
