<script setup lang="ts">
import type { Post } from '../../types';
import type { AuthUser } from '../../types';
import { ref, computed } from 'vue';
import VueApexCharts from "vue3-apexcharts";

const props = defineProps<{
  profileUser: {
    username: string;
    data: Record<string, unknown> | null;
    posts: Post[];
    comments: Post[];
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
}>();

const emit = defineEmits<{
  openProfile: [username: string];
  openTopic: [post: Post];
  openPayoutModal: [post: Post];
  toggleFollow: [username: string];
  handleMediaAction: [type: string, id: string, host: string, action: string, data: Record<string, unknown>];
  'update:profileTab': [value: string];
  fetchEarnings: [];
}>();

const showHistoryTable = ref(false);

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
          <div class="avatar" :style="{width: '120px', height: '120px', backgroundImage:'url(https://imgp.blurt.blog/profileimage/'+profileUser.username+'/128x128)'}"></div>
          <div style="flex: 1; min-width: 250px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <div>
                <h2 style="color: var(--primary); margin: 0 0 5px;">{{ profileUser.data ? (profileUser.data as any).displayName : '@' + profileUser.username }}</h2>
                <div class="gs" style="margin-bottom: 10px; font-weight: bold;">@{{ profileUser.username }}</div>
              </div>
              <button v-if="auth.user && auth.user.username !== profileUser.username"
                      class="btn btn-follow" :class="followingSet.has(profileUser.username) ? 'btn-ghost' : 'btn-accent'"
                      @click="emit('toggleFollow', profileUser.username)">
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
        <button class="tab-btn" :class="{active: profileTab==='posts'}" @click="emit('update:profileTab', 'posts')">{{ t('posts') }}</button>
        <button class="tab-btn" :class="{active: profileTab==='comments'}" @click="emit('update:profileTab', 'comments')">{{ t('comments') }}</button>
        <button class="tab-btn" :class="{active: profileTab==='earnings'}" @click="emit('update:profileTab', 'earnings')">💰 {{ t('earnings') }}</button>
      </div>

      <!-- EARNINGS TAB -->
      <div v-if="profileTab==='earnings'" class="earnings-tab">
        
        <div class="earnings-header-row">
          <h3 style="margin:0; color: var(--primary);">📊 {{ t('earningsSummary') }}</h3>
          <div style="display:flex; gap:10px; align-items:center;">
             <button class="btn btn-sm btn-accent" :disabled="profileUser.earnings.loading" @click="emit('fetchEarnings')">
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

      <!-- POSTS TAB -->
      <table class="forumline profile-list-table" v-if="profileTab==='posts'">
        <thead>
          <tr>
            <td class="thHead" style="text-align:left;padding-left:10px">{{ t('topic') }}</td>
            <td class="thHead" width="100" align="center">{{ t('payout') }}</td>
            <td class="thHead" width="180" align="center">{{ t('posted') }}</td>
          </tr>
        </thead>
        <tbody>
          <tr v-for="post in profileUser.posts" :key="post.permlink">
            <td class="row1">
              <div style="display: flex; align-items: center; gap: 8px;">
                <template v-if="player.state.enabled && post.media">
                  <span class="media-icon" @click.stop="emit('handleMediaAction', post.media.type, post.media.id, post.media.host ?? '', 'play', {title: post.title, author: post.author, permlink: post.permlink, src: post.media.src, cover: post.media.cover})" :title="t('playNow') || 'Play Now'">
                    <i :class="post.media.type === 'audio' ? 'fa-solid fa-music' : 'fa-solid fa-circle-play'"></i>
                  </span>
                  <span class="media-icon" @click.stop="emit('handleMediaAction', post.media.type, post.media.id, post.media.host ?? '', 'queue', {title: post.title, author: post.author, permlink: post.permlink, src: post.media.src, cover: post.media.cover})" :title="t('addToQueue') || 'Add to Queue'">
                    <i class="fa-solid fa-plus"></i>
                  </span>
                </template>
                <a href="#" @click.stop.prevent="emit('openTopic', post)" 
                   style="font-size: 12px; font-weight: normal;">{{ post.title }}</a>
              </div>
            </td>
            <td class="row2" align="center">
              <span class="badge" :class="(post.totalPayout || 0)>0?'badge-green':'badge-blue'">{{ (post.payout || 0).toFixed(2) }} B</span>
            </td>
            <td class="row1" align="center">
              <span class="gs">{{ fmtDate(post.created) }}</span>
            </td>
          </tr>
          <tr v-if="profileUser.posts.length===0"><td colspan="3" class="row1" style="text-align:center; padding: 20px;">{{ t('noPosts') }}</td></tr>
        </tbody>
      </table>

      <!-- COMMENTS TAB -->
      <table class="forumline profile-list-table" v-if="profileTab==='comments'">
        <thead>
          <tr>
            <td class="thHead" style="text-align:left;padding-left:10px">{{ t('replyTo') }}</td>
            <td class="thHead" width="100" align="center">{{ t('payout') }}</td>
            <td class="thHead" width="180" align="center">{{ t('posted') }}</td>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in profileUser.comments" :key="c.permlink" 
              class="row-hover" @click="emit('openTopic', c)">
            <td class="row1">
              <span class="gs">RE: @{{ c.parent_author }}</span><br>
              {{ c.body.substring(0, 100) }}...
            </td>
            <td class="row2" align="center">
              <span class="badge" :class="(c.totalPayout || 0)>0?'badge-green':'badge-blue'">{{ (c.payout || 0).toFixed(2) }} B</span>
            </td>
            <td class="row1" align="center">
              <span class="gs">{{ fmtDate(c.created) }}</span>
            </td>
          </tr>
          <tr v-if="profileUser.comments.length===0"><td colspan="3" class="row1" style="text-align:center; padding: 20px;">{{ t('noComments') }}</td></tr>
        </tbody>
      </table>
    <!-- /profile -->
</template>

<style scoped>
.profile-stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
.stat-box {
  background: var(--bg-r1); padding: 12px; border-radius: 6px;
  border: 1px solid var(--border-main); flex: 1; min-width: 140px;
}
.stat-box.accent { border-left: 4px solid var(--primary); }
.stat-box.success { border-left: 4px solid #2ecc71; }
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

@media (max-width: 900px) {
  .chart-row { flex-direction: column; }
}
</style>
