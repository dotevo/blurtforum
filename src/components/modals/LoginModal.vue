<script setup lang="ts">
defineProps<{
  loginTab: string;
  loginForm: { username: string; key: string; remember: boolean };
  loginErr: string;
  loginBusy: boolean;
  wvAvailable: boolean;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  doKeyLogin: [];
  doWVLogin: [];
  'update:loginTab': [value: string];
}>();
</script>

<template>
<!-- LOGIN MODAL -->
<div class="modal-overlay" @click.self="emit('close')">
  <div class="modal-box">
    <div class="modal-header">
      {{ t('login') }}
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>
    <div class="modal-body">
      <div v-if="loginErr" class="alert alert-error">{{ loginErr }}</div>
 
      <div class="tabs">
        <button class="tab-btn" :class="{active:loginTab==='key'}" @click="emit('update:loginTab', 'key')">{{ t('privateKey') }}</button>
        <button class="tab-btn" :class="{active:loginTab==='wv'}" @click="emit('update:loginTab', 'wv')">WhaleVault</button>
      </div>
 
      <template v-if="loginTab==='key'">
        <div style="margin-bottom:15px">
          <label class="form-label">{{ t('username') }}</label>
          <input type="text" v-model="loginForm.username" :placeholder="t('username')" @keyup.enter="emit('doKeyLogin')"
                 style="width:100%;padding:8px;border:1px solid #999;font-family:var(--sans);font-size:12px">
        </div>
        <div style="margin-bottom:15px">
          <label class="form-label">{{ t('postingKey') }}</label>
          <input type="password" v-model="loginForm.key" :placeholder="t('postingKey')" @keyup.enter="emit('doKeyLogin')"
                 style="width:100%;padding:8px;border:1px solid #999;font-family:var(--sans);font-size:12px">
        </div>
        <div style="margin-bottom:15px">
          <label class="gs" style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
            <input type="checkbox" v-model="loginForm.remember"> {{ t('rememberMe') }}
          </label>
          <div v-if="loginForm.remember" class="gs" style="color: #DD6900; margin-top: 5px;">{{ t('storageWarning') }}</div>
        </div>
        <button class="btn btn-primary" style="width:100%; padding: 10px;" @click="emit('doKeyLogin')" :disabled="loginBusy">
          <span v-if="loginBusy" class="spin"></span><i v-else class="fa-solid fa-key"></i> {{ t('login') }}
        </button>
      </template>
 
      <template v-else>
        <div v-if="!wvAvailable" class="alert alert-error" style="margin-bottom:15px">{{ t('wvNotInstalled') }}</div>
        <div v-if="wvAvailable" style="margin-bottom:15px">
          <label class="form-label">{{ t('username') }}</label>
          <input type="text" v-model="loginForm.username" :placeholder="t('username')"
                 style="width:100%;padding:8px;border:1px solid #999;font-family:var(--sans);font-size:12px">
        </div>
        <button class="wv-btn" @click="emit('doWVLogin')" :disabled="!wvAvailable||loginBusy">
          <span v-if="!loginBusy">🐋</span> <span v-if="loginBusy" class="spin"></span>{{ t('loginWV') }}
        </button>
        <div class="gs" style="margin-top:15px;text-align:center; font-weight: bold;">{{ t('wvDesc') }}</div>
      </template>
    </div>
  </div>
</div>
</template>
