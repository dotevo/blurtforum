<script setup lang="ts">
import { useApp } from './composables/useApp';

// Layout
import LangBar from './components/layout/LangBar.vue';
import SiteHeader from './components/layout/SiteHeader.vue';
import CommunityBar from './components/layout/CommunityBar.vue';
import GlobalActivity from './components/layout/GlobalActivity.vue';
import NavBar from './components/layout/NavBar.vue';

// Views
import ForumIndex from './components/forum/ForumIndex.vue';
import ForumView from './components/forum/ForumView.vue';
import TopicView from './components/forum/TopicView.vue';
import CommunitiesView from './components/forum/CommunitiesView.vue';
import ProfileView from './components/profile/ProfileView.vue';

// Player
import MediaPlayer from './components/player/MediaPlayer.vue';

// Modals
import LoginModal from './components/modals/LoginModal.vue';
import PayoutModal from './components/modals/PayoutModal.vue';
import NotifModal from './components/modals/NotifModal.vue';
import EditModal from './components/modals/EditModal.vue';
import PinModal from './components/modals/PinModal.vue';
import VoteModal from './components/modals/VoteModal.vue';
import FollowModal from './components/modals/FollowModal.vue';
import OldContentModal from './components/modals/OldContentModal.vue';
import StructureDocs from './components/modals/StructureDocs.vue';
import LayoutEditor from './components/modals/LayoutEditor.vue';
import ImageLightbox from './components/modals/ImageLightbox.vue';
import PlaylistModal from './components/modals/PlaylistModal.vue';

const {
  lang, setLang, langs, t, theme, setTheme, themes, config, view, loading, globalProps, forumStructure,
  activeForum, activeTopic, replies, repliesLoading, moderators, communityInfo,
  structureNote, selectedCommunity, currentTagFilter, applyTagFilter, clearTagFilter,
  customTag, allCommunities, userSubscriptions, auth, showLoginModal, loginTab,
  loginForm, loginErr, loginBusy, wvAvailable, replyTarget, replyForm,
  showNewPostForm, openNewPostForm, postForm, fmtDate, timeAgo, forumHasUnread,
  renderMD, isNestedReply, getParentBody,
  goHome, openForum, openTopic, handleCommunityChange, switchCommunity, openCommunities,
  toggleCommunitySub, openLoginModal,
  community,
  doKeyLogin, doWVLogin, logout, startReply, submitReply, submitPost, loadData,
  nextPage, prevPage,
  submitVote, hasVoted, openPayoutModal, payoutModal, openNotifModal, notifModal,
  playlistModal, handlePlaylistConfirm,
  followModal, confirmToggleFollow,
  openProfile, profileUser, profileTab, fetchEarningsHistory, openNotification,
  userRole, canEditStructure, canMute, mutePost, editStructureMode, startEditStructure, saveStructure,
  structureForm, showStructureDocs,
  forumPagination, loadMorePosts,
  pinModal, handlePinSubmit,
  globalActivity, activityTab, activityExpanded, activityFullList, mobileActivityExpanded, openActivity,
  editModal, startEdit, submitEdit,
  oldContentModal, submitSupportComment,
  voteModal, openVoteModal, submitVoteConfirmed, estimateVote,
  feeInfo, postFeeEstimate, replyFeeEstimate, schedulePostFeeUpdate, scheduleReplyFeeUpdate,
  bcWaitQueue, bcQueueExpanded,
  imgModal, openImgModal,
  statusModal, showStatus,
  claimRewards,
  postPreview, replyPreview, saveDraft, clearDraft,
  postImgUpload, replyImgUpload, onPostImagePick, onReplyImagePick, onPostPaste, onReplyPaste,
  rpcMenuOpen, rpcDataNode, rpcForumNode, rpcDataCustom, rpcForumCustom, applyRpcSettings,
  checkNewNotifications,
  getNotifIcon,
  loadTopicContext,
  isPostInCommunity,
  toggleFollow,
  explorationExpanded,
  explorationForm,
  toggleExploration,
  followingSet,
  handleMediaAction,
  player,
  handlePlayerSeek,
  vw,
  client,
} = useApp();
</script>

<template>
<div
  :class="{
    'has-player-active': player.state.active && !player.state.minimized,
    'has-player-expanded': player.state.active && player.state.expanded && !player.state.minimized
  }"
  :style="{ paddingBottom: (player.state.active && !player.state.minimized) ? (player.state.expanded ? (player.state.expandedHeight + 20) + 'px' : '120px') : '' }"
>

  <!-- ── Layout ─────────────────────────────────────────────────── -->

  <LangBar
    :theme="theme" :themes="themes" :lang="lang" :langs="langs"
    :rpc-menu-open="rpcMenuOpen"
    :rpc-data-node="rpcDataNode" :rpc-forum-node="rpcForumNode"
    :rpc-data-custom="rpcDataCustom" :rpc-forum-custom="rpcForumCustom"
    :t="t"
    @set-theme="setTheme" @set-lang="(v: string) => setLang(v as 'en'|'pl'|'eo')"
    @update:rpc-menu-open="rpcMenuOpen = $event"
    @update:rpc-data-node="rpcDataNode = $event"
    @update:rpc-forum-node="rpcForumNode = $event"
    @update:rpc-data-custom="rpcDataCustom = $event"
    @update:rpc-forum-custom="rpcForumCustom = $event"
    @apply-rpc-settings="applyRpcSettings"
  />

  <SiteHeader
    :community-title="communityInfo.title || ''"
    :community-account="config.communityAccount"
    :head-block-number="globalProps.head_block_number || '…'"
    :auth="auth"
    :has-new-notif="notifModal.hasNew"
    :t="t"
    @go-home="goHome"
    @open-login-modal="openLoginModal"
    @open-notif-modal="openNotifModal"
    @open-profile="openProfile"
    @logout="logout"
  />

  <CommunityBar
    :selected-community="selectedCommunity"
    :all-communities="allCommunities"
    :custom-tag="customTag"
    :community-account="config.communityAccount"
    :t="t"
    @update:selected-community="selectedCommunity = $event"
    @update:custom-tag="customTag = $event"
    @handle-community-change="handleCommunityChange"
    @open-communities="openCommunities"
  />

  <GlobalActivity
    :auth="auth"
    :global-activity="globalActivity"
    :activity-tab="activityTab"
    :activity-expanded="activityExpanded"
    :activity-full-list="activityFullList"
    :t="t"
    :time-ago="timeAgo"
    @update:activity-tab="activityTab = $event"
    @update:activity-expanded="activityExpanded = $event"
    @update:activity-full-list="activityFullList = $event"
    @open-activity="openActivity"
  />

  <NavBar
    :view="view"
    :community-account="config.communityAccount"
    :auth="auth"
    :active-forum="activeForum"
    :active-topic="activeTopic"
    :t="t"
    @go-home="goHome"
    @load-data="loadData()"
    @open-new-post-form="openNewPostForm"
    @open-forum="openForum"
  />

  <!-- ── Main content ───────────────────────────────────────────── -->

  <div class="content">

    <!-- Reward notification -->
    <div v-if="auth.user && auth.user.hasRewards"
         style="background:var(--accent); color:var(--bg-page); padding:10px 15px; margin-bottom:15px; border-radius:4px; display:flex; align-items:center; flex-wrap:wrap; gap:10px; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
      <div style="flex:1"><i class="fa-solid fa-gift"></i> {{ t('rewardsAvailable') }}: {{ auth.user.rewardBlurt }} / {{ auth.user.rewardVesting }}</div>
      <button class="btn btn-sm" @click="claimRewards" style="background:var(--bg-white); color:var(--accent); border:none">{{ t('claimRewards') }}</button>
    </div>

    <div v-if="loading" class="loader"><span class="spin"></span>{{ t('loading') }} {{ config.communityAccount }}…</div>

    <div v-if="!loading && forumPagination.bgLoading" style="background: var(--nav-bg); padding: 5px 15px; margin-bottom: 15px; border-radius: 4px; display: flex; align-items: center; gap: 10px; border: 1px solid var(--border-main);">
      <div style="flex: 1; height: 4px; background: var(--bg-page); border-radius: 2px; overflow: hidden;">
        <div :style="{ width: (forumPagination.fetchedCount / 300 * 100) + '%', height: '100%', background: 'var(--primary)', transition: 'width 0.3s' }"></div>
      </div>
      <span class="gs">{{ t('fetchingMore') }} ({{ forumPagination.fetchedCount }}/300)</span>
    </div>

    <!-- Blockchain wait queue panel -->
    <div v-if="bcWaitQueue.length > 0" class="bc-queue-panel">
      <div class="bc-queue-inner">
        <template v-for="(entry, idx) in (bcQueueExpanded ? bcWaitQueue : bcWaitQueue.slice(0, 3))" :key="entry.id">
          <div class="bc-queue-item">
            <div class="bc-queue-bar-wrap">
              <div class="bc-queue-bar-fill" :style="{ width: entry.progress + '%' }"></div>
            </div>
            <span class="bc-queue-label">⛓ {{ entry.label }}</span>
          </div>
        </template>
        <button v-if="bcWaitQueue.length > 3 && !bcQueueExpanded" class="bc-queue-more" @click="bcQueueExpanded = true">
          +{{ bcWaitQueue.length - 3 }} {{ t('more') || 'more' }} ▾
        </button>
      </div>
    </div>

    <template v-if="!loading">

      <!-- Tag filter bar -->
      <div v-if="(view==='index' && currentTagFilter) || (view==='forum')" class="tag-filter-bar forumline">
        <div style="display:flex; align-items:center; gap:10px; width: 100%;">
          <i class="fa-solid fa-filter" style="color:var(--primary); opacity:0.7;"></i>
          <div style="position:relative; flex:1; max-width: 300px;">
            <input type="text" v-model="currentTagFilter" :placeholder="t('filterByTag')"
                   @keyup.enter="applyTagFilter"
                   style="width:100%; padding: 6px 30px 6px 10px; box-sizing:border-box;">
            <span v-if="currentTagFilter" @click="clearTagFilter"
                  style="position:absolute; right:8px; top:50%; transform:translateY(-50%); cursor:pointer; opacity:0.5; font-size:14px;">
              <i class="fa-solid fa-circle-xmark"></i>
            </span>
          </div>
          <button class="btn btn-sm" @click="applyTagFilter">OK</button>
        </div>
      </div>

      <!-- ── Views ───────────────────────────────────────────────── -->

      <ForumIndex
        v-if="view === 'index'"
        :forum-structure="forumStructure"
        :community-account="config.communityAccount"
        :community-info="communityInfo"
        :moderators="moderators"
        :structure-note="structureNote"
        :loading="loading"
        :auth="auth"
        :can-edit-structure="canEditStructure"
        :exploration-expanded="explorationExpanded"
        :exploration-form="explorationForm"
        :t="t"
        :time-ago="timeAgo"
        :forum-has-unread="forumHasUnread"
        @open-forum="openForum"
        @open-profile="openProfile"
        @start-edit-structure="startEditStructure"
        @toggle-exploration="toggleExploration"
        @update:show-structure-docs="showStructureDocs = $event"
      />

      <ForumView
        v-if="view === 'forum' && activeForum"
        :active-forum="activeForum"
        :auth="auth"
        :show-new-post-form="showNewPostForm"
        :post-form="postForm"
        :post-preview="postPreview"
        :post-img-upload="postImgUpload"
        :post-fee-estimate="postFeeEstimate"
        :forum-pagination="forumPagination"
        :loading="loading"
        :player="player"
        :config="config"
        :has-voted="hasVoted"
        :t="t"
        :fmt-date="fmtDate"
        :render-m-d="(s: string, ctx?: unknown) => renderMD(s, ctx as Record<string,unknown> | null)"
        @open-new-post-form="openNewPostForm"
        @open-topic="openTopic"
        @open-profile="openProfile"
        @open-payout-modal="openPayoutModal"
        @submit-vote="submitVote"
        @handle-media-action="(type, id, host, action, data) => handleMediaAction(type, id, host, action, data)"
        @submit-post="submitPost"
        @save-draft="saveDraft"
        @clear-draft="clearDraft"
        @on-post-image-pick="onPostImagePick"
        @on-post-paste="onPostPaste"
        @schedule-post-fee-update="schedulePostFeeUpdate"
        @update:post-preview="postPreview = $event"
        @update:show-new-post-form="showNewPostForm = $event"
        @next-page="nextPage"
        @prev-page="prevPage"
        @open-forum="openForum"
      />

      <TopicView
        v-if="view === 'topic' && activeTopic"
        :active-topic="activeTopic"
        :replies="replies"
        :replies-loading="repliesLoading"
        :auth="auth"
        :reply-target="replyTarget"
        :reply-form="replyForm"
        :reply-preview="replyPreview"
        :reply-img-upload="replyImgUpload"
        :reply-fee-estimate="replyFeeEstimate"
        :following-set="followingSet"
        :can-mute="canMute"
        :t="t"
        :fmt-date="fmtDate"
        :time-ago="timeAgo"
        :render-m-d="(s: string, ctx?: unknown) => renderMD(s, ctx as Record<string,unknown> | null)"
        :has-voted="hasVoted"
        :is-nested-reply="isNestedReply"
        :get-parent-body="getParentBody"
        :is-post-in-community="isPostInCommunity"
        @open-profile="openProfile"
        @open-payout-modal="openPayoutModal"
        @submit-vote="submitVote"
        @start-reply="startReply"
        @start-edit="startEdit"
        @toggle-follow="toggleFollow"
        @mute-post="mutePost"
        @switch-community="switchCommunity"
        @load-topic-context="loadTopicContext"
        @submit-reply="submitReply"
        @on-reply-image-pick="onReplyImagePick"
        @on-reply-paste="onReplyPaste"
        @schedule-reply-fee-update="scheduleReplyFeeUpdate"
        @update:reply-preview="replyPreview = $event"
        @update:reply-target="replyTarget = $event"
      />

      <CommunitiesView
        v-if="view === 'communities'"
        :community-list="community.state.list"
        :community-loading="community.state.loading"
        :community-query="community.state.query"
        :community-has-more="community.state.hasMore"
        :user-subscriptions="userSubscriptions"
        :t="t"
        :fmt-date="fmtDate"
        @fetch-more="community.fetchCommunities(client as unknown as Record<string, unknown>)"
        @toggle-sub="toggleCommunitySub"
        @switch-community="switchCommunity"
        @update:community-query="community.state.query = $event"
      />

      <ProfileView
        v-if="view === 'profile' && profileUser.username"
        :profile-user="(profileUser as any)"
        :profile-tab="profileTab"
        :auth="auth"
        :following-set="followingSet"
        :t="t"
        :fmt-date="fmtDate"
        :time-ago="timeAgo"
        :render-m-d="(s: string, ctx?: unknown) => renderMD(s, ctx as Record<string,unknown> | null)"
        :player="player"
        @open-profile="openProfile"
        @open-topic="openTopic"
        @open-payout-modal="openPayoutModal"
        @toggle-follow="toggleFollow"
        @handle-media-action="(type, id, host, action, data) => handleMediaAction(type, id, host, action, data)"
        @update:profile-tab="profileTab = $event"
        @fetch-earnings="() => fetchEarningsHistory(profileUser.username, ((profileUser as any).earnings.history[(profileUser as any).earnings.history.length-1]?.seq || 0) - 1)"
      />

    </template>

    <!-- Footer -->
    <div class="site-footer">
      BlurtForum — Thanks to: <a href="#" @click.stop.prevent="openProfile('drakernoise')">@drakernoise</a> (for RPC), @beblurt/dblurt · Blurt Network | #{{ globalProps.head_block_number||'…' }} | {{ lang.toUpperCase() }}
      <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid var(--border-main); display: flex; justify-content: center; align-items: center; gap: 10px;">
        <span style="font-size: 11px; opacity: 0.6;">Media Player Enabled</span>
      </div>
    </div>

  </div><!-- /content -->

  <!-- ── Player ─────────────────────────────────────────────────── -->

  <MediaPlayer
    :player="player"
    :vw="vw"
    :t="t"
    @player-seek="(pct: number) => player.seek(pct)"
    @open-profile="openProfile"
    @open-topic="(p) => openTopic(p as any)"
    @open-playlist-modal="(track) => { playlistModal.track = track; playlistModal.show = true; }"
    @submit-vote="(p) => submitVote(p as any)"
    @open-payout-modal="(p) => openPayoutModal(p as any)"
  />

  <!-- ── Modals ─────────────────────────────────────────────────── -->

  <LoginModal
    v-if="showLoginModal"
    :login-tab="loginTab"
    :login-form="loginForm"
    :login-err="loginErr"
    :login-busy="loginBusy"
    :wv-available="wvAvailable"
    :t="t"
    @close="showLoginModal = false"
    @do-key-login="doKeyLogin"
    @do-w-v-login="doWVLogin"
    @update:login-tab="loginTab = $event"
  />

  <PayoutModal
    v-if="payoutModal.show"
    :payout-modal="payoutModal"
    :t="t"
    :fmt-date="fmtDate"
    @close="payoutModal.show = false"
    @open-profile="openProfile"
  />

  <NotifModal
    v-if="notifModal.show"
    :notif-modal="notifModal"
    :t="t"
    :time-ago="timeAgo"
    :get-notif-icon="getNotifIcon"
    @close="notifModal.show = false"
    @open-notification="openNotification"
  />

  <StructureDocs
    v-if="showStructureDocs"
    :t="t"
    @close="showStructureDocs = false"
  />

  <LayoutEditor
    v-if="editStructureMode"
    :structure-form="structureForm"
    :t="t"
    @close="editStructureMode = false"
    @save="saveStructure"
  />

  <EditModal
    v-if="editModal.show"
    :edit-modal="editModal"
    :t="t"
    :render-m-d="(s: string, ctx?: unknown) => renderMD(s, ctx as Record<string,unknown> | null)"
    @close="editModal.show = false"
    @submit-edit="submitEdit"
  />

  <PinModal
    v-if="pinModal.show"
    :pin-modal="pinModal"
    :t="t"
    @close="pinModal.show = false"
    @submit="handlePinSubmit"
  />

  <OldContentModal
    v-if="oldContentModal.show"
    :old-content-modal="oldContentModal"
    :t="t"
    @close="oldContentModal.show = false"
    @submit="submitSupportComment"
  />

  <ImageLightbox
    v-if="imgModal.show"
    :img-modal="imgModal"
    :t="t"
    @close="imgModal.show = false"
  />

  <VoteModal
    v-if="voteModal.show"
    :vote-modal="voteModal"
    :t="t"
    @close="voteModal.show = false"
    @confirm="submitVoteConfirmed"
    @estimate-vote="estimateVote"
  />

  <FollowModal
    v-if="followModal.show"
    :follow-modal="followModal"
    :t="t"
    @close="followModal.show = false"
    @confirm="confirmToggleFollow"
  />

  <PlaylistModal
    :show="playlistModal.show"
    :track="playlistModal.track"
    :t="t"
    @close="playlistModal.show = false"
    @confirm="handlePlaylistConfirm"
  />

  <!-- Status modal -->
  <div v-if="statusModal.show" class="modal-overlay" @click.self="statusModal.show=false" style="z-index: 5000;">
    <div class="modal-box" style="width: 350px;">
      <div class="modal-header" :style="{ background: statusModal.type === 'error' ? 'var(--error-border)' : (statusModal.type === 'success' ? 'var(--success-border)' : 'var(--primary)') }">
        <span>{{ statusModal.title }}</span>
        <button class="modal-close" @click="statusModal.show=false">×</button>
      </div>
      <div class="modal-body" style="text-align: center;">
        <div style="font-size: 40px; margin-bottom: 15px;">
          <i v-if="statusModal.type === 'success'" class="fa-solid fa-circle-check" style="color: var(--success-text);"></i>
          <i v-else-if="statusModal.type === 'error'" class="fa-solid fa-circle-xmark" style="color: var(--error-text);"></i>
          <i v-else class="fa-solid fa-circle-info" style="color: var(--primary);"></i>
        </div>
        <div style="font-size: 13px; line-height: 1.5; margin-bottom: 20px;">{{ statusModal.body }}</div>
        <button class="btn btn-primary" style="width: 100%; padding: 10px;" @click="statusModal.show=false">OK</button>
      </div>
    </div>
  </div>

  <!-- Player spacer -->
  <div class="player-spacer"
       :style="{ height: (player.state.active && !player.state.minimized) ? (player.state.expanded ? player.state.expandedHeight + 'px' : '100px') : '0px' }">
  </div>

</div><!-- /root -->
</template>
