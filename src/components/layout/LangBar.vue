<script setup lang="ts">
import SettingsSelectors from './SettingsSelectors.vue';

defineProps<{
  theme: string;
  themes: { id: string; label: string }[];
  lang: string;
  langs: string[];
  rpcMenuOpen: boolean;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  'update:rpcMenuOpen': [value: boolean];
  'setTheme': [value: string];
  'setLang': [value: string];
}>();
</script>

<template>
<!-- LANGUAGE BAR -->
<div class="lang-bar">
  <SettingsSelectors
    :theme="theme"
    :themes="themes"
    :lang="lang"
    :langs="langs"
    :t="t"
    @set-theme="emit('setTheme', $event)"
    @set-lang="emit('setLang', $event)"
    @open-rpc="emit('update:rpcMenuOpen', true)"
  />
</div>
</template>

<style scoped>
.lang-bar {
  background: var(--bg-r2);
  display: flex;
  align-items: center;
  padding: 6px 15px;
  border-bottom: 1px solid var(--border-main);
}

@media (max-width: 900px) {
  .lang-bar {
    padding: 8px 10px;
    background: var(--bg-r1);
  }
  /* LangBar on mobile uses the internal SettingsSelectors mobile styles via prop if needed, 
     but here we just ensure the bar itself is consistent */
}
</style>
