<script setup lang="ts">
import type { ActivityItem, AuthUser } from '../../types';
import NotifBell from './NotifBell.vue';
import UserAvatar from './UserAvatar.vue';
import ActivityFeed from './ActivityFeed.vue';
import LangBar from './LangBar.vue';
import { computed } from 'vue';

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
}>();

const emit = defineEmits<{
  'update:expanded': [value: boolean];
  'update:activityTab': [value: string];
  'update:rpcMenuOpen': [value: boolean];
  openActivity: [act: ActivityItem];
  openLoginModal: [];
  openNotifModal: [];
  openProfile: [username: string];
  goHome: [];
  setTheme: [theme: string];
  setLang: [lang: string];
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
      <div class="mtb-logo" @click="emit('goHome')">
        <span class="logo-text">B<span>F</span></span>
      </div>

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
                      style="width: 28px; height: 28px; border: 1px solid var(--border-main);" />
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
          :theme="theme"
          :themes="themes"
          :lang="lang"
          :langs="langs"
          :t="t"
          :rpc-menu-open="rpcMenuOpen"
          @set-theme="emit('setTheme', $event)"
          @set-lang="emit('setLang', $event)"
          @update:rpc-menu-open="emit('update:rpcMenuOpen', $event)"
        />
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
  background: var(--nav-bg);
  border-bottom: 2px solid var(--primary);
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
  background: var(--primary);
  color: var(--accent);
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-weight: bold;
  font-size: 16px;
  flex-shrink: 0;
}
.mtb-logo span { color: #fff; }

.mtb-ticker {
  flex: 1;
  min-width: 0;
  background: rgba(0,0,0,0.05);
  border-radius: 8px;
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
  color: var(--text);
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
  color: var(--primary);
  white-space: nowrap;
}

.mtb-toggle {
  color: var(--primary);
  width: 20px;
  text-align: center;
  cursor: pointer;
}

/* Drawer Styles */
.mtb-drawer {
  background: var(--bg-white);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.drawer-settings {
  display: flex;
  background: var(--bg-r1);
  border-bottom: 1px solid var(--border-main);
  padding: 8px 10px;
}

.mtb-lang-bar {
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  width: 100%;
}

.drawer-header {
  padding: 8px 10px;
  background: var(--bg-white);
  border-bottom: 1px solid var(--border-main);
}

.drawer-footer {
  padding: 10px;
  text-align: center;
  background: var(--bg-r2);
  font-size: 11px;
  font-weight: bold;
  color: var(--primary);
  border-top: 1px solid var(--border-main);
  cursor: pointer;
}
</style>
