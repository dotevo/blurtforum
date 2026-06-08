<script setup lang="ts">
defineProps<{
  show: boolean;
  rpcDataNode: string;
  rpcForumNode: string;
  rpcDataCustom: string;
  rpcForumCustom: string;
  t: (k: string) => string;
}>();

const emit = defineEmits<{
  'close': [];
  'update:rpcDataNode': [value: string];
  'update:rpcForumNode': [value: string];
  'update:rpcDataCustom': [value: string];
  'update:rpcForumCustom': [value: string];
  'applyRpcSettings': [];
}>();
</script>

<template>
  <div v-if="show" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-box">
      <div class="modal-header">
        <span><i class="fa-solid fa-gear"></i> {{ t('rpcSettings') }}</span>
        <button class="modal-close" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        <label style="display:block; font-size:11px; font-weight:bold; margin-bottom:5px;">📡 {{ t('rpcData') }} & Broadcast</label>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:15px;">
          <select :value="rpcDataNode" @change="emit('update:rpcDataNode', ($event.target as HTMLSelectElement).value); emit('applyRpcSettings')"
                  style="width:100%; padding:10px; font-size:12px; border:1px solid var(--border-main); background:var(--bg-r1); color:var(--text); border-radius:4px;">
            <option value="https://blurtrpc.dagobert.uk">blurtrpc.dagobert.uk</option>
            <option value="https://rpc.blurt.blog">rpc.blurt.blog</option>
            <option value="https://rpc.beblurt.com">rpc.beblurt.com</option>
            <option value="https://rpc.drakernoise.com">rpc.drakernoise.com</option>
            <option value="custom">— {{ t('custom') }} —</option>
          </select>
          <input v-if="rpcDataNode==='custom'" type="text" :value="rpcDataCustom" placeholder="https://..."
                 style="width:100%; padding:10px; font-size:12px; border:1px solid var(--border-main); background:var(--bg-r1); color:var(--text); border-radius:4px;"
                 @change="emit('update:rpcDataCustom', ($event.target as HTMLInputElement).value); emit('applyRpcSettings')">
        </div>

        <label style="display:block; font-size:11px; font-weight:bold; margin-bottom:5px;">🗄 {{ t('rpcForum') }} (Nexus)</label>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
          <select :value="rpcForumNode" @change="emit('update:rpcForumNode', ($event.target as HTMLSelectElement).value); emit('applyRpcSettings')"
                  style="width:100%; padding:10px; font-size:12px; border:1px solid var(--border-main); background:var(--bg-r1); color:var(--text); border-radius:4px;">
            <option value="https://blurtrpc.dagobert.uk">blurtrpc.dagobert.uk</option>
            <option value="https://rpc.drakernoise.com">rpc.drakernoise.com</option>
            <option value="https://rpc.beblurt.com">rpc.beblurt.com</option>
            <option value="custom">— {{ t('custom') }} —</option>
          </select>
          <input v-if="rpcForumNode==='custom'" type="text" :value="rpcForumCustom" placeholder="https://..."
                 style="width:100%; padding:10px; font-size:12px; border:1px solid var(--border-main); background:var(--bg-r1); color:var(--text); border-radius:4px;"
                 @change="emit('update:rpcForumCustom', ($event.target as HTMLInputElement).value); emit('applyRpcSettings')">
        </div>

        <div style="font-size:10px; opacity:0.6; margin-top:10px; line-height:1.4;">{{ t('rpcNote') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 11000;
  backdrop-filter: blur(2px);
}

.modal-box {
  background: var(--bg-white);
  border: 1px solid var(--border-main);
  border-radius: 8px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.3);
}

.modal-header {
  padding: 12px 15px;
  border-bottom: 1px solid var(--border-main);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: bold;
}

.modal-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-muted);
}

.modal-body {
  padding: 15px;
}
</style>
