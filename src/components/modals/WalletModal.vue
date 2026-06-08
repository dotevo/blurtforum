<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';

const props = defineProps<{
  show: boolean;
  mode: 'transfer' | 'power_up' | 'power_down';
  balance: string;
  username: string;
  targetUser?: string;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [data: { mode: string, to: string, amount: string, memo: string }];
}>();

const form = reactive({
  to: '',
  amount: '',
  memo: '',
  error: ''
});

const isBusy = ref(false);

watch(() => props.show, (val) => {
  if (val) {
    form.to = props.targetUser || '';
    form.amount = '';
    form.memo = '';
    form.error = '';
  }
});

const validate = () => {
  if (props.mode === 'transfer' && !form.to.trim()) {
    form.error = props.t('errorToRequired') || 'Recipient is required';
    return false;
  }
  const amt = parseFloat(form.amount);
  if (isNaN(amt) || amt <= 0) {
    form.error = props.t('errorInvalidAmount') || 'Invalid amount';
    return false;
  }
  const bal = parseFloat(props.balance) || 0;
  if (amt > bal) {
    form.error = props.t('errorInsufficentBalance') || 'Insufficient balance';
    return false;
  }
  return true;
};

const handleSubmit = () => {
  if (!validate()) return;
  emit('submit', { ...form, mode: props.mode });
};

const title = computed(() => {
  if (props.mode === 'transfer') return props.t('transfer') || 'Transfer BLURT';
  if (props.mode === 'power_up') return props.t('powerUp') || 'Power Up';
  if (props.mode === 'power_down') return props.t('powerDown') || 'Power Down';
  return '';
});

</script>

<template>
  <div v-if="show" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-box">
      <div class="modal-header">
        <span>{{ title }}</span>
        <button class="modal-close" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        
        <div class="gs" style="margin-bottom: 15px; background: var(--bg-r3); padding: 10px; border-radius: 4px;">
           {{ t('balance') }}: <b>{{ balance }}</b>
        </div>

        <div v-if="mode === 'transfer'" style="margin-bottom: 15px;">
          <label class="form-label">{{ t('to') }}</label>
          <input type="text" v-model="form.to" placeholder="username" />
        </div>

        <div style="margin-bottom: 15px;">
          <label class="form-label">{{ t('amount') }}</label>
          <div style="position: relative;">
            <input type="number" v-model="form.amount" step="0.001" placeholder="0.000" />
            <span style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-weight: bold; color: var(--text-muted);">
              {{ mode === 'power_down' ? 'BP' : 'BLURT' }}
            </span>
          </div>
        </div>

        <div v-if="mode === 'transfer'" style="margin-bottom: 15px;">
          <label class="form-label">{{ t('memo') }}</label>
          <input type="text" v-model="form.memo" :placeholder="t('optional') || 'Optional memo'" />
        </div>

        <div v-if="form.error" class="alert alert-error">{{ form.error }}</div>

        <div style="margin-top: 20px; display: flex; gap: 10px;">
          <button class="btn btn-primary" style="flex: 1;" @click="handleSubmit">
            {{ t('confirm') || 'Confirm' }}
          </button>
          <button class="btn btn-ghost" @click="emit('close')">{{ t('cancel') }}</button>
        </div>

        <div class="gs" style="margin-top: 15px; font-size: 11px; text-align: center;">
          <i class="fa-solid fa-shield-halved"></i> 
          {{ mode === 'transfer' ? t('transferNote') || 'Transferring funds is irreversible.' : t('powerNote') || 'Power operations affect your influence.' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
input {
  width: 100%;
  padding: 10px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text);
  border-radius: 4px;
}
.form-label {
  display: block;
  font-weight: bold;
  font-size: 12px;
  margin-bottom: 5px;
  color: var(--text);
}
</style>
