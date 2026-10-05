<script setup lang="ts">
import type { ActivityItem, AuthUser } from '../../types';
import NotifBell from '../../modules/notifications/components/NotifBell.vue';
import UserAvatar from './UserAvatar.vue';
import ActivityFeed from './ActivityFeed.vue';
import LangBar from './LangBar.vue';

// public/favicon.svg is a Vite "public dir" asset: it must be referenced
// by a root-relative runtime string, never imported/resolved at build
// time. import.meta.env.BASE_URL (= Vite's `base` config, "./" here)
// keeps this correct under both the root domain (forum.blurt.pl) and a
// GitHub Pages *project* subpath like /blurtforum_test/ — a literal
// src="/favicon.svg" only works at a domain root, and a literal
// src="./favicon.svg" fails the production build outright (Vite tries to
// import it as a module). Has to be a dynamic :src binding, not a static
// src=, for the same reason.
const faviconSrc = `${import.meta.env.BASE_URL}favicon.svg`;

const props = defineProps<{
  auth: { user: AuthUser | null };
  globalActivity: ActivityItem[];
  activityTab: string;
  expanded: boolean;
  t: (k: string) => string;
  timeAgo: (s: string) => string;
  hasNewNotif: boolean;
  vp: string;
  theme: string;
  themes: Array<{ id: string; label: string }>;
  lang: string;
  langs: string[];
  rpcMenuOpen: boolean;
  communityAccount: string;
  cinemaMode: boolean;
}>();

const emit = defineEmits<{
  'update:expanded': [value: boolean];
  'update:activityTab': [value: string];
  'update:rpcMenuOpen': [value: boolean];
  openTranslationSettings: [];
  openActivity: [act: ActivityItem];
  openLoginModal: [];
  openNotifModal: [];
  openProfile: [username: string];
  goHome: [];
  setTheme: [theme: string];
  setLang: [lang: string];
  setCinemaMode: [value: boolean];
  logout: [];
  openSwitchAccountModal: [];
}>();

const getLatestActivities = () => {
  return props.globalActivity
    .filter(a => !a.isRead)
    .slice(0, 3);
};
</script>

<template>
  <div class="mobile-top-bar" :class="{ 'is-expanded': expanded }">
    <!-- TOP LINE: Logo, User, Notifs -->
    <div class="mtb-main">
      <a :href="'?community=' + communityAccount" class="mtb-logo" @click.prevent="emit('goHome')" style="text-decoration: none; display: block;">
        <img :src="faviconSrc" alt="" class="mtb-logo-icon" />
      </a>

      <div class="mtb-ticker" v-if="!expanded" @click="emit('update:expanded', true)">
        <div class="ticker-content-stack" v-if="getLatestActivities().length > 0">
          <div v-for="act in getLatestActivities()" :key="act.id" class="ticker-item">
            <i class="fa-solid fa-bolt"></i>
            <span class="ticker-text">@{{ act.author }}: {{ act.title || act.community_title }}</span>
          </div>
        </div>
        <div v-else class="ticker-content">
          <span class="ticker-text">{{ t('globalActivity') }}</span>
        </div>
      </div>

      <div class="mtb-actions">
        <template v-if="auth.user">
          <div class="mtb-vp" @click="emit('openProfile', auth.user.username)">
            <i class="fa-solid fa-battery-three-quarters"></i> {{ vp }}%
          </div>
          <NotifBell :has-new="hasNewNotif" size="md" @click="emit('openNotifModal')" />
          <UserAvatar :username="auth.user.username" size="xs" round @click="emit('openProfile', auth.user.username)" 
                      style="width: 28px; height: 28px; border: 1px solid var(--surface-border);" />
        </template>
        <template v-else>
          <button class="btn btn-xs btn-primary" @click="emit('openLoginModal')">{{ t('login') }}</button>
        </template>
        
        <div class="mtb-toggle" @click="emit('update:expanded', !expanded)">
          <i class="fa-solid" :class="expanded ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
        </div>
      </div>
    </div>

    <!-- EXPANDED DRAWER: Global Activity -->
    <div class="mtb-drawer" v-if="expanded">
      <!-- SETTINGS ROW -->
      <div class="drawer-settings">
        <LangBar
          class="mtb-lang-bar"
          mobile
          :theme="theme"
          :themes="themes"
          :lang="lang"
          :langs="langs"
          :t="t"
          :rpc-menu-open="rpcMenuOpen"
          :cinemaMode="cinemaMode"
          @set-theme="emit('setTheme', $event)"
          @set-lang="emit('setLang', $event)"
          @update:rpc-menu-open="emit('update:rpcMenuOpen', $event)"
          @open-translation-settings="emit('openTranslationSettings')"
          @set-cinema-mode="emit('setCinemaMode', $event)"
        />
        <div class="mtb-auth-actions" v-if="auth.user">
          <button class="btn-hdr" @click="emit('openSwitchAccountModal')" :title="t('switchAccount')">
            <i class="fa-solid fa-users-viewfinder"></i>
          </button>
          <button class="btn-hdr logout-btn" @click="emit('logout')" :title="t('logout')">
            <i class="fa-solid fa-right-from-bracket"></i>
          </button>
        </div>
      </div>

      <div class="drawer-header">
        <ActivityFeed
          mobile
          :global-activity="globalActivity"
          :activity-tab="activityTab"
          :t="t"
          :time-ago="timeAgo"
          @update:activity-tab="emit('update:activityTab', $event)"
          @open-activity="emit('openActivity', $event)"
        />
      </div>
      <div class="drawer-footer" @click="emit('update:expanded', false)">
        {{ t('close') }} <i class="fa-solid fa-chevron-up"></i>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mobile-top-bar {
  position: sticky;
  top: 0;
  z-index: 1000;
  background: var(--surface-nav);
  border-bottom: 2px solid var(--brand);
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  display: flex;
  flex-direction: column;
}

.mtb-main {
  min-height: 50px;
  display: flex;
  align-items: center;
  padding: 5px 10px;
  gap: 10px;
}

.mtb-logo {
  background: #f2f2f2;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  padding: 4px;
  box-sizing: border-box;
}
.mtb-logo-icon { width: 100%; height: 100%; display: block; object-fit: contain; }

.mtb-ticker {
  flex: 1;
  min-width: 0;
  background: rgba(0,0,0,0.05);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  overflow: hidden;
}

.ticker-content-stack {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
}

.ticker-item {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}

.ticker-item i { font-size: 8px; color: var(--accent); opacity: 0.8; }
.ticker-text {
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-strong);
  line-height: 1.2;
}

.mtb-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto; /* Push to right when ticker is hidden */
}

.mtb-vp {
  font-size: 11px;
  font-weight: bold;
  color: var(--brand);
  white-space: nowrap;
}

.mtb-toggle {
  color: var(--brand);
  width: 20px;
  text-align: center;
  cursor: pointer;
}

/* Drawer Styles */
.mtb-drawer {
  background: var(--surface-1);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.drawer-settings {
  display: flex;
  background: var(--surface-2);
  border-bottom: 1px solid var(--surface-border);
  padding: 8px 10px;
}

.mtb-lang-bar {
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  flex: 1;
  min-width: 0; /* let this actually shrink / let its own ScrollableTabs scroll internally, instead of refusing to shrink below its content's natural width (flex items default to min-width:auto) and pushing .mtb-auth-actions off-screen */
}

.mtb-auth-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 10px;
  border-left: 1px solid var(--surface-border);
  margin-left: 5px;
  flex-shrink: 0; /* never lose space to .mtb-lang-bar -- logout must always stay reachable */
}

.btn-hdr {
  background: var(--input-bg);
  color: var(--text-strong);
  border: 1px solid var(--input-border);
  padding: 5px 10px;
  font-size: 14px;
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.logout-btn:hover {
  color: #ff4400;
  border-color: #ff4400;
}

.drawer-header {
  padding: 8px 10px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--surface-border);
}

.drawer-footer {
  padding: 10px;
  text-align: center;
  background: var(--surface-3);
  font-size: 11px;
  font-weight: bold;
  color: var(--brand);
  border-top: 1px solid var(--surface-border);
  cursor: pointer;
}
</style>
