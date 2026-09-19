<script setup lang="ts">
import { onMounted, watch, nextTick } from 'vue';
import { dispatchScanView } from '../player/player';
import VoteButton from '../../components/layout/VoteButton.vue';
import PostBeneficiaries from '../../components/layout/PostBeneficiaries.vue';
import ForumMedia from '../player_blurt/components/ForumMedia.ce.vue';
import PayoutBadge from '../../components/layout/PayoutBadge.vue';
import UserAvatar from '../../components/layout/UserAvatar.vue';
import PostEditor from '../../components/layout/PostEditor.vue';
import PostReplyThread from '../post/PostReplyThread.vue';
import type { Post, AuthUser } from '../../types';

const handleLinkClick = (event: MouseEvent) => {
  const target = (event.target as HTMLElement).closest('a[data-internal="true"]');
  if (!target) return;

  event.preventDefault();
  const href = (target as HTMLAnchorElement).href;

  try {
    const url = new URL(href);

    // Format Blurt: /@author/permlink → konwertuj na query params
    const blurtMatch = url.pathname.match(/^\/@([^/]+)\/([^/]+)/);
    if (blurtMatch) {
      const [, author, permlink] = blurtMatch;
      const currentParams = new URLSearchParams(window.location.search);
      const newParams = new URLSearchParams();
      newParams.set('view', 'topic');
      newParams.set('author', author);
      newParams.set('permlink', permlink);
      const forum = currentParams.get('forum');
      if (forum) newParams.set('forum', forum);
      const community = currentParams.get('community');
      if (community) newParams.set('community', community);
      props.navigateToPath('?' + newParams.toString());
      return;
    }

    // Format już z query params: ?view=topic&author=...
    const path = url.pathname + url.search + url.hash;
    props.navigateToPath(path);
  } catch (e) {
    console.warn('Nie udało się przetworzyć linku:', href, e);
  }
};

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
  quickReplyBody: string;
  followingSet: Set<string>;
  canMute: boolean;
  canBanUser: boolean;
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
  config: { communityAccount: string };
  navigateToPath: (path: string) => void;
}>();

const emit = defineEmits<{
  openProfile: [username: string];
  openPayoutModal: [post: Post];
  submitVote: [post: Post];
  startReply: [post: Post];
  startEdit: [post: Post];
  toggleFollow: [username: string];
  mutePost: [post: Post, mute: boolean];
  banUser: [username: string, ban: boolean];
  switchCommunity: [account: string];
  loadTopicContext: [];
  handleMediaAction: [type: string, id: string, host: string, action: string, data: any];
  submitReply: [data?: any];
  onReplySaveDraft: [data: { author: string; permlink: string; body: string }];
  onReplyImagePick: [event: Event];
  onReplyPaste: [event: ClipboardEvent];
  scheduleReplyFeeUpdate: [content: string];
  'update:replyPreview': [value: boolean];
  'update:replyTarget': [value: Post | null];
}>();


const triggerScan = () => {
  const container = document.querySelector('.topic-view-root');
  if (container) dispatchScanView(container);
};
onMounted(triggerScan);
watch(() => [props.activeTopic.permlink, props.replies.length], () => {
  nextTick(triggerScan);
});
</script>

<template>
    <div class="topic-view-root">
      <div v-if="activeTopic.isGloballyBanned" class="forumline forumline-wrap" style="padding: 40px 20px; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 10px;">🚫</div>
        <h2 style="margin: 0 0 8px;">{{ t('contentUnavailableTitle') }}</h2>
        <div class="gs">{{ t('contentUnavailableText') }}</div>
      </div>
      <template v-else>
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

      <div class="forumline-wrap" style="margin-bottom:5px" :style="{ opacity: activeTopic.isMuted ? 0.5 : 1 }">
      <table :id="'post-' + activeTopic.permlink" class="forumline topic-table">
        <thead>
          <tr class="hide-mobile">
            <td class="row3 post-profile"></td>
            <td class="row3">
              <div class="post-header">
                <span class="gs">{{ t('posted') }}: {{ fmtDate(activeTopic.created) }}</span>
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                  <span v-if="activeTopic.isMuted" style="color:var(--alert-error-text); font-weight:bold;">[{{ t('muted') }}]</span>
                  <span v-if="activeTopic.isCommunityBanned" style="color:var(--alert-error-text); font-weight:bold;">🚫 [{{ t('bannedShort') }}]</span>
                  <span v-if="activeTopic.isCoal" class="gs" style="color:var(--alert-error-text);" :title="activeTopic.coalInfo ? (activeTopic.coalInfo.reason + ': ' + activeTopic.coalInfo.notes) : ''"><i class="fa-solid fa-triangle-exclamation"></i> {{ t('coalWarningShort') }}</span>

                  <template v-if="canMute && isPostInCommunity(activeTopic)">
                    <button v-if="!activeTopic.isMuted" class="btn btn-sm btn-hdr" @click="emit('mutePost', activeTopic, true)">🚫 {{ t('mute') }}</button>
                    <button v-else class="btn btn-sm btn-hdr" @click="emit('mutePost', activeTopic, false)">🔓 {{ t('unmute') }}</button>
                  </template>
                  <template v-if="canBanUser && isPostInCommunity(activeTopic)">
                    <button v-if="!activeTopic.isCommunityBanned" class="btn btn-sm btn-hdr btn-danger" @click="emit('banUser', activeTopic.author, true)">🚫 {{ t('banUser') }}</button>
                    <button v-else class="btn btn-sm btn-hdr" @click="emit('banUser', activeTopic.author, false)">🔓 {{ t('unbanUser') }}</button>
                  </template>
                  </div>            </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="row1 post-profile hide-mobile">
              <UserAvatar :username="activeTopic.author" size="lg" @click="emit('openProfile', activeTopic.author)" />
              <div v-if="auth.user && auth.user.username !== activeTopic.author" style="margin-top:8px;">
                <button class="btn btn-sm btn-follow" :class="followingSet.has(activeTopic.author) ? 'btn-ghost' : 'btn-accent'" @click="emit('toggleFollow', activeTopic.author)">
                  <i class="fa-solid" :class="followingSet.has(activeTopic.author) ? 'fa-user-check' : 'fa-user-plus'"></i>
                  {{ followingSet.has(activeTopic.author) ? t('followed') : t('follow') }}
                </button>
              </div>
              <div class="gs" style="margin-top:8px; font-weight: bold;"><a :href="'?view=profile&user=' + activeTopic.author" @click.prevent="emit('openProfile', activeTopic.author)">@{{ activeTopic.author }}</a><br>{{ t('blurtUser') }}</div>
            </td>
            <td class="row1 post-body-cell">
              <!-- Mobile Header (OP) -->
              <div class="comment-mobile-header show-mobile">
                <UserAvatar :username="activeTopic.author" size="xs" @click="emit('openProfile', activeTopic.author)" />
                <div style="flex:1">
                  <div style="font-weight:bold; font-size:14px;"><a :href="'?view=profile&user=' + activeTopic.author" @click.prevent="emit('openProfile', activeTopic.author)">@{{ activeTopic.author }}</a></div>
                  <div class="gs" style="font-size:10px;">{{ fmtDate(activeTopic.created) }}</div>
                </div>
                <button v-if="auth.user && auth.user.username !== activeTopic.author" 
                        class="btn btn-xs btn-follow" :class="followingSet.has(activeTopic.author) ? 'btn-ghost' : 'btn-accent'" @click="emit('toggleFollow', activeTopic.author)"
                        style="width:auto; margin:0; padding:2px 6px !important;">
                  <i class="fa-solid" :class="followingSet.has(activeTopic.author) ? 'fa-user-check' : 'fa-user-plus'"></i>
                </button>
              </div>

              <!-- Mobile Header Stats (OP) -->
              <div class="show-mobile" style="margin-bottom:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                  <span v-if="activeTopic.isMuted" style="color:var(--alert-error-text); font-weight:bold;">[{{ t('muted') }}]</span>
                  <span v-if="activeTopic.isCommunityBanned" style="color:var(--alert-error-text); font-weight:bold;">🚫 [{{ t('bannedShort') }}]</span>
                  <span v-if="activeTopic.isCoal" class="gs" style="color:var(--alert-error-text);" :title="activeTopic.coalInfo ? (activeTopic.coalInfo.reason + ': ' + activeTopic.coalInfo.notes) : ''"><i class="fa-solid fa-triangle-exclamation"></i> {{ t('coalWarningShort') }}</span>
                  <PostBeneficiaries :beneficiaries="activeTopic.beneficiaries" :limit="2" :t="t" :community-account="config.communityAccount" @open-profile="(u) => emit('openProfile', u)" />
                  <template v-if="canMute && isPostInCommunity(activeTopic)">
                    <button v-if="!activeTopic.isMuted" class="btn btn-sm btn-hdr" @click="emit('mutePost', activeTopic, true)">🚫 {{ t('mute') }}</button>
                    <button v-else class="btn btn-sm btn-hdr" @click="emit('mutePost', activeTopic, false)">🔓 {{ t('unmute') }}</button>
                  </template>
                  <template v-if="canBanUser && isPostInCommunity(activeTopic)">
                    <button v-if="!activeTopic.isCommunityBanned" class="btn btn-sm btn-hdr btn-danger" @click="emit('banUser', activeTopic.author, true)">🚫 {{ t('banUser') }}</button>
                    <button v-else class="btn btn-sm btn-hdr" @click="emit('banUser', activeTopic.author, false)">🔓 {{ t('unbanUser') }}</button>
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
                <div class="post-body" v-html="renderMD(activeTopic.body, activeTopic)" @click="handleLinkClick"></div>
              </ForumMedia>
              <div v-else class="post-body" v-html="renderMD(activeTopic.body, activeTopic)" @click="handleLinkClick"></div>
              <div style="margin-top:15px;padding-top:10px;border-top:1px solid var(--surface-4); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 10px;">
                  <template v-if="auth.user">
                    <button class="btn btn-sm" @click="emit('startReply', activeTopic)">{{ t('reply') }}</button>
                    <button v-if="auth.user.username === activeTopic.author" class="btn btn-sm btn-ghost" @click="emit('startEdit', activeTopic)">{{ t('edit') }}</button>
                  </template>
                  <span v-else class="gs" style="font-weight: bold;">{{ t('loginToReply') }}</span>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                  <PayoutBadge :post="activeTopic" :show-currency="true" @click="emit('openPayoutModal', activeTopic)" />
                  <VoteButton 
                    :voted="hasVoted(activeTopic)" 
                    :count="activeTopic.vote_count" 
                    :pending="!!activeTopic._pendingVote"
                    :t="t"
                    @vote="emit('submitVote', activeTopic)" 
                    style="font-size: 16px;"
                  />
                </div>
              </div>
            </td>
          </tr>
          <!-- Unified PostEditor for main post -->
          <tr v-if="replyTarget && replyTarget.permlink===activeTopic.permlink">
            <td colspan="2" style="padding:0">
              <PostEditor
                mode="reply"
                :parent="activeTopic"
                :auth="auth"
                :t="t"
                :renderMD="renderMD"
                :loading="replyForm.loading"
                :error="replyForm.error"
                :success="replyForm.success"
                :initialBody="replyForm.body"
                :imgUpload="replyImgUpload"
                :feeEstimate="replyFeeEstimate"
                @submit="(data) => emit('submitReply', data)"
                @cancel="emit('update:replyTarget', null)"
                @imagePick="(e) => emit('onReplyImagePick', e)"
                @paste="(e) => emit('onReplyPaste', e)"
                @saveDraft="(d) => emit('onReplySaveDraft', { author: activeTopic.author, permlink: activeTopic.permlink, body: d.body })"
                @scheduleFeeUpdate="(c) => emit('scheduleReplyFeeUpdate', c)"
                style="margin:0; border:none; border-radius:0;"
              />
            </td>
          </tr>
        </tbody>
      </table>
      </div>
 
      <!-- COMMENTS SECTION -->
      <PostReplyThread
        :replies="replies"
        :repliesLoading="repliesLoading"
        :auth="auth"
        :replyTarget="replyTarget"
        :replyForm="replyForm"
        :replyImgUpload="replyImgUpload"
        :replyFeeEstimate="replyFeeEstimate"
        :followingSet="followingSet"
        :canMute="canMute"
        :canBanUser="canBanUser"
        :t="t"
        :fmtDate="fmtDate"
        :renderMD="renderMD"
        :hasVoted="hasVoted"
        :isNestedReply="isNestedReply"
        :getParentBody="getParentBody"
        :isPostInCommunity="isPostInCommunity"
        :config="config"
        :navigateToPath="navigateToPath"
        @open-profile="(u) => emit('openProfile', u)"
        @open-payout-modal="(p) => emit('openPayoutModal', p)"
        @submit-vote="(p) => emit('submitVote', p)"
        @start-reply="(p) => emit('startReply', p)"
        @start-edit="(p) => emit('startEdit', p)"
        @toggle-follow="(u) => emit('toggleFollow', u)"
        @mute-post="(p, m) => emit('mutePost', p, m)"
        @ban-user="(u, b) => emit('banUser', u, b)"
        @submit-reply="(d) => emit('submitReply', d)"
        @on-reply-save-draft="(d) => emit('onReplySaveDraft', d)"
        @on-reply-image-pick="(e) => emit('onReplyImagePick', e)"
        @on-reply-paste="(e) => emit('onReplyPaste', e)"
        @schedule-reply-fee-update="(c) => emit('scheduleReplyFeeUpdate', c)"
        @update:replyTarget="(v) => emit('update:replyTarget', v)"
      />
 
      <!-- QUICK REPLY (ALWAYS VISIBLE AT BOTTOM) -->
      <div v-if="auth.user" class="quick-reply-area" style="margin-top: 20px;">
        <div class="forumline forumline-wrap" style="padding: 0;">
          <PostEditor
            mode="reply"
            :parent="activeTopic"
            :auth="auth"
            :t="t"
            :renderMD="renderMD"
            :loading="replyForm.loading"
            :error="replyForm.error"
            :success="replyForm.success"
            :initialBody="quickReplyBody"
            :imgUpload="replyImgUpload"
            :feeEstimate="replyFeeEstimate"
            :hide-cancel="true"
            @submit="(data) => emit('submitReply', { ...data, _target: activeTopic })"
            @cancel="() => {}"
            @imagePick="(e) => emit('onReplyImagePick', e)"
            @paste="(e) => emit('onReplyPaste', e)"
            @saveDraft="(d) => emit('onReplySaveDraft', { author: activeTopic.author, permlink: activeTopic.permlink, body: d.body })"
            @scheduleFeeUpdate="(c) => emit('scheduleReplyFeeUpdate', c)"
            style="margin:0; border:none; border-radius:0;"
          />
        </div>
      </div>
 
    <!-- /topic -->
    </template>

  </div>
</template>
