<script setup lang="ts">
/**
 * components/layout/TranslatedBody.vue
 *
 * Drop-in replacement for a plain `<div class="post-body" v-html="renderMD(x.body, x)">`
 * that adds the opt-in translation feature (see composables/useTranslation.ts
 * and modules/shoutbox/shoutbox.ts) without TopicView.vue/PostReplyThread.vue
 * having to know how any of that works. Renders nothing extra at all while
 * the feature is disabled (modules/shoutbox/translation-prefs.ts's
 * `enabled` defaults to false) — just the same body div as before.
 *
 * Three states once enabled, mirroring what was asked for:
 *   - nothing cached yet: a small "Translate" button. Clicking it runs the
 *     full fetch-or-translate flow (ask peers, then machine-translate).
 *   - a translation is cached (locally or by some other peer) but
 *     `autoShow` is off: a slightly different-styled button indicates one
 *     is available; clicking it shows it instantly (no network — it's
 *     already in hand from the cache peek on mount).
 *   - `autoShow` is on: the translation is fetched/shown immediately on
 *     mount, with a "Show original" toggle (X/Twitter-style) to flip back.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useTranslation, type TranslationStatus } from '../../composables/useTranslation';
import { isLikelySameLanguage } from '../../modules/shoutbox/language-detect';

const props = defineProps<{
  post: { author: string; permlink: string; body: string } & Record<string, any>;
  renderMD: (s: string, ctx?: unknown) => string;
  handleLinkClick: (e: MouseEvent) => void;
  t: (k: string) => string;
  /** Same moderation applied to ordinary posts/comments, but for the
   *  ACCOUNT that produced a shared translation (see
   *  modules/visibility.ts's isAccountHiddenFromViewer). Omit to skip
   *  translator-level moderation (e.g. contexts with no moderation data
   *  in scope) — global site-wide bans still apply regardless, since
   *  that check lives inside useTranslation itself. */
  isTranslatorHidden?: (username: string) => boolean;
}>();

const { prefs, entryFor, peekCache, ensureTranslation } = useTranslation();

const contentId = computed(() => `${props.post.author}:${props.post.permlink}`);
const entry = computed(() => entryFor(contentId.value, prefs.targetLang));
const showTranslation = ref(false);

async function checkAndMaybeAutoShow(): Promise<void> {
  if (!prefs.enabled) return;
  // Skip the AUTOMATIC trigger (only) when the post already looks like
  // it's in the target language — see language-detect.ts for why this is
  // a cheap heuristic, not real detection, and why it only ever suppresses
  // auto-show, never the manual "Translate" button below: a wrong guess
  // here should cost nothing more than "I still had to click the button."
  if (prefs.autoShow && !isLikelySameLanguage(props.post.body, prefs.targetLang)) {
    showTranslation.value = true;
    await ensureTranslation(contentId.value, prefs.targetLang, props.post.body, props.isTranslatorHidden);
  } else {
    await peekCache(contentId.value, prefs.targetLang, props.isTranslatorHidden);
  }
}

onMounted(checkAndMaybeAutoShow);
// A post navigated to in-place (same component instance, new post via
// activeTopic change) needs this to re-run for the new contentId — without
// this, the translate bar would keep showing stale state from whatever was
// open before.
watch(contentId, () => { showTranslation.value = false; void checkAndMaybeAutoShow(); });
watch(() => prefs.targetLang, () => { showTranslation.value = prefs.autoShow; void checkAndMaybeAutoShow(); });

async function onTranslateClick(): Promise<void> {
  if (entry.value.status === 'ready') { showTranslation.value = !showTranslation.value; return; }
  showTranslation.value = true;
  await ensureTranslation(contentId.value, prefs.targetLang, props.post.body, props.isTranslatorHidden);
  const statusNow = entry.value.status as TranslationStatus;
  if (statusNow !== 'ready') showTranslation.value = false;
}

const displayHtml = computed(() => {
  if (showTranslation.value && entry.value.status === 'ready' && entry.value.body) {
    return props.renderMD(entry.value.body, props.post);
  }
  return props.renderMD(props.post.body, props.post);
});
</script>

<template>
  <div class="post-body" v-html="displayHtml" @click="handleLinkClick"></div>

  <div v-if="prefs.enabled" class="translate-bar">
    <button
      v-if="entry.status === 'idle' || entry.status === 'error'"
      type="button"
      class="translate-btn"
      @click="onTranslateClick"
    >
      <i class="fa-solid fa-language"></i> {{ t('translate') || 'Translate' }}
    </button>
    <button v-else-if="entry.status === 'loading'" type="button" class="translate-btn" disabled>
      <i class="fa-solid fa-spinner fa-spin"></i> {{ t('translating') || 'Translating…' }}
    </button>
    <template v-else-if="entry.status === 'ready'">
      <button type="button" class="translate-btn translate-btn--active" @click="showTranslation = !showTranslation">
        <i class="fa-solid fa-language"></i>
        {{ showTranslation ? (t('showOriginal') || 'Show original') : (t('showTranslation') || 'Show translation') }}
      </button>
      <span v-if="showTranslation" class="translate-attribution">
        <template v-if="entry.translator">{{ t('translatedBy') || 'Translated by' }} @{{ entry.translator }}</template>
        <template v-else>{{ t('translationUnattributed') || 'Translated locally (not shared)' }}</template>
      </span>
    </template>
    <span v-if="entry.status === 'error'" class="translate-error">{{ t('translationFailed') || 'Translation failed' }}</span>
  </div>
</template>

<style scoped>
.translate-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.translate-btn {
  background: var(--chip-bg);
  color: var(--btn-ghost-text);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-xs, 4px);
  padding: 3px 9px;
  font-size: 0.78rem;
  cursor: pointer;
}
.translate-btn:hover:not(:disabled) { background: var(--tab-active-bg); }
.translate-btn:disabled { opacity: 0.7; cursor: default; }
.translate-btn--active { color: var(--brand); border-color: var(--brand); }
.translate-attribution { font-size: 0.72rem; color: var(--card-muted-text); font-style: italic; }
.translate-error { font-size: 0.78rem; color: var(--alert-error-text); }
</style>
