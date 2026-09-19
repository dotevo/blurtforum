<script setup lang="ts">
/**
 * The actual "comment thread" rendering — extracted out of TopicView.vue so
 * it has exactly one implementation, used both by the full topic page and
 * by the media player's "Comments" tab (see
 * modules/player_blurt/components/BlurtCommentsTab.vue). Same markup, same
 * theme tokens, same behavior everywhere; no place-specific styling forked
 * off into a second copy.
 *
 * `navigateToPath` is only used for in-body link clicks (e.g. a comment
 * quoting/linking another post) — same handling as TopicView.vue had inline.
 */
import VoteButton from '../../components/layout/VoteButton.vue';
import PostBeneficiaries from '../../components/layout/PostBeneficiaries.vue';
import ForumMedia from '../player_blurt/components/ForumMedia.ce.vue';
import PayoutBadge from '../../components/layout/PayoutBadge.vue';
import UserAvatar from '../../components/layout/UserAvatar.vue';
import PostEditor from '../../components/layout/PostEditor.vue';
import type { Post, AuthUser } from '../../types';

const props = defineProps<{
  replies: Post[];
  repliesLoading: boolean;
  auth: { user: AuthUser | null };
  /** Pass null (and never set it) from a read-only host (e.g. the player's
   *  comments tab) to skip inline reply composition entirely — the
   *  PostEditor row only renders when this matches a given reply. */
  replyTarget: Post | null;
  replyForm: {
    body: string; loading: boolean; error: string; success: string;
    beneficiary: { account: string; weight: string };
    devTip?: boolean;
  };
  replyImgUpload: boolean;
  replyFeeEstimate: string | null;
  followingSet: Set<string>;
  canMute: boolean;
  /** Only owner/admin - shows the "ban user" button next to "mute", separate from canMute. */
  canBanUser: boolean;
  t: (k: string) => string;
  fmtDate: (s: string) => string;
  renderMD: (s: string, ctx?: unknown) => string;
  hasVoted: (p: Post) => boolean;
  isNestedReply: (r: Post) => boolean;
  getParentBody: (r: Post) => string;
  isPostInCommunity: (p: Post) => boolean;
  config: { communityAccount: string };
  navigateToPath: (path: string) => void;
  /** Condensed rendering for tight spaces (e.g. the player's comments tab) —
   *  forces the mobile-style compact header even on wide viewports, smaller
   *  type/spacing. Same markup/data everywhere, just a CSS-level variant. */
  compact?: boolean;
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
  submitReply: [data?: any];
  onReplySaveDraft: [data: { author: string; permlink: string; body: string }];
  onReplyImagePick: [event: Event];
  onReplyPaste: [event: ClipboardEvent];
  scheduleReplyFeeUpdate: [content: string];
  'update:replyTarget': [value: Post | null];
}>();

const handleLinkClick = (event: MouseEvent) => {
  const target = (event.target as HTMLElement).closest('a[data-internal="true"]');
  if (!target) return;

  event.preventDefault();
  const href = (target as HTMLAnchorElement).href;

  try {
    const url = new URL(href);
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
    const path = url.pathname + url.search + url.hash;
    props.navigateToPath(path);
  } catch (e) {
    console.warn('Nie udało się przetworzyć linku:', href, e);
  }
};
</script>

<template>
  <div :class="{ 'pr-thread--compact': compact }">
  <div v-if="repliesLoading" class="loader"><span class="spin"></span>{{ t('loadingComments') }}</div>

  <template v-else>
    <div v-if="replies.length>0"
         style="background:var(--modal-header-bg);color:var(--modal-header-text);padding:8px 12px;font-weight:bold;font-size:11px;text-transform:uppercase;margin-bottom:5px; border-radius: var(--radius-sm);">
      {{ t('comments') }} ({{ replies.length }})
    </div>
    <div v-else style="padding:20px 0;color:#666;font-size:12px; font-weight: bold; text-align: center;">{{ t('noComments') }}</div>

    <template v-for="(r,i) in replies" :key="r.permlink">
      <!-- Compact Bar for Collapsed Support Comment -->
      <div v-if="r.isCollapsed" class="collapsed-support-bar" @click="r.isCollapsed=false" style="cursor:pointer;">
        <span class="vote-info">
          <i class="fa-solid fa-caret-up" style="color:var(--brand)"></i>
          {{ r.vote_count }}
        </span>
        <span class="gs"><i class="fa-solid fa-robot" style="font-size:10px; opacity:0.6;"></i> {{ t('automatedSupportComment') }}</span>
        <span class="author-tag">@{{ r.author }}</span>
        <span class="expand-btn">[{{ t('show') }}]</span>
      </div>

      <div v-else class="forumline-wrap" style="margin-bottom:5px" :style="{ opacity: r.isMuted ? 0.5 : 1 }">
      <table :id="'post-' + r.permlink" class="forumline topic-table">
        <thead>
          <tr class="hide-mobile">
            <td class="row3 post-profile"><b><a :href="'?view=profile&user=' + r.author" @click.prevent="emit('openProfile', r.author)">@{{ r.author }}</a></b></td>
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
                  <span v-if="r.isMuted" style="color:var(--alert-error-text); font-weight:bold;">[{{ t('muted') }}]</span>
                  <span v-if="r.isCommunityBanned" style="color:var(--alert-error-text); font-weight:bold;">🚫 [{{ t('bannedShort') }}]</span>
                  <span v-if="r.isCoal" class="gs" style="color:var(--alert-error-text);" :title="r.coalInfo ? (r.coalInfo.reason + ': ' + r.coalInfo.notes) : ''"><i class="fa-solid fa-triangle-exclamation"></i></span>
                  <PostBeneficiaries :beneficiaries="r.beneficiaries" :t="t" :community-account="config.communityAccount" @open-profile="(u) => emit('openProfile', u)" />
                  <template v-if="canMute && isPostInCommunity(r)">
                    <button v-if="!r.isMuted" class="btn btn-sm btn-hdr" @click="emit('mutePost', r, true)">🚫 {{ t('mute') }}</button>
                    <button v-else class="btn btn-sm btn-hdr" @click="emit('mutePost', r, false)">🔓 {{ t('unmute') }}</button>
                  </template>
                  <template v-if="canBanUser && isPostInCommunity(r)">
                    <button v-if="!r.isCommunityBanned" class="btn btn-sm btn-hdr btn-danger" @click="emit('banUser', r.author, true)">🚫 {{ t('banUser') }}</button>
                    <button v-else class="btn btn-sm btn-hdr" @click="emit('banUser', r.author, false)">🔓 {{ t('unbanUser') }}</button>
                  </template>
                  </div>              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td :class="i%2===0?'row1':'row2'" class="post-profile hide-mobile">
              <UserAvatar :username="r.author" size="sm" @click="emit('openProfile', r.author)" />
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
                <UserAvatar :username="r.author" size="xs" @click="emit('openProfile', r.author)" />
                <div style="flex:1">
                  <div style="font-weight:bold; font-size:13px;"><a :href="'?view=profile&user=' + r.author" @click.prevent="emit('openProfile', r.author)">@{{ r.author }}</a></div>
                  <div class="gs" style="font-size:10px;">#{{ i+1 }} · {{ fmtDate(r.created) }}</div>
                </div>

                <button v-if="auth.user && auth.user.username !== r.author"
                        class="btn btn-xs btn-follow" :class="followingSet.has(r.author) ? 'btn-ghost' : 'btn-accent'" @click="emit('toggleFollow', r.author)"
                        style="width:auto; margin:0; padding:2px 6px !important;">
                  <i class="fa-solid" :class="followingSet.has(r.author) ? 'fa-user-check' : 'fa-user-plus'"></i>
                </button>

                  <template v-if="canMute && isPostInCommunity(r)">
                    <button v-if="!r.isMuted" class="btn btn-sm btn-hdr" @click="emit('mutePost', r, true)">🚫 {{ t('mute') }}</button>
                    <button v-else class="btn btn-sm btn-hdr" @click="emit('mutePost', r, false)">🔓 {{ t('unmute') }}</button>
                  </template>
                  <template v-if="canBanUser && isPostInCommunity(r)">
                    <button v-if="!r.isCommunityBanned" class="btn btn-sm btn-hdr btn-danger" @click="emit('banUser', r.author, true)">🚫 {{ t('banUser') }}</button>
                    <button v-else class="btn btn-sm btn-hdr" @click="emit('banUser', r.author, false)">🔓 {{ t('unbanUser') }}</button>
                  </template>

              </div>

              <!-- Mobile Header Stats (payout/votes) -->
              <div class="show-mobile" style="margin-bottom:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">

                  <span v-if="r.isMuted" style="color:var(--alert-error-text); font-weight:bold;">[{{ t('muted') }}]</span>
                  <span v-if="r.isCommunityBanned" style="color:var(--alert-error-text); font-weight:bold;">🚫 [{{ t('bannedShort') }}]</span>
                  <span v-if="r.isCoal" class="gs" style="color:var(--alert-error-text);" :title="r.coalInfo ? (r.coalInfo.reason + ': ' + r.coalInfo.notes) : ''"><i class="fa-solid fa-triangle-exclamation"></i> {{ t('coalWarningShort') }}</span>
                  <PostBeneficiaries :beneficiaries="r.beneficiaries" :limit="2" :t="t" :community-account="config.communityAccount" @open-profile="(u) => emit('openProfile', u)" />

                </div>
                <div v-if="(r.depth ?? 0) > 1" class="depth-badge">↳ {{ t('nested') }}</div>
              </div>

              <!-- Quote of parent comment (only when it's a nested reply, not a direct reply to OP) -->
              <div class="coal-blur-wrap">
              <div class="coal-content" :class="{ 'coal-blurred': r.isCoal && r.isCoalCollapsed }">

              <div v-if="isNestedReply(r)" class="quote-box">
                <span style="font-weight: bold;">{{ t('replyTo') }}: <a :href="'?view=profile&user=' + r.parent_author" @click.prevent="emit('openProfile', r.parent_author)">@{{ r.parent_author }}</a></span>
                <span class="quote-toggle" @click="r._qOpen=!r._qOpen">
                  [{{ r._qOpen ? t('hide') : t('show') }}]
                </span>
                <div v-if="r._qOpen" class="quote-content post-body" v-html="renderMD(getParentBody(r))" @click="handleLinkClick"></div>
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
                <div class="post-body" v-html="renderMD(r.body, r)" @click="handleLinkClick"></div>
              </ForumMedia>
              <div v-else class="post-body" v-html="renderMD(r.body, r)" @click="handleLinkClick"></div>

              </div>
              <!-- COAL warning overlay: content is blurred until the reader explicitly acknowledges it -
                   deliberately click-to-reveal rather than hover, since hover doesn't exist on mobile. -->
              <div v-if="r.isCoal && r.isCoalCollapsed" class="coal-overlay">
                <div class="coal-overlay-box">
                  <i class="fa-solid fa-triangle-exclamation"></i>
                  <div class="coal-overlay-title">{{ t('coalVoteWarningTitle') }}</div>
                  <div class="coal-overlay-text">{{ r.coalInfo?.reason }}<span v-if="r.coalInfo?.notes"> — {{ r.coalInfo?.notes }}</span></div>
                  <a href="https://coal.blurtwallet.com/" target="_blank" rel="noopener" class="coal-overlay-link" @click.stop>{{ t('coalVoteWarningLink') }}</a>
                  <button class="btn btn-sm btn-accent" @click="r.isCoalCollapsed=false">{{ t('coalAcknowledge') }}</button>
                </div>
              </div>
              </div>

              <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--surface-4); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 10px;">
                  <template v-if="auth.user">
                    <button class="btn btn-sm" @click="emit('startReply', r)">{{ t('reply') }}</button>
                    <button v-if="auth.user.username === r.author" class="btn btn-sm btn-ghost" @click="emit('startEdit', r)">{{ t('edit') }}</button>
                  </template>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                  <PayoutBadge :post="r" :precision="3" @click="emit('openPayoutModal', r)" />
                  <VoteButton
                    :voted="hasVoted(r)"
                    :count="r.vote_count"
                    :pending="!!r._pendingVote"
                    :t="t"
                    @vote="emit('submitVote', r)"
                  />
                </div>
              </div>
            </td>
          </tr>
          <!-- Unified PostEditor for this comment -->
          <tr v-if="replyTarget && replyTarget.permlink===r.permlink">
            <td colspan="2" style="padding:0">
              <PostEditor
                mode="reply"
                :parent="r"
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
                @saveDraft="(d) => emit('onReplySaveDraft', { author: r.author, permlink: r.permlink, body: d.body })"
                @scheduleFeeUpdate="(c) => emit('scheduleReplyFeeUpdate', c)"
                style="margin:0; border:none; border-radius:0;"
              />
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </template>
  </template>
  </div>
</template>

<style scoped>
/* Compact mode: always use the mobile-style condensed header/layout (already
   built for narrow viewports) instead of the wide two-column table look, and
   tighten up spacing/type — used by the player's comments tab where the
   sidebar is much narrower than the full topic page. */
.pr-thread--compact :deep(.hide-mobile) { display: none !important; }
.pr-thread--compact :deep(.show-mobile) { display: flex !important; }
.pr-thread--compact :deep(.topic-table) { margin-bottom: 8px !important; }
.pr-thread--compact :deep(.post-body-cell) { padding: 8px !important; }
.pr-thread--compact :deep(.post-body) { font-size: 12px !important; line-height: 1.4 !important; }
.pr-thread--compact :deep(.comment-mobile-header) { margin: 0 0 6px 0 !important; padding: 0 !important; background: none !important; border: none !important; }
.pr-thread--compact :deep(.avatar-xs) { width: 24px !important; height: 24px !important; }
.pr-thread--compact :deep(.quote-box) { padding: 6px !important; font-size: 11px !important; }


/* ===== Moved from global style.css (component-specific) ===== */
/* ===== QUOTE BLOCK ===== */
.quote-box {
  background: var(--quote-bg);
  border: 1px solid var(--quote-border);
  padding: 10px;
  margin-bottom: 10px;
  font-size: 13px;
}
.quote-toggle {
  cursor: pointer;
  color: var(--quote-toggle-color);
  font-weight: bold;
  margin-left: 5px;
}
.quote-toggle:hover { color: var(--quote-toggle-hover-color); }
.quote-content {
  margin-top: 5px;
  padding: 10px;
  background: var(--quote-content-bg);
  border: 1px solid var(--quote-content-border);
  line-height: 1.5;
  max-height: 200px;
  overflow-y: auto;
}
 

.depth-badge { display: inline-block; font-size: 11px; color: var(--depth-badge-text); margin-left: 5px; }

/* ===== COMPACT COLLAPSED BAR ===== */
.collapsed-support-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--collapsed-bar-bg);
  border: 1px solid var(--collapsed-bar-border);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  margin-bottom: 5px;
  font-size: 11px;
  color: var(--collapsed-bar-text);
}
.collapsed-support-bar .author-tag {
  font-weight: bold;
  color: var(--collapsed-bar-strong-text);
}
.collapsed-support-bar .expand-btn {
  margin-left: auto;
  cursor: pointer;
  font-weight: bold;
  color: var(--collapsed-bar-link-color);
  text-decoration: underline;
}
.collapsed-support-bar .expand-btn:hover {
  color: var(--collapsed-bar-link-hover);
}
.collapsed-support-bar .vote-info {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--collapsed-bar-strong-text);
  font-weight: bold;
}
</style>
