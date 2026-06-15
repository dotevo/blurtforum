<script setup lang="ts">
import type { Notification } from '../../types';

defineProps<{
  notifModal: {
    show: boolean; loading: boolean;
    list: Notification[]; lastReadIds: Record<string, number>;
    clickedIds: (number | string)[];
    pushSupported: boolean;
    pushEnabled: boolean;
  };
  auth: { user: any };
  t: (k: string) => string;
  timeAgo: (s: string) => string;
  getNotifIcon: (type: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  openNotification: [notif: Notification];
  openProfile: [username: string];
  togglePushNotifications: [];
}>();
</script>

<template>
<!-- NOTIFICATIONS MODAL -->
<div v-if="notifModal.show" class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box" style="width: 500px;">
    <div class="modal-header">
      {{ t('notifications') }}
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body" style="padding: 0;">
      <!-- Local notification toggle -->
      <div v-if="notifModal.pushSupported" class="notif-settings-row">
        <span>{{ t('browserNotifications') }}</span>
        <label class="switch">
          <input type="checkbox" :checked="notifModal.pushEnabled" @change="emit('togglePushNotifications')">
          <span class="slider-toggle"></span>
        </label>
      </div>

      <div v-if="notifModal.loading" class="loader"><span class="spin"></span>{{ t('loading') }}</div>
      <div v-else>
        <div v-for="n in notifModal.list" :key="n.id" class="notif-item row-hover" 
             @click="emit('openNotification', n)"
             :style="{ 
                padding: '10px 15px', 
                borderBottom: '1px solid var(--border-main)',
                background: (typeof n.id === 'number' && n.id > (notifModal.lastReadIds[n.account!] || 0)) ? 'var(--bg-r3)' : (notifModal.clickedIds.includes(`${n.account}-${n.id}`) ? 'transparent' : 'var(--bg-r2)'),
                fontWeight: notifModal.clickedIds.includes(`${n.account}-${n.id}`) ? 'normal' : 'bold',
                opacity: notifModal.clickedIds.includes(`${n.account}-${n.id}`) ? 0.7 : 1
             }">
          <div style="display:flex; gap:10px; align-items:center;">
             <span style="font-size: 18px;">{{ getNotifIcon(n.type) }}</span>
             <div style="flex:1">
               <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                 <template v-if="n.msg"> {{ n.msg }}</template>
                 <template v-else>
                   <b v-if="n.author" @click.stop="emit('openProfile', n.author); emit('close')">@{{ n.author }}</b> 
                   <span v-if="n.type==='reply'"> {{ t('repliedToYou') }}</span>
                   <span v-else-if="n.type==='mention'"> {{ t('mentionedYou') }}</span>
                   <span v-else-if="n.type==='vote'"> {{ t('votedYourPost') }}</span>
                   <span v-else> {{ n.type }}</span>
                 </template>
                 <span v-if="n.account && auth.user?.username !== n.account" 
                       style="font-size:10px; background:var(--bg-r1); padding:1px 4px; border-radius:3px; color:var(--text-muted); border:1px solid var(--border-main);">
                   → @{{ n.account }}
                 </span>
               </div>
               <div class="gs" style="margin-top:2px;">{{ timeAgo(n.date) }}</div>
             </div>
             <span v-if="typeof n.id === 'number' && n.id > (notifModal.lastReadIds[n.account!] || 0)" style="width:8px; height:8px; background:#ff4400; border-radius:50%; flex-shrink:0;"></span>
          </div>
        </div>
        <div v-if="notifModal.list.length===0" style="padding: 20px; text-align: center; color:var(--text-muted);">{{ t('noNotifications') }}</div>
      </div>
    </div>
  </div>
</div>
</template>

<style scoped>
.notif-settings-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 15px;
  border-bottom: 1px solid var(--border-main);
  background: var(--bg-r1);
  font-size: 13px;
}

/* TOGGLE SWITCH */
.switch {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 20px;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider-toggle {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--bg-r3);
  transition: .4s;
  border-radius: 20px;
  border: 1px solid var(--border-main);
}
.slider-toggle:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 2px;
  bottom: 2px;
  background-color: var(--text-muted);
  transition: .4s;
  border-radius: 50%;
}
input:checked + .slider-toggle {
  background-color: var(--primary);
  border-color: var(--primary);
}
input:checked + .slider-toggle:before {
  transform: translateX(14px);
  background-color: white;
}
</style>
