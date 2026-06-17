<script setup lang="ts">
import { onMounted, onUpdated } from 'vue';
import { dispatchScanView } from '../../modules/player';
import type { Forum, Post, AuthUser } from '../../types';
import VoteButton from '../layout/VoteButton.vue';
import ForumMediaContainer from '../player/ForumMediaContainer.vue';
import PayoutBadge from '../layout/PayoutBadge.vue';
import UserAvatar from '../layout/UserAvatar.vue';
import PostEditor from '../layout/PostEditor.vue';

const props = defineProps<{
  activeForum: Forum;
  auth: { user: AuthUser | null };
  showNewPostForm: boolean;
  postForm: {
    title: string; body: string; loading: boolean; error: string; success: string;
    hasDraft: boolean; devTip: boolean; beneficiary: { account: string; weight: string };
    selectedTag: string; customTags: string;
  };
  postPreview: boolean;
  postImgUpload: boolean;
  postFeeEstimate: string | null;
  forumPagination: { visibleCount: number; pageHistory: unknown[]; hasMore: boolean };
  loading: boolean;
  player: { state: { enabled: boolean } };
  config: { communityAccount: string };
  hasVoted: (p: Post) => boolean;
  t: (k: string) => string;
  fmtDate: (s: string) => string;
  renderMD: (s: string) => string;
}>();

const emit = defineEmits<{
  openNewPostForm: [];
  openTopic: [post: Post];
  openProfile: [username: string];
  openPayoutModal: [post: Post];
  submitVote: [post: Post];
  handleMediaAction: [type: string, id: string, host: string, action: string, data: any];
  submitPost: [data?: any];
  saveDraft: [data?: any];
  clearDraft: [];
  onPostImagePick: [event: Event];
  onPostPaste: [event: ClipboardEvent];
  schedulePostFeeUpdate: [content: string];
  'update:postPreview': [value: boolean];
  'update:showNewPostForm': [value: boolean];
  changePage: [dir: 'next' | 'prev'];
  openForum: [forum: Forum];
}>();

const triggerScan = () => {
  const container = document.querySelector('.post-list-table');
  if (container) dispatchScanView(container);
};
onMounted(triggerScan);
onUpdated(triggerScan);
</script>

<template>
    
 
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px">
        <div>
          <b style="font-size:15px;color:var(--primary)">{{ activeForum.name }}</b>
          <span v-if="activeForum.desc" class="gs"> — {{ activeForum.desc }}</span>
        </div>
        <button v-if="auth.user" class="btn btn-accent" @click="$emit('openNewPostForm')">+ {{ t('newPost') }}</button>
        <span v-else class="gs" style="font-weight: bold;">{{ t('loginToPost') }}</span>
      </div>
 
      <!-- NEW POST FORM (Unified) -->
      <div v-if="showNewPostForm && auth.user" style="margin-bottom: 20px;">
        <!-- Draft notice (outside editor as it affects editor state) -->
        <div v-if="postForm.hasDraft" style="background:var(--bg2); border:1px solid var(--accent); border-radius:4px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; font-size:12px;">
          <span>📝 {{ t('draftRestored') }}</span>
          <button class="btn btn-sm btn-ghost" @click="postForm.title=''; postForm.body=''; $emit('clearDraft')">🗑 {{ t('clearDraft') }}</button>
        </div>

        <PostEditor
          mode="post"
          :parent="activeForum"
          :auth="auth"
          :t="t"
          :renderMD="renderMD"
          :loading="postForm.loading"
          :error="postForm.error"
          :success="postForm.success"
          :initialTitle="postForm.title"
          :initialBody="postForm.body"
          :imgUpload="postImgUpload"
          :feeEstimate="postFeeEstimate"
          :config="config"
          @submit="(data) => emit('submitPost', data)"
          @cancel="emit('update:showNewPostForm', false)"
          @imagePick="(e) => emit('onPostImagePick', e)"
          @paste="(e) => emit('onPostPaste', e)"
          @scheduleFeeUpdate="(c) => emit('schedulePostFeeUpdate', c)"
          @saveDraft="(data) => emit('saveDraft', data)"
          @clearDraft="emit('clearDraft')"
        />
      </div>
 
      <table class="forumline post-list-table">
        <thead>
          <tr>
            <td class="thHead" width="30"></td>
            <td class="thHead col-topic" style="text-align:left;padding-left:10px"><i class="fa-solid fa-comments"></i> {{ t('topic') }}</td>
            <td class="thHead col-author" width="120" align="center"><i class="fa-solid fa-user"></i> {{ t('author') }}</td>
            <td class="thHead col-payout" width="100" align="center"><i class="fa-solid fa-coins"></i> {{ t('payout') }}</td>
            <td class="thHead col-lastpost" width="180" align="center"><i class="fa-solid fa-clock"></i> {{ t('lastPost') }}</td>
          </tr>
        </thead>
        <tbody>
          <tr v-if="activeForum.posts.length===0">
            <td colspan="5" class="row1" style="text-align:center;padding:30px; font-weight: bold;">{{ t('noPosts') }}</td>
          </tr>
          <tr v-for="(post,i) in activeForum.posts.slice(0, forumPagination.visibleCount)" :key="post.permlink"
              class="row-hover" @click="$emit('openTopic', post)"
              :style="{ opacity: post.isMuted ? 0.4 : 1, backgroundColor: post.isMuted ? 'var(--bg-r3)' : 'inherit' }">
            <td :class="i%2===0?'row1':'row2'" align="center" width="40">
              <VoteButton 
                :voted="hasVoted(post)" 
                :count="post.vote_count" 
                @vote="$emit('submitVote', post)" 
              />
            </td>
            <td :class="i%2===0?'row1':'row2'" class="col-topic">
              <span v-if="post.isMuted" style="margin-right:5px; color:var(--error-text); font-weight:bold;">[{{ t('muted') }}]</span>
              <span v-if="post.isUnread" style="display:inline-block; width:8px; height:8px; background:var(--accent); border-radius:50%; margin-right:8px; box-shadow:0 0 4px var(--accent);" title="Unread"></span>
              <span v-else style="display:inline-block; width:8px; height:8px; background:var(--border-main); border-radius:50%; margin-right:8px;" title="Read"></span>
              
              <!-- Media Container (Unified controls for all mirrors) -->
              <ForumMediaContainer 
                v-if="player.state.enabled"
                :post="post"
                :t="t"
              />

              <a href="#" @click.stop.prevent="$emit('openTopic', post)" 
                 :style="{ fontSize:'12px', fontWeight: post.isUnread ? 'bold' : 'normal' }">{{ post.title }}</a>
              <br>
              <span class="gs">
                {{ fmtDate(post.created) }}
                <span v-if="post.tags && post.tags.length" style="opacity: 0.7;"> • #{{ post.tags.join(' #') }}</span>
              </span>
            </td>
            <td :class="i%2===0?'row2':'row1'" align="center" class="col-author">
              <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
                <UserAvatar :username="post.author" size="xs" @click="$emit('openProfile', post.author)" />
                <a href="#" @click.stop.prevent="$emit('openProfile', post.author)">@{{ post.author }}</a>
                <span v-if="post.isFollowing" class="gs" style="color:var(--accent); font-size:9px;" :title="t('followed')"><i class="fa-solid fa-user-check"></i></span>
              </div>
            </td>
            <td :class="i%2===0?'row2':'row1'" align="center" class="col-payout">
              <PayoutBadge :post="post" @click="$emit('openPayoutModal', post)" />
            </td>
            <td :class="i%2===0?'row1':'row2'" align="center" class="col-lastpost">
              <span class="gs">{{ fmtDate(post.lastActivity) }}</span><br/>
              <a href="#" @click.stop.prevent="$emit('openProfile', post.lastAuthor)">@{{ post.lastAuthor }}</a><br/>
              <span class="gs" style="font-size: 10px; opacity: 0.8;">💬 {{ post.replyCount }} {{ t('replies') }}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div  style="display: flex; justify-content: center; gap: 20px; margin-top: 20px; align-items: center;">
        <button class="btn btn-primary" v-if="activeForum.pageHistory.length" @click="emit('changePage', 'prev')" :disabled="loading">
          « {{ t('prev') }}
        </button>
        <button class="btn btn-ghost" v-if="activeForum.pageHistory.length === 0 && activeForum.start_author" @click="emit('openForum', activeForum)">
          «« {{ t('firstPage') || 'First Page' }}
        </button>
        <span class="gs" style="font-weight: bold;">{{ t('page') }} {{ activeForum.pageHistory.length + 1 }}</span>
        <button class="btn btn-primary" @click="emit('changePage', 'next')" :disabled="loading || !activeForum.hasMore">
          {{ t('next') }} »
        </button>
      </div>
    
 
</template>
