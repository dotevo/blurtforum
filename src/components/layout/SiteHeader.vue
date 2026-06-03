<script setup lang="ts">
import type { AuthUser } from '../../types';

defineProps<{
  communityTitle: string;
  communityAccount: string;
  headBlockNumber: number | string;
  auth: { user: AuthUser | null };
  hasNewNotif: boolean;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  goHome: [];
  openLoginModal: [];
  openNotifModal: [];
  openProfile: [username: string];
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
      <div class="block-status">
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
        <button class="btn-hdr" @click="emit('openNotifModal')" style="margin-right: 5px; position:relative;">
          <i class="fa-solid fa-bell"></i> {{ t('notifications') }}
          <span v-if="hasNewNotif" style="position:absolute; top:-2px; right:-2px; width:8px; height:8px; background:#ff4400; border-radius:50%; border:1px solid #fff;"></span>
        </button>
        <span style="margin-right: 5px;">
          {{ t('loggedInAs') }}: <b class="interactive-username" style="cursor: pointer; color: var(--primary);" @click="emit('openProfile', auth.user!.username)">@{{ auth.user.username }}</b>
          <span class="gs" style="margin-left: 5px;">(VP: {{ auth.user.vp }}%)</span>
        </span>
        <button class="btn-hdr" @click="emit('logout')"><i class="fa-solid fa-right-from-bracket"></i> {{ t('logout') }}</button>
      </div>
    </div>
  </div>
</div>
</template>
