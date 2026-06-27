import { reactive } from 'vue';
import { Blockchain } from '../modules/blockchain';
import type { Post, AuthUser } from '../types';

/**
 * Composable for handling voting logic and state.
 *
 * Flow for paid-out posts (isPaid):
 *   submitVote → onOldPost(post)   (skips vote modal entirely)
 *
 * Flow for normal posts:
 *   submitVote → openVoteModal → submitVoteConfirmed → broadcast
 */
export function useVote(
  client: any,
  auth: { user: AuthUser | null },
  broadcast: (ops: any[]) => Promise<void>,
  waitAndReload: any,
  t: (k: string) => string,
  onOldPost?: (post: Post) => Promise<void>
) {
  const voteModal = reactive({
    show: false,
    post: null as Post | null,
    weight: parseInt(localStorage.getItem('bf-vote-weight') || '100'),
    estimatedValue: null as null | { vpCostPct: string; vpAfter: string; voteValue: string; fee: string },
    estimating: false
  });

  const estimateVote = async (weight: number): Promise<void> => {
    if (!auth.user) return;
    voteModal.estimating = true;
    const est = await Blockchain.estimateVoteValue(client, auth.user.username, weight);
    if (est) voteModal.estimatedValue = est;
    voteModal.estimating = false;
  };

  const openVoteModal = (post: Post): void => {
    voteModal.post = post;
    voteModal.show = true;
    Blockchain.fetchFeeInfo(client).then(() => estimateVote(voteModal.weight));
  };

  const hasVoted = (post: Post): boolean => {
    return !!(auth.user && post.active_votes?.some(v => v.voter === auth.user!.username && v.percent > 0));
  };

  const submitVoteConfirmed = async (): Promise<void> => {
    voteModal.show = false;
    if (!auth.user || !voteModal.post) return;

    const post = voteModal.post;
    const weight = Math.min(Math.max(Math.round(voteModal.weight), 1), 100) * 100;
    localStorage.setItem('bf-vote-weight', String(voteModal.weight));

    try {
      await broadcast([['vote', { voter: auth.user.username, author: post.author, permlink: post.permlink, weight }]]);
      const voter = auth.user.username;
      await waitAndReload(
        true, post.author, post.permlink,
        (c: any) => (c.active_votes || []).some((v: any) => v.voter === voter && v.percent > 0),
        t('syncingWithBlockchain')
      );
    } catch (err) {
      console.error('Vote error:', err);
      throw err;
    }
  };

  const submitVote = async (
    post: Post | { author: string; permlink: string },
    getFullPost: (p: any) => Promise<Post>
  ): Promise<void> => {
    if (!auth.user) throw new Error('NOT_LOGGED_IN');

    let fullPost: Post;
    if (!('active_votes' in post)) {
      fullPost = await getFullPost(post);
    } else {
      fullPost = post as Post;
    }

    if (hasVoted(fullPost)) {
      if (!confirm(t('confirmUnvote'))) return;
      try {
        await broadcast([['vote', { voter: auth.user.username, author: fullPost.author, permlink: fullPost.permlink, weight: 0 }]]);
        const voter = auth.user.username;
        await waitAndReload(
          false, fullPost.author, fullPost.permlink,
          (c: any) => !(c.active_votes || []).some((v: any) => v.voter === voter && v.percent > 0),
          t('syncingWithBlockchain')
        );
      } catch (err) {
        console.error('Unvote error:', err);
        throw err;
      }
      return;
    }

    // Paid-out post: skip vote modal, go directly to support flow
    if (fullPost.isPaid && onOldPost) {
      await onOldPost(fullPost);
      return;
    }

    openVoteModal(fullPost);
  };

  return {
    voteModal,
    estimateVote,
    openVoteModal,
    hasVoted,
    submitVoteConfirmed,
    submitVote
  };
}
