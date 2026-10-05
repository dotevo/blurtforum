<script setup lang="ts">
import { ref, watch } from 'vue';
import type { AuthUser, Post, Beneficiary } from '../../types';
import type { NotificationItem } from '../notifications/types';
import type { BFPlayerAPI } from '../player/types';
import NotifBell from '../notifications/components/NotifBell.vue';
import UserAvatar from '../../components/layout/UserAvatar.vue';
import SettingsSelectors from '../../components/layout/SettingsSelectors.vue';
import NotificationsList from '../notifications/components/NotificationsList.vue';
import PayoutDetails from '../../components/PayoutDetails.vue';
import { isTVPlatform } from '../native/platform-info';
import { activeProfile, exitProfile } from '../device-profiles/device-profiles';

const props = defineProps<{
  auth: { user: AuthUser | null };
  hasNewNotif: boolean;
  theme: string;
  themes: { id: string; label: string }[];
  lang: string;
  langs: string[];
  rpcMenuOpen: boolean;
  cinemaMode: boolean;
  /** Optional: lets app components (currently just the player, e.g.
   *  Playlists) contribute their own entries into this rail via
   *  player.registerRailItem() -- see modules/player/types.ts. Nothing
   *  else about CinemaRail needs to know what a given item does. */
  player?: BFPlayerAPI;
  t: (k: string) => string;
  notifModal: {
    show: boolean; loading: boolean;
    list: NotificationItem[];
    clickedIds: (number | string)[];
    pushSupported: boolean;
    pushEnabled: boolean;
  };
  timeAgo: (s: string) => string;
  getNotifIcon: (type: string) => string;
  isUnread: (item: NotificationItem) => boolean;
  // Payout details (PayoutModal.vue's forum-mode equivalent) end up here
  // instead of a modal for the same reason notifications do: the video
  // underneath shouldn't get a dialog stacked on top of it just because
  // someone clicked "payout" on the currently-playing track's actions.
  payoutModal: {
    show: boolean;
    post: Partial<Post & { payoutDate?: string }>;
    beneficiaries: Beneficiary[];
  };
  fmtDate: (s: string) => string;
}>();

const emit = defineEmits<{
  goHome: [];
  openLoginModal: [];
  openSwitchAccountModal: [];
  openNotifModal: [];
  openNotification: [notif: NotificationItem];
  openProfile: [username: string];
  openManageProfiles: [];
  logout: [];
  setTheme: [value: string];
  setLang: [value: string];
  'update:rpcMenuOpen': [value: boolean];
  openTranslationSettings: [];
  setCinemaMode: [value: boolean];
  togglePushNotifications: [];
  closePayoutModal: [];
}>();

// Desktop: expand on hover/focus. Mobile: expand via swipe-from-edge, same
// gesture as in the reference mock.
const expanded = ref(false);
const railEl = ref<HTMLElement | null>(null);
let touchStartX: number | null = null;
let touchStartY: number | null = null;
const EDGE_ZONE = 24;
const SWIPE_THRESHOLD = 60;

function onTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}
function onTouchEnd(e: TouchEvent) {
  if (touchStartX === null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = Math.abs(t.clientY - (touchStartY || 0));
  if (dy < 60) {
    if (!expanded.value && touchStartX <= EDGE_ZONE && dx > SWIPE_THRESHOLD) expanded.value = true;
    else if (expanded.value && dx < -SWIPE_THRESHOLD) expanded.value = false;
  }
  touchStartX = null;
  touchStartY = null;
}

// Keyboard/remote (D-pad) support: focus reaching any item inside the rail
// (e.g. CinemaIndex's grid sending focus here on ArrowLeft from the first
// column) expands it exactly like hovering does. Losing focus to something
// outside the rail collapses it again the same way mouseleave does.
function onRailFocusIn(): void { expanded.value = true; }
function onRailFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null;
  if (railEl.value && next && railEl.value.contains(next)) return;
  expanded.value = false;
}

// Notifications open as a panel right here next to the rail -- not a
// modal window -- consistent with the rest of cinema mode's chrome
// (everything lives in panels that expand/collapse, nothing pops a
// centered dialog on top of the video).
//
// Bug this fixes: this used to only flip showNotifPanel, without ever
// calling the composable's real openNotifModal() (== the notifications
// engine's openList()). state.list is ONLY ever populated by that call --
// the background poll (checkNew()) just tracks read/pushed watermarks and
// deliberately never touches state.list -- so the panel rendered with
// nothing in it on the very first open. SiteHeader.vue/MobileTopBar.vue's
// bell already call it correctly; this was the one place that didn't.
const showNotifPanel = ref(false);
function onNotifClick(): void {
  showNotifPanel.value = !showNotifPanel.value;
  if (showNotifPanel.value) emit('openNotifModal');
}
watch(() => props.payoutModal.show, (open) => { if (open) showNotifPanel.value = false; });
</script>

<template>
<div
  class="rail-toggle-btn"
  tabindex="0"
  role="button"
  @click="expanded = !expanded"
  :aria-label="expanded ? 'Close menu' : 'Open menu'"
>
  <i class="fa-solid" :class="expanded ? 'fa-xmark' : 'fa-bars'"></i>
</div>

<div class="cinema-rail-overlay" :class="{ visible: expanded }" @click="expanded = false"></div>

<div
  ref="railEl"
  class="cinema-rail"
  :class="{ expanded }"
  @mouseenter="expanded = true"
  @mouseleave="expanded = false"
  @focusin="onRailFocusIn"
  @focusout="onRailFocusOut"
  @touchstart.passive="onTouchStart"
  @touchend.passive="onTouchEnd"
>
  <div class="rail-logo" tabindex="0" role="button" @click="emit('goHome')">
    <i class="fa-solid fa-clapperboard"></i>
    <span class="rail-label">{{ t('siteTitle') || 'BlurtForum' }}</span>
  </div>

  <nav class="rail-nav">
    <a class="rail-item active" href="#" @click.prevent="emit('goHome')">
      <i class="fa-solid fa-film"></i>
      <span class="rail-label">{{ t('videos') || 'Wideo' }}</span>
    </a>
    <template v-if="player">
      <a v-for="item in player.getRailItems()" :key="item.id"
         v-show="!item.visible || item.visible()" class="rail-item" href="#" @click.prevent="item.onClick()">
        <i :class="item.icon"></i>
        <span class="rail-label">{{ item.label }}</span>
        <span v-if="item.badge && item.badge()" class="rail-badge rail-label">{{ item.badge() }}</span>
      </a>
    </template>
  </nav>

  <div class="rail-spacer"></div>

  <div class="rail-footer">
    <div class="rail-item rail-vp" v-if="auth.user" :title="'Voting Power: ' + auth.user.vp + '%'">
      <i class="fa-solid fa-bolt"></i>
      <div class="rail-vp-info rail-label">
        <span class="rail-vp-value">VP: {{ auth.user.vp }}%</span>
        <div class="rail-vp-track"><div class="rail-vp-fill" :style="{ width: auth.user.vp + '%' }"></div></div>
      </div>
    </div>

    <div class="rail-settings-wrap">
      <SettingsSelectors
        rail
        :theme="theme" :themes="themes" :lang="lang" :langs="langs"
        :cinema-mode="cinemaMode"
        :t="t"
        @set-theme="emit('setTheme', $event)"
        @set-lang="emit('setLang', $event)"
        @open-rpc="emit('update:rpcMenuOpen', true)"
        @open-translation-settings="emit('openTranslationSettings')"
        @set-cinema-mode="emit('setCinemaMode', $event)"
      />
    </div>

    <div class="rail-item" v-if="!auth.user" tabindex="0" role="button" @click="emit('openLoginModal')">
      <i class="fa-solid fa-right-to-bracket"></i>
      <span class="rail-label">{{ t('login') }}</span>
    </div>
    <template v-if="auth.user">
      <div class="rail-item" tabindex="0" role="button" @click="onNotifClick" :class="{ active: showNotifPanel }">
        <NotifBell :has-new="hasNewNotif" size="sm" />
        <span class="rail-label">{{ t('notifications') || 'Powiadomienia' }}</span>
      </div>
      <div class="rail-item" tabindex="0" role="button" @click="emit('openProfile', auth.user.username)">
        <UserAvatar :username="auth.user.username" size="xs" round />
        <span class="rail-label">@{{ auth.user.username }}</span>
      </div>
      <div v-if="!isTVPlatform" class="rail-item" tabindex="0" role="button" @click="emit('openSwitchAccountModal')" :title="t('switchAccount')">
        <i class="fa-solid fa-users-viewfinder"></i>
        <span class="rail-label">{{ t('switchAccount') }}</span>
      </div>
      <div v-if="!isTVPlatform" class="rail-item" tabindex="0" role="button" @click="emit('logout')">
        <i class="fa-solid fa-right-from-bracket"></i>
        <span class="rail-label">{{ t('logout') }}</span>
      </div>
    </template>

    <!-- Device profiles (see modules/device-profiles/) are a completely
         separate mechanism from Blurt login -- available regardless of
         whether a Blurt account happens to be linked/logged in yet, unlike
         the auth.user-gated block above. -->
    <div v-if="isTVPlatform && activeProfile?.isAdmin" class="rail-item" tabindex="0" role="button" @click="emit('openManageProfiles')">
      <i class="fa-solid fa-user-gear"></i>
      <span class="rail-label">{{ t('profileManage') || 'Manage profiles' }}</span>
    </div>
    <div v-if="isTVPlatform" class="rail-item" tabindex="0" role="button" @click="exitProfile">
      <i class="fa-solid fa-shuffle"></i>
      <span class="rail-label">{{ t('profileSwitchProfile') || 'Switch profile' }}</span>
    </div>
  </div>
</div>

<!-- Notifications: a panel anchored next to the rail, not a modal window --
     stays part of cinema mode's own chrome instead of stacking a dialog on
     top of the video. Works the same whether or not anything is playing. -->
<div class="cinema-side-panel-overlay" v-if="showNotifPanel" @click="showNotifPanel = false"></div>
<div class="cinema-side-panel" v-if="showNotifPanel" @keydown.esc="showNotifPanel = false">
  <div class="cinema-side-panel-header">
    <span>{{ t('notifications') || 'Powiadomienia' }}</span>
    <button type="button" class="cinema-side-panel-close" @click="showNotifPanel = false" :aria-label="t('close') || 'Close'">✕</button>
  </div>
  <NotificationsList
    :notif-modal="notifModal"
    :auth="auth"
    :t="t"
    :time-ago="timeAgo"
    :get-notif-icon="getNotifIcon"
    :is-unread="isUnread"
    @open-notification="(n: NotificationItem) => { emit('openNotification', n); showNotifPanel = false; }"
    @open-profile="(u: string) => { emit('openProfile', u); showNotifPanel = false; }"
    @toggle-push-notifications="emit('togglePushNotifications')"
  />
</div>

<!-- Payout details: same reasoning as the notifications panel above. This
     one has no rail icon of its own -- it opens whenever the "payout"
     button in the currently-playing track's actions (bfp-cinema-track-actions,
     see MediaPlayer.vue) is clicked, same trigger as the forum's PayoutModal. -->
<div class="cinema-side-panel-overlay" v-if="payoutModal.show" @click="emit('closePayoutModal')"></div>
<div class="cinema-side-panel" v-if="payoutModal.show" @keydown.esc="emit('closePayoutModal')">
  <div class="cinema-side-panel-header">
    <span>{{ t('payoutDetails') }}</span>
    <button type="button" class="cinema-side-panel-close" @click="emit('closePayoutModal')" :aria-label="t('close') || 'Close'">✕</button>
  </div>
  <div class="cinema-side-panel-body">
    <PayoutDetails
      :payout-modal="payoutModal"
      :t="t"
      :fmt-date="fmtDate"
      @open-profile="(u: string) => { emit('openProfile', u); emit('closePayoutModal'); }"
    />
  </div>
</div>
</template>

<style scoped>
/* The rail's *base* z-index sits below MediaPlayer.vue's .bfp-panel
   (z-index:1000, the fullscreen cinema video view) on purpose: collapsed,
   it should stay out of the way behind the video exactly like a mouse
   pointer can't interact with it either right then. It only needs to come
   forward while actually engaged (hover or keyboard focus already flip
   `expanded` via onRailFocusIn/mouseenter) -- see .cinema-rail.expanded
   below. Side panels (notifications/payout) are a separate, always-on-top
   concern since opening one is an explicit action regardless of whether
   the rail itself is expanded. */
.cinema-rail {
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  width: 72px;
  background: var(--surface-1);
  border-right: 1px solid var(--surface-border);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 16px 0;
  z-index: 200;
  overflow: hidden;
  white-space: nowrap;
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.cinema-rail.expanded {
  width: 230px;
  z-index: 1101;
  box-shadow: 10px 0 30px rgba(0, 0, 0, 0.25);
}

.rail-logo {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0 22px;
  margin-bottom: 30px;
  height: 32px;
  cursor: pointer;
  color: var(--brand);
  font-size: 22px;
}

.rail-nav { width: 100%; }

.rail-spacer { flex-grow: 1; }

.rail-footer {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--surface-border);
  padding-top: 10px;
}

.rail-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 12px 22px;
  color: var(--text-soft);
  text-decoration: none;
  cursor: pointer;
  gap: 16px;
  font-size: 14px;
  font-weight: 500;
}
.rail-item:hover, .rail-item.active { color: var(--brand); background: var(--surface-2); outline: none; }
/* D-pad/keyboard focus needs to look clearly different from hover/active,
   not just the same background tint -- otherwise moving focus through the
   rail with arrow keys is invisible (which item, if any, actually has it?
   hover and "this panel is open" looked identical to "focused"). */
.rail-item:focus-visible, .rail-logo:focus-visible, .rail-toggle-btn:focus-visible {
  color: var(--brand);
  background: var(--surface-2);
  outline: none;
  box-shadow: inset 3px 0 0 var(--brand), 0 0 12px 1px var(--brand);
}
.rail-item i { font-size: 18px; min-width: 20px; text-align: center; }
.rail-badge {
  margin-left: auto;
  background: var(--surface-2);
  color: var(--text-soft);
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
}

.rail-vp { cursor: default; }
.rail-vp:hover { background: transparent; color: var(--text-soft); }
.rail-vp-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.rail-vp-value { font-size: 12px; font-weight: 700; color: var(--text-strong); }
.rail-vp-track { width: 100%; height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.rail-vp-fill { height: 100%; background: var(--brand); border-radius: 2px; }

.rail-label {
  opacity: 0;
  transition: opacity 0.2s;
}
.cinema-rail.expanded .rail-label { opacity: 1; }

.rail-settings {
  padding: 6px 14px 10px;
}
.rail-settings-wrap {
  width: 100%;
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transition: opacity 0.15s;
}
.cinema-rail.expanded .rail-settings-wrap {
  opacity: 1;
  max-height: 300px;
  overflow: visible;
}

.rail-toggle-btn {
  display: none;
}

.cinema-rail-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
}
.cinema-rail-overlay.visible {
  opacity: 1;
  pointer-events: auto;
}

/* Notifications panel -- anchored right next to the rail, above it, not a
   centered modal dialog. Same overlay-to-dismiss convention as the rail's
   own mobile drawer. */
.cinema-side-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 1102;
  background: rgba(0,0,0,0.4);
}
.cinema-side-panel {
  position: fixed;
  top: 0;
  left: 72px;
  height: 100vh;
  width: 340px;
  max-width: calc(100vw - 72px);
  background: var(--surface-1);
  border-right: 1px solid var(--surface-border);
  box-shadow: 10px 0 30px rgba(0,0,0,0.35);
  z-index: 1103;
  display: flex;
  flex-direction: column;
}
.cinema-side-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--surface-border);
  font-weight: bold;
  color: var(--text-strong);
  flex-shrink: 0;
}
.cinema-side-panel-close {
  background: none;
  border: none;
  color: var(--text-soft);
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}
.cinema-side-panel-close:hover, .cinema-side-panel-close:focus-visible { color: var(--brand); background: var(--surface-2); outline: none; }
.cinema-side-panel-body { flex: 1; overflow-y: auto; padding: 16px; }
@media (max-width: 768px) {
  .cinema-side-panel { left: 0; width: 100vw; max-width: 100vw; }
}
/* On desktop the rail only ever grows in place (no overlay needed behind it,
   matches the mock where hover-expand doesn't blur the page) -- the blur
   overlay is a mobile-only affordance for the swipe-open drawer. */
@media (min-width: 769px) {
  .cinema-rail-overlay { display: none; }
}

@media (max-width: 768px) {
  .rail-toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    position: fixed;
    top: 14px;
    left: 14px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(4px);
    color: #fff;
    font-size: 16px;
    z-index: 1104;
    cursor: pointer;
  }
  .cinema-rail { transform: translateX(-100%); transition: transform 0.28s cubic-bezier(0.4,0,0.2,1); width: 230px; }
  .cinema-rail.expanded { transform: translateX(0); width: 230px; box-shadow: 10px 0 30px rgba(0,0,0,0.35); }
  .cinema-rail:not(.expanded) .rail-label { opacity: 0; }
  .cinema-rail.expanded .rail-label { opacity: 1; }
}
</style>
