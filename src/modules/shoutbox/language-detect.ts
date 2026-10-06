/**
 * modules/shoutbox/language-detect.ts
 *
 * Deliberately NOT a real language-identification library (no AI model,
 * no network call, nothing added to the bundle) — just a cheap heuristic
 * strong enough to answer one narrow question: "is this text ALREADY in
 * roughly this target language?", so the auto-translate-on-open feature
 * (see useTranslation.ts / translation-prefs.ts's `autoShow`) can skip
 * posts that are already in the reader's chosen language instead of
 * machine-translating Polish into Polish.
 *
 * False negatives (missing a real match, so the post gets translated once
 * more than strictly needed) are fine — that's exactly today's behavior,
 * so nothing regresses. False positives (wrongly skipping a genuine
 * foreign-language post) are the one thing worth guarding against, so
 * this only ever answers "yes" when reasonably confident; the manual
 * "Translate" button is never hidden by this, only the automatic trigger
 * is — someone can always force a translation themselves if the guess
 * was wrong.
 */

// Non-Latin scripts: the Unicode block alone is enough to settle this.
// Several target languages can share a script (Cyrillic covers
// ru/uk/bg/sr here) — a hit just means "already one of that script's
// languages", which is the right call either way: there's no point
// machine-translating Russian text just because the exact Slavic variant
// can't be pinned down any further than that.
const SCRIPT_GROUPS: Array<{ re: RegExp; langs: string[] }> = [
  { re: /[Ѐ-ӿ]/, langs: ['ru', 'uk', 'bg', 'sr'] },
  { re: /[؀-ۿ]/, langs: ['ar'] },
  { re: /[一-鿿]/, langs: ['zh'] },
  { re: /[぀-ヿ]/, langs: ['ja'] },
  { re: /[가-힯]/, langs: ['ko'] },
  { re: /[ऀ-ॿ]/, langs: ['hi'] },
  { re: /[฀-๿]/, langs: ['th'] },
  { re: /[Ͱ-Ͽ]/, langs: ['el'] },
  { re: /[֐-׿]/, langs: ['he'] },
];

// Latin-script languages: a short bag of very common, mostly function
// words (articles, conjunctions, pronouns) per language — the kind of
// token that shows up constantly no matter the topic, which is what
// makes even this cheap a detector usable at all.
const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'are', 'was', 'were', 'this', 'that', 'with', 'for', 'you', 'have', 'but', 'not', 'from', 'your'],
  pl: ['jest', 'oraz', 'się', 'nie', 'tak', 'jak', 'dla', 'ale', 'czy', 'może', 'tego', 'które', 'przez', 'tylko', 'bardzo', 'jestem'],
  de: ['und', 'der', 'die', 'das', 'ist', 'nicht', 'mit', 'für', 'auch', 'eine', 'wir', 'auf', 'sich', 'sind', 'werden'],
  fr: ['le', 'la', 'les', 'est', 'pas', 'pour', 'avec', 'que', 'vous', 'nous', 'dans', 'une', 'un', 'des', 'sont'],
  es: ['el', 'los', 'las', 'que', 'para', 'con', 'una', 'por', 'pero', 'como', 'esta', 'muy', 'son', 'están'],
  pt: ['que', 'para', 'com', 'uma', 'não', 'isso', 'mais', 'muito', 'como', 'você', 'são', 'está'],
  it: ['che', 'per', 'con', 'una', 'sono', 'questo', 'molto', 'anche', 'non', 'sei'],
  nl: ['de', 'het', 'een', 'niet', 'voor', 'met', 'dat', 'deze', 'maar', 'zijn', 'ook'],
  ro: ['și', 'pentru', 'este', 'acest', 'dar', 'sau', 'care', 'foarte', 'mai'],
  cs: ['je', 'pro', 'ale', 'jako', 'toto', 'velmi', 'který', 'jsou', 'nebo'],
  sk: ['je', 'pre', 'ale', 'ako', 'toto', 'veľmi', 'ktorý', 'sú', 'alebo'],
  hu: ['és', 'nem', 'hogy', 'ezt', 'nagyon', 'vagy', 'amely', 'van'],
  sv: ['och', 'är', 'för', 'inte', 'med', 'detta', 'mycket', 'som', 'den'],
  fi: ['ja', 'on', 'ei', 'tämä', 'erittäin', 'kuin', 'mutta', 'myös'],
  hr: ['je', 'za', 'ali', 'kao', 'ovo', 'vrlo', 'koji', 'ili'],
  tr: ['ve', 'bir', 'bu', 'çok', 'için', 'ama', 'gibi', 'değil'],
  id: ['dan', 'yang', 'untuk', 'ini', 'sangat', 'tetapi', 'adalah'],
  vi: ['và', 'là', 'cho', 'này', 'rất', 'nhưng', 'của'],
  eo: ['kaj', 'estas', 'por', 'tio', 'tre', 'sed', 'ankaŭ'],
};

const MIN_WORDS = 10; // below this there isn't enough signal to trust any guess at all
const MIN_SCORE = 3; // raw stopword hits the best-matching language needs to reach
const MIN_MARGIN = 2; // ...and needs to beat the runner-up language by, to call it confident

/** Best-effort "is `text` already written in `targetLang`?" — see this
 *  file's header comment for the trade-offs. Always errs toward `false`
 *  (i.e. "go ahead and translate, same as before") whenever the signal is
 *  too thin to be confident either way. */
export function isLikelySameLanguage(text: string, targetLang: string): boolean {
  const sample = text.slice(0, 4000);

  for (const { re, langs } of SCRIPT_GROUPS) {
    if (re.test(sample)) return langs.includes(targetLang);
  }

  const targetWords = STOPWORDS[targetLang];
  if (!targetWords) return false; // no stopword data for this target -- don't guess

  const words = sample.toLowerCase().match(/[a-zà-öø-ÿąćęłńóśźżñçşğıİâêîôûëïüěščřůöžâăîâşţ]+/g) ?? [];
  if (words.length < MIN_WORDS) return false;

  let best = -1; let bestLang = ''; let second = -1;
  for (const [lang, stops] of Object.entries(STOPWORDS)) {
    const stopSet = new Set(stops);
    let score = 0;
    for (const w of words) if (stopSet.has(w)) score++;
    if (score > best) { second = best; best = score; bestLang = lang; }
    else if (score > second) { second = score; }
  }

  return bestLang === targetLang && best >= MIN_SCORE && best - second >= MIN_MARGIN;
}
