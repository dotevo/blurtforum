/**
 * modules/shoutbox/translation-languages.ts
 *
 * Target-language list for the translation feature — deliberately NOT
 * tied to the app's own UI-locale list (public/locales/*.json has 6
 * entries; this has ~30). The UI you read the forum in and the language
 * you want OTHER people's posts translated into are different
 * questions — someone reading the UI in Polish might still want posts
 * translated into English, or vice versa.
 */
export interface TranslationLanguage {
  code: string;
  name: string;
}

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'en', name: 'English' },
  { code: 'pl', name: 'Polski' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'eo', name: 'Esperanto' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ar', name: 'العربية' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
  { code: 'cs', name: 'Čeština' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'ro', name: 'Română' },
  { code: 'hu', name: 'Magyar' },
  { code: 'sv', name: 'Svenska' },
  { code: 'fi', name: 'Suomi' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'he', name: 'עברית' },
  { code: 'bg', name: 'Български' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'sr', name: 'Српски' },
];

export function translationLanguageName(code: string): string {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
