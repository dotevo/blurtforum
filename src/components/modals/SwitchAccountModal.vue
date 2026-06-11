<script setup lang="ts">
import type { AuthUser } from '../../types';
import UserAvatar from '../layout/UserAvatar.vue';

defineProps<{
  auth: { user: AuthUser | null, accounts: AuthUser[] };
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  switchAccount: [username: string];
  removeAccount: [username: string];
  openLoginModal: [];
}>();
</script>

<template>
<div class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box">
    <div class="modal-header">
      {{ t('switchAccount') }}
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body">
      <div class="accounts-list">
        <div v-for="acc in auth.accounts" :key="acc.username" class="account-item" :class="{ active: auth.user?.username === acc.username }">
          <UserAvatar :username="acc.username" size="xs" round style="flex-shrink: 0; cursor: pointer;" @click="emit('switchAccount', acc.username)" />
          <div class="acc-details" @click="emit('switchAccount', acc.username)">
            <div class="acc-name">@{{ acc.username }}</div>
            <div class="acc-method">
              <i v-if="acc.type === 'key'" class="fa-solid fa-key" title="Posting Key"></i>
              <span v-else title="WhaleVault">🐋</span>
              {{ acc.type === 'key' ? t('privateKey') : 'WhaleVault' }}
            </div>
          </div>
          <div class="acc-actions">
            <button v-if="auth.user?.username !== acc.username" class="btn btn-sm btn-hdr" @click="emit('switchAccount', acc.username)" :title="t('switchAccount')">
              <i class="fa-solid fa-right-left"></i>
            </button>
            <button class="btn btn-sm btn-danger" @click="emit('removeAccount', acc.username)" :title="t('remove')">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%; margin-top:15px;" @click="emit('openLoginModal')">
        <i class="fa-solid fa-user-plus"></i> {{ t('login') }}
      </button>
    </div>
  </div>
</div>
</template>

<style scoped>
.accounts-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.account-item {
  display: grid;
  grid-template-columns: 32px 1fr 75px;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-main);
  border-radius: 4px;
  background: var(--bg-r1);
}
.account-item.active {
  border-color: var(--primary);
  background: var(--bg-white);
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}
.acc-info {
  display: contents; /* allows children to participate in parent grid */
  cursor: pointer;
}
.acc-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
  cursor: pointer;
}
.acc-name {
  font-weight: bold;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}
.acc-method {
  font-size: 10px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 1px;
}
.acc-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
.btn-hdr {
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
}
.btn-hdr:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.btn-danger {
  background: #fff5f5;
  color: #c53030;
  border: 1px solid #feb2b2;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
}
.btn-danger:hover {
  background: #c53030;
  color: #fff;
  border-color: #c53030;
}
</style>
