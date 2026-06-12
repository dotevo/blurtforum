import { ref, reactive } from 'vue';
import * as dblurt from '@beblurt/dblurt';
import type { AuthUser } from '../types';
import { AuthService } from '../modules/auth';
import { whalevault } from '../modules/whalevault';

/**
 * Composable for managing authentication, multi-account support, and PIN encryption.
 */
export function useAuth(client: any, t: (k: string) => string) {
  const auth = reactive<{ user: AuthUser | null, accounts: AuthUser[] }>({ user: null, accounts: [] });
  
  const loginTab = ref('key');
  const loginForm = reactive({ username: '', key: '', remember: false });
  const loginErr = ref('');
  const loginBusy = ref(false);
  const wvAvailable = ref(false);
  const showLoginModal = ref(false);

  whalevault.promiseRequestHandshake('blurtforum').then((v: any) => wvAvailable.value = !!v);
  const showSwitchAccountModal = ref(false);
  const loginOptions = reactive({ noSwitch: false, targetAccount: '' });
  
  const openLoginModal = (opts?: { noSwitch?: boolean, targetAccount?: string }): void => {
    loginErr.value = ''; loginForm.username = opts?.targetAccount || ''; loginForm.key = '';
    loginOptions.noSwitch = !!opts?.noSwitch;
    loginOptions.targetAccount = opts?.targetAccount || '';
    showLoginModal.value = true;
  };

  const openSwitchAccountModal = (): void => {
    showSwitchAccountModal.value = true;
  };

  const pinModal = reactive({
    show: false,
    mode: 'setup' as 'setup' | 'unlock',
    value: '',
    error: '',
    tempUser: null as null | { username: string; key: string; acc: Record<string, unknown> },
    loading: false
  });

  const saveSessions = (): void => {
    const sessions = auth.accounts.map(u => {
      if (u.type === 'key' && !u.encryptedKey) return null;
      return {
        username: u.username,
        type: u.type,
        key: u.encryptedKey || null,
        expires: Date.now() + 30 * 24 * 60 * 60 * 1000
      };
    }).filter(s => s !== null);
    localStorage.setItem('blurtforum_sessions', JSON.stringify(sessions));
    if (auth.user && (auth.user.type === 'whalevault' || auth.user.encryptedKey)) {
      localStorage.setItem('blurtforum_session', JSON.stringify({
        username: auth.user.username,
        type: auth.user.type,
        key: auth.user.encryptedKey || null,
        expires: Date.now() + 30 * 24 * 60 * 60 * 1000
      }));
    }
  };

  const completeLogin = (
    username: string,
    key: string | null,
    acc: Record<string, unknown>,
    pin?: string,
    callbacks?: {
      loadUserCommunities: (u: string) => void,
      loadFollowingList: (u: string) => void,
      loadData: () => void
    }
  ): void => {
    const lastVoteTime = new Date((acc.last_vote_time as string) + 'Z').getTime();
    const delta = (Date.now() - lastVoteTime) / 1000;
    let vp = (acc.voting_power as number) + (10000 * delta / 432000);
    vp = Math.min(vp / 100, 100);
    
    // Parse payout helpers would be good here but we'll use a simple check for now
    const hasRewards = (acc.reward_blurt_balance as string).startsWith('0.000') === false || 
                      (acc.reward_vesting_balance as string).startsWith('0.000') === false;
    
    let encryptedKey: string | undefined = undefined;
    if (key && pin) encryptedKey = AuthService.encryptKey(key, pin);
    else if (key && AuthService.isEncrypted(key)) { encryptedKey = key; }

    const newUser: AuthUser = { 
      username, 
      type: key ? 'key' : 'whalevault', 
      key, 
      encryptedKey,
      vp: vp.toFixed(2), 
      hasRewards, 
      rewardBlurt: acc.reward_blurt_balance as string, 
      rewardVesting: acc.reward_vesting_balance as string, 
      locked: key ? AuthService.isEncrypted(key) : false
    };

    const existingIdx = auth.accounts.findIndex(a => a.username === username);
    if (existingIdx >= 0) auth.accounts[existingIdx] = newUser;
    else auth.accounts.push(newUser);

    if (!loginOptions.noSwitch) {
      auth.user = newUser;
      if (callbacks) {
        callbacks.loadUserCommunities(username);
        callbacks.loadFollowingList(username);
        callbacks.loadData();
      }
    }
    
    if (loginForm.remember || newUser.type === 'whalevault') saveSessions();
    showLoginModal.value = false;
    loginForm.key = '';
  };

  const doKeyLogin = async (callbacks: any): Promise<void> => {
    const username = loginForm.username.trim();
    const keyStr = loginForm.key.trim();
    if (!username || !keyStr) { loginErr.value = 'Both fields are required.'; return; }
    loginBusy.value = true; loginErr.value = '';
    try {
      const privKey = (dblurt as any).PrivateKey.from(keyStr);
      const pubKey = privKey.createPublic().toString();
      const accounts = await client.condenser.getAccounts([username]);
      const acc = accounts?.[0] as Record<string, unknown>;
      if (!acc) throw new Error('Account not found');
      const postingPubs = (acc.posting as { key_auths: [string, number][] }).key_auths.map(k => k[0]);
      if (!postingPubs.includes(pubKey)) throw new Error('Key mismatch');
      
      if (loginForm.remember) {
        pinModal.tempUser = { username, key: keyStr, acc };
        pinModal.mode = 'setup';
        pinModal.value = '';
        pinModal.error = '';
        pinModal.show = true;
        showLoginModal.value = false;
      } else {
        completeLogin(username, keyStr, acc, undefined, callbacks);
      }
    } catch (err) {
      console.error('Key login error:', err);
      loginErr.value = t('loginError');
    }
    loginBusy.value = false;
  };

  const doWVLogin = async (callbacks: any): Promise<void> => {
    const username = loginForm.username.trim();
    if (!username) { loginErr.value = 'Username required'; return; }
    loginBusy.value = true;
    try {
      const challenge = `Login to BlurtForum as ${username} at ${new Date().toISOString()}`;
      const response = await whalevault.promiseRequestSignBuffer('blurtforum', 'blt:' + username, challenge, 'posting', 'Login', 'hex');
      if (response && response.success) {
        const accounts = await client.condenser.getAccounts([username]);
        if (accounts?.[0]) {
          completeLogin(username, null, accounts[0], undefined, callbacks);
        }
      } else {
        throw new Error(response?.message || 'WhaleVault sign error');
      }
    } catch (err) {
      console.error('WhaleVault login error:', err);
      loginErr.value = 'WhaleVault error: ' + (err as Error).message;
    }
    loginBusy.value = false;
  };

  const logout = (): void => {
    if (!auth.user) return;
    const idx = auth.accounts.findIndex(a => a.username === auth.user!.username);
    if (idx >= 0) auth.accounts.splice(idx, 1);
    auth.user = auth.accounts.length > 0 ? auth.accounts[0] : null;
    saveSessions();
    if (!auth.user) location.reload();
  };

  const switchAccount = (username: string, callbacks: any): void => {
    const acc = auth.accounts.find(a => a.username === username);
    if (acc) {
      auth.user = acc;
      saveSessions();
      callbacks.loadUserCommunities(username);
      callbacks.loadFollowingList(username);
      callbacks.loadData();
    }
  };

  const removeAccount = (username: string): void => {
    auth.accounts = auth.accounts.filter(a => a.username !== username);
    if (auth.user?.username === username) {
      auth.user = auth.accounts.length > 0 ? auth.accounts[0] : null;
    }
    saveSessions();
    if (auth.accounts.length === 0) location.reload();
  };

  const handlePinSubmit = async (callbacks: any): Promise<void> => {
    if (pinModal.value.length < 4) { pinModal.error = 'Min 4 digits'; return; }
    pinModal.loading = true; pinModal.error = '';
    await new Promise(r => setTimeout(r, 50));
    try {
      if (pinModal.mode === 'setup') {
        const encrypted = AuthService.encryptKey(pinModal.tempUser!.key, pinModal.value);
        localStorage.setItem('blurtforum_session', JSON.stringify({ username: pinModal.tempUser!.username, key: encrypted, expires: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
        completeLogin(pinModal.tempUser!.username, pinModal.tempUser!.key, pinModal.tempUser!.acc, pinModal.value, callbacks);
        pinModal.show = false;
      } else {
        const sessionStr = localStorage.getItem('blurtforum_session');
        if (!sessionStr) return;
        const session = JSON.parse(sessionStr) as { username: string; key: string };
        let decrypted: string | null = null;
        if (AuthService.isEncrypted(session.key)) {
          decrypted = AuthService.decryptKey(session.key, pinModal.value);
        }
        if (!decrypted || !decrypted.startsWith('5')) throw new Error('Invalid PIN');
        
        // Unlock all accounts with this PIN
        auth.accounts.forEach(acc => {
          if (acc.type === 'key' && acc.locked && acc.key && AuthService.isEncrypted(acc.key)) {
            const dec = AuthService.decryptKey(acc.key, pinModal.value);
            if (dec) { acc.key = dec; acc.locked = false; }
          }
        });

        const accounts = await client.condenser.getAccounts([session.username]);
        if (accounts?.[0]) {
          completeLogin(session.username, decrypted, accounts[0] as Record<string, unknown>, pinModal.value, callbacks);
          if (auth.user) auth.user.locked = false;
          pinModal.show = false;
          if (callbacks.resumeAction) callbacks.resumeAction();
        }
      }
    } catch {
      pinModal.error = t('invalidPin');
      pinModal.value = '';
    } finally {
      pinModal.loading = false;
    }
  };

  return {
    auth,
    loginTab,
    loginForm,
    loginErr,
    loginBusy,
    wvAvailable,
    showLoginModal,
    loginOptions,
    pinModal,
    completeLogin,
    doKeyLogin,
    doWVLogin,
    logout,
    switchAccount,
    removeAccount,
    openLoginModal,
    openSwitchAccountModal,
    showSwitchAccountModal,
    handlePinSubmit,
    saveSessions
  };
}
