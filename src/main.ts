import { createApp, defineCustomElement } from 'vue';
import App from './App.vue';
import './style.css';
import ForumMedia from './components/player/ForumMedia.ce.vue';
import ForumIframe from './components/player/ForumIframe.ce.vue';

// Register ForumMedia as a native Web Component
const ForumMediaElement = defineCustomElement(ForumMedia);
customElements.define('forum-media', ForumMediaElement);

const ForumIframeElement = defineCustomElement(ForumIframe);
customElements.define('forum-iframe', ForumIframeElement);

createApp(App).mount('#app');
