<script setup lang="ts">
/**
 * components/CookieConsentBanner.vue
 *
 * Shown whenever cookie-consent.ts's `consent` is null (no decision made
 * yet this browser) -- see App.vue's `v-if="!cinemaMode && !cookieConsent"`.
 * Purely a thin UI shell around modules/cookie-consent.ts, which owns all
 * the actual state/persistence/GA-loading logic -- see that file's own
 * top-of-file comment for the full story of what this is fixing.
 *
 * Position: self-registers in the shared floating-bottom-layer stack (see
 * modules/floating-stack.ts) as order 20 -- above the player and the
 * blockchain wait-queue bar (order 10, see App.vue), below ShoutboxWidget's
 * chat dock (order 30, topmost -- chat sits above everything else by
 * design), so all three compose predictably instead of each guessing
 * independently. `bottom` is a REAL ResizeObserver measurement of this
 * component's own root element, not a guessed constant -- this banner's
 * own history is two separate bugs from guessed constants (an unbounded
 * one that chased the player's expanded height, then a capped-but-still-
 * guessed 160px) before landing here; measuring the actual rendered height
 * makes that whole class of bug impossible going forward, including for
 * whatever this banner's content ends up being in a future translation
 * or copy change. `visible: () => true` because this component is only
 * ever mounted while it should be showing (v-if in App.vue), same
 * reasoning as ShoutboxWidget's own always-true registration. Cinema mode
 * isn't handled here at all because this component is never shown during
 * it (see the `!cinemaMode` in App.vue's v-if) -- there's no cinema-
 * specific "corner chip" variant for this the way .bc-queue-panel has one,
 * since a cookie-consent decision isn't the kind of thing that needs to
 * interrupt someone mid-video the way a blockchain-sync status does.
 */
import { ref } from 'vue';
import { useFloatingLayer } from '../modules/floating-stack';

defineProps<{ t: (k: string) => string }>();
const emit = defineEmits<{ accept: []; reject: []; 'open-privacy': [] }>();

const el = ref<HTMLElement | null>(null);
const bottom = useFloatingLayer(el, { id: 'cookie-banner', order: 20, visible: () => true });
</script>

<template>
  <div ref="el" class="ccb-banner" role="dialog" :aria-label="t('cookieBannerAriaLabel') || 'Cookie consent'" aria-live="polite" :style="{ bottom: bottom + 'px' }">
    <div class="ccb-inner">
      <p class="ccb-text">
        {{ t('cookieBannerText') || 'We use cookies for essential site functionality and, only with your consent, for analytics (Google Analytics). See our' }}
        <a href="#" @click.stop.prevent="emit('open-privacy')">{{ t('privacyPolicy') || 'privacy policy' }}</a>.
      </p>
      <div class="ccb-actions">
        <button class="btn btn-sm ccb-reject" @click="emit('reject')">{{ t('cookieBannerReject') || 'Reject non-essential' }}</button>
        <button class="btn btn-sm ccb-accept" @click="emit('accept')">{{ t('cookieBannerAccept') || 'Accept' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ccb-banner {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 10000;
  background: var(--surface-1, #1c2129);
  color: var(--text-strong, #eee);
  border-top: 1px solid var(--surface-border, rgba(255,255,255,0.12));
  box-shadow: 0 -3px 12px rgba(0,0,0,0.3);
  padding: 12px 16px;
  transition: bottom 0.3s ease-in-out;
  /* Defensive cap only -- normal height comes from real content now (see
     the ResizeObserver-backed `bottom` above), this just guards against
     something truly unexpected (e.g. a very long future translation)
     rather than being load-bearing for the common case the way it used to
     be when height was a guessed constant. Scrolls internally rather than
     growing past this. */
  max-height: 40vh;
  overflow-y: auto;
}
.ccb-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ccb-text {
  flex: 1 1 320px;
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}
.ccb-text a { text-decoration: underline; }
.ccb-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}
.ccb-accept {
  background: var(--brand, #d3a341);
  color: #1a1206;
  border: none;
  font-weight: 600;
}
.ccb-reject {
  background: transparent;
  border: 1px solid var(--surface-border, rgba(255,255,255,0.3));
  color: inherit;
}
@media (max-width: 600px) {
  .ccb-inner { flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 10px; }
  /* .ccb-text's base-rule `flex: 1 1 320px` sets flex-basis: 320px, which
     is only sane as a WIDTH hint for the desktop row layout above --
     flex-basis follows whichever axis is "main" for the container, and
     flex-direction:column here flips that to vertical. Left un-reset, the
     text block was getting a 320px-tall basis (plus flex-grow:1 letting it
     grow taller still) instead of just sizing to its actual ~2-3 lines of
     content -- this, not the justify-content miss fixed earlier, was the
     real cause of the banner looking huge on mobile. `flex: 0 1 auto`
     here means: don't grow, can shrink, size to content -- full width
     still comes from `align-items: stretch` above. */
  .ccb-text { flex: 0 1 auto; }
  .ccb-actions { justify-content: stretch; }
  .ccb-actions button { flex: 1; }
}
</style>
