import { reactive } from 'vue';
import { Blockchain } from '../modules/blockchain';
import type { Post, AuthUser } from '../types';

/**
 * Composable for handling voting logic and state.
 */
export function useVote(client: any, auth: { user: AuthUser | null }, broadcast: (ops: any[]) => Promise<void>, waitAndReload: any, t: (k: string) => string) {
  
  const voteModal = reactive({
    show: false,
    post: null as Post | null,
    weight: parseInt(localStorage.getItem('bf-vote-weight') || '100'),
    estimatedValue: null as null | { vpCostPct: string; vpAfter: string; voteValue: string; fee: string },
    estimating: false
  });

  /** Estimates the value of a vote */
  const estimateVote = async (weight: number): Promise<void> => {
    if (!auth.user) return;
    voteModal.estimating = true;
    const est = await Blockchain.estimateVoteValue(client, auth.user.username, weight);
    if (est) voteModal.estimatedValue = est;
    voteModal.estimating = false;
  };

  /** Opens the vote modal for a post */
  const openVoteModal = (post: Post): void => {
    voteModal.post = post;
    voteModal.show = true;
    Blockchain.fetchFeeInfo(client).then(() => estimateVote(voteModal.weight));
  };

  /** Checks if the current user has already voted for a post */
  const hasVoted = (post: Post): boolean => {
    return !!(auth.user && post.active_votes?.some(v => v.voter === auth.user!.username && v.percent > 0));
  };

  /** Confirms and broadcasts the vote */
  const submitVoteConfirmed = async (): Promise<Post | null> => {
    voteModal.show = false;
    if (!auth.user || !voteModal.post) return null;
    
    const post = voteModal.post;
    const weight = Math.min(Math.max(Math.round(voteModal.weight), 1), 100) * 100;
    localStorage.setItem('bf-vote-weight', String(voteModal.weight));
    
    const op = ['vote', { voter: auth.user.username, author: post.author, permlink: post.permlink, weight }];
    
    try {
      await broadcast([op]);
      const voter = auth.user.username;
      
      // Determine if it's an old post (older than 7 days)
      const created = new Date((post.created.endsWith('Z') ? post.created : post.created + 'Z')).getTime();
      const isOld = (Date.now() - created) > 7 * 24 * 60 * 60 * 1000;
      
      // Note: triggerSupportLogic should be handled by the caller or a separate event
      // if we want to follow the TopicView.vue suggestion.
      
      await waitAndReload(true, post.author, post.permlink, (c: any) => 
        (c.active_votes || []).some((v: any) => v.voter === voter && v.percent > 0), 
        t('syncingWithBlockchain')
      );
      
      return isOld ? post : null; // Return post if old to trigger support logic
    } catch (err) {
      console.error('Vote error:', err);
      throw err;
    }
  };

  /** Main entry point for voting, handles unvoting and opening modal */
  const submitVote = async (post: Post | { author: string; permlink: string }, getFullPost: (p: any) => Promise<Post>): Promise<void> => {
    if (!auth.user) throw new Error('NOT_LOGGED_IN');

    let fullPost: Post;
    if (!('active_votes' in post)) {
      fullPost = await getFullPost(post);
    } else {
      fullPost = post as Post;
    }

    if (hasVoted(fullPost)) {
      if (!confirm(t('confirmUnvote'))) return;
      const op = ['vote', { voter: auth.user.username, author: fullPost.author, permlink: fullPost.permlink, weight: 0 }];
      try {
        await broadcast([op]);
        const voter = auth.user.username;
        await waitAndReload(false, fullPost.author, fullPost.permlink, (c: any) => 
          !(c.active_votes || []).some((v: any) => v.voter === voter && v.percent > 0), 
          t('syncingWithBlockchain')
        );
      } catch (err) {
        console.error('Unvote error:', err);
        throw err;
      }
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
