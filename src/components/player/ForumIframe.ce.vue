<script setup lang="ts">
import { ref, computed } from 'vue';
import { Parser } from '../../modules/parser';

const props = defineProps<{
  dataSrc: string;
  t?: (k: string) => string;
}>();

const isLoaded = ref(false);

const domain = computed(() => {
  try {
    return new URL(props.dataSrc).hostname;
  } catch {
    return props.dataSrc;
  }
});

const detectedMedia = computed(() => {
  return Parser.detectMedia(props.dataSrc);
});

const handleLoad = () => {
  isLoaded.value = true;
};

// Fallback translation function if not provided via props
const _t = (k: string) => (props.t ? props.t(k) : k);
</script>

<template>
  <div class="forum-iframe-container">
    <template v-if="!isLoaded">
      <div class="iframe-placeholder" @click="handleLoad">
        <div class="placeholder-content">
          <div class="icon">🔒</div>
          <div class="info">
            <strong>{{ _t('externalContent') }}</strong>
            <span>{{ _t('source') }}: {{ domain }}</span>
          </div>
          <button class="btn btn-primary">{{ _t('loadContent') }}</button>
        </div>
      </div>
    </template>
    
    <template v-else>
      <div class="iframe-wrapper">
        <!-- If it's a known media source, let forum-media handle it -->
        <forum-media 
          v-if="detectedMedia" 
          :data-type="detectedMedia.type" 
          :data-id="detectedMedia.id" 
          :data-host="detectedMedia.host"
          :data-src="detectedMedia.src"
          :data-cover="detectedMedia.cover"
          mode="card"
        ></forum-media>
        
        <!-- Otherwise, render a standard sandboxed iframe -->
        <iframe 
          v-else
          :src="dataSrc" 
          frameborder="0" 
          allowfullscreen 
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        ></iframe>
      </div>
    </template>
  </div>
</template>

<style scoped>
.forum-iframe-container {
  display: block;
  width: 100%;
  margin: 15px 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-r1, #eee);
  border: 1px solid var(--border-main, #999);
}

.iframe-placeholder {
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s;
}

.iframe-placeholder:hover {
  background: var(--bg-r2, #e5e5e5);
}

.placeholder-content {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.icon {
  font-size: 32px;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info strong {
  font-size: 14px;
  color: var(--text, #333);
}

.info span {
  font-size: 11px;
  color: var(--text-muted, #666);
}

.iframe-wrapper {
  position: relative;
  width: 100%;
}

.iframe-wrapper iframe {
  width: 100%;
  aspect-ratio: 16 / 9;
  display: block;
}

/* Re-inject essential button styles for Shadow DOM */
.btn {
  padding: 6px 14px;
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  border: 1px solid var(--input-border, #999);
  background: var(--input-bg, #fff);
  color: var(--text, #333);
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  transition: all 0.2s;
  margin-top: 5px;
}

.btn-primary {
  background: var(--primary, #006699);
  color: #fff;
  border-color: var(--primary-dk, #005580);
}

.btn-primary:hover {
  background: var(--primary-lt, #0076B1);
}
</style>
