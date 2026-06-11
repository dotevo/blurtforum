import { reactive } from 'vue';
import type { AuthUser } from '../types';

/**
 * Composable for handling wallet operations (transfers, power up/down, delegation).
 */
export function useWallet(
  auth: { user: AuthUser | null },
  broadcast: (ops: any[]) => Promise<void>,
  waitAndReload: any,
  showStatus: (title: string, body: string, type: 'info' | 'success' | 'error') => void,
  checkLock: (fn: () => any) => boolean
) {
  const walletModal = reactive({
    show: false,
    mode: 'transfer' as 'transfer' | 'power_up' | 'power_down',
    balance: '0.000',
    targetUser: ''
  });

  const openWalletModal = (mode: 'transfer' | 'power_up' | 'power_down', balance: string, targetUser = ''): void => {
    walletModal.mode = mode;
    walletModal.balance = balance;
    walletModal.targetUser = targetUser;
    walletModal.show = true;
  };

  const handleWalletSubmit = async (data: { mode: string, to: string, amount: string, memo: string }, globalProps: any): Promise<void> => {
    if (!auth.user) return;
    walletModal.show = false;
    if (checkLock(() => handleWalletSubmit(data, globalProps))) return;

    try {
      const amount = parseFloat(data.amount).toFixed(3);
      let ops: any[] = [];
      let label = '';

      if (data.mode === 'transfer') {
        ops = [['transfer', { from: auth.user.username, to: data.to.trim().toLowerCase(), amount: `${amount} BLURT`, memo: data.memo || '' }]];
        label = `Transferring ${amount} BLURT to ${data.to}...`;
      } else if (data.mode === 'power_up') {
        ops = [['transfer_to_vesting', { from: auth.user.username, to: data.to.trim().toLowerCase() || auth.user.username, amount: `${amount} BLURT` }]];
        label = `Powering up ${amount} BLURT...`;
      } else if (data.mode === 'power_down') {
        const ratio = parseFloat(String(globalProps.value.total_vesting_fund_blurt || 0)) / parseFloat(String(globalProps.value.total_vesting_shares || 1));
        const vests = (parseFloat(data.amount) / ratio).toFixed(6);
        ops = [['withdraw_vesting', { account: auth.user.username, vesting_shares: `${vests} VESTS` }]];
        label = `Starting power down of ${amount} BP...`;
      }

      await broadcast(ops);
      showStatus('Wallet', 'Transaction broadcasted successfully!', 'success');
      waitAndReload(false, null, null, null, label);
    } catch (err) {
      console.error('Wallet error:', err);
      showStatus('Wallet', 'Transaction failed: ' + ((err as Error).message || err), 'error');
    }
  };

  const cancelDelegation = async (target: string): Promise<void> => {
    if (!auth.user || !confirm(`Cancel delegation to @${target}?`)) return;
    if (checkLock(() => cancelDelegation(target))) return;
    const op = ['delegate_vesting_shares', { delegator: auth.user.username, delegatee: target, vesting_shares: '0.000000 VESTS' }];
    try {
      await broadcast([op]);
      showStatus('Wallet', 'Delegation cancel requested', 'success');
      waitAndReload(false, null, null, null, `Cancelling delegation to @${target}...`);
    } catch (err) {
      showStatus('Wallet', 'Error: ' + ((err as Error).message || err), 'error');
    }
  };

  return {
    walletModal,
    openWalletModal,
    handleWalletSubmit,
    cancelDelegation
  };
}
