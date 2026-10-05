<script setup lang="ts">
import SettingsSelectors from './SettingsSelectors.vue';

withDefaults(defineProps<{
  theme: string;
  themes: { id: string; label: string }[];
  lang: string;
  langs: string[];
  rpcMenuOpen: boolean;
  t: (k: string) => string;
  cinemaMode: boolean;
  /** Compact icon-forward layout for the mobile top-bar drawer. */
  mobile?: boolean;
}>(), {
  mobile: false,
});

const emit = defineEmits<{
  'update:rpcMenuOpen': [value: boolean];
  'openTranslationSettings': [];
  'setTheme': [value: string];
  'setLang': [value: string];
  'setCinemaMode': [value: boolean];
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
    :cinemaMode="cinemaMode"
    :mobile="mobile"
    @set-theme="emit('setTheme', $event)"
    @set-lang="emit('setLang', $event)"
    @open-rpc="emit('update:rpcMenuOpen', true)"
    @open-translation-settings="emit('openTranslationSettings')"
    @set-cinema-mode="emit('setCinemaMode', $event)"
  />
</div>
</template>

<style scoped>
.lang-bar {
  background: var(--surface-3);
  display: flex;
  align-items: center;
  padding: 6px 15px;
  border-bottom: 1px solid var(--surface-border);
}

@media (max-width: 900px) {
  .lang-bar {
    padding: 8px 10px;
    background: var(--surface-2);
  }
  /* LangBar on mobile uses the internal SettingsSelectors mobile styles via prop if needed, 
     but here we just ensure the bar itself is consistent */
}
</style>
