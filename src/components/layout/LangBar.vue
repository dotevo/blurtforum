<script setup lang="ts">
defineProps<{
  theme: string;
  themes: { id: string; label: string }[];
  lang: string;
  langs: string[];
  rpcMenuOpen: boolean;
  rpcDataNode: string;
  rpcForumNode: string;
  rpcDataCustom: string;
  rpcForumCustom: string;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  'update:theme': [value: string];
  'update:lang': [value: string];
  'update:rpcMenuOpen': [value: boolean];
  'update:rpcDataNode': [value: string];
  'update:rpcForumNode': [value: string];
  'update:rpcDataCustom': [value: string];
  'update:rpcForumCustom': [value: string];
  'setTheme': [value: string];
  'setLang': [value: string];
  'applyRpcSettings': [];
}>();
</script>

<template>
<!-- LANGUAGE BAR -->
<div class="lang-bar">
  <div style="margin-right: auto; display: flex; gap: 10px; align-items: center;">
    <div style="display: flex; gap: 5px; align-items: center;">
      <span class="gs">{{ t('theme') }}:</span>
      <select :value="theme" @change="emit('setTheme', ($event.target as HTMLSelectElement).value)" class="lang-btn" style="padding: 1px 4px; font-size: 9px; cursor: pointer;">
        <option v-for="th in themes" :key="th.id" :value="th.id">{{ th.label }}</option>
      </select>
    </div>
    <div style="display: flex; gap: 5px; align-items: center;">
      <span class="gs">{{ t('lang') }}:</span>
      <select :value="lang" @change="emit('setLang', ($event.target as HTMLSelectElement).value)" class="lang-btn" style="padding: 1px 4px; font-size: 9px; cursor: pointer;">
        <option v-for="l in langs" :key="l" :value="l">{{ l.toUpperCase() }}</option>
      </select>
    </div>
  </div>

  <!-- RPC SETTINGS TRIGGER -->
  <div style="margin-right:6px;">
    <button class="lang-btn" @click="emit('update:rpcMenuOpen', true)" title="RPC settings"><i class="fa-solid fa-gear"></i> RPC</button>
  </div>

  <!-- RPC SETTINGS MODAL -->
  <div v-if="rpcMenuOpen" class="modal-overlay" @click.self="emit('update:rpcMenuOpen', false)">
    <div class="modal-box">
      <div class="modal-header">
        <span>{{ t('rpcSettings') }}</span>
        <button class="modal-close" @click="emit('update:rpcMenuOpen', false)">×</button>
      </div>
      <div class="modal-body">
        <label style="display:block; font-size:11px; font-weight:bold; margin-bottom:5px;">📡 {{ t('rpcData') }} & Broadcast</label>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:15px;">
          <select :value="rpcDataNode" @change="emit('update:rpcDataNode', ($event.target as HTMLSelectElement).value); emit('applyRpcSettings')"
                  style="width:100%; padding:6px; font-size:12px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text); border-radius:4px;">
            <option value="https://blurtrpc.dagobert.uk">blurtrpc.dagobert.uk</option>
            <option value="https://rpc.blurt.blog">rpc.blurt.blog</option>
            <option value="https://rpc.beblurt.com">rpc.beblurt.com</option>
            <option value="https://rpc.drakernoise.com">rpc.drakernoise.com</option>
            <option value="custom">— {{ t('custom') }} —</option>
          </select>
          <input v-if="rpcDataNode==='custom'" type="text" :value="rpcDataCustom" placeholder="https://..."
                 style="width:100%; padding:6px; font-size:12px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text); border-radius:4px;"
                 @change="emit('update:rpcDataCustom', ($event.target as HTMLInputElement).value); emit('applyRpcSettings')">
        </div>

        <label style="display:block; font-size:11px; font-weight:bold; margin-bottom:5px;">🗄 {{ t('rpcForum') }} (Nexus)</label>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
          <select :value="rpcForumNode" @change="emit('update:rpcForumNode', ($event.target as HTMLSelectElement).value); emit('applyRpcSettings')"
                  style="width:100%; padding:6px; font-size:12px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text); border-radius:4px;">
            <option value="https://blurtrpc.dagobert.uk">blurtrpc.dagobert.uk</option>
            <option value="https://rpc.drakernoise.com">rpc.drakernoise.com</option>
            <option value="https://rpc.beblurt.com">rpc.beblurt.com</option>
            <option value="custom">— {{ t('custom') }} —</option>
          </select>
          <input v-if="rpcForumNode==='custom'" type="text" :value="rpcForumCustom" placeholder="https://..."
                 style="width:100%; padding:6px; font-size:12px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text); border-radius:4px;"
                 @change="emit('update:rpcForumCustom', ($event.target as HTMLInputElement).value); emit('applyRpcSettings')">
        </div>

        <div style="font-size:10px; opacity:0.6; margin-top:10px; line-height:1.4;">{{ t('rpcNote') }}</div>
      </div>
    </div>
  </div>
</div>
</template>
