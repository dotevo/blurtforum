/**
 * BlurtForum i18n translations - Dynamic Loading
 */
import { reactive } from 'vue';

export type Lang = 'en' | 'pl' | 'eo';
export const LANGS: Lang[] = ['en', 'pl', 'eo'];

// Reactive object to hold current translations
export const TR = reactive<Record<string, string>>({});

/**
 * Loads a language JSON file from the public directory.
 * Returns true if successful.
 */
export async function loadLanguage(lang: Lang): Promise<boolean> {
  try {
    const response = await fetch(`locales/${lang}.json`);
    if (!response.ok) throw new Error(`Failed to load locale: ${lang}`);
    
    const data = await response.json();
    
    // Clear current translations and merge new ones
    Object.keys(TR).forEach(key => delete TR[key]);
    Object.assign(TR, data);
    
    return true;
  } catch (err) {
    console.error('Translation load error:', err);
    return false;
  }
}
