<script setup lang="ts">
defineProps<{
  theme: string;
  themes: { id: string; label: string }[];
  lang: string;
  langs: string[];
  t: (k: string) => string;
  mobile?: boolean;
}>();

const emit = defineEmits<{
  'setTheme': [value: string];
  'setLang': [value: string];
  'openRpc': [];
}>();
</script>

<template>
  <div class="settings-selectors" :class="{ 'is-mobile': mobile }">
    <div class="selector-item">
      <i class="fa-solid fa-palette"></i>
      <span class="gs hide-on-mobile" v-if="!mobile">{{ t('theme') }}:</span>
      <select :value="theme" @change="emit('setTheme', ($event.target as HTMLSelectElement).value)" class="lang-btn">
        <option v-for="th in themes" :key="th.id" :value="th.id">{{ th.label }}</option>
      </select>
    </div>
    <div class="selector-item">
      <i class="fa-solid fa-language"></i>
      <span class="gs hide-on-mobile" v-if="!mobile">{{ t('lang') }}:</span>
      <select :value="lang" @change="emit('setLang', ($event.target as HTMLSelectElement).value)" class="lang-btn">
        <option v-for="l in (langs as any)" :key="l.code || l" :value="l.code || l">{{ l.name || l.toUpperCase() }}</option>
      </select>
    </div>
    <button class="lang-btn rpc-btn" @click="emit('openRpc')" title="RPC settings">
      <i class="fa-solid fa-gear"></i> <span v-if="!mobile">RPC</span>
    </button>
  </div>
</template>

<style scoped>
.settings-selectors {
  display: flex;
  gap: 10px;
  align-items: center;
}

.selector-item {
  display: flex;
  gap: 5px;
  align-items: center;
}

.selector-item i {
  font-size: 12px;
  color: var(--primary);
}

.lang-btn {
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text);
  padding: 2px 6px;
  font-size: 11px;
  cursor: pointer;
  border-radius: 4px;
  font-family: inherit;
  font-weight: bold;
  outline: none;
}

.lang-btn:hover {
  border-color: var(--primary);
  background: var(--bg-r1);
}

.rpc-btn {
  display: flex;
  align-items: center;
  gap: 5px;
}

/* Mobile overrides */
.is-mobile {
  width: 100%;
  justify-content: space-between;
  gap: 5px;
}

.is-mobile .selector-item {
  flex: 1;
  background: var(--nav-bg);
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-main);
}

.is-mobile .selector-item select {
  flex: 1;
  border: none;
  background: transparent;
  padding: 0;
  width: 100%;
}

.is-mobile .rpc-btn {
  flex: 0 0 auto;
  padding: 6px 10px;
  background: var(--nav-bg);
  border: 1px solid var(--border-main);
}

.hide-on-mobile {
  display: none;
}

@media (min-width: 901px) {
  .hide-on-mobile {
    display: inline;
  }
}
</style>
