<script setup lang="ts">
import { defineAsyncComponent, watch, computed, ref } from 'vue';
import { useApp } from './composables/useApp';
import { useTitle } from './composables/useTitle';
import { installCinemaDpadNav } from './modules/cinema/dpad-nav';
import { isTVPlatform } from './modules/native/platform-info';
import { activeProfile } from './modules/device-profiles/device-profiles';
import { limitReached } from './modules/device-profiles/watch-time';
import CinemaProfileGate from './modules/device-profiles/components/CinemaProfileGate.vue';
import ManageProfiles from './modules/device-profiles/components/ManageProfiles.vue';
import WatchLimitReached from './modules/device-profiles/components/WatchLimitReached.vue';
import type { Post } from './types';

// Layout
import LangBar from './components/layout/LangBar.vue';
import SiteHeader from './components/layout/SiteHeader.vue';
import CommunityBar from './components/layout/CommunityBar.vue';
import GlobalActivity from './components/layout/GlobalActivity.vue';
import NavBar from './components/layout/NavBar.vue';
import MobileTopBar from './components/layout/MobileTopBar.vue';
import MobileContext from './components/layout/MobileContext.vue';
import CinemaRail from './modules/cinema/CinemaRail.vue';
import CinemaIndex from './modules/cinema/CinemaIndex.vue';

// Views (Sync for core, Async for heavy)
import ForumIndex from './modules/forum/ForumIndex.vue';
import ForumView from './modules/forum/ForumView.vue';
import TopicView from './modules/forum/TopicView.vue';
const CommunitiesView = defineAsyncComponent(() => import('./modules/forum/CommunitiesView.vue'));
const ProfileView = defineAsyncComponent(() => import('./components/profile/ProfileView.vue'));

// Player
const MediaPlayer = defineAsyncComponent(() => import('./modules/player_blurt/components/ForumMediaPlayer.vue'));

// Shoutbox (backend-free WebRTC presence chat — see modules/shoutbox/README.md)
const ShoutboxWidget = defineAsyncComponent(() => import('./modules/shoutbox/components/ShoutboxWidget.vue'));

// Modals (Async)
const LoginModal = defineAsyncComponent(() => import('./components/modals/LoginModal.vue'));
const PayoutModal = defineAsyncComponent(() => import('./components/modals/PayoutModal.vue'));
const NotifModal = defineAsyncComponent(() => import('./modules/notifications/components/NotifModal.vue'));
const EditModal = defineAsyncComponent(() => import('./components/modals/EditModal.vue'));
const PinModal = defineAsyncComponent(() => import('./components/modals/PinModal.vue'));
const VoteModal = defineAsyncComponent(() => import('./components/modals/VoteModal.vue'));
const FollowModal = defineAsyncComponent(() => import('./components/modals/FollowModal.vue'));
const StructureDocs = defineAsyncComponent(() => import('./components/modals/StructureDocs.vue'));
const LayoutEditor = defineAsyncComponent(() => import('./components/modals/LayoutEditor.vue'));
const ImageLightbox = defineAsyncComponent(() => import('./components/modals/ImageLightbox.vue'));
const WalletModal = defineAsyncComponent(() => import('./components/modals/WalletModal.vue'));
const WalletAuthModal = defineAsyncComponent(() => import('./components/modals/WalletAuthModal.vue'));
const RpcModal = defineAsyncComponent(() => import('./components/modals/RpcModal.vue'));
const SwitchAccountModal = defineAsyncComponent(() => import('./components/modals/SwitchAccountModal.vue'));
const OldContentModal = defineAsyncComponent(() => import('./components/modals/OldContentModal.vue'));
const PrivacyPolicyModal = defineAsyncComponent(() => import('./components/modals/PrivacyPolicyModal.vue'));

// Cookie consent banner is tiny and shown on essentially every first visit,
// so it's a sync (not async) import unlike the modals above.
import CookieConsentBanner from './components/CookieConsentBanner.vue';
import { consent as cookieConsent, acceptCookies, rejectCookies, resetConsent } from './modules/cookie-consent';
import { useFloatingLayer } from './modules/floating-stack';
const showPrivacyPolicy = ref(false);

const {
  lang, setLang, langs, t, theme, setTheme, themes, cinemaMode, setCinemaMode, config, view, loading, globalProps, forumStructure,
  activeForum, activeTopic, replies, repliesLoading, moderators, communityInfo,
  structureNote, selectedCommunity, currentTagFilter, applyTagFilter, clearTagFilter,
  customTag, allCommunities, userSubscriptions, auth, showLoginModal, loginTab,
  loginForm, loginErr, loginBusy, wvAvailable, loginOptions, replyTarget, replyForm,
  showNewPostForm, openNewPostForm, postForm, fmtDate, timeAgo, forumHasUnread,
  renderMD, isNestedReply, getParentBody,
  goHome, openForum, openTopic, handleCommunityChange, switchCommunity, openCommunities,
  toggleCommunitySub, openLoginModal,
  switchAccount, removeAccount, showSwitchAccountModal, openSwitchAccountModal,
  syncUrl,
  community, communityRewards,
  doKeyLogin, doWVLogin, logout, startReply, submitReply, submitPost, loadData,
  changePage,
  submitVote, hasVoted, openPayoutModal, payoutModal, openNotifModal, notifModal, togglePushNotifications, isNotifUnread,
  walletModal, openWalletModal, handleWalletSubmit, cancelDelegation,
  walletAuthModal,
  followModal, confirmToggleFollow,

  openProfile, profileUser, profileTab, loadMoreProfileContent, fetchEarningsHistory, openNotification,
  canEditStructure, canMute, mutePost, canBanUser, banUser, isProtectedFromBan, mutedAccounts, coalMap, editStructureMode, startEditStructure, saveStructure,
  structureForm, showStructureDocs,
  forumPagination,
  pinModal, handlePinSubmit,
  globalActivity, updateGlobalActivity, activityTab, activityExpanded, activityFullList, mobileActivityExpanded, openActivity,
  editModal, startEdit, submitEdit,
  voteModal, submitVoteConfirmed, estimateVote,
  supportModal, submitSupportComment,
  feeEstimates, scheduleFeeUpdate,
  bcWaitQueue, bcQueueExpanded,
  imgModal,
  statusModal,
  claimRewards,
  postPreview, replyPreview, saveDraft, clearDraft,
  imgUploads, onImagePick, onPaste,
  saveReplyDraft,
  quickReplyBody,
  rpcMenuOpen, rpcDataNode, rpcForumNode, rpcDataCustom, rpcForumCustom, applyRpcSettings,
  getNotifIcon,
  loadTopicContext,
  isPostInCommunity,
  toggleFollow,
  broadcast, waitAndReload, checkLock,
  explorationExpanded,
  explorationForm,
  toggleExploration,
  followingSet,
  player,
  client, navigateToPath
  } = useApp();

  const { initTitleWatcher, setPageTitle } = useTitle();
  initTitleWatcher();

  /**
   * bc-queue-panel's position in the shared floating-bottom-layer stack
   * (see modules/floating-stack.ts for the full rationale -- this replaces
   * what used to be three separate, drifting, guessed-constant computeds
   * here: `playerClearance`, `bcQueuePanelClearance`, and
   * `cookieBannerClearance`). Order 10: closest to the player (which the
   * shared formula in floating-stack.ts accounts for automatically),
   * with CookieConsentBanner (order 20) and then ShoutboxWidget's chat
   * dock (order 30, topmost) stacking above it -- this ordering (chat at
   * the very top, blockchain-sync status closest to the player) was a
   * deliberate choice, not the original order this was built with. `el`
   * gets bound to .bc-queue-panel's root below so its height is a real
   * ResizeObserver measurement, not a row-counting estimate.
   */
  const bcQueueEl = ref<HTMLElement | null>(null);
  const bcQueueStackBottom = useFloatingLayer(bcQueueEl, {
    id: 'bc-queue',
    order: 10, // closest to the player -- see modules/floating-stack.ts's `order` doc for the stacking story
    visible: () => bcWaitQueue.value.length > 0 && !cinemaMode.value,
  });

  installCinemaDpadNav(() => cinemaMode.value);

  // TV-only device-profiles gate (see modules/device-profiles/). On web/
  // phone, isTVPlatform is always false, so cinemaContentReady === cinemaMode
  // exactly as before this existed -- zero behavior change off-TV.
  const showCinemaProfileGate = computed(() => cinemaMode.value && isTVPlatform.value && !activeProfile.value);
  const cinemaContentReady = computed(() => cinemaMode.value && (!isTVPlatform.value || !!activeProfile.value));
  const showManageProfiles = ref(false);

  // Bridges the shoutbox's minimal (author, permlink) post references —
  // see modules/shoutbox/render.ts — onto the app's real navigation.
  // openTopic() fetches the full post itself whenever payout/body are
  // falsy, which this stub always is, so it always ends up fully hydrated
  // (via Blockchain.getContent + normalizePost) before rendering.
  const openPostRef = (author: string, permlink: string): void => {
    const stub: Post = {
      author, permlink, media: null, title: '', body: '', created: '', url: '',
      category: '', lastActivity: '', lastAuthor: '', isUnread: false, isRead: false,
      isFollowing: false, isMuted: false, isCommunityBanned: false, isGloballyBanned: false, isCoal: false, isPaid: false, isCollapsed: false,
      replyCount: 0, parent_author: '', parent_permlink: '', pendingPayout: 0,
      totalPayout: 0, payout: 0, vote_count: 0, active_votes: [], net_rshares: 0,
      beneficiaries: [], tags: [],
    };
    void openTopic(stub);
  };

  watch([view, activeForum, activeTopic, () => profileUser.username], () => {
    if (view.value === 'forum' && activeForum.value) {
      setPageTitle(activeForum.value.name);
    } else if (view.value === 'topic' && activeTopic.value) {
      setPageTitle(activeTopic.value.title);
    } else if (view.value === 'profile' && profileUser.username) {
      setPageTitle(`@${profileUser.username}`);
    } else if (view.value === 'communities') {
      setPageTitle(t('exploreCommunities') || 'Explore Communities');
    } else {
      setPageTitle(null);
    }
  }, { immediate: true });
</script>

<template>
<div
  class="bf-app-shell"
  :class="{
    'has-player-active': player.state.active && !player.state.minimized,
    'has-player-expanded': player.state.active && player.state.expanded && !player.state.minimized,
    'cinema-active': cinemaMode
  }"
  :style="{ paddingBottom: (player.state.active && !player.state.minimized) ? (player.state.expanded ? (player.state.expandedHeight + 20) + 'px' : '120px') : '' }"
>

  <!-- ── Layout ─────────────────────────────────────────────────── -->

  <MobileTopBar
    v-if="!cinemaMode"
    class="show-mobile"
    :auth="auth"
    :global-activity="globalActivity"
    :activity-tab="activityTab"
    :expanded="mobileActivityExpanded"
    :t="t"
    :time-ago="timeAgo"
    :has-new-notif="notifModal.hasNew"
    :vp="auth.user?.vp || '…'"
    :theme="theme"
    :themes="themes"
    :lang="lang"
    :langs="langs"
    :rpc-menu-open="rpcMenuOpen"
    :community-account="config.communityAccount"
    :cinemaMode="cinemaMode"
    @update:expanded="mobileActivityExpanded = $event"
    @update:activity-tab="activityTab = $event"
    @update:rpc-menu-open="rpcMenuOpen = $event"
    @open-activity="openActivity"
    @open-login-modal="openLoginModal"
    @open-notif-modal="openNotifModal"
    @open-profile="openProfile"
    @go-home="goHome"
    @set-theme="setTheme"
    @set-lang="(v: string) => setLang(v as 'en'|'pl'|'eo')"
    @set-cinema-mode="setCinemaMode"
    @logout="logout"
    @open-switch-account-modal="openSwitchAccountModal"
  />

  <LangBar
    v-if="!cinemaMode"
    class="hide-mobile"
    :theme="theme" :themes="themes" :lang="lang" :langs="langs"
    :rpc-menu-open="rpcMenuOpen"
    :t="t"
    :cinemaMode="cinemaMode"
    @set-theme="setTheme" @set-lang="(v: string) => setLang(v as 'en'|'pl'|'eo')"
    @update:rpc-menu-open="rpcMenuOpen = $event"
    @set-cinema-mode="setCinemaMode"
  />

  <RpcModal
    :show="rpcMenuOpen"
    :rpc-data-node="rpcDataNode"
    :rpc-forum-node="rpcForumNode"
    :rpc-data-custom="rpcDataCustom"
    :rpc-forum-custom="rpcForumCustom"
    :t="t"
    @close="rpcMenuOpen = false"
    @update:rpc-data-node="rpcDataNode = $event"
    @update:rpc-forum-node="rpcForumNode = $event"
    @update:rpc-data-custom="rpcDataCustom = $event"
    @update:rpc-forum-custom="rpcForumCustom = $event"
    @apply-rpc-settings="applyRpcSettings"
  />

  <SiteHeader
    v-if="!cinemaMode"
    class="hide-mobile"
    :community-title="communityInfo.title || ''"
    :community-account="config.communityAccount"
    :head-block-number="globalProps.head_block_number || '…'"
    :auth="auth"
    :has-new-notif="notifModal.hasNew"
    :notif-loading="notifModal.initializing"
    :t="t"
    @go-home="goHome"
    @open-login-modal="openLoginModal"
    @open-notif-modal="openNotifModal"
    @open-profile="openProfile"
    @open-switch-account-modal="openSwitchAccountModal"
    @logout="logout"
  />

  <CommunityBar
    v-if="!cinemaMode"
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
    v-if="!cinemaMode"
    class="hide-mobile"
    :auth="auth"
    :global-activity="globalActivity"
    :activity-tab="activityTab"
    :activity-expanded="activityExpanded"
    :activity-full-list="activityFullList"
    :update-global-activity="updateGlobalActivity"
    :t="t"
    :time-ago="timeAgo"
    @update:activity-tab="activityTab = $event"
    @update:activity-expanded="activityExpanded = $event"
    @update:activity-full-list="activityFullList = $event"
    @open-activity="openActivity"
  />

  <ShoutboxWidget
    v-if="!cinemaMode"
    :auth="auth"
    :get-client="() => client"
    :check-lock="checkLock"
    :community-id="config.communityAccount"
    :current-post="view === 'topic' && activeTopic ? { author: activeTopic.author, permlink: activeTopic.permlink, title: activeTopic.title } : null"
    :open-post-ref="openPostRef"
  />

  <NavBar
    v-if="!cinemaMode"
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

  <CinemaProfileGate v-if="showCinemaProfileGate" :t="t" />
  <WatchLimitReached v-if="isTVPlatform && limitReached" :t="t" />
  <ManageProfiles
    v-if="showManageProfiles && isTVPlatform"
    :auth="auth"
    :t="t"
    @close="showManageProfiles = false"
    @open-switch-account-modal="openSwitchAccountModal"
    @logout="logout"
  />

  <CinemaRail
    v-if="cinemaContentReady"
    :auth="auth"
    :has-new-notif="notifModal.hasNew"
    :theme="theme" :themes="themes" :lang="lang" :langs="langs"
    :rpc-menu-open="rpcMenuOpen"
    :cinema-mode="cinemaMode"
    :player="player"
    :t="t"
    :notif-modal="notifModal"
    :time-ago="timeAgo"
    :get-notif-icon="getNotifIcon"
    :is-unread="isNotifUnread"
    :payout-modal="payoutModal"
    :fmt-date="fmtDate"
    @go-home="goHome"
    @open-login-modal="openLoginModal"
    @open-switch-account-modal="openSwitchAccountModal"
    @open-notif-modal="openNotifModal"
    @open-notification="openNotification"
    @toggle-push-notifications="togglePushNotifications"
    @open-profile="openProfile"
    @open-manage-profiles="showManageProfiles = true"
    @logout="logout"
    @set-theme="setTheme"
    @set-lang="(v: string) => setLang(v as 'en'|'pl'|'eo')"
    @update:rpc-menu-open="rpcMenuOpen = $event"
    @set-cinema-mode="setCinemaMode"
    @close-payout-modal="payoutModal.show = false"
  />

  <!-- ── Main content ───────────────────────────────────────────── -->

  <div class="content" :class="{ 'cinema-active': cinemaMode }">

    <MobileContext
      v-if="!cinemaMode"
      class="show-mobile"
      :view="view"
      :active-forum="activeForum"
      :active-topic="activeTopic"
      :t="t"
      @go-home="goHome"
      @open-forum="openForum"
    />

    <!-- Reward notification -->
    <div v-if="!cinemaMode && auth.user && auth.user.hasRewards"
         style="background:var(--accent); color:var(--page-bg); padding:10px 15px; margin-bottom:15px; border-radius:4px; display:flex; align-items:center; flex-wrap:wrap; gap:10px; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
      <div style="flex:1"><i class="fa-solid fa-gift"></i> {{ t('rewardsAvailable') }}: {{ auth.user.rewardBlurt }} / {{ auth.user.rewardVesting }}</div>
      <button class="btn btn-sm" @click="() => claimRewards()" style="background:var(--surface-1); color:var(--accent); border:none">{{ t('claimRewards') }}</button>
    </div>

    <div v-if="loading" class="loader"><span class="spin"></span>{{ t('loading') }} {{ config.communityAccount }}…</div>

    <div v-if="!cinemaMode && !loading && forumPagination.bgLoading" style="background: var(--surface-nav); padding: 5px 15px; margin-bottom: 15px; border-radius: 4px; display: flex; align-items: center; gap: 10px; border: 1px solid var(--surface-border);">
      <div style="flex: 1; height: 4px; background: var(--page-bg); border-radius: 2px; overflow: hidden;">
        <div :style="{ width: (forumPagination.fetchedCount / 300 * 100) + '%', height: '100%', background: 'var(--brand)', transition: 'width 0.3s' }"></div>
      </div>
      <span class="gs">{{ t('fetchingMore') }} ({{ forumPagination.fetchedCount }}/300)</span>
    </div>

    <!--
      Blockchain wait queue panel.

      Real bug fixed here: the `bottom` offset below used to be
      `player.state.expanded ? player.state.expandedHeight + 'px' : ''`.
      `expandedHeight` (default 400, user-resizable up to 80% of window
      height, see player.ts) is the height of the DOCKED (non-cinema)
      expanded panel -- see MediaPlayer.vue's own use of it, `:style="{
      height: player.state.expandedHeight + 'px' }"`, applied only to that
      docked panel. But CinemaIndex.vue always sets `cinema` and `expanded`
      together (playing a card, or currentTrack changing, sets
      `playerState.cinema = true; playerState.expanded = true;` in the same
      breath -- state.cinema is never true on its own), so the old condition
      here was just `player.state.expanded`, with no check for cinema at
      all -- true in cinema mode exactly as much as in the docked one. Net
      effect: voting while in cinema mode pinned this bar `expandedHeight`px
      (whatever the user last dragged the UNRELATED docked panel to, often
      several hundred px) above the true bottom edge, instead of at it --
      which reads as "floating in the middle of the video". Gated on
      `!cinemaMode` now so cinema gets its own presentation entirely (see
      below) rather than inheriting a docked-mode-only offset.

      Second half of the same fix -- and the actual UX ask, not just the
      position bug: in cinema mode this now renders as a small pinned corner
      chip (spinner + one line of text) instead of the full per-item
      progress-bar list. The full list makes sense in the normal page layout
      where there's a whole page of other content it's a footer strip for;
      stacked over a fullscreen video it's just noise. Still uses the exact
      same bcWaitQueue/bcQueueExpanded state as the normal panel -- only the
      cinema branch's template/CSS differs, nothing about how entries get
      queued.

      `bottom` now comes from the shared floating-stack registry (see
      modules/floating-stack.ts and this file's <script setup> comment on
      `bcQueueStackBottom`) instead of a locally-computed offset -- this is
      also what makes it stack correctly above ShoutboxWidget's chat dock
      when both are visible at once, which the old per-file computed didn't
      account for at all.
    -->
    <div v-if="bcWaitQueue.length > 0 && !cinemaMode" ref="bcQueueEl" class="bc-queue-panel"
         :style="{ bottom: bcQueueStackBottom + 'px' }">
      <div class="bc-queue-inner">
        <template v-for="entry in (bcQueueExpanded ? bcWaitQueue : bcWaitQueue.slice(0, 3))" :key="entry.id">
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

    <div v-if="bcWaitQueue.length > 0 && cinemaMode" class="bc-queue-chip" :title="bcWaitQueue.map(e => e.label).join(' · ')">
      <span class="bc-queue-chip-spin"></span>
      <span class="bc-queue-chip-label">⛓ {{ bcWaitQueue[0].label }}<template v-if="bcWaitQueue.length > 1"> (+{{ bcWaitQueue.length - 1 }})</template></span>
    </div>

    <template v-if="!loading">

      <!-- Tag filter bar -->
      <div v-if="!cinemaMode && ((view==='index' && currentTagFilter) || (view==='forum'))" class="tag-filter-bar forumline">
        <div style="display:flex; align-items:center; gap:10px; width: 100%;">
          <i class="fa-solid fa-filter" style="color:var(--brand); opacity:0.7;"></i>
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

      <CinemaIndex v-if="cinemaMode" :client="client" :t="t" :auth="auth"
        :get-can-mute="() => canMute" :get-can-ban-user="() => canBanUser"
        :get-muted-accounts="() => mutedAccounts" :get-coal-map="() => coalMap"
        :config="config" />

      <!-- While the TV-only device-profiles gate is up, render nothing here
           at all rather than falling through to the full forum UI
           underneath -- the gate's own fixed overlay already covers it
           visually, but there's no reason to also run all of the forum
           view's data-fetching/mounting for a view nobody can see or
           interact with. -->
      <template v-else-if="showCinemaProfileGate"></template>

      <template v-else>
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
        :community-rewards="communityRewards"
        :t="t"
        :time-ago="timeAgo"
        :forum-has-unread="forumHasUnread"
        @open-forum="openForum"
        @open-profile="openProfile"
        @start-edit-structure="startEditStructure"
        @toggle-exploration="toggleExploration"
        @update:show-structure-docs="showStructureDocs = $event"
        @claim-community-rewards="claimRewards(config.communityAccount)"
      />

      <ForumView
        v-if="view === 'forum' && activeForum"
        :active-forum="activeForum"
        :auth="auth"
        :show-new-post-form="showNewPostForm"
        :post-form="postForm"
        :post-preview="postPreview"
        :post-img-upload="imgUploads.post"
        :post-fee-estimate="feeEstimates.post"
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
        @submit-post="submitPost"
        @save-draft="saveDraft($event)"
        @clear-draft="clearDraft"
        @on-post-image-pick="onImagePick('post', $event)"
        @on-post-paste="onPaste('post', $event)"
        @schedule-post-fee-update="scheduleFeeUpdate('post')"
        @update:post-preview="postPreview = $event"
        @update:show-new-post-form="showNewPostForm = $event"
        @change-page="changePage"
        @open-forum="openForum"
      />

      <TopicView
        v-if="view === 'topic' && activeTopic"
        :active-topic="activeTopic"
        :replies="replies"
        :replies-loading="repliesLoading"
        :auth="auth"
        :config="config"
        :reply-target="replyTarget"
        @update:reply-target="replyTarget = $event"
        :reply-form="replyForm"
        :reply-preview="replyPreview"
        :reply-img-upload="imgUploads.reply"
        :reply-fee-estimate="feeEstimates.reply"
        :quick-reply-body="quickReplyBody"
        :following-set="followingSet"
        :can-mute="canMute"
        :can-ban-user="canBanUser"
        :is-protected-from-ban="isProtectedFromBan"
        :t="t"
        :fmt-date="fmtDate"
        :time-ago="timeAgo"
        :render-m-d="(s: string, ctx?: unknown) => renderMD(s, ctx as Record<string,unknown> | null)"
        :has-voted="hasVoted"
        :is-nested-reply="isNestedReply"
        :get-parent-body="getParentBody"
        :is-post-in-community="isPostInCommunity"
        :client="client"
        :broadcast="broadcast"
        :wait-and-reload="waitAndReload"
        :check-lock="checkLock"
        :navigate-to-path="navigateToPath"
        @open-profile="openProfile"
        @open-payout-modal="openPayoutModal"
        @submit-vote="submitVote"
        @start-reply="startReply"
        @start-edit="startEdit"
        @toggle-follow="toggleFollow"
        @mute-post="mutePost"
        @ban-user="(u, b) => banUser(u, b)"
        @switch-community="switchCommunity"
        @load-topic-context="loadTopicContext"
        @submit-reply="submitReply"
        @on-reply-save-draft="(d) => { 
          saveReplyDraft(d.author, d.permlink, d.body); 
          if (activeTopic && d.author === activeTopic.author && d.permlink === activeTopic.permlink) quickReplyBody = d.body;
          if (replyTarget && d.author === replyTarget.author && d.permlink === replyTarget.permlink) replyForm.body = d.body;
        }"
        @on-reply-image-pick="onImagePick('reply', $event)"
        @on-reply-paste="onPaste('reply', $event)"
        @schedule-reply-fee-update="scheduleFeeUpdate('reply')"
        @update:reply-preview="replyPreview = $event"
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
        :has-voted="hasVoted"
        :config="config"
        :can-ban-user="canBanUser"
        :is-protected-from-ban="isProtectedFromBan"
        :is-community-banned="mutedAccounts.has(profileUser.username.toLowerCase())"
        @open-profile="openProfile"
        @open-topic="openTopic"
        @open-payout-modal="openPayoutModal"
        @toggle-follow="toggleFollow"
        @update:profile-tab="profileTab = $event; syncUrl()"
        @open-wallet-modal="openWalletModal"
        @claim-rewards="claimRewards"
        @cancel-delegation="cancelDelegation"
        @fetch-earnings="() => fetchEarningsHistory(profileUser.username, ((profileUser as any).earnings.history[(profileUser as any).earnings.history.length-1]?.seq || 0) - 1)"
        @load-more-profile-content="loadMoreProfileContent"
        @submit-vote="submitVote"
        @ban-user="(username: string, ban: boolean) => banUser(username, ban)"
      />

      </template>

    </template>

    <!-- Footer -->
    <div v-if="!cinemaMode" class="site-footer">
      BlurtForum — Thanks to: <a href="#" @click.stop.prevent="openProfile('drakernoise')">@drakernoise</a> (for RPC), @beblurt/dblurt · Blurt Network | #{{ globalProps.head_block_number||'…' }} | {{ lang.toUpperCase() }}
      <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid var(--surface-border); display: flex; justify-content: center; align-items: center; gap: 10px; flex-wrap: wrap;">
        <span style="font-size: 11px; opacity: 0.6;">Media Player Enabled</span>
        <span style="opacity: 0.4;">·</span>
        <a href="#" @click.stop.prevent="showPrivacyPolicy = true" style="font-size: 11px;">{{ t('privacyPolicy') || 'Privacy policy' }}</a>
        <span style="opacity: 0.4;">·</span>
        <a href="#" @click.stop.prevent="resetConsent()" style="font-size: 11px;">{{ t('cookieSettings') || 'Cookie settings' }}</a>
      </div>
    </div>

  </div><!-- /content -->

  <CookieConsentBanner v-if="!cinemaMode && !cookieConsent" :t="t"
                        @accept="acceptCookies" @reject="rejectCookies"
                        @open-privacy="showPrivacyPolicy = true" />

  <PrivacyPolicyModal v-if="showPrivacyPolicy" :t="t" @close="showPrivacyPolicy = false" />

  <!-- ── Player ─────────────────────────────────────────────────── -->

  <MediaPlayer
    :player="player"
    :t="t"
    :client="client"
    @open-profile="openProfile"
    @open-topic="(p: any) => openTopic(p as any)"
    @submit-vote="(p: any) => submitVote(p as any)"
    @open-payout-modal="(p: any) => openPayoutModal(p as any)"
  />

  <!-- ── Modals ─────────────────────────────────────────────────── -->

  <LoginModal
    v-if="showLoginModal"
    :login-tab="loginTab"
    :login-form="loginForm"
    :login-options="loginOptions"
    :login-err="loginErr"
    :login-busy="loginBusy"
    :wv-available="wvAvailable"
    :t="t"
    @close="showLoginModal = false"
    @do-key-login="doKeyLogin"
    @do-w-v-login="doWVLogin"
    @update:login-tab="loginTab = $event"
  />

  <SwitchAccountModal
    v-if="showSwitchAccountModal"
    :auth="auth"
    :t="t"
    @close="showSwitchAccountModal = false"
    @switch-account="switchAccount($event); showSwitchAccountModal = false"
    @remove-account="removeAccount"
    @open-login-modal="openLoginModal(); showSwitchAccountModal = false"
  />

  <!-- Both of these render inside CinemaRail's side panel instead when
       cinemaMode is on (see CinemaRail.vue) -- gated on cinemaMode itself,
       not player.state.cinema (fullscreen video playing), since CinemaRail
       is mounted whenever cinemaMode is on regardless of whether anything
       is actually playing. Gating on player.state.cinema here left both
       the modal AND the panel showing at once whenever a panel was opened
       while just browsing (not watching), since player.state.cinema was
       false in that case and this guard let the modal through too. -->
  <PayoutModal
    v-if="payoutModal.show && !cinemaMode"
    :payout-modal="payoutModal"
    :t="t"
    :fmt-date="fmtDate"
    @close="payoutModal.show = false"
    @open-profile="openProfile"
  />

  <NotifModal
    v-if="notifModal.show && !cinemaMode"
    :notif-modal="notifModal"
    :auth="auth"
    :t="t"
    :time-ago="timeAgo"
    :get-notif-icon="getNotifIcon"
    :is-unread="isNotifUnread"
    @close="notifModal.show = false"
    @open-notification="openNotification"
    @toggle-push-notifications="togglePushNotifications"
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
    :auth="auth"
    :t="t"
    :render-m-d="(s: string, ctx?: unknown) => renderMD(s, ctx as Record<string,unknown> | null)"
    :img-upload="imgUploads.post"
    @close="editModal.show = false"
    @submit-edit="submitEdit"
    @image-pick="onImagePick('post', $event)"
    @paste="onPaste('post', $event)"
  />
  <PinModal
    v-if="pinModal.show"
    :pin-modal="pinModal"
    :t="t"
    @close="pinModal.show = false"
    @submit="handlePinSubmit"
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

  <OldContentModal
    v-if="supportModal.show"
    :old-content-modal="supportModal"
    :t="t"
    @close="supportModal.show = false"
    @submit="submitSupportComment"
  />

  <FollowModal
    v-if="followModal.show"
    :follow-modal="followModal"
    :t="t"
    @close="followModal.show = false"
    @confirm="confirmToggleFollow"
  />
<WalletModal
  v-if="walletModal.show"
  :show="walletModal.show"
  :mode="walletModal.mode"
  :balance="walletModal.balance"
  :username="auth.user?.username || ''"
  :target-user="walletModal.targetUser"
  :t="t"
  @close="walletModal.show = false"
  @submit="handleWalletSubmit"
/>

<WalletAuthModal
  v-if="walletAuthModal.show"
  :show="walletAuthModal.show"
  :username="walletAuthModal.username"
  :authority="walletAuthModal.authority"
  :t="t"
  @close="walletAuthModal.show = false"
  @submit="(k) => walletAuthModal.callback?.(k)"
/>


  <!-- Status modal -->
  <div v-if="statusModal.show" class="modal-overlay" @click.self="statusModal.show=false" style="z-index: 5000;">
    <div class="modal-box" style="width: 350px;">
      <div class="modal-header" :style="{ background: statusModal.type === 'error' ? 'var(--alert-error-border)' : (statusModal.type === 'success' ? 'var(--alert-success-border)' : 'var(--modal-header-bg)') }">
        <span>{{ statusModal.title }}</span>
        <button class="modal-close" @click="statusModal.show=false">×</button>
      </div>
      <div class="modal-body" style="text-align: center;">
        <div style="font-size: 40px; margin-bottom: 15px;">
          <i v-if="statusModal.type === 'success'" class="fa-solid fa-circle-check" style="color: var(--alert-success-text);"></i>
          <i v-else-if="statusModal.type === 'error'" class="fa-solid fa-circle-xmark" style="color: var(--alert-error-text);"></i>
          <i v-else class="fa-solid fa-circle-info" style="color: var(--alert-info-text);"></i>
        </div>
        <div style="font-size: 13px; line-height: 1.5; margin-bottom: 20px;">{{ statusModal.body }}</div>
        <button class="btn btn-primary" style="width: 100%; padding: 10px;" @click="statusModal.show=false">OK</button>
      </div>
    </div>
  </div>


</div><!-- /root -->
</template>

<style scoped>
/* ===== Moved from global style.css (component-specific) ===== */
/* ===== FOOTER ===== */
.site-footer {
  background: var(--footer-bg);
  color: var(--footer-text);
  text-align: center;
  padding: 20px;
  font-size: 12px;
  border-top: 1px solid var(--footer-border);
}
 

/* TAG FILTER */
.tag-filter-bar {
  margin: 0 15px 15px;
  padding: 8px 15px;
  background: var(--tagfilter-bg);
  display: flex;
  align-items: center;
  border: 1px solid var(--tagfilter-border);
  border-radius: var(--radius-sm);
}
.tag-filter-bar input {
  background: var(--input-bg);
  color: var(--input-text);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
}
@media (max-width: 600px) {
  .tag-filter-bar div {
    max-width: none !important;
  }
}

/* ===== BLOCKCHAIN WAIT QUEUE PANEL ===== */

/* Cinema-mode variant of the wait queue: a small pinned corner chip instead
   of the full-width bottom bar (see the template comment above where this
   renders for why it's a separate branch rather than a CSS override of
   .bc-queue-panel). Sits above the cinema controls cluster (which itself is
   z-index 5-ish, see MediaPlayer.vue) and above the cinema player's own
   z-index: 999/1000 (.bfp-panel/.bfp-bar), same as .bc-queue-panel did. */
.bc-queue-chip {
  position: fixed;
  right: 16px;
  bottom: 96px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(70vw, 320px);
  padding: 7px 12px;
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 999px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}
.bc-queue-chip-spin {
  flex: 0 0 auto;
  width: 12px; height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
.bc-queue-chip-label {
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 600px) {
  .bc-queue-chip { bottom: 84px; right: 10px; }
}

.bc-queue-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  background: var(--queue-panel-bg);
  border-top: 2px solid var(--queue-panel-border);
  box-shadow: 0 -3px 12px rgba(0,0,0,0.2);
  padding: 8px 14px;
  transition: bottom 0.3s ease-in-out;
}
/* The bottom offset for the "docked bar, not expanded" player state used to
   live here as a CSS class rule (`.has-player-active .bc-queue-panel {
   bottom: 76px }`, plus a 64px mobile variant), then briefly as a
   locally-computed `playerClearance` in <script setup>. Both are gone now
   in favor of modules/floating-stack.ts's shared registry (`bcQueueStackBottom`,
   bound via the `ref="bcQueueEl"` + `:style` on .bc-queue-panel above) --
   see that module's own comment for why a shared registry replaced three
   separate per-file computeds that had drifted out of sync with each other. */
.bc-queue-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.bc-queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 220px;
  min-width: 0;
}
.bc-queue-bar-wrap {
  flex: 1;
  height: 6px;
  background: var(--queue-track-bg);
  border-radius: var(--radius-xs);
  overflow: hidden;
  min-width: 60px;
}
.bc-queue-bar-fill {
  height: 100%;
  background: var(--queue-fill-bg);
  border-radius: var(--radius-xs);
  transition: width 0.4s ease;
}
.bc-queue-label {
  font-size: 12px;
  color: var(--queue-label-text);
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bc-queue-more {
  background: none;
  border: 1px solid var(--queue-more-color);
  color: var(--queue-more-color);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  border-radius: var(--radius-xs);
  font-family: var(--sans);
}
.bc-queue-more:hover { background: var(--queue-more-color); color: #fff; }

/* Desktop: side-by-side columns, more compact */
@media (min-width: 681px) {
  .bc-queue-item {
    flex: 1 1 260px;
    max-width: 340px;
  }
}

/* Mobile: stack vertically, limit to 3 */
@media (max-width: 680px) {
  .bc-queue-item {
    flex: 1 1 100%;
  }
  .bc-queue-label { max-width: 55vw; }
}
</style>
