<script setup lang="ts">
import type { Post } from '../../types';
import type { AuthUser } from '../../types';
import { ref, computed, onMounted, onUpdated } from 'vue';
import { dispatchScanView } from '../../modules/player';
import ForumMedia from '../player/ForumMedia.ce.vue';
import PayoutBadge from '../layout/PayoutBadge.vue';
import UserAvatar from '../layout/UserAvatar.vue';
import VoteButton from '../layout/VoteButton.vue';
import VueApexCharts from "vue3-apexcharts";

const props = defineProps<{
  profileUser: {
    username: string;
    data: Record<string, unknown> | null;
    posts: Post[];
    comments: Post[];
    replies: Post[];
    postsHasMore: boolean;
    commentsHasMore: boolean;
    repliesHasMore: boolean;
    earnings: {
      rawHistory: any[];
      history: any[];
      stats: {
        author: number;
        curation: number;
        benefactor: number;
        claimed: number;
        total: number;
        avgPerDay: number;
        range: string;
      };
      chartData: {
        daily: Array<{ date: string; author: number, curation: number, benefactor: number, total: number }>;
        distribution: { author: number; curation: number; benefactor: number };
      };
      loading: boolean;
    };
    wallet: {
      delegations: any[];
      incomingDelegations: any[];
      history: any[];
      powerDown: { total: string, rate: string, next: string, percent: number };
      loading: boolean;
    };
    loading: boolean;
  };
  profileTab: string;
  auth: { user: AuthUser | null };
  followingSet: Set<string>;
  t: (k: string) => string;
  fmtDate: (s: string) => string;
  timeAgo: (s: string) => string;
  renderMD: (s: string) => string;
  player: { state: { enabled: boolean } };
  hasVoted: (p: Post) => boolean;
}>();

const emit = defineEmits<{
  openProfile: [username: string];
  openTopic: [post: Post];
  openPayoutModal: [post: Post];
  toggleFollow: [username: string];
  handleMediaAction: [type: string, id: string, host: string, action: string, data: Record<string, unknown>];
  'update:profileTab': [value: string];
  fetchEarnings: [];
  openWalletModal: [mode: 'transfer' | 'power_up' | 'power_down', balance: string, targetUser?: string];
  claimRewards: [];
  cancelDelegation: [target: string];
  loadMoreProfileContent: [sort: 'posts' | 'comments' | 'replies'];
  submitVote: [post: Post];
}>();

const showHistoryTable = ref(false);

const triggerScan = () => {
  const container = document.querySelector('.profile-list-table');
  if (container) dispatchScanView(container);
};
onMounted(triggerScan);
onUpdated(triggerScan);

// --- Colors ---
const colors = {
  author: '#2ecc71',
  curation: '#3498db',
  benefactor: '#f39c12',
  claimed: '#9b59b6'
};

// --- ApexCharts Options ---

const donutOptions = computed(() => ({
  chart: { type: 'donut' as const },
  labels: [props.t('authorRewards'), props.t('curationRewards'), props.t('benefactorRewards')],
  colors: [colors.author, colors.curation, colors.benefactor],
  legend: { position: 'bottom' as const, labels: { colors: 'var(--text-muted)' } },
  dataLabels: { enabled: false },
  stroke: { show: false },
  plotOptions: { pie: { donut: { size: '65%', background: 'transparent' } } },
  tooltip: { theme: 'dark' as const }
}));

const donutSeries = computed(() => {
  const d = props.profileUser.earnings.chartData.distribution;
  return [d.author, d.curation, d.benefactor];
});

const barOptions = computed(() => ({
  chart: { 
    type: 'bar' as const, 
    stacked: true, 
    toolbar: { show: true, tools: { download: false } },
    background: 'transparent'
  },
  colors: [colors.author, colors.curation, colors.benefactor],
  plotOptions: { bar: { horizontal: false, columnWidth: '70%' } },
  dataLabels: { enabled: false },
  xaxis: {
    categories: props.profileUser.earnings.chartData.daily.map(d => d.date),
    labels: { style: { colors: 'var(--text-muted)', fontSize: '10px' } },
    axisBorder: { show: false },
    axisTicks: { show: false }
  },
  yaxis: { labels: { style: { colors: 'var(--text-muted)' } } },
  grid: { borderColor: 'var(--border-main)', strokeDashArray: 4 },
  legend: { show: false },
  tooltip: { theme: 'dark' as const, shared: true, intersect: false },
  theme: { mode: 'dark' as const }
}));

const barSeries = computed(() => {
  const data = props.profileUser.earnings.chartData.daily;
  return [
    { name: props.t('authorRewards'), data: data.map(d => parseFloat(d.author.toFixed(2))) },
    { name: props.t('curationRewards'), data: data.map(d => parseFloat(d.curation.toFixed(2))) },
    { name: props.t('benefactorRewards'), data: data.map(d => parseFloat(d.benefactor.toFixed(2))) }
  ];
});

</script>

<template>
    
      <div class="forumline" style="padding: 20px;">
        <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
          <UserAvatar :username="profileUser.username" size="lg" style="width: 120px; height: 120px;" />
          <div style="flex: 1; min-width: 250px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <div>
                <h2 style="color: var(--primary); margin: 0 0 5px;">{{ profileUser.data ? (profileUser.data as any).displayName : '@' + profileUser.username }}</h2>
                <div class="gs" style="margin-bottom: 10px; font-weight: bold;">@{{ profileUser.username }}</div>
              </div>
              <button v-if="auth.user && auth.user.username !== profileUser.username"
                      class="btn btn-follow" :class="followingSet.has(profileUser.username) ? 'btn-ghost' : 'btn-accent'"
                      @click="$emit('toggleFollow', profileUser.username)">
                <i class="fa-solid" :class="followingSet.has(profileUser.username) ? 'fa-user-check' : 'fa-user-plus'"></i>
                {{ followingSet.has(profileUser.username) ? t('unfollow') : t('follow') }}
              </button>            </div>
            
            <div v-if="profileUser.data" style="display: flex; flex-direction: column; gap: 5px; margin-bottom: 15px;">
              <div v-if="(profileUser.data as any).about" style="font-size: 12px; margin-bottom: 10px; padding: 10px; background: var(--bg-r2); border-left: 3px solid var(--primary);">
                {{ (profileUser.data as any).about }}
              </div>
              <div style="display: flex; gap: 15px; flex-wrap: wrap;" class="gs">
                <span v-if="(profileUser.data as any).location">📍 {{ (profileUser.data as any).location }}</span>
                <span v-if="(profileUser.data as any).website">🔗 <a :href="(profileUser.data as any).website" target="_blank">{{ (profileUser.data as any).website }}</a></span>
                <span>📅 {{ t('joined') }}: {{ fmtDate((profileUser.data as any).created).split(',')[0] }}</span>
              </div>
            </div>

            <div v-if="profileUser.data" class="profile-stats">
              <div class="stat-box">
                <div class="stat-label">{{ t('followers') }}</div>
                <div class="stat-val">{{ (profileUser.data as any).followerCount }}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">{{ t('following') }}</div>
                <div class="stat-val">{{ (profileUser.data as any).followingCount }}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">BLURT</div>
                <div class="stat-val">{{ (profileUser.data as any).balance }}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">BLURT POWER</div>
                <div class="stat-val">
                  {{ (profileUser.data as any).totalBP }} BP
                  <div class="gs" style="font-weight: normal; margin-top: 2px;">
                    ({{ (profileUser.data as any).bp }} + {{ (profileUser.data as any).delegatedIn }} - {{ (profileUser.data as any).delegatedOut }})
                  </div>
                </div>
              </div>
            </div>
            <div v-if="profileUser.loading" class="loader"><span class="spin"></span>{{ t('loading') }}…</div>
          </div>
        </div>
      </div>

      <div class="tabs" style="margin-top: 20px;">
        <button class="tab-btn" :class="{active: profileTab==='posts'}" @click="$emit('update:profileTab', 'posts')">{{ t('posts') }}</button>
        <button class="tab-btn" :class="{active: profileTab==='comments'}" @click="$emit('update:profileTab', 'comments')">{{ t('comments') }}</button>
        <button class="tab-btn" :class="{active: profileTab==='replies'}" @click="$emit('update:profileTab', 'replies')">{{ t('replies') }}</button>
        <button class="tab-btn" :class="{active: profileTab==='wallet'}" @click="$emit('update:profileTab', 'wallet')">💳 {{ t('wallet') }}</button>
        <button class="tab-btn" :class="{active: profileTab==='earnings'}" @click="$emit('update:profileTab', 'earnings')">💰 {{ t('earnings') }}</button>
      </div>

      <!-- WALLET TAB -->
      <div v-if="profileTab==='wallet'" class="wallet-tab">
        <div class="forumline" style="padding: 20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
             <h3 style="margin: 0; color: var(--primary);">💳 {{ t('walletBalances') }}</h3>
             <div v-if="profileUser.wallet.loading" class="gs"><i class="fa-solid fa-sync fa-spin"></i> {{ t('loading') }}</div>
          </div>
          
          <div class="wallet-grid">
            <!-- TOTAL VALUE -->
            <div class="wallet-card forumline total-card">
               <div class="stat-label">{{ t('estimatedAccountValue') || 'Estimated Account Value' }}</div>
               <div class="stat-val main-amt highlight">~{{ (profileUser.data as any)?.walletValue }} <span class="unit">BLURT</span></div>
               <div class="gs" style="font-size:10px; margin-top:5px; opacity:0.8">
                 {{ t('totalValueDesc') || 'Sum of liquid BLURT and BP (excluding incoming delegations).' }}
               </div>
            </div>

            <!-- BLURT -->
            <div class="wallet-card forumline highlight-card">
              <div class="wallet-card-header">
                <div class="stat-label">BLURT (Liquid)</div>
                <div class="stat-val main-amt">{{ (profileUser.data as any)?.balance || '0.000 BLURT' }}</div>
              </div>
              <div class="wallet-card-desc gs">
                {{ t('blurtDesc') }}
              </div>
              <div v-if="auth.user?.username === profileUser.username" class="wallet-actions">
                <button class="btn btn-sm btn-primary" @click="$emit('openWalletModal', 'transfer', (profileUser.data as any)?.balance)">
                  <i class="fa-solid fa-paper-plane"></i> {{ t('transfer') }}
                </button>
                <button class="btn btn-sm btn-accent" @click="$emit('openWalletModal', 'power_up', (profileUser.data as any)?.balance)">
                  <i class="fa-solid fa-bolt"></i> {{ t('powerUp') }}
                </button>
              </div>
              <div v-else-if="auth.user" class="wallet-actions">
                <button class="btn btn-sm btn-primary" @click="$emit('openWalletModal', 'transfer', (auth.user as any)?.balance, profileUser.username)">
                  <i class="fa-solid fa-gift"></i> {{ t('sendBlurt') }}
                </button>
              </div>
            </div>

            <!-- BLURT POWER -->
            <div class="wallet-card forumline highlight-card-bp">
              <div class="wallet-card-header">
                <div class="stat-label">BLURT POWER</div>
                <div class="stat-val main-amt">{{ (profileUser.data as any)?.totalBP }} BP</div>
              </div>
              <div class="wallet-card-desc gs">
                <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                   <span>{{ t('own') }}:</span> <b>{{ (profileUser.data as any)?.bp }} BP</b>
                </div>
                <div style="display:flex; justify-content:space-between; color: var(--success-text);">
                   <span>{{ t('received') }}:</span> <b>+ {{ (profileUser.data as any)?.delegatedIn }} BP</b>
                </div>
                <div style="display:flex; justify-content:space-between; color: var(--error-text);">
                   <span>{{ t('delegated') }}:</span> <b>- {{ (profileUser.data as any)?.delegatedOut }} BP</b>
                </div>
              </div>
              <div v-if="auth.user?.username === profileUser.username" class="wallet-actions">
                <button class="btn btn-sm btn-ghost" @click="$emit('openWalletModal', 'power_down', (profileUser.data as any)?.bp)">
                  <i class="fa-solid fa-arrow-down-wide-short"></i> {{ t('powerDown') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Rewards Box -->
          <div v-if="auth.user?.username === profileUser.username && auth.user.hasRewards" 
               class="reward-claim-box">
            <div style="display:flex; align-items:center; gap:12px;">
              <div class="reward-icon">🎁</div>
              <div>
                <div style="font-weight: bold; color: #fff;">{{ t('unclaimedRewards') }}</div>
                <div style="color: rgba(255,255,255,0.8); font-size: 11px;">{{ auth.user.rewardBlurt }} / {{ auth.user.rewardVesting }}</div>
              </div>
            </div>
            <button class="btn btn-light" @click="$emit('claimRewards')">
              {{ t('claimRewards') }}
            </button>
          </div>

          <!-- Power Down Monitor -->
          <div v-if="profileUser.wallet.powerDown.rate !== '0.000'" class="forumline pd-monitor">
            <div style="font-weight: bold; color: var(--primary); margin-bottom: 12px; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-clock-rotate-left"></i> {{ t('powerDownActive') }}
            </div>
            <div class="pd-grid">
              <div class="pd-stat">
                <div class="stat-label">{{ t('weeklyRate') }}</div>
                <div class="stat-val small">{{ profileUser.wallet.powerDown.rate }} <span class="unit">BP</span></div>
              </div>
              <div class="pd-stat">
                <div class="stat-label">{{ t('remainingTotal') }}</div>
                <div class="stat-val small">{{ profileUser.wallet.powerDown.total }} <span class="unit">BP</span></div>
              </div>
              <div class="pd-stat">
                <div class="stat-label">{{ t('nextWithdrawal') }}</div>
                <div class="stat-val small" style="color: var(--accent);">{{ timeAgo(profileUser.wallet.powerDown.next) }}</div>
              </div>
            </div>
          </div>

          <!-- Delegations Section -->
          <div class="delegations-row">
            <div class="delegation-half">
              <h4 style="color: var(--primary); margin-bottom: 12px; display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> {{ t('outgoingDelegations') }}
              </h4>
              <table class="forumline profile-list-table tight">
                <thead>
                  <tr>
                    <td class="thHead" style="text-align:left;padding-left:10px">{{ t('delegatee') }}</td>
                    <td class="thHead" align="right">BP</td>
                    <td class="thHead" align="center" width="50" v-if="auth.user?.username === profileUser.username"></td>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="del in profileUser.wallet.delegations" :key="del.delegatee">
                    <td class="row1"><b>@{{ del.delegatee }}</b></td>
                    <td class="row2" align="right" style="font-weight:bold;">{{ del.bp }}</td>
                    <td class="row1" align="center" v-if="auth.user?.username === profileUser.username">
                      <button class="btn-icon-only" @click="$emit('cancelDelegation', del.delegatee)" title="Cancel">
                        <i class="fa-solid fa-trash-can"></i>
                      </button>
                    </td>
                  </tr>
                  <tr v-if="profileUser.wallet.delegations.length === 0">
                    <td colspan="3" class="row1 gs" style="text-align:center; padding: 15px; opacity: 0.7;">
                      {{ t('noOutgoingDelegations') }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="delegation-half">
              <h4 style="color: var(--primary); margin-bottom: 12px; display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-arrow-down-left-and-arrow-up-right-to-center"></i> {{ t('incomingDelegations') }}
              </h4>
              <table class="forumline profile-list-table tight">
                <thead>
                  <tr>
                    <td class="thHead" style="text-align:left;padding-left:10px">{{ t('delegator') }}</td>
                    <td class="thHead" align="right">BP</td>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="del in profileUser.wallet.incomingDelegations" :key="del.delegator">
                    <td class="row1"><b>@{{ del.delegator }}</b></td>
                    <td class="row2" align="right" style="font-weight:bold;">{{ del.bp }}</td>
                  </tr>
                  <tr v-if="profileUser.wallet.incomingDelegations.length === 0">
                    <td colspan="2" class="row1 gs" style="text-align:center; padding: 15px; opacity: 0.7;">
                      {{ t('noIncomingDelegations') }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Wallet History -->
          <div style="margin-top: 30px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
              <h4 style="color: var(--primary); margin:0; display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-clock-rotate-left"></i> {{ t('recentWalletTransactions') }}
              </h4>
              <div class="gs" style="font-size:10px;">{{ t('last') || 'Last' }} 500</div>
            </div>
            
            <div class="forumline" style="overflow: hidden; border-radius: 4px;">
              <table class="profile-list-table tight-history">
                <thead>
                  <tr style="background: var(--bg-r3);">
                    <td class="thHead" style="text-align:left;padding-left:10px; width:130px">{{ t('date') }}</td>
                    <td class="thHead">{{ t('description') }}</td>
                    <td class="thHead" align="right" style="padding-right:15px">{{ t('amount') }}</td>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="tx in profileUser.wallet.history" :key="tx.seq" class="row-hover history-row">
                    <td class="row1 gs ts-cell">{{ tx.timestamp.replace('T', ' ').slice(0,16) }}</td>
                    <td class="row2 desc-cell">
                      <div class="tx-flex">
                        <div class="tx-icon-v2" :class="'tx-'+tx.op[0]">
                          <i v-if="tx.op[0]==='transfer'" class="fa-solid" :class="tx.op[1].from === profileUser.username ? 'fa-arrow-up' : 'fa-arrow-down'"></i>
                          <i v-else-if="tx.op[0]==='transfer_to_vesting'" class="fa-solid fa-bolt"></i>
                          <i v-else-if="tx.op[0]==='withdraw_vesting'" class="fa-solid fa-circle-minus"></i>
                          <i v-else-if="tx.op[0]==='delegate_vesting_shares'" class="fa-solid fa-share-from-square"></i>
                        </div>
                        <div class="tx-details">
                          <template v-if="tx.op[0] === 'transfer'">
                            <span class="tx-label">{{ tx.op[1].from === profileUser.username ? t('sentTo') : t('receivedFrom') }}</span>
                            <b class="interactive-username" @click="$emit('openProfile', tx.op[1].from === profileUser.username ? tx.op[1].to : tx.op[1].from)">@{{ tx.op[1].from === profileUser.username ? tx.op[1].to : tx.op[1].from }}</b>
                            <div v-if="tx.op[1].memo" class="tx-memo-v2">"{{ tx.op[1].memo }}"</div>
                          </template>
                          <template v-else-if="tx.op[0] === 'transfer_to_vesting'">
                            <span class="tx-label">{{ t('powerUp') }}</span>
                            <span v-if="tx.op[1].to !== tx.op[1].from">to <b>@{{ tx.op[1].to }}</b></span>
                          </template>
                          <template v-else-if="tx.op[0] === 'withdraw_vesting'">
                            <span class="tx-label">{{ tx.op[1].vesting_shares === '0.000000 VESTS' ? t('stopPowerDown') : t('startPowerDown') }}</span>
                          </template>
                          <template v-else-if="tx.op[0] === 'delegate_vesting_shares'">
                             <span class="tx-label">{{ t('delegateTo') }}</span> <b>@{{ tx.op[1].delegatee }}</b>
                          </template>
                        </div>
                      </div>
                    </td>
                    <td class="row1 amt-cell" align="right">
                      <div class="amt-container">
                        <span class="amt-val" :class="tx.op[1].from === profileUser.username ? 'minus' : (tx.op[1].to === profileUser.username ? 'plus' : '')">
                          {{ tx.op[1].from === profileUser.username ? '-' : (tx.op[1].to === profileUser.username ? '+' : '') }}
                          {{ (tx.op[1].amount || tx.op[1].vesting_shares).split(' ')[0] }}
                        </span>
                        <span class="amt-unit">{{ (tx.op[1].amount || tx.op[1].vesting_shares).split(' ')[1] }}</span>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="profileUser.wallet.history.length === 0">
                    <td colspan="3" class="row1 gs" style="text-align:center; padding: 40px; opacity: 0.5;">
                      <i class="fa-solid fa-ghost" style="font-size:24px; display:block; margin-bottom:10px"></i>
                      {{ t('noWalletHistory') }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- EARNINGS TAB -->
      <div v-if="profileTab==='earnings'" class="earnings-tab">
        
        <div class="earnings-header-row">
          <h3 style="margin:0; color: var(--primary);">📊 {{ t('earningsSummary') }}</h3>
          <div style="display:flex; gap:10px; align-items:center;">
             <button class="btn btn-sm btn-accent" :disabled="profileUser.earnings.loading" @click="$emit('fetchEarnings')">
               <i class="fa-solid fa-sync" :class="{ 'fa-spin': profileUser.earnings.loading }"></i> {{ t('loadMoreHistory') }}
             </button>
             <button class="btn btn-sm" @click="showHistoryTable = !showHistoryTable">
               {{ showHistoryTable ? t('hideDetails') : t('showDetails') }}
             </button>
          </div>
        </div>
        <p class="gs" style="margin: 5px 0 20px 0; font-size: 11px;">{{ profileUser.earnings.stats.range }}</p>

        <div class="earnings-visuals">
          <div class="chart-row">
            <!-- Distribution Donut -->
            <div class="chart-container forumline donut-section">
              <h4>{{ t('distribution') }}</h4>
              <div v-if="profileUser.earnings.stats.total !== 0" style="min-height: 200px;">
                <VueApexCharts width="100%" height="220" :options="donutOptions" :series="donutSeries" />
              </div>
              <div v-else class="empty-chart">{{ t('noData') }}</div>
            </div>

            <!-- Stacked Bar Trend -->
            <div class="chart-container forumline trend-section">
              <h4>{{ t('dailyTrend') }}</h4>
              <div v-if="profileUser.earnings.chartData.daily.length" style="min-height: 200px;">
                <VueApexCharts width="100%" height="200" :options="barOptions" :series="barSeries" />
              </div>
              <div v-else class="empty-chart">{{ t('noData') }}</div>
            </div>
          </div>

          <!-- Statistics Cards -->
          <div class="profile-stats earnings-grid">
            <div class="stat-box accent">
              <div class="stat-label">{{ t('totalGenerated') }}</div>
              <div class="stat-val">{{ profileUser.earnings.stats.total.toFixed(2) }} <span class="unit">BLURT</span></div>
            </div>
            <div class="stat-box success">
              <div class="stat-label">{{ t('avgPerDay') }}</div>
              <div class="stat-val">{{ profileUser.earnings.stats.avgPerDay.toFixed(2) }} <span class="unit">B/d</span></div>
            </div>
            <div class="stat-box info">
              <div class="stat-label">{{ t('claimedWallet') }}</div>
              <div class="stat-val" :style="{color: colors.claimed}">{{ profileUser.earnings.stats.claimed.toFixed(2) }} <span class="unit">B</span></div>
            </div>
          </div>
        </div>

        <div v-if="showHistoryTable" style="margin-top: 20px;">
          <table class="forumline profile-list-table">
            <thead>
              <tr>
                <td class="thHead" style="text-align:left;padding-left:10px">{{ t('date') }}</td>
                <td class="thHead">{{ t('source') }}</td>
                <td class="thHead">{{ t('type') }}</td>
                <td class="thHead" align="right">BLURT</td>
                <td class="thHead" align="right">BP</td>
                <td class="thHead" align="right">SUM</td>
              </tr>
            </thead>
            <tbody>
              <tr v-for="op in profileUser.earnings.history" :key="op.seq">
                <td class="row1 gs" style="font-size:10px;">{{ op.timestamp.replace('T', ' ') }}</td>
                <td class="row2 gs" style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ op.permlink }}</td>
                <td class="row1">
                  <span class="badge" :style="{ background: colors[op.type.replace('_reward','').replace('comment_benefactor','benefactor').replace('curation','curation').replace('claim_reward_balance','claimed') as keyof typeof colors] || '#777' }">
                    {{ op.type.replace('_reward', '').replace('_balance', '').replace('comment_benefactor', 'ben') }}
                  </span>
                </td>
                <td class="row2" align="right">{{ op.blurtVal.toFixed(2) }}</td>
                <td class="row1" align="right">{{ op.bpVal.toFixed(2) }}</td>
                <td class="row2" align="right"><strong>{{ op.totalVal.toFixed(2) }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>

      <div v-if="profileTab==='posts'">
        <table class="forumline profile-list-table">
          <thead>
            <tr>
              <td class="thHead" width="40"></td>
              <td class="thHead" style="text-align:left;padding-left:10px">{{ t('topic') }}</td>
              <td class="thHead" width="100" align="center">{{ t('payout') }}</td>
              <td class="thHead" width="180" align="center">{{ t('posted') }}</td>
            </tr>
          </thead>
          <tbody>
            <tr v-for="post in profileUser.posts" :key="post.permlink">
              <td class="row1" align="center">
                <VoteButton :voted="hasVoted(post)" :count="post.vote_count" @vote="$emit('submitVote', post)" />
              </td>
              <td class="row1">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <ForumMedia 
                    v-if="player.state.enabled && post.media"
                    :media="post.media"
                    :title="post.title"
                    :author="post.author"
                    :permlink="post.permlink"
                    :t="t"
                  />
                  <a href="#" @click.stop.prevent="$emit('openTopic', post)" 
                     style="font-size: 12px; font-weight: normal;">{{ post.title }}</a>
                </div>
              </td>
              <td class="row2" align="center">
                <PayoutBadge :post="post" @click="$emit('openPayoutModal', post)" />
              </td>
              <td class="row1" align="center">
                <span class="gs">{{ fmtDate(post.created) }}</span>
              </td>
            </tr>
            <tr v-if="profileUser.posts.length===0"><td colspan="4" class="row1" style="text-align:center; padding: 20px;">{{ t('noPosts') }}</td></tr>
          </tbody>
        </table>
        <div v-if="profileUser.postsHasMore" style="text-align:center; margin-top: 10px;">
          <button class="btn btn-primary" @click="$emit('loadMoreProfileContent', 'posts')" :disabled="profileUser.loading">
            <span v-if="profileUser.loading" class="spin"></span> {{ t('loadMore') }}
          </button>
        </div>
      </div>

      <div v-if="profileTab==='comments'">
        <table class="forumline profile-list-table">
          <thead>
            <tr>
              <td class="thHead" width="40"></td>
              <td class="thHead" style="text-align:left;padding-left:10px">{{ t('replyTo') }}</td>
              <td class="thHead" width="100" align="center">{{ t('payout') }}</td>
              <td class="thHead" width="180" align="center">{{ t('posted') }}</td>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in profileUser.comments" :key="c.permlink">
              <td class="row1" align="center">
                <VoteButton :voted="hasVoted(c)" :count="c.vote_count" @vote="$emit('submitVote', c)" />
              </td>
              <td class="row1 row-hover" @click="$emit('openTopic', c)">
                <span class="gs">RE: @{{ c.parent_author }}</span><br>
                {{ c.body.substring(0, 100) }}...
              </td>
              <td class="row2" align="center">
                <PayoutBadge :post="c" @click="$emit('openPayoutModal', c)" />
              </td>
              <td class="row1" align="center">
                <span class="gs">{{ fmtDate(c.created) }}</span>
              </td>
            </tr>
            <tr v-if="profileUser.comments.length===0"><td colspan="4" class="row1" style="text-align:center; padding: 20px;">{{ t('noComments') }}</td></tr>
          </tbody>
        </table>
        <div v-if="profileUser.commentsHasMore" style="text-align:center; margin-top: 10px;">
          <button class="btn btn-primary" @click="$emit('loadMoreProfileContent', 'comments')" :disabled="profileUser.loading">
            <span v-if="profileUser.loading" class="spin"></span> {{ t('loadMore') }}
          </button>
        </div>
      </div>

      <!-- REPLIES TAB -->
      <div v-if="profileTab==='replies'">
        <table class="forumline profile-list-table">
          <thead>
            <tr>
              <td class="thHead" width="40"></td>
              <td class="thHead" width="90" align="center">{{ t('author') }}</td>
              <td class="thHead">{{ t('topic') }}</td>
              <td class="thHead" width="100" align="center">{{ t('payout') }}</td>
              <td class="thHead" width="180" align="center">{{ t('posted') }}</td>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in profileUser.replies" :key="r.permlink">
              <td class="row1" align="center">
                <VoteButton :voted="hasVoted(r)" :count="r.vote_count" @vote="$emit('submitVote', r)" />
              </td>
              <td class="row1" align="center">
                <UserAvatar :username="r.author" size="xs" @click="$emit('openProfile', r.author)" />
                <a href="#" @click.stop.prevent="$emit('openProfile', r.author)" style="font-size:11px;">@{{ r.author }}</a>
              </td>
              <td class="row1 row-hover" @click="$emit('openTopic', r)">
                <div class="gs" style="font-size:10px; margin-bottom:4px;">RE: {{ r.title || r.parent_permlink }}</div>
                {{ r.body.substring(0, 100) }}...
              </td>
              <td class="row2" align="center">
                <PayoutBadge :post="r" @click="$emit('openPayoutModal', r)" />
              </td>
              <td class="row1" align="center">
                <span class="gs">{{ fmtDate(r.created) }}</span>
              </td>
            </tr>
            <tr v-if="profileUser.replies.length===0"><td colspan="5" class="row1" style="text-align:center; padding: 20px;">{{ t('noComments') }}</td></tr>
          </tbody>
        </table>
        <div v-if="profileUser.repliesHasMore" style="text-align:center; margin-top: 10px;">
          <button class="btn btn-primary" @click="$emit('loadMoreProfileContent', 'replies')" :disabled="profileUser.loading">
            <span v-if="profileUser.loading" class="spin"></span> {{ t('loadMore') }}
          </button>
        </div>
      </div>
    <!-- /profile -->
</template>

<style scoped>
.profile-stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
.stat-box {
  background: var(--bg-r1); padding: 12px; border-radius: 6px;
  border: 1px solid var(--border-main); flex: 1; min-width: 140px;
}
.stat-box.accent { border-left: 4px solid var(--primary); }
.stat-box.success { border-left: 4px solid var(--accent-active, #2ecc71); }
.stat-box.info { border-left: 4px solid var(--accent); }

.stat-label { font-size: 10px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 5px; }
.stat-val { font-size: 18px; font-weight: bold; color: var(--text); }
.unit { font-size: 10px; opacity: 0.6; margin-left: 2px; }

.profile-list-table { width: 100%; margin-top: 10px; border-collapse: collapse; }
.row-hover:hover { background: var(--bg-r2); cursor: pointer; }

.earnings-header-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; }

.earnings-visuals { margin-top: 10px; }
.chart-row { display: flex; gap: 15px; margin-bottom: 20px; }
.chart-container { flex: 1; background: var(--bg-r1); padding: 15px; border-radius: 8px; min-width: 280px; }
.chart-container h4 { margin: 0 0 15px 0; font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }

.empty-chart { height: 100px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 12px; }

.badge { font-size: 9px; padding: 2px 6px; border-radius: 4px; color: #fff; font-weight: bold; }

.wallet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-top: 10px;
}
.wallet-card {
  padding: 15px;
  background: var(--bg-r1);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wallet-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-main);
  padding-bottom: 8px;
}
.wallet-card-desc {
  font-size: 11px;
  line-height: 1.5;
  flex: 1;
}
.highlight-card { border-top: 3px solid var(--primary); }
.highlight-card-bp { border-top: 3px solid var(--accent); }
.total-card { border-top: 3px solid var(--success-border); background: var(--bg-r3); }
.main-amt { color: var(--primary); font-size: 22px; }
.main-amt.highlight { color: var(--success-text); }

.reward-claim-box {
  margin-top: 20px;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  padding: 15px 20px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 15px;
  box-shadow: 0 4px 10px rgba(0,0,0,0.2);
}
.reward-icon { font-size: 24px; }
.btn-light { background: #fff; color: var(--primary); border: none; font-weight: bold; }

.pd-monitor { margin-top: 20px; padding: 15px; background: var(--bg-r2); border-left: 4px solid var(--accent); }
.pd-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.pd-stat .stat-val.small { font-size: 14px; }

.delegations-row { display: flex; gap: 20px; margin-top: 30px; }
.delegation-half { flex: 1; min-width: 300px; }

.tight td { padding: 6px 10px !important; }

.tx-icon {
  width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; flex-shrink: 0;
}
.tx-in { background: rgba(46, 204, 113, 0.15); color: #2ecc71; }
.tx-out { background: rgba(231, 76, 60, 0.15); color: #e74c3c; }
.tx-up { background: rgba(52, 152, 219, 0.15); color: #3498db; }
.tx-down { background: rgba(243, 156, 18, 0.15); color: #f39c12; }
.tx-del { background: rgba(155, 89, 182, 0.15); color: #9b59b6; }

.amt-in { color: #2ecc71; }
.amt-out { color: #e74c3c; }
.tx-memo { font-style: italic; opacity: 0.8; margin-top: 2px; border-left: 2px solid var(--border-main); padding-left: 6px; }

.btn-icon-only { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 5px; transition: color 0.2s; }
.btn-icon-only:hover { color: var(--error-text, #e74c3c); }

.tx-icon-v2 { width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
.tx-transfer { background: var(--bg-r3); color: var(--primary); }
.tx-transfer_to_vesting { background: rgba(52, 152, 219, 0.2); color: #3498db; }
.tx-withdraw_vesting { background: rgba(243, 156, 18, 0.2); color: #f39c12; }
.tx-delegate_vesting_shares { background: rgba(155, 89, 182, 0.2); color: #9b59b6; }

.tx-flex { display: flex; align-items: center; gap: 10px; }
.tx-label { font-size: 10px; text-transform: uppercase; opacity: 0.7; margin-right: 4px; }
.tx-memo-v2 { font-size: 10px; font-style: italic; opacity: 0.6; margin-top: 2px; }

.amt-container { display: flex; flex-direction: column; line-height: 1.1; }
.amt-val { font-weight: 800; font-size: 12px; }
.amt-val.plus { color: #2ecc71; }
.amt-val.minus { color: #e74c3c; }
.amt-unit { font-size: 9px; opacity: 0.5; font-weight: bold; }

.tight-history td { padding: 10px !important; border-bottom: 1px solid var(--bg-r2) !important; }
.history-row:last-child td { border-bottom: none !important; }

@media (max-width: 900px) {
  .chart-row, .delegations-row { flex-direction: column; }
}

@media (max-width: 600px) {
  .profile-list-table, 
  .profile-list-table thead, 
  .profile-list-table tbody, 
  .profile-list-table tr, 
  .profile-list-table td {
    display: block;
    width: 100% !important;
    text-align: left !important;
    box-sizing: border-box;
  }
  .profile-list-table thead { display: none; }
  .profile-list-table tr {
    padding: 12px 10px;
    border-bottom: 1px solid var(--border-main);
  }
  .profile-list-table td {
    padding: 2px 0 !important;
    border: none !important;
    background: transparent !important;
  }
  /* Payout and Date cells on mobile */
  .profile-list-table td:nth-child(2),
  .profile-list-table td:nth-child(3) {
    display: inline-block;
    width: auto !important;
    margin-right: 15px;
    margin-top: 4px;
    font-size: 11px;
    opacity: 0.9;
  }
}
</style>
