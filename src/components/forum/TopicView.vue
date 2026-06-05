<script setup lang="ts">
import { ref, reactive, onMounted, onUpdated } from 'vue';
import { BFPlayer, dispatchScanView } from '../../modules/player';
import { Blockchain } from '../../modules/blockchain';
import { BFUtils } from '../../modules/utils';
import OldContentModal from '../modals/OldContentModal.vue';
import VoteButton from '../layout/VoteButton.vue';
import PostBeneficiaries from '../layout/PostBeneficiaries.vue';
import ForumMedia from '../player/ForumMedia.vue';
import { createApp, h } from 'vue';
import type { Post, AuthUser, RawPost, Beneficiary } from '../../types';

// ... (props remains same) ...

// ... (emits remains same) ...

const hydrateMedia = (container: HTMLElement | null) => {
  if (!container) return;
  const placeholders = container.querySelectorAll('forum-media');
  placeholders.forEach(el => {
    // If already hydrated, skip
    if (el.getAttribute('data-hydrated')) return;
    
    const props: any = {
      dataType: el.getAttribute('data-type'),
      dataId: el.getAttribute('data-id'),
      dataSrc: el.getAttribute('data-src'),
      dataCover: el.getAttribute('data-cover'),
      dataHost: el.getAttribute('data-host'),
      dataTitle: el.getAttribute('data-title'),
      dataAuthor: el.getAttribute('data-author'),
      dataPermlink: el.getAttribute('data-permlink'),
      dataPending: el.getAttribute('data-pending'),
      mode: el.getAttribute('mode') || 'card'
    };
    
    const app = createApp({
      render: () => h(ForumMedia, props)
    });
    
    // Clear the element and mount the Vue app
    el.innerHTML = '';
    app.mount(el);
    el.setAttribute('data-hydrated', 'true');
  });
};

onUpdated(() => {
  hydrateMedia(document.querySelector('.post-body'));
  hydrateMedia(document.querySelector('.replies-container'));
});

onMounted(() => {
  hydrateMedia(document.querySelector('.post-body'));
  hydrateMedia(document.querySelector('.replies-container'));
});

// ... (logic remains same) ...

const props = defineProps<{
  activeTopic: Post;
  replies: Post[];
  repliesLoading: boolean;
  auth: { user: AuthUser | null };
  replyTarget: Post | null;
  replyForm: {
    body: string; loading: boolean; error: string; success: string;
    beneficiary: { account: string; weight: string };
    devTip?: boolean;
  };
  replyPreview: boolean;
  replyImgUpload: boolean;
  replyFeeEstimate: string | null;
  followingSet: Set<string>;
  canMute: boolean;
  t: (k: string) => string;
  fmtDate: (s: string) => string;
  timeAgo: (s: string) => string;
  renderMD: (s: string, ctx?: unknown) => string;
  hasVoted: (p: Post) => boolean;
  isNestedReply: (r: Post) => boolean;
  getParentBody: (r: Post) => string;
  isPostInCommunity: (p: Post) => boolean;
  client: any;
  broadcast: (ops: any[]) => Promise<void>;
  waitAndReload: (isTopic: boolean, author?: string, permlink?: string, pollFn?: any, label?: string) => Promise<void>;
  checkLock: (fn: any) => boolean;
}>();

// ... (emits remains same) ...

// ── Support Old Content ───────────────────────────────────────────────────
const oldContentModal = reactive({
  show: false,
  author: '',
  permlink: '',
  beneficiaries: [] as Beneficiary[],
  originalPost: null as RawPost | null,
  weight: 0,
  body: '',
  status: '',
  loading: false
});

const triggerSupportLogic = async (post: Post, weight: number): Promise<void> => {
  let fullPost: RawPost = post as unknown as RawPost;
  if (!post.beneficiaries?.length) {
    try { fullPost = await props.client.condenser.getContent(post.author, post.permlink); } catch { /* ignore */ }
  }
  const beneficiaries = (fullPost.beneficiaries || []) as Beneficiary[];
  let existingSupport: RawPost | undefined;
  try {
    const reps = await props.client.condenser.getContentReplies(post.author, post.permlink);
    existingSupport = reps.find((r: any) => {
      if (!r.body?.trim().startsWith('Supporting original content by @')) return false;
      const rBens = (r.beneficiaries || []) as Beneficiary[];
      return rBens.length === beneficiaries.length && beneficiaries.every(b => rBens.some(rb => rb.account === b.account && rb.weight === b.weight));
    });
  } catch { /* ignore */ }
  if (existingSupport) {
    try { await props.broadcast([['vote', { voter: props.auth.user!.username, author: existingSupport.author, permlink: existingSupport.permlink, weight }]]); } catch { /* ignore */ }
  } else {
    oldContentModal.author = post.author; oldContentModal.permlink = post.permlink; oldContentModal.beneficiaries = beneficiaries; oldContentModal.originalPost = fullPost; oldContentModal.weight = weight; oldContentModal.body = 'Supporting original content by @' + post.author; oldContentModal.status = ''; oldContentModal.loading = false; oldContentModal.show = true;
  }
};

const submitSupportComment = async (): Promise<void> => {
  if (props.checkLock(submitSupportComment)) return;
  if (!props.auth.user || !oldContentModal.author) return;
  oldContentModal.loading = true; oldContentModal.status = props.t('supporting');
  const permlink = BFUtils.genPermlink('support-' + oldContentModal.author);
  const beneficiaries = oldContentModal.beneficiaries.length ? [...oldContentModal.beneficiaries].sort((a, b) => a.account.localeCompare(b.account)) : [{ account: oldContentModal.author, weight: 10000 }];
  const op = ['comment', { parent_author: oldContentModal.author, parent_permlink: oldContentModal.permlink, author: props.auth.user.username, permlink, title: '', body: oldContentModal.body, json_metadata: JSON.stringify({ app: 'blurtforum/1.0', tags: ['blurt-140455'] }) }];
  const options = ['comment_options', { author: props.auth.user.username, permlink, max_accepted_payout: '1000000.000 BLURT', percent_steem_dollars: 10000, allow_votes: true, allow_curation_rewards: true, extensions: [[0, { beneficiaries }]] }];
  try {
    await props.broadcast([op, options]);
    oldContentModal.status = props.t('waitingForBlock');
    await new Promise(r => setTimeout(r, 5000));
    oldContentModal.status = props.t('votingOnSupport');
    await props.broadcast([['vote', { voter: props.auth.user.username, author: props.auth.user.username, permlink, weight: oldContentModal.weight || 10000 }]]);
    oldContentModal.status = props.t('supportSuccess');
    setTimeout(() => { oldContentModal.show = false; }, 1500);
  } catch (err) { console.error('Support error:', err); oldContentModal.status = 'Error: ' + (err as Error).message; }
  oldContentModal.loading = false;
};

// ... (rest of logic) ...


const emit = defineEmits<{
  openProfile: [username: string];
  openPayoutModal: [post: Post];
  submitVote: [post: Post];
  startReply: [post: Post];
  startEdit: [post: Post];
  toggleFollow: [username: string];
  mutePost: [post: Post, mute: boolean];
  switchCommunity: [account: string];
  loadTopicContext: [];
  handleMediaAction: [type: string, id: string, host: string, action: string, data: any];
  submitReply: [];
  onReplyImagePick: [event: Event];
  onReplyPaste: [event: ClipboardEvent];
  scheduleReplyFeeUpdate: [];
  'update:replyPreview': [value: boolean];
  'update:replyTarget': [value: Post | null];
}>();

// Po każdym render-passie player skanuje ten widok.
// nextTick gwarantuje, że forum-media są już w DOM.
const triggerScan = () => {
  // Przekazujemy konkretny kontener — player nie musi skanować całego dokumentu.
  const container = document.querySelector('.topic-view-root');
  console.log("aaaa", container);
  dispatchScanView(container);
};
onMounted(triggerScan);
onUpdated(triggerScan);
</script>

<template>
    <div class="topic-view-root">
      <div v-if="!isPostInCommunity(activeTopic)" class="alert alert-info" style="margin-bottom:15px">
        🌐 {{ t('externalPostWarning') || 'This post is outside the currently selected community.' }} 
        (Category: 
        <a v-if="activeTopic.category && activeTopic.category.startsWith('blurt-')" href="#" 
           class="warning-link" @click.prevent="emit('switchCommunity', activeTopic.category)">#{{ activeTopic.category }}</a>
        <span v-else>#{{ activeTopic.category }}</span>)
      </div>

      <!-- ORIGINAL POST -->
      <div v-if="activeTopic.parent_author" class="alert alert-info" style="margin-bottom:15px; display:flex; align-items:center; gap:10px;">
        <div style="flex:1">ℹ️ {{ t('viewingComment') || 'You are viewing a specific comment context.' }}</div>
        <button class="btn btn-sm btn-hdr" @click="emit('loadTopicContext')">{{ t('loadFullThread') }}</button>
      </div>

      <table :id="'post-' + activeTopic.permlink" class="forumline topic-table" style="margin-bottom:5px"
             :style="{ opacity: activeTopic.isMuted ? 0.5 : 1 }">
        <thead>
          <tr class="hide-mobile">
            <td class="row3 post-profile"></td>
            <td class="row3">
              <div class="post-header">
                <span class="gs">{{ t('posted') }}: {{ fmtDate(activeTopic.created) }}</span>
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                  <span v-if="activeTopic.isMuted" style="color:var(--error-text); font-weight:bold;">[{{ t('muted') }}]</span>
                  <span class="badge payout-link" :class="activeTopic.isPaid?'badge-green':'badge-blue'" @click="emit('openPayoutModal', activeTopic)">
                    {{ (activeTopic.payout || 0).toFixed(2) }} BLURT
                  </span>
                  
                  <PostBeneficiaries :beneficiaries="activeTopic.beneficiaries" :t="t" @open-profile="(u) => emit('openProfile', u)" />

                  <VoteButton 
                    :voted="hasVoted(activeTopic)" 
                    :count="activeTopic.vote_count" 
                    @vote="emit('submitVote', activeTopic)" 
                    style="font-size: 16px;"
                  />
                  <template v-if="canMute && isPostInCommunity(activeTopic)">
                    <button v-if="!activeTopic.isMuted" class="btn btn-sm btn-hdr" @click="emit('mutePost', activeTopic, true)">🚫 {{ t('mute') }}</button>
                    <button v-else class="btn btn-sm btn-hdr" @click="emit('mutePost', activeTopic, false)">🔓 {{ t('unmute') }}</button>
                  </template>
                  </div>            </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="row1 post-profile hide-mobile">
              <div class="avatar" :style="{backgroundImage:'url(https://imgp.blurt.blog/profileimage/'+activeTopic.author+'/128x128)'}"></div>
              <div v-if="auth.user && auth.user.username !== activeTopic.author" style="margin-top:8px;">
                <button class="btn btn-sm btn-follow" :class="followingSet.has(activeTopic.author) ? 'btn-ghost' : 'btn-accent'" @click="emit('toggleFollow', activeTopic.author)">
                  <i class="fa-solid" :class="followingSet.has(activeTopic.author) ? 'fa-user-check' : 'fa-user-plus'"></i>
                  {{ followingSet.has(activeTopic.author) ? t('followed') : t('follow') }}
                </button>
              </div>
              <div class="gs" style="margin-top:8px; font-weight: bold;"><a href="#" @click.prevent="emit('openProfile', activeTopic.author)">@{{ activeTopic.author }}</a><br>{{ t('blurtUser') }}</div>
            </td>
            <td class="row1 post-body-cell">
              <!-- Mobile Header (OP) -->
              <div class="comment-mobile-header show-mobile">
                <div class="avatar avatar-xs" :style="{backgroundImage:'url(https://imgp.blurt.blog/profileimage/'+activeTopic.author+'/64x64)'}"></div>
                <div style="flex:1">
                  <div style="font-weight:bold; font-size:14px;"><a href="#" @click.prevent="emit('openProfile', activeTopic.author)">@{{ activeTopic.author }}</a></div>
                  <div class="gs" style="font-size:10px;">{{ fmtDate(activeTopic.created) }}</div>
                </div>
                <button v-if="auth.user && auth.user.username !== activeTopic.author" 
                        class="btn btn-xs btn-follow" :class="followingSet.has(activeTopic.author) ? 'btn-ghost' : 'btn-accent'" @click="emit('toggleFollow', activeTopic.author)"
                        style="width:auto; margin:0; padding:2px 6px !important;">
                  <i class="fa-solid" :class="followingSet.has(activeTopic.author) ? 'fa-user-check' : 'fa-user-plus'"></i>
                </button>
                <VoteButton :voted="hasVoted(activeTopic)" :count="activeTopic.vote_count" @vote="emit('submitVote', activeTopic)" />
              </div>

              <!-- Mobile Header Stats (OP) -->
              <div class="show-mobile" style="margin-bottom:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                  <span class="badge payout-link" :class="activeTopic.isPaid?'badge-green':'badge-blue'" @click="emit('openPayoutModal', activeTopic)">
                    {{ (activeTopic.payout || 0).toFixed(2) }} B
                  </span>
                  
                  
                  <PostBeneficiaries :beneficiaries="activeTopic.beneficiaries" :limit="2" :t="t" @open-profile="(u) => emit('openProfile', u)" />
                  
                  <template v-if="canMute && isPostInCommunity(activeTopic)">
                    <button v-if="!activeTopic.isMuted" class="btn btn-sm btn-hdr" @click="emit('mutePost', activeTopic, true)">🚫 {{ t('mute') }}</button>
                    <button v-else class="btn btn-sm btn-hdr" @click="emit('mutePost', activeTopic, false)">🔓 {{ t('unmute') }}</button>
                  </template>
                </div>
              </div>

              <ForumMedia 
                v-if="activeTopic.media"
                :hideButtons="true"
                :media="activeTopic.media"
                :title="activeTopic.title || ''"
                :author="activeTopic.author"
                :permlink="activeTopic.permlink"
                :t="t"
              >
                <div class="post-body" v-html="renderMD(activeTopic.body, activeTopic)"></div>
              </ForumMedia>
              <div v-else class="post-body" v-html="renderMD(activeTopic.body, activeTopic)"></div>
              <div style="margin-top:15px;padding-top:10px;border-top:1px solid var(--bg-r3); display: flex; gap: 10px;">
                <template v-if="auth.user">
                  <button class="btn btn-sm" @click="emit('startReply', activeTopic)">{{ t('reply') }}</button>
                  <button v-if="auth.user.username === activeTopic.author" class="btn btn-sm btn-ghost" @click="emit('startEdit', activeTopic)">{{ t('edit') }}</button>
                </template>
                <span v-else class="gs" style="font-weight: bold;">{{ t('loginToReply') }}</span>
              </div>
            </td>
          </tr>
          <!-- Inline reply form for main post -->
          <tr v-if="replyTarget && replyTarget.permlink===activeTopic.permlink">
            <td colspan="2" style="padding:0">
              <div class="write-form" style="margin:0;border:none;border-radius:0;">
                <div style="font-weight:bold;color:var(--primary);margin-bottom:10px">
                  {{ t('replyTo') }}: <i>{{ activeTopic.title }}</i>
                </div>
                <div style="display:flex; justify-content:flex-end; align-items:center; gap:6px; margin-bottom:4px;">
                  <label v-if="auth.user" class="btn btn-sm btn-ghost" style="cursor:pointer; margin:0; padding:3px 8px;" :style="{opacity: replyImgUpload ? 0.5 : 1}">
                    <span v-if="replyImgUpload" class="spin"></span><span v-else>📎</span>
                    <input type="file" accept="image/*" style="display:none" @change="emit('onReplyImagePick', $event)">
                  </label>
                  <button class="btn btn-sm" :class="replyPreview ? 'btn-ghost' : 'btn-primary'" @click="emit('update:replyPreview', false)">{{ t('write') }}</button>
                  <button class="btn btn-sm" :class="replyPreview ? 'btn-primary' : 'btn-ghost'" @click="emit('update:replyPreview', true)">{{ t('preview') }}</button>
                </div>
                <textarea v-if="!replyPreview" v-model="replyForm.body" :placeholder="t('writeReply')" @paste="emit('onReplyPaste', $event)"></textarea>
                <div v-else class="post-body" style="min-height:80px; border:1px solid var(--input-border); border-radius:4px; padding:10px; background:var(--input-bg);" v-html="replyForm.body ? renderMD(replyForm.body) : '<span style=&quot;opacity:0.4&quot;>...</span>'"></div>
                <div style="margin-top:10px">
                  <label class="gs" style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                    <input type="checkbox" v-model="replyForm.devTip"> {{ t('devTip') }}
                  </label>
                </div>
                <div style="margin-top:8px; padding:8px 10px; border:1px dashed var(--border-main); border-radius:4px;">
                  <div class="gs" style="font-weight:bold; margin-bottom:5px;">👥 {{ t('addBeneficiary') }}</div>
                  <div class="ben-form-row">
                    <input type="text" v-model="replyForm.beneficiary.account" :placeholder="t('beneficiaryAccount')" class="ben-input-account">
                    <input type="number" v-model="replyForm.beneficiary.weight" min="1" max="100" :placeholder="t('beneficiaryWeight')" class="ben-input-pct">
                    <span class="gs ben-pct-label">%</span>
                  </div>
                </div>
                <div v-if="replyForm.error" class="alert alert-error" style="margin-top:10px">{{ replyForm.error }}</div>
                <div v-if="replyForm.success" class="alert alert-success" style="margin-top:10px">{{ replyForm.success }}</div>
                <div style="margin-top:10px;display:flex;gap:10px">
                  <button class="btn btn-primary btn-sm" @click="emit('submitReply')" :disabled="replyForm.loading">
                    <span v-if="replyForm.loading" class="spin"></span><i v-else class="fa-solid fa-paper-plane"></i> {{ t('send') }}
                  </button>
                  <button class="btn btn-sm" @click="emit('update:replyTarget', null)"><i class="fa-solid fa-xmark"></i> {{ t('cancel') }}</button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
 
      <!-- COMMENTS SECTION -->
      <div v-if="repliesLoading" class="loader"><span class="spin"></span>{{ t('loadingComments') }}</div>
 
      <template v-else>
        <div v-if="replies.length>0"
             style="background:var(--primary);color:var(--accent);padding:8px 12px;font-weight:bold;font-size:11px;text-transform:uppercase;margin-bottom:5px; border-radius: 4px;">
          {{ t('comments') }} ({{ replies.length }})
        </div>
        <div v-else style="padding:20px 0;color:#666;font-size:12px; font-weight: bold; text-align: center;">{{ t('noComments') }}</div>
 
        <template v-for="(r,i) in replies" :key="r.permlink">
          <!-- Compact Bar for Collapsed Support Comment -->
          <div v-if="r.isCollapsed" class="collapsed-support-bar" @click="r.isCollapsed=false" style="cursor:pointer;">
            <span class="vote-info">
              <i class="fa-solid fa-caret-up" style="color:var(--primary)"></i>
              {{ r.vote_count }}
            </span>
            <span class="gs"><i class="fa-solid fa-robot" style="font-size:10px; opacity:0.6;"></i> {{ t('automatedSupportComment') }}</span>
            <span class="author-tag">@{{ r.author }}</span>
            <span class="expand-btn">[{{ t('show') }}]</span>
          </div>

          <table v-else :id="'post-' + r.permlink" class="forumline topic-table" style="margin-bottom:5px"
                 :style="{ opacity: r.isMuted ? 0.5 : 1 }">
            <thead>
              <tr class="hide-mobile">
                <td class="row3 post-profile"><b><a href="#" @click.prevent="emit('openProfile', r.author)">@{{ r.author }}</a></b></td>
                <td class="row3">
                  <div class="post-header">
                    <span class="gs">
                      #{{ i+1 }} · {{ fmtDate(r.created) }}
                      <span v-if="r._pending" style="display:inline-block; background:var(--accent); color:#fff; border-radius:3px; padding:1px 6px; font-size:10px; margin-left:5px;">
                        <i class="fa-solid fa-circle-notch fa-spin"></i> {{ r._pending === 'sending' ? t('sending') : (r._pending === 'syncing' ? t('syncing') : t('indexing')) }}
                      </span>
                      <span v-if="(r.depth ?? 0) > 1" class="depth-badge">↳ {{ t('nested') }}</span>
                    </span>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                      <span v-if="r.isMuted" style="color:var(--error-text); font-weight:bold;">[{{ t('muted') }}]</span>
                      <span class="badge payout-link" :class="r.totalPayout>0?'badge-green':'badge-blue'" @click="emit('openPayoutModal', r)">
                        {{ (r.payout || 0).toFixed(3) }} B
                      </span>
                      <PostBeneficiaries :beneficiaries="r.beneficiaries" :t="t" @open-profile="(u) => emit('openProfile', u)" />
                      <VoteButton :voted="hasVoted(r)" :count="r.vote_count" @vote="emit('submitVote', r)" />

                      <template v-if="canMute && isPostInCommunity(r)">
                        <button v-if="!r.isMuted" class="btn btn-sm btn-hdr" @click="emit('mutePost', r, true)">🚫 {{ t('mute') }}</button>
                        <button v-else class="btn btn-sm btn-hdr" @click="emit('mutePost', r, false)">🔓 {{ t('unmute') }}</button>
                      </template>
                      </div>              </div>
                </td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td :class="i%2===0?'row1':'row2'" class="post-profile hide-mobile">
                  <div class="avatar avatar-sm" :style="{backgroundImage:'url(https://imgp.blurt.blog/profileimage/'+r.author+'/128x128)'}"></div>
                  <div v-if="auth.user && auth.user.username !== r.author" style="margin-top:6px; margin-bottom:6px;">
                    <button class="btn btn-sm btn-follow" :class="followingSet.has(r.author) ? 'btn-ghost' : 'btn-accent'" @click="emit('toggleFollow', r.author)">
                      <i class="fa-solid" :class="followingSet.has(r.author) ? 'fa-user-check' : 'fa-user-plus'"></i>
                      {{ followingSet.has(r.author) ? t('followed') : t('follow') }}
                    </button>
                  </div>
                </td>
                <td :class="i%2===0?'row1':'row2'" class="post-body-cell">
                  <!-- Mobile Header -->
                  <div class="comment-mobile-header show-mobile">
                    <div class="avatar avatar-xs" :style="{backgroundImage:'url(https://imgp.blurt.blog/profileimage/'+r.author+'/64x64)'}"></div>
                    <div style="flex:1">
                      <div style="font-weight:bold; font-size:13px;"><a href="#" @click.prevent="emit('openProfile', r.author)">@{{ r.author }}</a></div>
                      <div class="gs" style="font-size:10px;">#{{ i+1 }} · {{ fmtDate(r.created) }}</div>
                    </div>
                    
                    <button v-if="auth.user && auth.user.username !== r.author" 
                            class="btn btn-xs btn-follow" :class="followingSet.has(r.author) ? 'btn-ghost' : 'btn-accent'" @click="emit('toggleFollow', r.author)"
                            style="width:auto; margin:0; padding:2px 6px !important;">
                      <i class="fa-solid" :class="followingSet.has(r.author) ? 'fa-user-check' : 'fa-user-plus'"></i>
                    </button>
                    <VoteButton 
                      :voted="hasVoted(r)" 
                      :count="r.vote_count" 
                      @vote="emit('submitVote', r)" 
                    />
                  </div>

                  <!-- Mobile Header Stats (payout/votes) -->
                  <div class="show-mobile" style="margin-bottom:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                      <span class="badge payout-link" :class="r.totalPayout>0?'badge-green':'badge-blue'" @click="emit('openPayoutModal', r)">
                        {{ (r.payout || 0).toFixed(3) }} B
                      </span>
                      

                      <PostBeneficiaries :beneficiaries="r.beneficiaries" :limit="2" :t="t" @open-profile="(u) => emit('openProfile', u)" />
                      
                      <template v-if="canMute && isPostInCommunity(r)">
                        <button v-if="!r.isMuted" class="btn btn-sm btn-hdr" @click="emit('mutePost', r, true)">🚫 {{ t('mute') }}</button>
                        <button v-else class="btn btn-sm btn-hdr" @click="emit('mutePost', r, false)">🔓 {{ t('unmute') }}</button>
                      </template>
                    </div>
                    <div v-if="(r.depth ?? 0) > 1" class="depth-badge">↳ {{ t('nested') }}</div>
                  </div>

                  <!-- Quote of parent comment (only when it's a nested reply, not a direct reply to OP) -->

                  <div v-if="isNestedReply(r)" class="quote-box">
                    <span style="font-weight: bold;">{{ t('replyTo') }}: <a href="#" @click.prevent="emit('openProfile', r.parent_author)">@{{ r.parent_author }}</a></span>
                    <span class="quote-toggle" @click="r._qOpen=!r._qOpen">
                      [{{ r._qOpen ? t('hide') : t('show') }}]
                    </span>
                    <div v-if="r._qOpen" class="quote-content post-body" v-html="renderMD(getParentBody(r))"></div>
                  </div>
    
                  <ForumMedia 
                    v-if="r.media"
                    :hideButtons="true"
                    :media="r.media"
                    :title="r.title || ''"
                    :author="r.author"
                    :permlink="r.permlink"
                    :t="t"
                  >
                    <div class="post-body" v-html="renderMD(r.body, r)"></div>
                  </ForumMedia>
                  <div v-else class="post-body" v-html="renderMD(r.body, r)"></div>
    
                  <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--bg-r3); display: flex; gap: 10px;">
                    <template v-if="auth.user">
                      <button class="btn btn-sm" @click="emit('startReply', r)">{{ t('reply') }}</button>
                      <button v-if="auth.user.username === r.author" class="btn btn-sm btn-ghost" @click="emit('startEdit', r)">{{ t('edit') }}</button>
                    </template>
                  </div>
                </td>
              </tr>
              <!-- Inline reply form for this comment -->
              <tr v-if="replyTarget && replyTarget.permlink===r.permlink">
                <td colspan="2" style="padding:0">
                  <div class="write-form" style="margin:0;border:none;border-radius:0;">
                    <div style="font-weight:bold;color:var(--primary);margin-bottom:10px">
                      {{ t('replyTo') }}: <b>@{{ r.author }}</b>
                    </div>
                    <div style="display:flex; justify-content:flex-end; align-items:center; gap:6px; margin-bottom:4px;">
                      <label v-if="auth.user" class="btn btn-sm btn-ghost" style="cursor:pointer; margin:0; padding:3px 8px;" :style="{opacity: replyImgUpload ? 0.5 : 1}">
                        <span v-if="replyImgUpload" class="spin"></span><span v-else>📎</span>
                        <input type="file" accept="image/*" style="display:none" @change="emit('onReplyImagePick', $event)">
                      </label>
                      <button class="btn btn-sm" :class="replyPreview ? 'btn-ghost' : 'btn-primary'" @click="emit('update:replyPreview', false)">{{ t('write') }}</button>
                      <button class="btn btn-sm" :class="replyPreview ? 'btn-primary' : 'btn-ghost'" @click="emit('update:replyPreview', true)">{{ t('preview') }}</button>
                    </div>
                    <textarea v-if="!replyPreview" v-model="replyForm.body" :placeholder="t('writeReply')" @paste="emit('onReplyPaste', $event)"></textarea>
                    <div v-else class="post-body" style="min-height:80px; border:1px solid var(--input-border); border-radius:4px; padding:10px; background:var(--input-bg);" v-html="replyForm.body ? renderMD(replyForm.body) : '<span style=&quot;opacity:0.4&quot;>...</span>'"></div>
                    
                    <div style="margin-top:10px">
                      <label class="gs" style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                        <input type="checkbox" v-model="replyForm.devTip"> {{ t('devTip') }}
                      </label>
                    </div>
                    <div style="margin-top:8px; padding:8px 10px; border:1px dashed var(--border-main); border-radius:4px;">
                      <div class="gs" style="font-weight:bold; margin-bottom:5px;">👥 {{ t('addBeneficiary') }}</div>
                      <div class="ben-form-row">
                        <input type="text" v-model="replyForm.beneficiary.account" :placeholder="t('beneficiaryAccount')" class="ben-input-account">
                        <input type="number" v-model="replyForm.beneficiary.weight" min="1" max="100" :placeholder="t('beneficiaryWeight')" class="ben-input-pct">
                        <span class="gs ben-pct-label">%</span>
                      </div>
                    </div>
                    <div v-if="replyForm.error" class="alert alert-error" style="margin-top:10px">{{ replyForm.error }}</div>
                    <div v-if="replyForm.success" class="alert alert-success" style="margin-top:10px">{{ replyForm.success }}</div>

                    <div style="margin-top:10px; display:flex; gap:10px;">
                      <button class="btn btn-primary btn-sm" @click="emit('submitReply')" :disabled="replyForm.loading">
                        <span v-if="replyForm.loading" class="spin"></span><i v-else class="fa-solid fa-paper-plane"></i> {{ t('send') }}
                      </button>
                      <button class="btn btn-sm btn-ghost" @click="emit('update:replyTarget', null)"><i class="fa-solid fa-xmark"></i> {{ t('cancel') }}</button>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>
 
    <!-- /topic -->
    <OldContentModal
      v-if="oldContentModal.show"
      :old-content-modal="oldContentModal"
      :t="t"
      @close="oldContentModal.show = false"
      @submit="submitSupportComment"
    />
  </div>
</template>

