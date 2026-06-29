import { reactive } from 'vue';
import { Blockchain } from '../modules/blockchain';
import { BFUtils } from '../modules/utils';
import type { Post, Beneficiary, AuthUser } from '../types';

/**
 * Composable handling "support old content" logic.
 *
 * Flow when user clicks vote on a paid-out post:
 * 1. Scan direct children for existing support comment (matching beneficiaries)
 * 2a. Found  → vote on it directly with chosen weight
 * 2b. Not found → open modal (user writes body + picks weight) → create comment → vote
 */
export function useSupport(
  client: any,
  auth: { user: AuthUser | null },
  broadcast: (ops: any[]) => Promise<void>,
  checkLock: (fn: () => any) => boolean,
  t: (k: string) => string
) {
  const modal = reactive({
    show: false,
    author: '',
    permlink: '',
    beneficiaries: [] as Beneficiary[],
    weight: parseInt(localStorage.getItem('bf-vote-weight') || '100'),
    body: '',
    status: '',
    loading: false,
    // When an existing support comment is found we store it here and skip creation
    existingPermlink: null as string | null,
    existingAuthor: null as string | null,
  });

  const submitSupportComment = async (): Promise<void> => {
    if (checkLock(submitSupportComment)) return;
    if (!auth.user || !modal.author) return;

    const weight = Math.min(Math.max(Math.round(modal.weight), 1), 100) * 100;
    localStorage.setItem('bf-vote-weight', String(modal.weight));

    // If existing support comment found earlier, just vote on it
    if (modal.existingAuthor && modal.existingPermlink) {
      modal.loading = true;
      modal.status = t('votingOnSupport');
      try {
        await broadcast([['vote', {
          voter: auth.user.username,
          author: modal.existingAuthor,
          permlink: modal.existingPermlink,
          weight,
        }]]);
        modal.status = t('supportSuccess');
        setTimeout(() => { modal.show = false; }, 1500);
      } catch (err: any) {
        console.error('Support vote error:', err);
        modal.status = 'Error: ' + err.message;
      }
      modal.loading = false;
      return;
    }

    modal.loading = true;
    modal.status = t('supporting');

    const permlink = BFUtils.genPermlink('support-' + modal.author);
    const beneficiaries = modal.beneficiaries.length
      ? [...modal.beneficiaries].sort((a, b) => a.account.localeCompare(b.account))
      : [{ account: modal.author, weight: 10000 }];

    const op = ['comment', {
      parent_author: modal.author,
      parent_permlink: modal.permlink,
      author: auth.user.username,
      permlink,
      title: '',
      body: `Supporting original content by @${modal.author}

${modal.body}`.trim(),
      json_metadata: JSON.stringify({ app: 'blurtforum/1.0', tags: ['blurt-140455'] }),
    }];
    const options = ['comment_options', {
      author: auth.user.username,
      permlink,
      max_accepted_payout: '1000000.000 BLURT',
      percent_steem_dollars: 10000,
      allow_votes: true,
      allow_curation_rewards: true,
      extensions: [[0, { beneficiaries }]],
    }];

    try {
      await broadcast([op, options]);
      modal.status = t('waitingForBlock');
      await new Promise(r => setTimeout(r, 5000));
      modal.status = t('votingOnSupport');
      await broadcast([['vote', {
        voter: auth.user.username,
        author: auth.user.username,
        permlink,
        weight,
      }]]);
      modal.status = t('supportSuccess');
      setTimeout(() => { modal.show = false; }, 1500);
    } catch (err: any) {
      console.error('Support error:', err);
      modal.status = 'Error: ' + err.message;
    }
    modal.loading = false;
  };

  /**
   * Entry point called by useVote when user clicks vote on a paid-out post.
   * Scans children, then either opens modal (always) with pre-filled state.
   */
  const triggerSupport = async (post: Post): Promise<void> => {
    const user = auth.user?.username;
    if (!user) return;

    let children: any[] = [];
    try {
      children = await Blockchain.getContentReplies(client, post.author, post.permlink);
    } catch (e) {
      console.warn('Support scan failed:', e);
    }

    // Find existing support comment: posted by current user with matching beneficiaries
    const existing = children.find(c => {
      if (c.author !== user) return false;
      const cBens: Beneficiary[] = c.beneficiaries || [];
      const pBens: Beneficiary[] = post.beneficiaries || [];
      if (pBens.length === 0) {
        return cBens.length === 1 && cBens[0].account === post.author && cBens[0].weight === 10000;
      }
      if (cBens.length !== pBens.length) return false;
      const sorted = [...cBens].sort((a, b) => a.account.localeCompare(b.account));
      const orig   = [...pBens].sort((a, b) => a.account.localeCompare(b.account));
      return sorted.every((b, i) => b.account === orig[i].account && b.weight === orig[i].weight);
    });

    modal.author           = post.author;
    modal.permlink         = post.permlink;
    modal.beneficiaries    = post.beneficiaries || [];
    modal.weight           = parseInt(localStorage.getItem('bf-vote-weight') || '100');
    modal.body             = '';
    modal.status           = '';
    modal.loading          = false;
    modal.existingAuthor   = existing?.author ?? null;
    modal.existingPermlink = existing?.permlink ?? null;
    modal.show             = true;
  };

  return {
    supportModal: modal,
    submitSupportComment,
    triggerSupport,
  };
}
