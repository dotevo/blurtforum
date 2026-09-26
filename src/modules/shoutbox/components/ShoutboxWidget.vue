<script setup lang="ts">
/**
 * modules/shoutbox/components/ShoutboxWidget.vue
 *
 * Self-contained floating dock — fixed to the bottom-LEFT corner of the
 * viewport, deliberately opposite the media player's minimized pill
 * (bottom-right, see modules/player/components/MediaPlayer.vue's
 * `.bfp-bar--minimized`).
 *
 * Its vertical position TRACKS the player's current height (bar / expanded
 * panel / minimized / hidden), imported directly from the player's own
 * reactive singleton (`modules/player/player.ts`'s `state`) — the same
 * object MediaPlayer.vue itself reads. This is the one deliberate
 * exception to this module's "fully independent, safe to delete" claim
 * (see README.md): a small, read-only, one-directional dependency on the
 * player so the dock always sits a bit above whatever the player is
 * currently showing, rather than being covered by it.
 *
 * z-index sits above the player's expanded bar/panel (999-1000) so the
 * two never fight over stacking, but below `.modal-overlay` (10000) so
 * modals still cover it.
 *
 * Collapses to a small pill (same interaction pattern as the forum's own
 * "exploration" panel toggle — a persisted boolean, nothing fancier) so
 * it doesn't sit open over content uninvited. State persists across
 * reloads in localStorage, independent of everything else in this module.
 *
 * Renders on mobile too, unlike an earlier draft of this component that
 * borrowed GlobalActivity's `hide-mobile` class — that class exists
 * because GlobalActivity's *content* moves into MobileTopBar on small
 * screens, not because floating widgets in general shouldn't render on
 * mobile. This one has nowhere else to move to, so it just stays put as
 * a small corner dock, same as desktop, sized down slightly.
 *
 * `communityId` is optional and expected to be the current community's
 * account name (e.g. 'blurt-179874') when the user is browsing inside a
 * community, or omitted/null on global/virtual-forum views. The Global tab
 * is always available regardless.
 *
 * `currentPost` / `openPostRef` together power TWO features:
 *   1. Smart post links in chat (unchanged from the previous version).
 *   2. The "Online" tab shows what post each peer currently has open
 *      (broadcast via Shoutbox.setViewingPost(), see the watcher below) —
 *      deliberately ONLY the post, never anything about the media player.
 *      That was a specific, explicit design choice: someone might be fine
 *      with "I'm reading this post" being visible but not "I'm listening
 *      to this track", so the two are kept as clearly separate concerns
 *      rather than one being folded into the other.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Shoutbox } from '../shoutbox';
import type { ShoutboxScope } from '../types';
import type { AuthUser } from '../../../types';
import { EMOJI_LIST } from '../emoji';
import { parseMessageSegments } from '../render';
import { useFloatingLayer } from '../../floating-stack';

const props = defineProps<{
  auth: { user: AuthUser | null };
  getClient: () => unknown;
  /** Same checkLock() convention used across the app (useApp.ts) — shows
   * the PIN modal and retries automatically if a local key is locked.
   * Required: sending is disabled without it having a real implementation. */
  checkLock: (fn: () => any) => boolean;
  communityId?: string | null;
  /** The post currently open in the host app, if any — powers the 🔗
   * "share current post" button AND the "Online" tab's "reading: …" line
   * (see Shoutbox.setViewingPost()). `title` is optional and only used
   * for display in the Online tab; author/permlink are what actually
   * gets shared/linked. */
  currentPost?: { author: string; permlink: string; title?: string } | null;
  /** Navigates the host app to a post referenced in chat or in the Online
   * tab. Omit to render post references as plain (non-clickable) text. */
  openPostRef?: (author: string, permlink: string) => void;
}>();

const activeTab = defineModel<'global' | 'community' | 'online'>('activeTab', { default: 'global' });
const draft = defineModel<string>('draft', { default: '' });

const EXPANDED_STORAGE_KEY = 'bf_shoutbox_expanded';
const expanded = ref(localStorage.getItem(EXPANDED_STORAGE_KEY) === '1');

// ─── Unread badge: per-scope "read up to this timestamp" marker, persisted
// across reloads — NOT a simple "did the message count grow" delta.
//
// The bug this replaces: the old version was a bare `ref(0)` incremented
// whenever `messages.value.length` grew while collapsed. That watcher
// can't tell "a message that's genuinely new since you last looked" apart
// from "the local history cache (up to 200 msgs/scope, see store.ts) just
// finished loading from localStorage/peers" — both look identical to it
// (length going from 0 to N). Every single page load re-hydrates that
// full local history, so the badge always showed the *entire* cached
// backlog as unread, every time, regardless of what you'd actually seen
// before.
//
// Fixed by tracking, per scope, the timestamp of the newest message you'd
// already been shown, persisted in localStorage so it survives reloads.
// Unread = messages newer than that marker. A scope's marker is seeded
// (once, the first time we ever see that scope) to whatever's ALREADY
// loaded at that moment — not 0 — so pre-existing history is never
// misread as unread on a fresh browser either; only messages that show up
// after that point count.
const LAST_READ_STORAGE_KEY = 'bf_shoutbox_last_read_v1';
function loadLastRead(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(LAST_READ_STORAGE_KEY) || '{}'); } catch { return {}; }
}
const lastRead = reactive<Record<string, number>>(loadLastRead());
function persistLastRead(): void {
  try { localStorage.setItem(LAST_READ_STORAGE_KEY, JSON.stringify(lastRead)); } catch { /* quota — non-fatal, same trade-off as store.ts */ }
}
/** Seed a scope's marker to "everything currently loaded counts as read"
 *  the first time we ever see it — never retroactively lowers an existing
 *  marker. Safe to call repeatedly (e.g. on every scope switch). */
function ensureLastReadBaseline(s: ShoutboxScope): void {
  if (lastRead[s] !== undefined) return;
  const msgs = Shoutbox.messagesFor(s);
  lastRead[s] = msgs.length ? msgs[msgs.length - 1].ts : 0;
  persistLastRead();
}
function markScopeRead(s: ShoutboxScope): void {
  const msgs = Shoutbox.messagesFor(s);
  lastRead[s] = msgs.length ? msgs[msgs.length - 1].ts : Date.now();
  persistLastRead();
}
const unreadCount = computed(() => {
  if (expanded.value) return 0;
  const cutoff = lastRead[scope.value] ?? 0;
  return messages.value.filter((m) => m.ts > cutoff).length;
});

function toggleExpanded(): void {
  expanded.value = !expanded.value;
  localStorage.setItem(EXPANDED_STORAGE_KEY, expanded.value ? '1' : '0');
  if (expanded.value) markScopeRead(scope.value);
}

const communityScope = computed<ShoutboxScope | null>(() =>
  props.communityId ? (`community:${props.communityId}` as ShoutboxScope) : null
);

const scope = computed<ShoutboxScope>(() =>
  activeTab.value === 'community' && communityScope.value ? communityScope.value : 'global'
);

const messages = computed(() => Shoutbox.messagesFor(scope.value));
const onlineCount = computed(() => Shoutbox.onlineCount(scope.value)); // pill badge: current chat tab only
const totalOnlineCount = computed(() => Shoutbox.allPeers().length); // Online tab: everyone, any scope
const onlinePeers = computed(() => Shoutbox.allPeers());
const status = computed(() => Shoutbox.status.value);
const isSending = computed(() => Shoutbox.sending.value);
// Sending requires being logged in — no exceptions (see shoutbox.ts's
// send()). This is the second of two enforcement points, not the only one.
const canSend = computed(() => !!props.auth.user && !isSending.value);

// ─── Position: stay a bit above whatever's below in the shared floating
// stack (the player, plus anything else registered there) ───
// See modules/floating-stack.ts for the full story of why this used to be
// a locally-duplicated copy of the player-footprint formula, and isn't
// anymore.
const GAP_ABOVE_PLAYER_PX = 12;
const dockEl = ref<HTMLElement | null>(null);
const stackBottomPx = useFloatingLayer(dockEl, {
  id: 'shoutbox',
  order: 30, // topmost layer -- furthest from the player. Stacking order (bottom to top): player -> blockchain wait-queue bar (order 10, App.vue) -> cookie banner (order 20, CookieConsentBanner.vue) -> chat (here, order 30)
  visible: () => true, // always rendered, at minimum as the collapsed pill (see mount condition in App.vue)
});
const dockBottomPx = computed(() => stackBottomPx.value + GAP_ABOVE_PLAYER_PX);

// Avoids a real (if tiny -- Lighthouse measured 0.003) layout-shift: on
// first paint, dockBottomPx is still using floating-stack.ts's fallback
// defaults (ResizeObserver hasn't reported real measurements yet), so the
// dock would render at an estimated position and then visibly jump once
// real numbers arrive a frame or two later. Staying invisible until then
// turns that into "fades in already in the right place" instead -- CLS
// only counts movement of content that's already painted.
const settled = ref(false);
onMounted(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => { settled.value = true; }));
});

onMounted(async () => {
  Shoutbox.init({ auth: props.auth, getClient: props.getClient, checkLock: props.checkLock });
  await Shoutbox.start(scope.value);
  // Baseline whatever local-cache history just got hydrated by start() as
  // "already read" (see the unread-badge comment above `lastRead`) —
  // otherwise the very first computation of `unreadCount` right after this
  // would count that entire backlog as new.
  ensureLastReadBaseline('global');
  if (communityScope.value) ensureLastReadBaseline(communityScope.value);
  if (expanded.value) markScopeRead(scope.value);
});

onBeforeUnmount(() => {
  Shoutbox.stop();
});

watch(scope, (s) => {
  Shoutbox.setScope(s);
  ensureLastReadBaseline(s);
  if (expanded.value) markScopeRead(s);
});

// If a community-scoped tab is active but the user navigates somewhere
// without a community (communityId becomes null), fall back to Global
// rather than leaving the tab pointing at a scope with no visible entry point.
watch(communityScope, (s) => { if (!s && activeTab.value === 'community') activeTab.value = 'global'; });


// Tell the room what we're currently reading — see this file's header
// comment for why this is intentionally post-only, never player/track info.
watch(
  () => props.currentPost,
  (p) => Shoutbox.setViewingPost(p ? { author: p.author, permlink: p.permlink, title: p.title } : null),
  { immediate: true }
);

async function submit(): Promise<void> {
  const text = draft.value;
  if (!text.trim()) return;
  const ok = await Shoutbox.send(text);
  if (ok) draft.value = '';
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function openPost(author: string, permlink: string): void {
  props.openPostRef?.(author, permlink);
}

function scopeLabel(s: ShoutboxScope): string {
  return s === 'global' ? 'Global' : 'Community';
}

// ─── Composer input helpers: insert text at the cursor rather than always
// appending, so picking an emoji or the share button doesn't clobber
// wherever someone was mid-sentence. ─────────────────────────────────────
const inputEl = ref<HTMLInputElement | null>(null);

function insertAtCursor(text: string): void {
  const el = inputEl.value;
  if (!el) { draft.value += text; return; }
  const start = el.selectionStart ?? draft.value.length;
  const end = el.selectionEnd ?? draft.value.length;
  draft.value = draft.value.slice(0, start) + text + draft.value.slice(end);
  const caret = start + text.length;
  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
}

// ─── Emoji picker ───────────────────────────────────────────────────────
const showEmojiPicker = ref(false);
function pickEmoji(emoji: string): void {
  insertAtCursor(emoji);
  showEmojiPicker.value = false;
}

// ─── Share current post ─────────────────────────────────────────────────
function shareCurrentPost(): void {
  if (!props.currentPost) return;
  insertAtCursor(`@${props.currentPost.author}/${props.currentPost.permlink} `);
}
</script>

<template>
  <div ref="dockEl" class="shoutbox-dock" :class="{ 'shoutbox-dock--expanded': expanded }" :style="{ bottom: dockBottomPx + 'px', opacity: settled ? 1 : 0, transition: 'opacity 0.15s ease-in, bottom 0.2s ease-in-out' }">
    <button type="button" class="shoutbox-pill" @click="toggleExpanded">
      <span class="dot" :class="status"></span>
      <span class="shoutbox-pill-label">Chat</span>
      <span class="shoutbox-pill-count">{{ onlineCount }} online</span>
      <span v-if="unreadCount > 0" class="shoutbox-pill-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
      <span class="shoutbox-pill-chevron">{{ expanded ? '▾' : '▴' }}</span>
    </button>

    <div v-if="expanded" class="shoutbox">
      <div class="shoutbox-header">
        <div class="shoutbox-tabs">
          <button type="button" :class="{ active: activeTab === 'global' }" @click="activeTab = 'global'">
            Global
          </button>
          <button
            v-if="communityScope"
            type="button"
            :class="{ active: activeTab === 'community' }"
            @click="activeTab = 'community'"
          >
            Community
          </button>
          <button type="button" :class="{ active: activeTab === 'online' }" @click="activeTab = 'online'">
            Online ({{ totalOnlineCount }})
          </button>
        </div>
      </div>

      <div v-if="activeTab === 'online'" class="shoutbox-online-list">
        <div v-if="!onlinePeers.length" class="shoutbox-empty">Nobody else around right now.</div>
        <div v-for="p in onlinePeers" :key="p.peerId" class="online-row">
          <span class="online-name">{{ p.username ?? 'anonymous' }}</span>
          <span class="online-scope">{{ scopeLabel(p.scope) }}</span>
          <a
            v-if="p.viewingPost"
            href="#"
            class="post-ref"
            :class="{ 'post-ref--inert': !openPostRef }"
            :title="`@${p.viewingPost.author}/${p.viewingPost.permlink}`"
            @click.prevent="openPost(p.viewingPost!.author, p.viewingPost!.permlink)"
          >📖 {{ p.viewingPost.title || `@${p.viewingPost.author}/${p.viewingPost.permlink}` }}</a>
          <span v-else class="online-browsing">browsing</span>
        </div>
      </div>

      <template v-else>
        <div class="shoutbox-messages">
          <div v-if="!messages.length" class="shoutbox-empty">No messages yet — say hi.</div>
          <div v-for="m in messages" :key="m.id" class="shoutbox-msg">
            <span class="author">{{ m.author }}</span>
            <span class="time">{{ fmtTime(m.ts) }}</span>
            <div class="body">
              <template v-for="(seg, idx) in parseMessageSegments(m.body)" :key="idx">
                <span v-if="seg.type === 'text'">{{ seg.value }}</span>
                <a
                  v-else
                  href="#"
                  class="post-ref"
                  :class="{ 'post-ref--inert': !openPostRef }"
                  :title="seg.label"
                  @click.prevent="openPost(seg.author, seg.permlink)"
                >📄 {{ seg.label }}</a>
              </template>
            </div>
          </div>
        </div>

        <div v-if="showEmojiPicker" class="emoji-picker">
          <button
            v-for="e in EMOJI_LIST"
            :key="e.shortcode"
            type="button"
            class="emoji-option"
            :title="`:${e.shortcode}:`"
            @click="pickEmoji(e.emoji)"
          >{{ e.emoji }}</button>
        </div>

        <form class="shoutbox-input" @submit.prevent="submit">
          <button
            type="button"
            class="icon-btn"
            :class="{ active: showEmojiPicker }"
            title="Emoji"
            @click="showEmojiPicker = !showEmojiPicker"
          >😀</button>
          <button
            v-if="currentPost"
            type="button"
            class="icon-btn"
            title="Share the post you're currently viewing"
            @click="shareCurrentPost"
          >🔗</button>
          <input
            ref="inputEl"
            v-model="draft"
            type="text"
            maxlength="500"
            :placeholder="!props.auth.user ? 'Log in to chat' : isSending ? 'Sending…' : 'Write a message…'"
            :disabled="!canSend"
            @focus="showEmojiPicker = false"
          />
          <button type="submit" class="send-btn" :disabled="!canSend || !draft.trim()">Send</button>
        </form>
      </template>
    </div>
  </div>
</template>

<style scoped>
.shoutbox-dock {
  position: fixed;
  left: 12px;
  z-index: 1500; /* above the player's bar/expanded panel (999-1000), below .modal-overlay (10000) */
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  font-family: var(--sans);
  font-size: 0.85rem;
  max-width: calc(100vw - 24px);
  transition: bottom 0.2s ease; /* smooth follow when the player's height changes */
}

.shoutbox-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--collapsed-bar-bg);
  border: 1px solid var(--collapsed-bar-border);
  color: var(--collapsed-bar-text);
  border-radius: var(--radius-sm, 6px);
  padding: 6px 10px;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
  order: 2; /* sits below the panel, which grows upward when expanded */
}
.shoutbox-pill-label { font-weight: 600; color: var(--collapsed-bar-strong-text); }
.shoutbox-pill-count { opacity: 0.85; white-space: nowrap; }
.shoutbox-pill-badge {
  background: var(--badge-info-bg);
  color: var(--badge-text);
  border-radius: 999px;
  padding: 0 6px;
  font-size: 0.7rem;
  line-height: 1.5;
}
.shoutbox-pill-chevron { opacity: 0.7; }

.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-soft); flex-shrink: 0; }
.dot.connected { background: var(--state-active); }
.dot.connecting { background: var(--accent); }
.dot.disconnected { background: var(--alert-error-border); }

.shoutbox {
  order: 1; /* above the pill */
  display: flex;
  flex-direction: column;
  width: 320px;
  max-width: calc(100vw - 24px);
  max-height: 420px;
  margin-bottom: 6px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
  background: var(--card-bg);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}
.shoutbox-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--tab-border);
  background: var(--tab-bg);
}
.shoutbox-tabs { display: flex; }
.shoutbox-tabs button {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--tab-text);
  padding: 8px 10px;
  cursor: pointer;
  font-size: 0.8rem;
  white-space: nowrap;
}
.shoutbox-tabs button.active {
  background: var(--tab-active-bg);
  border-bottom-color: var(--tab-active-border);
  color: var(--tab-active-text);
  font-weight: 600;
}
.shoutbox-messages { flex: 1; overflow-y: auto; padding: 8px 10px; color: var(--card-about-text); }
.shoutbox-empty { opacity: 0.6; color: var(--card-muted-text); text-align: center; padding: 16px 0; }
.shoutbox-msg { margin-bottom: 6px; }
.shoutbox-msg .author { font-weight: 600; color: var(--brand); }
.shoutbox-msg .time { opacity: 0.7; color: var(--card-muted-text); font-size: 0.7rem; margin-left: 6px; }
.shoutbox-msg .body { white-space: pre-wrap; word-break: break-word; }
.post-ref {
  color: var(--link-color);
  text-decoration: none;
  border-bottom: 1px dotted currentColor;
  cursor: pointer;
}
.post-ref:hover { color: var(--link-hover-color); }
.post-ref--inert { cursor: default; }

.shoutbox-online-list { flex: 1; overflow-y: auto; padding: 8px 10px; color: var(--card-about-text); }
.online-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid var(--card-divider);
  flex-wrap: wrap;
}
.online-row:last-child { border-bottom: none; }
.online-name { font-weight: 600; color: var(--brand); }
.online-scope {
  font-size: 0.7rem;
  color: var(--card-muted-text);
  background: var(--chip-bg);
  border-radius: var(--radius-xs, 4px);
  padding: 1px 5px;
}
.online-browsing { color: var(--card-muted-text); font-size: 0.8rem; font-style: italic; }

.emoji-picker {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  padding: 6px;
  max-height: 140px;
  overflow-y: auto;
  border-top: 1px solid var(--card-divider);
  background: var(--card-bg);
}
.emoji-option {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1.6;
  border-radius: var(--radius-xs, 4px);
  padding: 2px 0;
}
.emoji-option:hover { background: var(--chip-bg); }

.shoutbox-input {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-top: 1px solid var(--card-divider);
  background: var(--card-bg);
}
.shoutbox-input input {
  flex: 1;
  min-width: 0;
  background: var(--input-bg);
  color: var(--input-text);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-xs, 4px);
  padding: 5px 8px;
  font-family: var(--sans);
}
.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 2px 4px;
  border-radius: var(--radius-xs, 4px);
  color: var(--btn-ghost-text);
  flex-shrink: 0;
}
.icon-btn:hover { background: var(--chip-bg); }
.icon-btn.active { background: var(--chip-bg); }
.send-btn {
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  border: 1px solid var(--btn-primary-border);
  border-radius: var(--radius-xs, 4px);
  padding: 5px 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.send-btn:hover:not(:disabled) { background: var(--btn-primary-hover-bg); }
.send-btn:disabled { opacity: 0.5; cursor: default; }

@media (max-width: 800px) {
  .shoutbox-dock { left: 8px; }
  .shoutbox { width: calc(100vw - 16px); max-height: 60vh; }
  .shoutbox-pill-label, .shoutbox-pill-count { display: none; } /* keep the pill small on phones */
}
</style>
