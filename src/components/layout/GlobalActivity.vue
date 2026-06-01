<script setup lang="ts">
import type { ActivityItem, AuthUser } from '../../types';

defineProps<{
  auth: { user: AuthUser | null };
  globalActivity: ActivityItem[];
  activityTab: string;
  activityExpanded: boolean;
  activityFullList: boolean;
  t: (k: string) => string;
  timeAgo: (s: string) => string;
}>();

const emit = defineEmits<{
  'update:activityTab': [value: string];
  'update:activityExpanded': [value: boolean];
  'update:activityFullList': [value: boolean];
  openActivity: [act: ActivityItem];
}>();
</script>

<template>
<!-- GLOBAL ACTIVITY FEED -->
<div v-if="auth.user && globalActivity.length > 0" style="margin: 0 15px 15px;">
  <table class="forumline activity-table">
    <tr>
      <td class="catHead" style="padding: 6px 12px;">
        <div class="activity-header-container">
          <span class="activity-label"><i class="fa-solid fa-rss"></i> {{ t('globalActivity') }}</span>
          <div style="display:flex; gap:10px; align-items:center;">
            <!-- Activity Tabs -->
            <div style="display:flex; gap:2px; background:rgba(0,0,0,0.05); padding:2px; border-radius:4px; margin-right:5px;">
              <button class="activity-tab-btn" :class="{ active: activityTab === 'comments' }" @click="emit('update:activityTab', 'comments')">
                {{ t('comments') }} {{ globalActivity.filter(a => !a.is_post && !a.isRead).length ? '(' + globalActivity.filter(a => !a.is_post && !a.isRead).length + ')' : '' }}
              </button>
              <button class="activity-tab-btn" :class="{ active: activityTab === 'posts' }" @click="emit('update:activityTab', 'posts')">
                {{ t('posts') }} {{ globalActivity.filter(a => a.is_post && !a.isRead).length ? '(' + globalActivity.filter(a => a.is_post && !a.isRead).length + ')' : '' }}
              </button>
            </div>
            <button class="btn btn-sm btn-ghost" @click="emit('update:activityExpanded', !activityExpanded)" style="padding: 2px 8px; font-size: 10px; color: var(--primary); border-color: var(--primary); background: var(--bg-white);">
              {{ activityExpanded ? t('hide') : t('show') + ' (' + globalActivity.filter(a => activityTab === 'posts' ? a.is_post : !a.is_post).length + ')' }}
            </button>
          </div>
        </div>
      </td>
    </tr>
    <template v-if="activityExpanded">
      <tr v-for="act in globalActivity.filter(a => activityTab === 'posts' ? a.is_post : !a.is_post).slice(0, activityFullList ? 20 : 3)" :key="act.id">
        <td class="row1" style="padding: 10px 15px; border-bottom: 1px solid var(--bg-white);">
          <a href="#" @click.prevent="emit('openActivity', act)"
             style="text-decoration: none; display: block;"
             :style="{ fontWeight: act.isRead ? 'normal' : 'bold', color: act.isRead ? 'var(--text-muted)' : 'var(--text)' }">
            <div class="activity-item-inner">
              <div class="activity-item-main">
                <span v-if="!act.isRead" style="display:inline-block; width:6px; height:6px; background:var(--accent); border-radius:50%; margin-right:6px; vertical-align:middle;"></span>
                {{ act.is_post ? t('newPostIn') : t('newCommentIn') }}
                <span style="display:inline-block; background: var(--primary); color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 10px; margin: 0 4px; text-transform: uppercase; font-weight: bold; vertical-align: middle; opacity: 0.9;">{{ act.community_title }}</span>
                {{ t('by') }} <b :style="{ color: act.isRead ? 'inherit' : 'var(--primary)' }">@{{ act.author }}</b>
              </div>
              <div class="activity-item-sub">
                <span v-if="act.title" class="activity-item-title" :title="act.title">
                  — "{{ act.title }}"
                </span>
                <span class="activity-item-time gs">{{ timeAgo(act.created) }}</span>
              </div>
            </div>
          </a>
        </td>
      </tr>
      <tr v-if="globalActivity.filter(a => activityTab === 'posts' ? a.is_post : !a.is_post).length > 3">
        <td class="row2" align="center" style="padding: 8px;">
          <a href="#" @click.prevent="emit('update:activityFullList', !activityFullList)" class="gs" style="font-size: 11px; font-weight: bold; text-decoration: underline;">
            {{ activityFullList ? t('showLess') : t('showMore') + ' (' + (globalActivity.filter(a => activityTab === 'posts' ? a.is_post : !a.is_post).length - 3) + ')' }}
          </a>
        </td>
      </tr>
    </template>
  </table>
</div>
</template>
