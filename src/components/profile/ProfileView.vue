<script setup lang="ts">
import type { Post } from '../../types';

import type { AuthUser } from '../../types';

defineProps<{
  profileUser: {
    username: string;
    data: Record<string, unknown> | null;
    posts: Post[];
    comments: Post[];
    loading: boolean;
  };
  profileTab: string;
  auth: { user: AuthUser | null };
  followingSet: Set<string>;
  t: (k: string) => string;
  fmtDate: (s: string) => string;
  timeAgo: (s: string) => string;
  renderMD: (s: string) => string;
}>();

const emit = defineEmits<{
  openProfile: [username: string];
  openTopic: [post: Post];
  openPayoutModal: [post: Post];
  toggleFollow: [username: string];
  'update:profileTab': [value: string];
}>();
</script>

<template>
    
      <div class="forumline" style="padding: 20px;">
        <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
          <div class="avatar" :style="{width: '120px', height: '120px', backgroundImage:'url(https://imgp.blurt.blog/profileimage/'+profileUser.username+'/128x128)'}"></div>
          <div style="flex: 1; min-width: 250px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <div>
                <h2 style="color: var(--primary); margin: 0 0 5px;">{{ profileUser.data ? profileUser.data.displayName : '@' + profileUser.username }}</h2>
                <div class="gs" style="margin-bottom: 10px; font-weight: bold;">@{{ profileUser.username }}</div>
              </div>
              <button v-if="auth.user && auth.user.username !== profileUser.username"
                      class="btn btn-follow" :class="followingSet.has(profileUser.username) ? 'btn-ghost' : 'btn-accent'"
                      @click="emit('toggleFollow', profileUser.username)">
                <i class="fa-solid" :class="followingSet.has(profileUser.username) ? 'fa-user-check' : 'fa-user-plus'"></i>
                {{ followingSet.has(profileUser.username) ? t('unfollow') : t('follow') }}
              </button>            </div>
            
            <div v-if="profileUser.data" style="display: flex; flex-direction: column; gap: 5px; margin-bottom: 15px;">
              <div v-if="profileUser.data.about" style="font-size: 12px; margin-bottom: 10px; padding: 10px; background: var(--bg-r2); border-left: 3px solid var(--primary);">
                {{ profileUser.data.about }}
              </div>
              <div style="display: flex; gap: 15px; flex-wrap: wrap;" class="gs">
                <span v-if="(profileUser.data as any)?.location">📍 {{ (profileUser.data as any)?.location }}</span>
                <span v-if="(profileUser.data as any)?.website">🔗 <a :href="(profileUser.data as any)?.website" target="_blank">{{ (profileUser.data as any)?.website }}</a></span>
                <span>📅 {{ t('joined') }}: {{ fmtDate((profileUser.data as any)?.created).split(',')[0] }}</span>
              </div>
            </div>

            <div v-if="profileUser.data" class="profile-stats">
              <div class="stat-box">
                <div class="stat-label">{{ t('followers') }}</div>
                <div class="stat-val">{{ profileUser.data.followerCount }}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">{{ t('following') }}</div>
                <div class="stat-val">{{ profileUser.data.followingCount }}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">BLURT</div>
                <div class="stat-val">{{ profileUser.data.balance }}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">BLURT POWER</div>
                <div class="stat-val">
                  {{ profileUser.data.totalBP }} BP
                  <div class="gs" style="font-weight: normal; margin-top: 2px;">
                    ({{ profileUser.data.bp }} + {{ profileUser.data.delegatedIn }} - {{ profileUser.data.delegatedOut }})
                  </div>
                </div>
              </div>
              <div class="stat-box" v-if="profileUser.data.proxy">
                <div class="stat-label">PROXY</div>
                <div class="stat-val">@{{ profileUser.data.proxy }}</div>
              </div>
            </div>

            <div v-if="profileUser.loading" class="loader"><span class="spin"></span>{{ t('loading') }}…</div>
          </div>
        </div>
      </div>

      <div class="tabs" style="margin-top: 20px;">
        <button class="tab-btn" :class="{active: profileTab==='posts'}" @click="profileTab='posts'">{{ t('posts') }}</button>
        <button class="tab-btn" :class="{active: profileTab==='comments'}" @click="profileTab='comments'">{{ t('comments') }}</button>
      </div>

      <table class="forumline profile-list-table" v-if="profileTab==='posts'">
        <thead>
          <tr>
            <td class="thHead" style="text-align:left;padding-left:10px">{{ t('topic') }}</td>
            <td class="thHead" width="100" align="center">{{ t('payout') }}</td>
            <td class="thHead" width="180" align="center">{{ t('posted') }}</td>
          </tr>
        </thead>
        <tbody>
          <tr v-for="post in profileUser.posts" :key="post.permlink" 
              class="row-hover" @click="emit('openTopic', post)">
            <td class="row1">
              <a href="#" @click.stop.prevent="emit('openTopic', post)">{{ post.title }}</a><br>
              <div v-if="post.beneficiaries && post.beneficiaries.length" class="beneficiaries-inline" style="margin-top:4px;">
                <span class="ben-icon">👥</span>
                <template v-for="(b, bi) in post.beneficiaries.slice(0,2)" :key="b.account">
                  <span class="ben-link" style="font-size: 10px;">@{{ b.account }}</span>
                  <span v-if="bi < post.beneficiaries.slice(0,2).length-1" class="ben-sep">,</span>
                </template>
                <span v-if="post.beneficiaries.length > 2" class="ben-more" style="font-size: 10px;">+{{ post.beneficiaries.length - 2 }}</span>
              </div>
            </td>
            <td class="row2" align="center">
              <span class="badge" :class="(post.totalPayout || 0)>0?'badge-green':'badge-blue'">{{ (post.payout || 0).toFixed(2) }} B</span>
            </td>
            <td class="row1" align="center">
              <span class="gs">{{ fmtDate(post.created) }}</span>
            </td>
          </tr>
          <tr v-if="profileUser.posts.length===0"><td colspan="3" class="row1" style="text-align:center; padding: 20px;">{{ t('noPosts') }}</td></tr>
        </tbody>
      </table>

      <table class="forumline profile-list-table" v-if="profileTab==='comments'">
        <thead>
          <tr>
            <td class="thHead" style="text-align:left;padding-left:10px">{{ t('replyTo') }}</td>
            <td class="thHead" width="100" align="center">{{ t('payout') }}</td>
            <td class="thHead" width="180" align="center">{{ t('posted') }}</td>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in profileUser.comments" :key="c.permlink" 
              class="row-hover" @click="emit('openTopic', c)">
            <td class="row1">
              <span class="gs">RE: @{{ c.parent_author }}</span><br>
              {{ c.body.substring(0, 100) }}...
            </td>
            <td class="row2" align="center">
              <span class="badge" :class="(c.totalPayout || 0)>0?'badge-green':'badge-blue'">{{ (c.payout || 0).toFixed(2) }} B</span>
            </td>
            <td class="row1" align="center">
              <span class="gs">{{ fmtDate(c.created) }}</span>
            </td>
          </tr>
          <tr v-if="profileUser.comments.length===0"><td colspan="3" class="row1" style="text-align:center; padding: 20px;">{{ t('noComments') }}</td></tr>
        </tbody>
      </table>
    <!-- /profile -->
</template>
