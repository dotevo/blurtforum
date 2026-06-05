<script setup lang="ts">
import type { Beneficiary } from '../../types';

defineProps<{
  beneficiaries: Beneficiary[];
  limit?: number;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  openProfile: [username: string];
}>();
</script>

<template>
  <div v-if="beneficiaries && beneficiaries.length > 0" class="beneficiaries-inline">
    <span class="ben-icon">👥</span>
    <template v-for="(b, bi) in beneficiaries.slice(0, limit || 3)" :key="b.account">
      <a href="#" @click.prevent="emit('openProfile', b.account)" class="ben-link">@{{ b.account }}</a>
      <span class="ben-pct">{{ ((b.weight || 0)/100).toFixed(0) }}%</span>
      <span v-if="bi < beneficiaries.slice(0, limit || 3).length-1" class="ben-sep">,</span>
    </template>
    <span v-if="beneficiaries.length > (limit || 3)" class="ben-more">+{{ beneficiaries.length - (limit || 3) }}</span>
  </div>
</template>

<style scoped>
.beneficiaries-inline {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  background: rgba(0,0,0,0.05);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
}
.ben-icon { opacity: 0.7; font-size: 10px; }
.ben-link { color: var(--primary); font-weight: bold; }
.ben-link:hover { text-decoration: underline; }
.ben-pct { opacity: 0.6; font-size: 9px; }
.ben-sep { opacity: 0.3; }
.ben-more { font-weight: bold; opacity: 0.8; font-size: 9px; }

[data-theme="dark"] .beneficiaries-inline,
[data-theme="deepnight"] .beneficiaries-inline,
[data-theme="ocean"] .beneficiaries-inline,
[data-theme="midnight"] .beneficiaries-inline {
  background: rgba(255,255,255,0.05);
}
</style>
