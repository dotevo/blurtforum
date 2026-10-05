<script setup lang="ts">
/**
 * components/modals/TranslationSettingsModal.vue
 *
 * Settings for the opt-in post/comment translation feature (see
 * composables/useTranslation.ts). Styled identically to RpcModal.vue —
 * same .modal-overlay/.modal-box/.modal-header/.modal-body theme classes
 * from the global stylesheet, same show/close contract.
 */
import { onMounted, ref, watch } from 'vue';
import { useTranslation } from '../../composables/useTranslation';
import { TRANSLATION_LANGUAGES } from '../../modules/shoutbox/translation-languages';
import type { CacheStats } from '../../modules/shoutbox/translation-store';

const props = defineProps<{
  show: boolean;
  t: (k: string) => string;
}>();

const emit = defineEmits<{ close: [] }>();

const { prefs, cacheStats, clearCache, setMaxCacheBytes, getMaxCacheBytes } = useTranslation();

const stats = ref<CacheStats>({ count: 0, bytes: 0 });
const maxBytesMb = ref(Math.round(getMaxCacheBytes() / (1024 * 1024)));
const clearing = ref(false);

async function refreshStats(): Promise<void> {
  stats.value = await cacheStats();
}

watch(() => props.show, (v) => { if (v) void refreshStats(); });
onMounted(refreshStats);

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function onClearCache(): Promise<void> {
  clearing.value = true;
  try {
    await clearCache();
    await refreshStats();
  } finally {
    clearing.value = false;
  }
}

function onMaxBytesChange(e: Event): void {
  const mb = parseInt((e.target as HTMLInputElement).value, 10);
  if (Number.isFinite(mb) && mb > 0) {
    maxBytesMb.value = mb;
    setMaxCacheBytes(mb * 1024 * 1024);
  }
}
</script>

<template>
  <div v-if="show" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-box">
      <div class="modal-header">
        <span><i class="fa-solid fa-globe"></i> {{ t('translationSettings') || 'Translation settings' }}</span>
        <button class="modal-close" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        <div class="ts-row">
          <label class="ts-toggle">
            <input type="checkbox" v-model="prefs.enabled" />
            <span>{{ t('translationEnable') || 'Enable automatic translation' }}</span>
          </label>
          <div class="ts-hint">{{ t('translationEnableHint') || 'Off by default. Shows a translate option on posts/comments and shares results peer-to-peer so others don\'t have to re-translate the same text.' }}</div>
        </div>

        <template v-if="prefs.enabled">
          <div class="ts-row">
            <label class="ts-label">{{ t('translationTargetLang') || 'Translate into' }}</label>
            <select v-model="prefs.targetLang" class="ts-select" :aria-label="t('translationTargetLang') || 'Translate into'">
              <option v-for="l in TRANSLATION_LANGUAGES" :key="l.code" :value="l.code">{{ l.name }}</option>
            </select>
          </div>

          <div class="ts-row">
            <label class="ts-label">{{ t('translationEngine') || 'Translation engine' }}</label>
            <select v-model="prefs.engine" class="ts-select" :aria-label="t('translationEngine') || 'Translation engine'">
              <option value="mymemory">MyMemory</option>
              <option value="google">Google ({{ t('translationEngineUnofficial') || 'unofficial' }})</option>
            </select>
          </div>

          <div class="ts-row">
            <label class="ts-toggle">
              <input type="checkbox" v-model="prefs.autoShow" />
              <span>{{ t('translationAutoShow') || 'Show translations automatically' }}</span>
            </label>
            <div class="ts-hint">{{ t('translationAutoShowHint') || 'Off: a small "Translate" button appears on content. On: translated text shows immediately, with a "show original" toggle.' }}</div>
          </div>

          <div class="ts-row ts-cache">
            <label class="ts-label">{{ t('translationCache') || 'Local translation cache' }}</label>
            <div class="ts-cache-stats">
              {{ t('translationCacheCount') || 'Cached translations' }}: <strong>{{ stats.count }}</strong>
              · {{ t('translationCacheSize') || 'Size' }}: <strong>{{ fmtBytes(stats.bytes) }}</strong>
            </div>
            <div class="ts-cache-limit">
              <span>{{ t('translationCacheLimit') || 'Cache limit' }}:</span>
              <input type="number" min="1" max="200" :value="maxBytesMb" @change="onMaxBytesChange" class="ts-number" /> MB
            </div>
            <button class="btn btn-sm btn-ghost" :disabled="clearing" @click="onClearCache">
              <i class="fa-solid fa-trash"></i> {{ t('translationClearCache') || 'Clear cache' }}
            </button>
          </div>
        </template>

        <div class="ts-note">{{ t('translationNote') || 'Shared translations are cryptographically signed by whoever produced them (a real Blurt account) and subject to the same moderation as regular posts.' }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay { z-index: 11000; backdrop-filter: blur(2px); }
.modal-box { width: 90%; max-width: 420px; }

.ts-row { margin-bottom: 16px; }
.ts-label { display: block; font-size: 11px; font-weight: bold; margin-bottom: 5px; }
.ts-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.ts-toggle input { width: 16px; height: 16px; cursor: pointer; }
.ts-hint { font-size: 10px; opacity: 0.6; line-height: 1.4; margin-top: 4px; margin-left: 24px; }
.ts-select {
  width: 100%; padding: 8px; font-size: 12px;
  border: 1px solid var(--input-border); background: var(--input-bg); color: var(--input-text);
  border-radius: 4px;
}
.ts-cache { border-top: 1px solid var(--card-divider); padding-top: 12px; }
.ts-cache-stats { font-size: 12px; margin-bottom: 8px; }
.ts-cache-limit { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 10px; }
.ts-number {
  width: 64px; padding: 4px 6px; font-size: 12px;
  border: 1px solid var(--input-border); background: var(--input-bg); color: var(--input-text);
  border-radius: 4px;
}
.ts-note { font-size: 10px; opacity: 0.6; line-height: 1.4; margin-top: 10px; }
</style>
