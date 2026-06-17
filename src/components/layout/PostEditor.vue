<script setup lang="ts">
import { reactive, onMounted, computed, watch } from 'vue';
import type { Post, AuthUser, Forum } from '../../types';

const props = defineProps<{
  mode: 'post' | 'reply' | 'edit';
  parent?: Post | Forum | { author: string; permlink: string; title?: string; category?: string; targetTags?: string[] };
  auth: { user: AuthUser | null };
  t: (k: string) => string;
  renderMD: (s: string) => string;
  loading: boolean;
  error?: string;
  success?: string;
  initialTitle?: string;
  initialBody?: string;
  imgUpload?: boolean;
  feeEstimate?: string | null;
  config?: { communityAccount: string };
  draftKey?: string;
  hideCancel?: boolean;
  hideBeneficiary?: boolean;
}>();

// ... (emits remains same) ...

const emit = defineEmits<{
  submit: [data: { title: string; body: string; beneficiary: { account: string; weight: string }; devTip: boolean; selectedTag: string; customTags: string }];
  cancel: [];
  imagePick: [event: Event];
  paste: [event: ClipboardEvent];
  scheduleFeeUpdate: [content: string];
  saveDraft: [data: { title: string; body: string; selectedTag: string; customTags: string }];
  clearDraft: [];
}>();

const form = reactive({
  title: props.initialTitle || '',
  body: props.initialBody || '',
  devTip: localStorage.getItem('blurtforum_devtip') !== 'false',
  beneficiary: { account: '', weight: '' },
  selectedTag: '',
  customTags: '',
  preview: false
});

// Sync form with initial props when they change (important for edit mode)
watch(() => props.initialTitle, (v) => { form.title = v || ''; });
watch(() => props.initialBody, (v) => { form.body = v || ''; });

// ... (targetTags remains same) ...

// For mode === 'post', we might have targetTags in the parent (which would be the forum)
const targetTags = computed(() => {
  if (props.mode === 'post' && props.parent && 'targetTags' in props.parent) {
    return props.parent.targetTags || [];
  }
  return [];
});

onMounted(() => {
  if (props.mode === 'post' && targetTags.value.length > 0) {
    form.selectedTag = targetTags.value[0];
  }
});

const handleInput = () => {
  emit('saveDraft', { title: form.title, body: form.body, selectedTag: form.selectedTag, customTags: form.customTags });
  emit('scheduleFeeUpdate', (form.title || '') + form.body);
};

const handleSubmit = () => {
  emit('submit', { ...form });
};

const handleCancel = () => {
  emit('cancel');
};

const finalTags = computed(() => {
  if (props.mode !== 'post' || !props.config) return [];
  const list = [props.config.communityAccount, form.selectedTag];
  const custom = form.customTags.split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean);
  list.push(...custom);
  return list.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
});
</script>

<template>
  <div class="write-form" :class="[`write-form--${mode}`, { 'no-border': mode === 'reply' || mode === 'edit' }]">
    <div v-if="mode === 'post'" class="editor-header">
      {{ t('newPost') }}
    </div>
    <div v-else-if="mode === 'edit'" class="editor-header">
      {{ initialTitle ? t('editPost') : t('editComment') }}
    </div>
    <div v-else-if="parent && (parent as any).title" class="editor-header-reply">
      {{ t('replyTo') }}: <i>{{ (parent as any).title }}</i>
    </div>
    <div v-else-if="parent && (parent as any).author" class="editor-header-reply">
      {{ t('replyTo') }}: <b>@{{ (parent as any).author }}</b>
    </div>
    <div v-else class="editor-header-reply">
      <i class="fa-solid fa-reply"></i> {{ t('quickReply') }}
    </div>

    <!-- Title input for POST or EDIT mode (if post) -->
    <div v-if="mode === 'post' || (mode === 'edit' && initialTitle)" style="margin-bottom:10px">
      <label class="form-label">{{ t('postTitle') }}</label>
      <input type="text" v-model="form.title" :placeholder="t('postTitle')" @input="handleInput">
    </div>

    <div style="margin-bottom:10px">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <label class="form-label" style="margin:0">{{ (mode === 'post' || mode === 'edit') ? t('postBody'): '' }}</label>
        <div style="display:flex; gap:6px; align-items:center;">
          <!-- Image upload button -->
          <label v-if="auth.user" class="btn btn-sm btn-ghost" style="cursor:pointer; margin:0; padding:3px 8px;" :style="{opacity: imgUpload ? 0.5 : 1}">
            <span v-if="imgUpload" class="spin"></span><span v-else>📎</span> {{ (mode === 'post' || mode === 'edit') ? t('addImage') : '' }}
            <input type="file" accept="image/*" style="display:none" @change="emit('imagePick', $event)">
          </label>
          <!-- Write / Preview toggle -->
          <button class="btn btn-sm" :class="form.preview ? 'btn-ghost' : 'btn-primary'" @click="form.preview = false">{{ t('write') }}</button>
          <button class="btn btn-sm" :class="form.preview ? 'btn-primary' : 'btn-ghost'" @click="form.preview = true">{{ t('preview') }}</button>
        </div>
      </div>
      
      <textarea v-if="!form.preview" v-model="form.body" :placeholder="mode === 'post' ? t('writePost') : t('writeReply')" @input="handleInput" @paste="emit('paste', $event)" :style="{ minHeight: mode === 'post' || mode === 'edit' ? '250px' : '120px' }"></textarea>
      <div v-else class="post-body" :style="{ minHeight: mode === 'post' || mode === 'edit' ? '250px' : '120px' }" style="border:1px solid var(--input-border); border-radius:4px; padding:10px; background:var(--input-bg); overflow-y: auto;" v-html="form.body ? renderMD(form.body) : '<span style=&quot;opacity:0.4&quot;>...</span>'"></div>
    </div>

    <!-- TAG SELECTOR (POST only) -->
    <div v-if="mode === 'post'" style="margin-bottom:10px; padding:10px; border:1px dashed var(--border-main); border-radius:4px;">
      <div class="gs" style="font-weight:bold; margin-bottom:8px;">🏷️ {{ t('tags') }}</div>
      <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; margin-bottom:6px;">
        <div v-if="targetTags.length > 0">
          <label class="gs" style="display:block; font-size:11px; margin-bottom:3px;">{{ t('category') }}</label>
          <select v-model="form.selectedTag" @change="handleInput"
                  style="padding:5px 8px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text); font-size:12px; border-radius:3px;">
            <option v-for="tag in targetTags" :key="tag" :value="tag">#{{ tag }}</option>
          </select>
        </div>
        <div style="flex:1; min-width:150px;">
          <label class="gs" style="display:block; font-size:11px; margin-bottom:3px;">{{ t('customTags') }}</label>
          <input type="text" v-model="form.customTags" placeholder="np. fotografia, plener" @input="handleInput"
                 style="width:100%; padding:5px 8px; border:1px solid var(--input-border); background:var(--input-bg); color:var(--text); font-size:12px; border-radius:3px; box-sizing:border-box;">
        </div>
      </div>
      <div class="gs" style="font-size:11px;">
        {{ t('sentTags') }}:
        <template v-for="tag in finalTags" :key="tag">
          <span style="display:inline-block; background:var(--primary); color:#fff; border-radius:3px; padding:1px 6px; margin:2px 2px 0 0; font-size:10px;">#{{ tag }}</span>
        </template>
        <span style="opacity:0.5">{{ t('max5') }}</span>
      </div>
    </div>

    <!-- Common settings -->
    <div v-if="!hideBeneficiary" style="margin-top:15px; display: flex; flex-direction: column; gap: 10px;">
      <label class="gs" style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;">
        <input type="checkbox" v-model="form.devTip"> {{ t('devTip') }}
      </label>
      
      <div style="padding: 12px; border: 1px dashed var(--border-main); border-radius: 4px; background: var(--bg-r1);">
        <div class="gs" style="font-weight:bold; margin-bottom:10px; font-size: 12px;">👥 {{ t('addBeneficiary') }}</div>
        <div class="ben-form-row">
          <input type="text" v-model="form.beneficiary.account" :placeholder="t('beneficiaryAccount')" class="ben-input-account">
          <input type="number" v-model="form.beneficiary.weight" min="1" max="100" :placeholder="'%'" class="ben-input-pct">
          <span class="gs ben-pct-label">%</span>
        </div>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" style="margin-top:10px">{{ error }}</div>
    <div v-if="success" class="alert alert-success" style="margin-top:10px">{{ success }}</div>

    <div style="margin-top:15px; display:flex; gap:10px; align-items:center;">
      <button class="btn btn-primary" @click="handleSubmit" :disabled="loading" style="padding: 8px 24px; font-weight: bold;">
        <span v-if="loading" class="spin"></span><i v-else class="fa-solid fa-paper-plane"></i> {{ mode === 'edit' ? t('update') : (mode === 'post' ? t('submit') : t('send')) }}
      </button>
      <button v-if="!hideCancel" class="btn btn-ghost" @click="handleCancel"><i class="fa-solid fa-xmark"></i> {{ t('cancel') }}</button>
      
      <span v-if="feeEstimate && mode !== 'edit'" style="font-size:11px; color:var(--text-muted); margin-left:4px;">
        💸 ~{{ feeEstimate }} BLURT
      </span>
    </div>
  </div>
</template>

<style scoped>
.editor-header {
  font-weight:bold;
  color:var(--primary);
  margin-bottom:10px;
  border-bottom:1px solid var(--border-main);
  padding-bottom:10px;
  font-size:14px;
}
.editor-header-reply {
  font-weight:bold;
  color:var(--primary);
  margin-bottom:10px;
  font-size:12px;
  text-transform: uppercase;
}
.no-border { border: none !important; margin: 0 !important; }
</style>
