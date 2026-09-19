<script setup lang="ts">
/**
 * Comments tab body for the expanded player panel — registered by
 * comments-plugin.ts via player.registerExpandedTab(). Renders the SAME
 * PostReplyThread.vue used by TopicView.vue, so a comment looks identical
 * whether you're on the full topic page or watching in the player/cinema
 * mode. Deliberately read-mostly: voting, muting, following and opening a
 * profile work in place, but "Reply"/"Edit" navigate to the full topic
 * (via navigateToPath) rather than reimplementing a second reply-composer
 * inside the player.
 *
 * Keeps its own local replies/loading state — NOT the app's shared
 * replies/activeTopic refs — because the track playing here has nothing to
 * do with whatever topic the user might independently be browsing behind
 * the player.
 */
import { ref, watch } from 'vue';
import PostReplyThread from '../../post/PostReplyThread.vue';
import { Blockchain } from '../../blockchain';
import { PostProcessor } from '../../post-processor';
import { isHiddenFromViewer } from '../../visibility';
import type { MediaTrack, BFPlayerAPI } from '../../player/types';
import type { Post, AuthUser } from '../../../types';
import type { CoalEntry } from '../../coal-list';

const props = defineProps<{
  track: MediaTrack | null;
  player: BFPlayerAPI;
  client: any;
  auth: { user: AuthUser | null };
  t: (k: string) => string;
  fmtDate: (s: string) => string;
  renderMD: (s: string, ctx?: unknown) => string;
  hasVoted: (p: Post) => boolean;
  isNestedReply: (r: Post) => boolean;
  getParentBody: (r: Post) => string;
  isPostInCommunity: (p: Post) => boolean;
  getFollowingSet: () => Set<string>;
  getCanMute: () => boolean;
  getCanBanUser: () => boolean;
  getMutedAccounts: () => Set<string>;
  getCoalMap: () => Map<string, CoalEntry>;
  banUser: (username: string, ban: boolean) => void;
  config: { communityAccount: string };
  navigateToPath: (path: string) => void;
  cachePostBody: (author: string, permlink: string, body: string) => void;
  submitVote: (post: Post | { author: string; permlink: string }) => void;
  mutePost: (post: Post, mute: boolean) => void;
  toggleFollow: (username: string) => void;
  openPayoutModal: (post: Post | { author: string; permlink: string }) => void;
  openProfile: (username: string) => void;
}>();

const replies = ref<Post[]>([]);
const repliesLoading = ref(false);
const postBody = ref<string | null>(null);
const postLoading = ref(false);

const fetchReplies = async (author: string, permlink: string) => {
  repliesLoading.value = true;
  const flat: Post[] = [];
  const recurse = async (pAuthor: string, pPermlink: string, depth: number): Promise<void> => {
    let results: any[];
    try {
      results = await Blockchain.getContentReplies(props.client, pAuthor, pPermlink);
    } catch (e) {
      console.error(`BlurtCommentsTab: error loading replies for ${pAuthor}/${pPermlink}:`, e);
      return;
    }
    if (!results?.length) return;
    for (const r of results) {
      props.cachePostBody(r.author, r.permlink, r.body);
      const post = {
        ...PostProcessor.normalizePost(r, {
          canMute: props.getCanMute(),
          mutedAccounts: props.getMutedAccounts(),
          coalMap: props.getCoalMap()
        }),
        depth,
        _qOpen: false
      };
      // Same visibility rule as everywhere else - see visibility.ts.
      if (!isHiddenFromViewer(post, { canBanUser: props.getCanBanUser(), canMute: props.getCanMute() })) {
        flat.push(post);
      }
      if (r.children && r.children > 0) await recurse(r.author, r.permlink, depth + 1);
    }
  };
  await recurse(author, permlink, 1);
  flat.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
  replies.value = flat;
  repliesLoading.value = false;
};

const fetchPostBody = async (author: string, permlink: string) => {
  postLoading.value = true;
  postBody.value = null;
  const content = await Blockchain.getContent(props.client, author, permlink);
  if (content?.body) {
    props.cachePostBody(author, permlink, content.body);
    postBody.value = content.body;
  }
  postLoading.value = false;
};

watch(
  () => props.track ? props.track.author + '/' + props.track.permlink : null,
  (id) => {
    if (!id || !props.track) { replies.value = []; postBody.value = null; return; }
    fetchReplies(props.track.author, props.track.permlink);
    fetchPostBody(props.track.author, props.track.permlink);
  },
  { immediate: true },
);

// Reply/Edit jump to the full topic page instead of composing in-place here.
// If the player is currently shown full-bleed (cinema), drop out of that
// display mode first — otherwise the page navigates underneath a player
// that's still rendered fullscreen on top of it.
const goToComment = (post: Post) => {
  if (props.player.state.cinema) props.player.state.cinema = false;
  props.navigateToPath(`?view=topic&author=${post.author}&permlink=${post.permlink}`);
};

const emptyReplyForm = { body: '', loading: false, error: '', success: '', beneficiary: { account: '', weight: '' } };
</script>

<template>
  <div class="bfp-comments-tab">
    <div v-if="!track" class="gs" style="padding: 20px; text-align: center;">{{ t('noTracks') || 'No track' }}</div>
    <template v-else>
      <div class="bfp-comments-post">
        <h3 class="bfp-comments-post-title">{{ track.title }}</h3>
        <i v-if="postLoading" class="fa-solid fa-spinner fa-spin bfp-comments-post-loading"></i>
        <div
          v-else-if="postBody"
          class="bfp-comments-post-body markdown-body"
          v-html="renderMD(postBody, { author: track.author, permlink: track.permlink })"
        ></div>
      </div>
      <PostReplyThread
        :replies="replies"
        :repliesLoading="repliesLoading"
        :auth="auth"
        :replyTarget="null"
        :replyForm="emptyReplyForm"
        :replyImgUpload="false"
        :replyFeeEstimate="null"
        :followingSet="getFollowingSet()"
        :canMute="getCanMute()"
        :canBanUser="getCanBanUser()"
        :t="t"
        :fmtDate="fmtDate"
        :renderMD="renderMD"
        :hasVoted="hasVoted"
        :isNestedReply="isNestedReply"
        :getParentBody="getParentBody"
        :isPostInCommunity="isPostInCommunity"
        :config="config"
        :navigateToPath="navigateToPath"
        :compact="true"
        @open-profile="openProfile"
        @open-payout-modal="openPayoutModal"
        @submit-vote="submitVote"
        @start-reply="goToComment"
        @start-edit="goToComment"
        @toggle-follow="toggleFollow"
        @mute-post="mutePost"
        @ban-user="(u, b) => banUser(u, b)"
      />
    </template>
  </div>
</template>

<style scoped>
.bfp-comments-tab { padding: 12px; overflow-y: auto; height: 100%; }
.bfp-comments-post {
  padding: 12px 14px;
  margin-bottom: 14px;
  background: var(--card-bg, rgba(255,255,255,0.04));
  border: 1px solid var(--surface-border, rgba(255,255,255,0.08));
  border-radius: 8px;
}
.bfp-comments-post-title { margin: 0 0 8px; font-size: 0.95rem; font-weight: 700; }
.bfp-comments-post-body { font-size: 0.85rem; line-height: 1.5; opacity: 0.9; max-height: 220px; overflow-y: auto; }
.bfp-comments-post-loading { opacity: 0.6; }
</style>
