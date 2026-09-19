import BlurtCommentsTab from './components/BlurtCommentsTab.vue';
import { activeProfile } from '../device-profiles/device-profiles';
import { isTVPlatform } from '../native/platform-info';
import type { BFPlayerAPI } from '../player/types';
import type { Post, AuthUser } from '../../types';
import type { CoalEntry } from '../coal-list';

/**
 * Registers the "Comments" tab into the player's expanded panel (see
 * registerExpandedTab in modules/player/types.ts). The player core has no
 * idea this tab shows blockchain replies — it just mounts whatever
 * component is registered when that tab id is selected.
 *
 * `deps` mirrors the same functions/refs useApp.ts already hands to
 * TopicView.vue (submitVote, mutePost, toggleFollow, openPayoutModal,
 * openProfile, hasVoted, etc.) — no new logic, just reused as-is so a vote
 * or mute performed from the player behaves identically to the full topic
 * page.
 */
export interface BlurtCommentsPluginDeps {
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
  // Same moderation data useApp.ts's normalizePost wrapper uses - passed through so comments
  // shown in the player tab get exactly the same hide-muted/banned/coal-flag behavior as the
  // full topic page (this tab calls PostProcessor.normalizePost itself, see BlurtCommentsTab.vue).
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
}

export const BlurtCommentsPlugin = (deps: BlurtCommentsPluginDeps) => ({
  name: 'BlurtComments',

  install(player: BFPlayerAPI) {
    player.registerExpandedTab({
      id: 'comments',
      label: 'Comments',
      icon: 'fa-solid fa-comments',
      component: BlurtCommentsTab,
      props: deps as unknown as Record<string, unknown>,
      visible: () => !isTVPlatform.value || !activeProfile.value || activeProfile.value.showComments,
    });
  },
});
