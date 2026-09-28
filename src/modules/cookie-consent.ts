import { ref } from 'vue';

/**
 * modules/cookie-consent.ts
 *
 * Real compliance gap this fixes: index.html used to load Google Analytics
 * (gtag.js, measurement ID G-66P34PGTQF) unconditionally in <head>, on every
 * single page load, before the user had made -- or even been asked to make
 * -- any choice about it. GA sets its own cookies (_ga/_ga_*) purely for
 * tracking, which under EU ePrivacy/GDPR rules needs prior opt-in consent,
 * not just a policy page nobody's forced to read. There was no consent
 * banner and no privacy policy anywhere in the app at all.
 *
 * Fix has three parts:
 *   1. The static gtag <script> tags are gone from index.html. Nothing
 *      Analytics-related loads until loadGoogleAnalytics() below is called.
 *   2. This module tracks the user's choice (localStorage, not a cookie --
 *      remembering "the user already answered the consent question" is
 *      itself strictly necessary storage, which is why it's fine to persist
 *      before any consent decision exists; nothing here is a tracking
 *      cookie).
 *   3. CookieConsentBanner.vue shows on first visit (or whenever consent is
 *      null) and calls acceptCookies()/rejectCookies() below, which is the
 *      ONLY path that ever calls loadGoogleAnalytics(). Rejecting, or just
 *      never answering, means GA plain never loads -- analytics.ts's own
 *      calls already no-op safely when `window.gtag` doesn't exist, so
 *      nothing else needed to change there.
 *
 * There's no real "unload GA mid-session" story once it's been injected
 * (matches how basically every cookie-consent implementation on the web
 * actually works) -- withdrawing consent via resetConsent() takes effect
 * from the NEXT page load, which is what re-showing the banner and pointing
 * this out to the user is for.
 */

const CONSENT_KEY = 'bf-cookie-consent';
const GA_MEASUREMENT_ID = 'G-66P34PGTQF';

export type ConsentState = 'accepted' | 'rejected' | null;

const readStored = (): ConsentState => {
  const v = localStorage.getItem(CONSENT_KEY);
  return v === 'accepted' || v === 'rejected' ? v : null;
};

export const consent = ref<ConsentState>(readStored());

let gaLoaded = false;

function loadGoogleAnalytics(): void {
  if (gaLoaded) return;
  gaLoaded = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  (window as any).dataLayer = (window as any).dataLayer || [];
  // MUST push the `arguments` object, not an array. gtag.js only recognises
  // gtag() commands when the queued item is an Arguments object; a plain
  // Array (which is what `function gtag(...args) { dataLayer.push(args) }`
  // pushes) is treated as an ordinary GTM-style dataLayer push and the
  // command is silently ignored - no error, no network hit. That is what
  // broke analytics after the cookie banner moved this snippet out of
  // index.html (the original inline snippet used push(arguments)). Both
  // shapes look identical under JSON.stringify(dataLayer), which is why it
  // was easy to miss when inspecting the queue in the console.
  //
  // (An earlier version of this comment blamed a gtag('consent', 'default')
  // call instead. That diagnosis was wrong: the consent call is left out
  // below, but it was never shown to be the cause. It is also unnecessary:
  // loadGoogleAnalytics() only ever runs after the user has accepted, so
  // there is no pre-consent window for a consent signal to gate.)
  (window as any).gtag = function gtag() { (window as any).dataLayer.push(arguments); };

  (window as any).gtag('js', new Date());
  (window as any).gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });
}

/** Call once at app boot. If the user already accepted in a previous
 *  session, loads GA immediately; otherwise leaves it unloaded until (and
 *  unless) acceptCookies() is called this session. */
export function initConsent(): void {
  if (consent.value === 'accepted') loadGoogleAnalytics();
}

export function acceptCookies(): void {
  consent.value = 'accepted';
  localStorage.setItem(CONSENT_KEY, 'accepted');
  loadGoogleAnalytics();
}

export function rejectCookies(): void {
  consent.value = 'rejected';
  localStorage.setItem(CONSENT_KEY, 'rejected');
}

/** Used by the "cookie settings" footer link to let the user reopen the
 *  banner and change their mind. Doesn't unload GA if it's already running
 *  this session (see top-of-file comment) -- it takes effect on reload,
 *  same as rejecting fresh would have if the accept had never happened. */
export function resetConsent(): void {
  consent.value = null;
  localStorage.removeItem(CONSENT_KEY);
}
