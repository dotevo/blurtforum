/**
 * BlurtForum i18n translations
 */

export type Lang = 'en' | 'pl' | 'eo';

export type Translations = Record<string, string>;

import { TR_RAW as _TR_RAW } from './translations.raw';

// Cast to allow string indexing at runtime (keys are not all statically known)
export const TR = _TR_RAW as Record<Lang, Record<string, string>>;

export const LANGS: Lang[] = ['en', 'pl', 'eo'];
