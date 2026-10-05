import { reactive, watch } from 'vue';
import type { TranslationEngine } from './translation-providers';

/**
 * modules/shoutbox/translation-prefs.ts
 *
 * User-level settings for the translation feature — reactive + persisted
 * to localStorage (these are small flags/strings, not translation
 * bodies, so they belong in localStorage rather than the IndexedDB cache
 * in translation-store.ts; see that file's header comment for why the
 * two are split).
 *
 * `enabled` defaults to false: this is an opt-in feature (not every
 * reader wants machine-translated text injected into posts they can
 * already read), and the per-post UI (TranslatedToggle.vue) stays
 * entirely invisible while it's off.
 */

const STORAGE_KEY = 'bf-translation-prefs-v1';

export interface TranslationPrefs {
  enabled: boolean;
  targetLang: string;
  engine: TranslationEngine;
  /** When true, a cached/fetched translation is shown immediately
   *  (X/Twitter-style, with a "show original" toggle) instead of
   *  requiring a click on the translate icon first. */
  autoShow: boolean;
}

function detectDefaultLang(): string {
  try {
    const savedUiLang = localStorage.getItem('bf-lang');
    if (savedUiLang) return savedUiLang;
  } catch { /* ignore */ }
  return (navigator.language || 'en').slice(0, 2).toLowerCase();
}

function loadPrefs(): TranslationPrefs {
  const defaults: TranslationPrefs = { enabled: false, targetLang: detectDefaultLang(), engine: 'mymemory', autoShow: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaults.enabled,
      targetLang: typeof parsed.targetLang === 'string' ? parsed.targetLang : defaults.targetLang,
      engine: parsed.engine === 'google' ? 'google' : 'mymemory',
      autoShow: typeof parsed.autoShow === 'boolean' ? parsed.autoShow : defaults.autoShow,
    };
  } catch {
    return defaults;
  }
}

export const translationPrefs = reactive<TranslationPrefs>(loadPrefs());

watch(
  translationPrefs,
  (p) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* non-fatal — same trade-off as every other prefs store in this app */ }
  },
  { deep: true }
);
