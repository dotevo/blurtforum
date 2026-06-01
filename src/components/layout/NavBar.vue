<script setup lang="ts">
import type { AuthUser, Forum, Post } from '../../types';

defineProps<{
  view: string;
  communityAccount: string;
  auth: { user: AuthUser | null };
  activeForum: Forum | null;
  activeTopic: Post | null;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  goHome: [];
  loadData: [];
  openNewPostForm: [];
  openForum: [forum: Forum];
}>();
</script>

<template>
<!-- NAV BAR -->
<div class="nav-bar">
  <div class="nav-links">
    <a class="nav-link" href="#" @click.prevent="emit('goHome')"><i class="fa-solid fa-house"></i> {{ t('home') }}</a>
    <a class="nav-link" href="#" @click.prevent="emit('loadData')"><i class="fa-solid fa-arrows-rotate"></i> {{ t('refresh') }}</a>
    <a class="nav-link" href="#" v-if="auth.user && view==='forum' && activeForum"
       @click.prevent="emit('openNewPostForm')"><i class="fa-solid fa-plus"></i> {{ t('newPost') }}</a>
  </div>
  <div class="nav-right gs" style="padding: 8px 10px; font-weight: bold;">{{ communityAccount }}</div>
</div>

<!-- BREADCRUMB -->
<div class="breadcrumb">
  <a href="#" @click.prevent="emit('goHome')">BlurtForum</a>
  <template v-if="view==='communities'"> &raquo; {{ t('exploreCommunities') }}</template>
  <template v-if="activeForum"> &raquo; <a href="#" @click.prevent="emit('openForum', activeForum!)">{{ activeForum.name }}</a></template>
  <template v-if="activeTopic"> &raquo; {{ activeTopic.title }}</template>
  <template v-if="view==='newpost'"> &raquo; {{ t('newPost') }}</template>
</div>
</template>
