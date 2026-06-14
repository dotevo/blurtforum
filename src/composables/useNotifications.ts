import { reactive, watch } from 'vue';
import type { Notification } from '../types';
import { useTitle } from './useTitle';
import { Blockchain } from '../modules/blockchain';

const safeParse = (key: string, fallback: any) => {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : fallback;
  } catch { return fallback; }
};

export const notifModal = reactive({
  show: false,
  loading: false,
  initializing: true,
  list: [] as Notification[],
  lastReadIds: safeParse('bf_last_notif_ids', {}),
  hasNew: false,
  clickedIds: safeParse('bf_clicked_notif_ids', [])
});

export const useNotifications = (client: any, auth: any) => {
  const { setTitleIcon } = useTitle();

  watch(() => notifModal.hasNew, (hasNew) => {
    setTitleIcon('notif', hasNew ? '🔔' : null);
  }, { immediate: true });

  const checkNewNotifications = async (isInitial = false): Promise<void> => {
    if (auth.accounts.length === 0 || notifModal.show) {
      notifModal.initializing = false;
      return;
    }
    if (isInitial) notifModal.initializing = true;
    try {
      let hasAnyNew = false;
      for (const account of auth.accounts) {
        const lastReadId = notifModal.lastReadIds[account.username] || 0;
        const list = await Blockchain.getNotifications(client, account.username, 1);
        if (list?.length && Number(list[0].id) > lastReadId) {
          hasAnyNew = true;
          break;
        }
      }
      notifModal.hasNew = hasAnyNew;
    } catch { /* ignore */ }
    finally { if (isInitial) notifModal.initializing = false; }
  };

  const startPolling = () => {
    checkNewNotifications(true);
    setInterval(checkNewNotifications, 60000);
  };

  const openNotifModal = async (): Promise<void> => {
    notifModal.show = true;
    notifModal.loading = true;
    try {
      const allNotifications: Notification[] = [];
      
      await Promise.all(auth.accounts.map(async (account: any) => {
        try {
          const list = await Blockchain.getNotifications(client, account.username, 20);
          if (Array.isArray(list)) {
            list.forEach(n => { n.account = account.username; allNotifications.push(n); });
          }
          
          const history = await Blockchain.getAccountHistory(client, account.username, -1, 20);
          if (Array.isArray(history)) {
            history.forEach(item => {
              const op = item[1].op;
              if (op[0] === 'transfer' && op[1].to === account.username) {
                const tx = op[1];
                const notifId = `tx-${account.username}-${item[0]}`;
                if (!allNotifications.find(n => n.id === notifId)) {
                  allNotifications.push({ 
                    id: notifId, type: 'transfer', author: tx.from, date: item[1].timestamp, 
                    msg: `Received ${tx.amount} from @${tx.from}` + (tx.memo ? `: ${tx.memo}` : ''), 
                    url: `@${tx.from}`, account: account.username 
                  });
                }
              }
            });
          }
        } catch (e) { console.warn(`Notif fetch error for ${account.username}:`, e); }
      }));

      allNotifications.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      notifModal.list = allNotifications.slice(0, 50);

      // Update last read IDs for all accounts
      let changed = false;
      auth.accounts.forEach((account: any) => {
        const accountNotifs = notifModal.list.filter(n => n.account === account.username && typeof n.id === 'number');
        if (accountNotifs.length > 0) {
          const maxId = Math.max(...accountNotifs.map(n => n.id as number));
          const currentMax = notifModal.lastReadIds[account.username] || 0;
          if (maxId > currentMax) {
            notifModal.lastReadIds[account.username] = maxId;
            changed = true;
          }
        }
      });

      if (changed) {
        localStorage.setItem('bf_last_notif_ids', JSON.stringify(notifModal.lastReadIds));
        notifModal.hasNew = false;
      }
    } catch (err) {
      console.error('Notif error:', err);
    } finally {
      notifModal.loading = false;
    }
  };

  const openNotification = async (
    notif: Notification,
    callbacks: {
      openTopic: (p: any) => void,
      openProfile: (u: string) => void,
      normalizePost: (r: any) => any,
      client: any,
      config: any,
      targetNotifPermlink: any,
      selectedCommunity: any,
      loading: any,
      loadData: () => Promise<void>,
      forumClient: any,
      getForumUrl: () => string,
      getDataUrl: () => string,
      auth: any,
      switchAccount: (u: string) => void
    }
  ): Promise<void> => {
    const notifKey = `${notif.account || 'unknown'}-${notif.id}`;
    if (!notifModal.clickedIds.includes(notifKey)) {
      notifModal.clickedIds.push(notifKey);
      if (notifModal.clickedIds.length > 200) notifModal.clickedIds.shift();
      localStorage.setItem('bf_clicked_notif_ids', JSON.stringify(notifModal.clickedIds));
    }
    notifModal.show = false;

    // Handle account switch if notification is for a different account
    if (notif.account && callbacks.auth.user?.username !== notif.account) {
      callbacks.switchAccount(notif.account);
    }

    if (!notif.url) return;
    callbacks.loading.value = true;
    try {
      const parts = notif.url.split('/');
      const author = parts[0].replace('@', '');
      const permlink = parts[1];
      if (permlink) {
        const content = await Blockchain.getContent(callbacks.client, author, permlink);
        if (content?.author) {
          let root: any = content;
          if (content.parent_author) {
            const urlParts = content.url.split('#')[0].split('/');
            if (urlParts.length >= 4) {
              const rootAuthor = urlParts[2].replace('@', ''); const rootPermlink = urlParts[3];
              if (rootAuthor !== author || rootPermlink !== permlink) root = await Blockchain.getContent(callbacks.client, rootAuthor, rootPermlink);
            }
          }
          const targetCommunity = root.category;
          if (targetCommunity?.startsWith('blurt-') && targetCommunity !== callbacks.config.communityAccount && !callbacks.config.lockedCommunity) {
            callbacks.config.communityAccount = targetCommunity; 
            callbacks.selectedCommunity.value = targetCommunity;
          }
          callbacks.targetNotifPermlink.value = permlink;
          callbacks.openTopic(callbacks.normalizePost(root));
        }
      } else { callbacks.openProfile(author); }
    } catch (err) { console.error('Open notification error:', err); }
    callbacks.loading.value = false;
  };

  return { notifModal, checkNewNotifications, openNotifModal, openNotification, startPolling };
};
