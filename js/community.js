/**
 * BlurtForum Community Discovery & Subscription Library
 */
window.BFCommunity = (function() {
  const { reactive, ref } = Vue;

  const state = reactive({
    list: [],
    loading: false,
    query: '',
    last: '',
    hasMore: true
  });

  /**
   * fetchCommunities: Fetches list of communities from RPC
   * @param {Object} client - Hive/Blurt client instance
   * @param {boolean} refresh - Clear list and start from beginning
   */
  const fetchCommunities = async (client, refresh = false) => {
    if (state.loading) return;
    if (refresh) {
      state.list = [];
      state.last = '';
      state.hasMore = true;
    }
    if (!state.hasMore) return;

    state.loading = true;
    try {
      const result = await client.call('bridge', 'list_communities', {
        last: state.last,
        limit: 20,
        query: state.query
      });

      if (result && result.length > 0) {
        state.list.push(...result);
        state.last = result[result.length - 1].name;
        if (result.length < 20) state.hasMore = false;
      } else {
        state.hasMore = false;
      }
    } catch (err) {
      console.error('Failed to fetch communities:', err);
    } finally {
      state.loading = false;
    }
  };

  /**
   * toggleSubscription: Subscribes or unsubscribes from a community
   * @param {Object} auth - Auth object containing user info
   * @param {Function} broadcastFn - Function to broadcast operations
   * @param {string} communityName - Account name of the community (e.g. blurt-123)
   * @param {boolean} isSubscribed - Current subscription status
   */
  const toggleSubscription = async (auth, broadcastFn, communityName, isSubscribed) => {
    if (!auth.user) throw new Error('Must be logged in');

    const op = ['custom_json', {
      required_auths: [],
      required_posting_auths: [auth.user.username],
      id: 'community',
      json: JSON.stringify([isSubscribed ? 'unsubscribe' : 'subscribe', {
        community: communityName
      }])
    }];

    await broadcastFn([op]);
    return !isSubscribed;
  };

  return {
    state,
    fetchCommunities,
    toggleSubscription
  };
})();
