<script setup lang="ts">
import { onMounted, onUpdated } from 'vue';
import { dispatchScanView } from '../../modules/player';
import type { Forum, Post, AuthUser } from '../../types';
import VoteButton from '../layout/VoteButton.vue';
import ForumMedia from '../player/ForumMedia.vue';

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
  submitPost: [];
  saveDraft: [];
  clearDraft: [];
  onPostImagePick: [event: Event];
  onPostPaste: [event: ClipboardEvent];
  schedulePostFeeUpdate: [];
  'update:postPreview': [value: boolean];
  'update:showNewPostForm': [value: boolean];
  nextPage: [];
  prevPage: [];
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
 
      <!-- NEW POST FORM -->
      <div v-if="showNewPostForm && auth.user" class="write-form">
        <div style="font-weight:bold;color:var(--primary);margin-bottom:10px;border-bottom:1px solid #D1D7DC;padding-bottom:10px;font-size:14px">
          {{ t('newPost') }}
        </div>
        <div style="margin-bottom:10px">
          <label class="form-label">{{ t('postTitle') }}</label>
          <input type="text" v-model="postForm.title" :placeholder="t('postTitle')" @input="$emit('saveDraft')">
        </div>
        <!-- Draft notice -->
        <div v-if="postForm.hasDraft" style="background:var(--bg2); border:1px solid var(--accent); border-radius:4px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; font-size:12px;">
          <span>📝 {{ t('draftRestored') }}</span>
          <button class="btn btn-sm btn-ghost" @click="postForm.title=''; postForm.body=''; $emit('clearDraft')">🗑 {{ t('clearDraft') }}</button>
        </div>

        <div style="margin-bottom:10px">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label class="form-label" style="margin:0">{{ t('postBody') }} (Markdown)</label>
            <div style="display:flex; gap:6px; align-items:center;">
              <!-- Image upload button -->
              <label v-if="auth.user" class="btn btn-sm btn-ghost" style="cursor:pointer; margin:0; padding:3px 8px;" :style="{opacity: postImgUpload ? 0.5 : 1}">
                <span v-if="postImgUpload" class="spin"></span><span v-else>📎</span> {{ t('addImage') }}
                <input type="file" accept="image/*" style="display:none" @change="$emit('onPostImagePick', $event)">
              </label>
              <!-- Write / Preview toggle -->
              <button class="btn btn-sm" :class="postPreview ? 'btn-ghost' : 'btn-primary'" @click="$emit('update:postPreview', false); $emit('saveDraft')">{{ t('write') }}</button>
              <button class="btn btn-sm" :class="postPreview ? 'btn-primary' : 'btn-ghost'" @click="$emit('update:postPreview', true); $emit('saveDraft')">{{ t('preview') }}</button>
            </div>
          </div>
          <textarea v-if="!postPreview" v-model="postForm.body" :placeholder="t('writePost')" @input="$emit('saveDraft'); $emit('schedulePostFeeUpdate')" @paste="$emit('onPostPaste', $event)"></textarea>
          <div v-else class="post-body" style="min-height:120px; border:1px solid var(--input-border); border-radius:4px; padding:10px; background:var(--input-bg);" v-html="postForm.body ? renderMD(postForm.body) : '<span style=&quot;opacity:0.4&quot;>...' + t('writePost') + '...</span>'"></div>
        </div>

        <!-- TAG SELECTOR -->
        <div style="margin-bottom:10px; padding:10px; border:1px dashed var(--border-main); border-radius:4px;">
          <div class="gs" style="font-weight:bold; margin-bottom:8px;">🏷️ {{ t('tags') }}</div>
          <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; margin-bottom:6px;">
            <div>
              <label class="gs" style="display:block; font-size:11px; margin-bottom:3px;">{{ t('category') }}</label>
              <select v-model="postForm.selectedTag" @change="$emit('saveDraft')"
                      style="padding:5px 8px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text); font-size:12px; border-radius:3px;">
                <option v-for="tag in activeForum.targetTags" :key="tag" :value="tag">#{{ tag }}</option>
              </select>
            </div>
            <div style="flex:1; min-width:150px;">
              <label class="gs" style="display:block; font-size:11px; margin-bottom:3px;">{{ t('customTags') }}</label>
              <input type="text" v-model="postForm.customTags" placeholder="np. fotografia, plener" @input="$emit('saveDraft')"
                     style="width:100%; padding:5px 8px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text); font-size:12px; border-radius:3px; box-sizing:border-box;">
            </div>
          </div>
          <!-- live preview of final tags -->
          <div class="gs" style="font-size:11px;">
            {{ t('sentTags') }}:
            <template v-for="(tag, i) in [config.communityAccount, postForm.selectedTag, ...postForm.customTags.split(',').map(s=>s.trim().toLowerCase().replace(/[^a-z0-9-]/g,'')).filter(Boolean)].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,5)" :key="tag">
              <span style="display:inline-block; background:var(--primary); color:#fff; border-radius:3px; padding:1px 6px; margin:2px 2px 0 0; font-size:10px;">#{{ tag }}</span>
            </template>
            <span style="opacity:0.5">{{ t('max5') }}</span>
          </div>
        </div>
        <div style="margin-bottom:10px">
          <label class="gs" style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
            <input type="checkbox" v-model="postForm.devTip"> {{ t('devTip') }}
          </label>
        </div>
        <div style="margin-bottom:10px; padding:10px; border:1px dashed var(--border-main); border-radius:4px;">
          <div class="gs" style="font-weight:bold; margin-bottom:6px;">👥 {{ t('addBeneficiary') }}</div>
          <div class="ben-form-row">
            <input type="text" v-model="postForm.beneficiary.account" :placeholder="t('beneficiaryAccount')" class="ben-input-account">
            <input type="number" v-model="postForm.beneficiary.weight" min="1" max="100" :placeholder="t('beneficiaryWeight')" class="ben-input-pct">
            <span class="gs ben-pct-label">%</span>
          </div>
        </div>
        <div v-if="postForm.error" class="alert alert-error">{{ postForm.error }}</div>
        <div v-if="postForm.success" class="alert alert-success">{{ postForm.success }}</div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="btn btn-primary" @click="$emit('submitPost')" :disabled="postForm.loading">
            <span v-if="postForm.loading" class="spin"></span><i v-else class="fa-solid fa-paper-plane"></i> {{ t('submit') }}
          </button>
          <button class="btn btn-ghost" @click="$emit('update:showNewPostForm', false); $emit('clearDraft')"><i class="fa-solid fa-xmark"></i> {{ t('cancel') }}</button>
          <span v-if="postFeeEstimate" style="font-size:11px; color:var(--text-muted); margin-left:4px;">
            💸 ~{{ postFeeEstimate }} BLURT
          </span>
        </div>
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
              
              <!-- Media icons component -->
              <ForumMedia 
                v-if="player.state.enabled && post.media"
                :media="post.media"
                :title="post.title"
                :author="post.author"
                :permlink="post.permlink"
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
                <a href="#" @click.stop.prevent="$emit('openProfile', post.author)">@{{ post.author }}</a>
                <span v-if="post.isFollowing" class="gs" style="color:var(--accent); font-size:9px;" :title="t('followed')"><i class="fa-solid fa-user-check"></i></span>
              </div>
            </td>
            <td :class="i%2===0?'row2':'row1'" align="center" class="col-payout">
              <span class="badge payout-link" :class="post.isPaid?'badge-green':'badge-blue'" @click.stop="$emit('openPayoutModal', post)">
                {{ (post.payout || 0).toFixed(2) }} B
              </span>
            </td>
            <td :class="i%2===0?'row1':'row2'" align="center" class="col-lastpost">
              <span class="gs">{{ fmtDate(post.lastActivity) }}</span><br>
              <a href="#" @click.stop.prevent="$emit('openProfile', post.lastAuthor)">@{{ post.lastAuthor }}</a><br/>
              <span class="gs" style="font-size: 10px; opacity: 0.8;">💬 {{ post.replyCount }} {{ t('replies') }}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div  style="display: flex; justify-content: center; gap: 20px; margin-top: 20px; align-items: center;">
        <button class="btn btn-primary" v-if="activeForum.pageHistory.length" @click="$emit('prevPage')" :disabled="loading">
          « {{ t('prev') }}
        </button>
        <button class="btn btn-ghost" v-if="activeForum.pageHistory.length === 0 && activeForum.start_author" @click="$emit('openForum', activeForum)">
          «« {{ t('firstPage') || 'First Page' }}
        </button>
        <span class="gs" style="font-weight: bold;">{{ t('page') }} {{ activeForum.pageHistory.length + 1 }}</span>
        <button class="btn btn-primary" @click="$emit('nextPage')" :disabled="loading || !activeForum.hasMore">
          {{ t('next') }} »
        </button>
      </div>
    
 
</template>
