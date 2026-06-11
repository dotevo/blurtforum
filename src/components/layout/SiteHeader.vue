<script setup lang="ts">
import type { AuthUser } from '../../types';
import NotifBell from './NotifBell.vue';
import UserAvatar from './UserAvatar.vue';

defineProps<{
  communityTitle: string;
  communityAccount: string;
  headBlockNumber: number | string;
  auth: { user: AuthUser | null };
  hasNewNotif: boolean;
  notifLoading: boolean;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  goHome: [];
  openLoginModal: [];
  openNotifModal: [];
  openProfile: [username: string];
  openSwitchAccountModal: [];
  logout: [];
}>();
</script>

<template>
<!-- HEADER -->
<div class="site-header">
  <div class="header-inner">
    <div class="logo" @click="emit('goHome')">
      <div class="logo-title">Blurt<em>Forum</em></div>
      <div class="logo-sub">BLOCKCHAIN-POWERED COMMUNITY PLATFORM • BLURT NETWORK</div>
      <div class="active-community-badge">
        🏛️ {{ communityTitle || communityAccount }}
      </div>
    </div>
    <div class="header-right">
      <div class="block-status hide-tablet">
        ONLINE | BLOCK: #{{ headBlockNumber || '…' }}
      </div>
      <div class="user-bar" v-if="!auth.user">
        <span>{{ t('notLoggedIn') }}</span>
        <button class="btn-hdr" @click="emit('openLoginModal')">{{ t('login') }}</button>
        <a href="https://blurt.pl" target="_blank" class="btn btn-sm btn-hdr" style="text-decoration:none; margin-left:5px; background:var(--bg-r3); color:var(--text);">
          <i class="fa-solid fa-user-plus"></i> {{ t('register') }}
        </a>
      </div>
      <div class="user-bar" v-else>
        <div class="header-vp-bar" @click="emit('openProfile', auth.user.username)" :title="'Voting Power: ' + auth.user.vp + '%'">
           <div class="vp-label"><i class="fa-solid fa-battery-three-quarters"></i> {{ auth.user.vp }}%</div>
           <div class="vp-track">
             <div class="vp-fill" :style="{ width: auth.user.vp + '%' }"></div>
           </div>
        </div>

        <NotifBell :has-new="hasNewNotif" :loading="notifLoading" size="md" @click="emit('openNotifModal')" style="margin: 0 15px;" />

        <div class="header-user-info" @click="emit('openProfile', auth.user.username)">
          <div class="header-user-text">
            <span class="gs" style="font-size: 9px; display: block;">{{ t('loggedInAs') }}</span>
            <b class="interactive-username">@{{ auth.user.username }}</b>
          </div>
          <UserAvatar :username="auth.user.username" size="xs" round style="border: 1px solid var(--primary);" />
        </div>

        <button class="btn-hdr" @click="emit('openSwitchAccountModal')" :title="t('switchAccount')" style="margin-left: 5px;"><i class="fa-solid fa-users-viewfinder"></i></button>
        <button class="btn-hdr logout-btn" @click="emit('logout')" :title="t('logout')"><i class="fa-solid fa-right-from-bracket"></i></button>
      </div>
    </div>
  </div>
</div>
</template>

<style scoped>
.site-header {
  background: var(--bg-white);
  padding: 20px;
  border-bottom: 1px solid var(--border-main);
}
.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.logo { cursor: pointer; }
.logo-title {
  font-family: 'Trebuchet MS', sans-serif;
  font-size: 32px;
  font-weight: bold;
  color: var(--text);
}
.logo-title em { color: var(--primary); font-style: normal; }
.logo-sub {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 5px;
}
.active-community-badge {
  display: inline-block !important;
  margin-top: 15px !important;
  background: var(--primary) !important;
  color: var(--accent) !important;
  padding: 10px 25px !important;
  border-radius: 8px !important;
  font-weight: bold !important;
  font-size: 44px !important;
  box-shadow: 0 6px 16px rgba(0,0,0,0.3) !important;
  font-family: 'Trebuchet MS', sans-serif !important;
  text-transform: uppercase !important;
  letter-spacing: 2px !important;
  width: fit-content !important;
  border: 3px solid var(--accent) !important;
}

.header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.block-status {
  font-size: 12px;
  color: var(--text-muted);
}
.user-bar { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); }
.btn-hdr {
  background: var(--input-bg);
  color: var(--text);
  border: 1px solid var(--input-border);
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.btn-hdr:hover { background: var(--bg-white); border-color: var(--primary); color: var(--primary); }

.header-vp-bar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
  width: 80px;
}

.vp-label {
  font-size: 10px;
  font-weight: bold;
  color: var(--primary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.vp-track {
  height: 4px;
  background: var(--bg-r1);
  border-radius: 2px;
  overflow: hidden;
  border: 1px solid var(--border-main);
}

.vp-fill {
  height: 100%;
  background: var(--primary);
  transition: width 0.3s;
}

.header-user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.header-user-info:hover {
  background: var(--bg-r1);
}

.header-user-text {
  text-align: right;
}

.interactive-username {
  color: var(--primary);
  font-size: 13px;
}

.logout-btn {
  margin-left: 10px;
  padding: 5px 10px;
  color: var(--text-muted);
}

.logout-btn:hover {
  color: #ff4400;
}

@media (max-width: 1000px) {
  .hide-tablet { display: none; }
}
</style>

