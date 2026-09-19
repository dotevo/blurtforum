import { reactive } from 'vue';
import { BFUtils } from '../modules/utils';
import type { Post, Beneficiary, AuthUser } from '../types';

export interface PostFormState {
  title: string; body: string; loading: boolean; error: string; success: string;
  hasDraft: boolean; devTip: boolean;
  beneficiary: { account: string; weight: string };
  selectedTag: string; customTags: string;
}

export interface ReplyFormState {
  body: string; loading: boolean; error: string; success: string;
  beneficiary: { account: string; weight: string };
}

export interface EditModalState {
  show: boolean; loading: boolean; isPost: boolean;
  author: string; permlink: string; title: string; body: string;
  error: string; success: string; target: Post | null;
}

/**
 * Context of state/functions usePostForm needs from the host app.
 * Kept as a single object instead of a long parameter list.
 */
export interface PostFormContext {
  auth: { user: AuthUser | null };
  config: { communityAccount: string };
  t: (k: string) => string;
  checkLock: (fn: () => any) => boolean;
  broadcast: (ops: unknown[]) => Promise<void>;
  waitAndReload: (isTopic: boolean, author?: string | null, permlink?: string | null, pollFn?: ((c: any) => boolean) | null, label?: string | null) => Promise<void>;
  showStatus: (title: string, body: string, type?: 'info' | 'success' | 'error') => void;
}

export function usePostForm(ctx: PostFormContext) {
  // See submitReply()'s own comment on `myReplyGeneration` for why this
  // exists: replyForm is one shared object across every reply target in
  // the app, and a submission's own waitAndReload() can take minutes in
  // the background -- this stops an old, abandoned submission's eventual
  // completion from clobbering a newer one's `loading` state if the user
  // has since started replying to something else.
  let replyGeneration = 0;

  const postForm = reactive<PostFormState>({
    title: '', body: '', loading: false, error: '', success: '', hasDraft: false,
    devTip: localStorage.getItem('blurtforum_devtip') !== 'false',
    beneficiary: { account: '', weight: '' },
    selectedTag: '', customTags: '',
  });

  const replyForm = reactive<ReplyFormState>({
    body: '', loading: false, error: '', success: '',
    beneficiary: { account: '', weight: '' },
  });

  const editModal = reactive<EditModalState>({
    show: false, loading: false, isPost: false,
    author: '', permlink: '', title: '', body: '', error: '', success: '', target: null,
  });

  const prepareBeneficiaries = (
    customBeneficiary: { account: string; weight: string },
    communityAcc: string | null = null
  ): Beneficiary[] => {
    const bens: Beneficiary[] = [];
    const author = ctx.auth.user?.username;
    if (!author) return [];
    if (communityAcc?.startsWith('blurt-') && communityAcc !== author) bens.push({ account: communityAcc, weight: 300 });
    if (postForm.devTip && author !== 'dotevo') bens.push({ account: 'dotevo', weight: 100 });
    if (customBeneficiary?.account.trim()) {
      const acc = customBeneficiary.account.trim().toLowerCase();
      const weight = Math.min(Math.max(Math.round(parseFloat(customBeneficiary.weight) * 100) || 0, 1), 10000);
      if (weight > 0 && acc !== author) {
        const existing = bens.find(b => b.account === acc);
        if (existing) existing.weight = Math.min(10000, existing.weight + weight);
        else bens.push({ account: acc, weight });
      }
    }
    return bens.sort((a, b) => a.account.localeCompare(b.account));
  };

  /**
   * Submits a reply. `target` is the post being replied to, `replies` is the
   * current reply list (for the optimistic insert), `activeTopicPermlink` is
   * used to decide whether to clear quickReplyBody instead of replyForm.body.
   */
  const submitReply = async (
    target: Post | null,
    replies: { value: Post[] },
    activeTopicPermlink: string | undefined,
    quickReplyBody: { value: string },
    drafts: { clearReplyDraft: (author: string, permlink: string) => void },
    data?: any
  ): Promise<void> => {
    if (ctx.checkLock(() => submitReply(target, replies, activeTopicPermlink, quickReplyBody, drafts, data))) return;
    if (!ctx.auth.user) {
      console.warn('submitReply: no auth.user at submit time -- session may have been lost.');
      replyForm.error = ctx.t('replyError') + ' (not logged in)';
      if (data) data.error = replyForm.error;
      return;
    }
    if (!target) {
      // Real, previously silent failure mode: this fires if replyTarget
      // became null between the reply box rendering and the click actually
      // reaching here (e.g. loadReplies(..., keepState=false) resets
      // replyTarget.value = null as a side effect of an unrelated reload
      // racing with the user still composing) -- a click that visibly does
      // nothing, no error, nothing in the console, which is exactly what
      // was reported. Now at least surfaces something instead of silently
      // no-oping.
      console.warn('submitReply: called with no target (replyTarget was likely reset from under an in-progress reply).');
      replyForm.error = ctx.t('replyError') + ' (lost reply target -- please reopen the reply box and try again)';
      if (data) data.error = replyForm.error;
      return;
    }

    const body = (data?.body || replyForm.body).trim();
    if (!body) { replyForm.error = 'Reply cannot be empty.'; return; }

    const myReplyGeneration = ++replyGeneration;
    replyForm.loading = true; replyForm.error = ''; replyForm.success = '';
    const communityAcc = target.category;
    const beneficiaries = prepareBeneficiaries(data?.beneficiary || replyForm.beneficiary, communityAcc);

    const op = ['comment', {
      parent_author: target.author,
      parent_permlink: target.permlink,
      author: ctx.auth.user.username,
      permlink: BFUtils.genPermlink('re-' + target.author),
      title: '',
      body,
      json_metadata: JSON.stringify({ app: 'blurtforum/1.0', tags: [communityAcc || ctx.config.communityAccount], format: 'markdown' })
    }];

    const options = ['comment_options', {
      author: ctx.auth.user.username,
      permlink: (op[1] as Record<string, string>).permlink,
      max_accepted_payout: '1000000.000 BLURT',
      percent_steem_dollars: 10000,
      allow_votes: true,
      allow_curation_rewards: true,
      extensions: beneficiaries.length > 0 ? [[0, { beneficiaries }]] : []
    }];

    try {
      await ctx.broadcast([op, options]);
      replyForm.success = ctx.t('replySuccess');
      drafts.clearReplyDraft(target.author, target.permlink);
      if (data) { data.body = ''; data.title = ''; data.success = ctx.t('replySuccess'); }

      if (target.permlink === activeTopicPermlink) quickReplyBody.value = '';
      else replyForm.body = '';

      const parentPermlink = (op[1] as Record<string, string>).parent_permlink;
      const parentReply = replies.value.find(r => r.permlink === parentPermlink);
      const optimisticDepth = parentReply ? (parentReply.depth ?? 0) + 1 : 1;
      const optimistic: Post = {
        author: ctx.auth.user.username, permlink: (op[1] as Record<string, string>).permlink,
        parent_author: (op[1] as Record<string, string>).parent_author, parent_permlink: parentPermlink,
        body, created: new Date().toISOString().slice(0, 19), depth: optimisticDepth,
        pendingPayout: 0, totalPayout: 0, payout: 0, vote_count: 0, active_votes: [], net_rshares: 0,
        beneficiaries, _qOpen: false, _pending: 'sending', media: null, title: '', url: '', category: '',
        lastActivity: '', lastAuthor: '', isUnread: false, isRead: true, isFollowing: false, isMuted: false,
        isCommunityBanned: false, isGloballyBanned: false, isCoal: false,
        isPaid: false, isCollapsed: false, replyCount: 0, tags: [],
      };
      replies.value = [...replies.value, optimistic];
      await ctx.waitAndReload(true, ctx.auth.user.username, (op[1] as Record<string, string>).permlink);
    } catch (err) {
      console.error('Reply error:', err);
      replyForm.error = ctx.t('replyError') + ' (' + ((err as Error).message || '') + ')';
      if (data) data.error = replyForm.error;
    }
    // Only this generation gets to clear `loading` -- if the user has
    // since called submitReply() again (a newer generation), THAT call
    // owns `loading` now; this one finishing late (waitAndReload can take
    // minutes) must not clear it out from under a still-in-progress newer
    // submission. startReply() (see useApp.ts) independently resets
    // `loading` to false the moment the user switches targets, so an old
    // submission finishing after that is a no-op here either way -- this
    // guard specifically covers the narrower case of two submissions to
    // the same target in quick succession.
    if (myReplyGeneration === replyGeneration) replyForm.loading = false;
  };

  const submitPost = async (
    activeForumId: string | undefined,
    onSuccess: (authorPermlink: { author: string; permlink: string }) => void,
    drafts: { clearDraft: () => void },
    data?: any
  ): Promise<void> => {
    if (ctx.checkLock(() => submitPost(activeForumId, onSuccess, drafts, data))) return;
    if (!ctx.auth.user || !activeForumId) return;

    const title = (data?.title || postForm.title).trim();
    const body = (data?.body || postForm.body).trim();
    if (!title || !body) { postForm.error = 'Title and body are required.'; return; }

    postForm.loading = true; postForm.error = ''; postForm.success = '';

    const customTagsVal = data?.customTags ?? postForm.customTags;
    const selectedTagVal = data?.selectedTag ?? postForm.selectedTag;
    const beneficiaryVal = data?.beneficiary ?? postForm.beneficiary;

    const customTagsList = customTagsVal.split(',').map((s: string) => s.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean);
    const targetCommunity = ctx.config.communityAccount.startsWith('blurt-') ? ctx.config.communityAccount : null;
    const primaryTag = targetCommunity || selectedTagVal || customTagsList[0] || 'blurt';
    const tags = [primaryTag];
    if (selectedTagVal && !tags.includes(selectedTagVal)) tags.push(selectedTagVal);
    for (const ct of customTagsList) { if (tags.length >= 5) break; if (!tags.includes(ct)) tags.push(ct); }

    const beneficiaries = prepareBeneficiaries(beneficiaryVal, targetCommunity);
    const op = ['comment', {
      parent_author: '', parent_permlink: primaryTag, author: ctx.auth.user.username,
      permlink: BFUtils.genPermlink(title), title, body,
      json_metadata: JSON.stringify({ app: 'blurtforum/1.0', tags, format: 'markdown', community: targetCommunity || undefined })
    }];
    const options = ['comment_options', {
      author: ctx.auth.user.username, permlink: (op[1] as Record<string, string>).permlink,
      max_accepted_payout: '1000000.000 BLURT', percent_steem_dollars: 10000,
      allow_votes: true, allow_curation_rewards: true,
      extensions: beneficiaries.length > 0 ? [[0, { beneficiaries }]] : []
    }];
    try {
      await ctx.broadcast([op, options]);
      postForm.title = ''; postForm.body = '';
      if (data) { data.title = ''; data.body = ''; }
      drafts.clearDraft();
      ctx.showStatus(ctx.t('newPost'), ctx.t('postSuccess'), 'success');
      onSuccess({ author: ctx.auth.user.username, permlink: (op[1] as Record<string, string>).permlink });
    } catch (err) {
      console.error('Post error:', err);
      ctx.showStatus(ctx.t('newPost'), (ctx.t('postError') || 'Error: ') + ((err as Error).message || err), 'error');
    }
    postForm.loading = false;
  };

  const startEdit = (target: Post): void => {
    editModal.target = target; editModal.author = target.author; editModal.permlink = target.permlink;
    editModal.title = target.title || ''; editModal.body = target.body; editModal.isPost = !target.parent_author;
    editModal.error = ''; editModal.success = ''; editModal.loading = false; editModal.show = true;
  };

  const submitEdit = async (
    isTopicView: boolean,
    onSuccess: (authorPermlink: { author: string; permlink: string }, wasInTopic: boolean) => void,
    data?: any
  ): Promise<void> => {
    if (ctx.checkLock(() => submitEdit(isTopicView, onSuccess, data))) return;
    if (!ctx.auth.user || !editModal.target) return;
    editModal.loading = true; editModal.error = ''; editModal.success = '';

    const body = (data?.body ?? editModal.body).trim();
    const title = (data?.title ?? editModal.title).trim();

    let meta = editModal.target.json_metadata || '';
    if (typeof meta !== 'string') { try { meta = JSON.stringify(meta); } catch { meta = ''; } }
    const op = ['comment', {
      parent_author: editModal.target.parent_author || '',
      parent_permlink: editModal.target.parent_permlink || ctx.config.communityAccount,
      author: ctx.auth.user.username, permlink: editModal.permlink, title, body, json_metadata: meta
    }];
    try {
      await ctx.broadcast([op]);
      editModal.success = ctx.t('updateSuccess');
      const editedPermlink = editModal.permlink;
      const editedAuthor = editModal.author;
      editModal.show = false;
      onSuccess({ author: editedAuthor, permlink: editedPermlink }, isTopicView);
    } catch (err) {
      console.error('Edit error:', err);
      editModal.error = ctx.t('updateError') + ' (' + ((err as Error).message || '') + ')';
    }
    editModal.loading = false;
  };

  return {
    postForm,
    replyForm,
    editModal,
    prepareBeneficiaries,
    submitReply,
    submitPost,
    startEdit,
    submitEdit,
  };
}
