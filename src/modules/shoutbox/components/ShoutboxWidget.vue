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
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Shoutbox } from '../shoutbox';
import type { ShoutboxScope } from '../types';
import type { AuthUser } from '../../../types';
import { EMOJI_LIST } from '../emoji';
import { parseMessageSegments } from '../render';
import { useFloatingLayer } from '../../floating-stack';
import { useTitle } from '../../../composables/useTitle';
import ScrollableTabs from '../../ui/ScrollableTabs.vue';

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
  /** Navigates the host app to a user's profile — used when a chat
   * username is clicked. Omit to render usernames as plain (non-clickable)
   * text, same convention as openPostRef above. */
  openProfileRef?: (username: string) => void;
  /** Other Blurt communities the logged-in user subscribes to (same list
   * useGlobalActivity.ts's sidebar uses) — NOT this forum's own community
   * (that's `communityId` above, always its own dedicated tab). The
   * underlying P2P room is shared across every deployed instance of this
   * app regardless of which community each instance is configured for
   * (see transport/peerjs-transport.ts's ROOM_ID), so messages tagged
   * with one of these communities' scopes can genuinely arrive here, from
   * that other instance's own users — this just gives them a tab to
   * surface in, instead of being silently stored but never shown. See the
   * `extraCommunityScopes` comment below for how a tab actually appears. */
  userSubscriptions?: { account: string; title: string }[];
}>();

const activeTab = defineModel<string>('activeTab', { default: 'global' });
const draft = defineModel<string>('draft', { default: '' });

// Always starts collapsed on every page load — never remembers/restores a
// previously-expanded state across reloads. That used to be the behavior
// (a localStorage flag toggled in toggleExpanded() below, read back in as
// the initial value here), which meant leaving it open once left it
// popping open on every subsequent visit, unprompted — the unread badge
// (see `unreadCount`/`unreadForScope` below) is the only thing that should
// ever draw attention to it; opening is always the user's own action.
const expanded = ref(false);

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
// Own messages never count as "unread" — sending something and then
// switching tabs used to flag the tab you just posted in, because the
// filter below only compared timestamps against the read marker and had
// no notion of "but I'm the one who wrote this." You've necessarily
// already seen your own message (you just typed it), so it's excluded
// from both the count AND from ever advancing `lastRead` on its own.
const ownUsername = computed(() => props.auth.user?.username ?? null);

const unreadCount = computed(() => {
  if (expanded.value) return 0;
  const cutoff = lastRead[scope.value] ?? 0;
  return messages.value.filter((m) => m.ts > cutoff && m.author !== ownUsername.value).length;
});
/** Same as `unreadCount` above but for an arbitrary scope, not just the
 *  currently-selected one — powers the per-tab badges (Global/Community/
 *  other subscribed communities) so a new message in a tab you're NOT
 *  looking at is actually visible, instead of only affecting the pill's
 *  total once you happen to open that tab. */
function unreadForScope(s: ShoutboxScope): number {
  if (expanded.value && scope.value === s) return 0; // currently open and being looked at
  const cutoff = lastRead[s] ?? 0;
  return Shoutbox.messagesFor(s).filter((m) => m.ts > cutoff && m.author !== ownUsername.value).length;
}

// ─── @mention of the logged-in user's own username ──────────────────────
// Mirrors the existing activity-feed notification (useGlobalActivity.ts's
// '⚡' via useTitle's setTitleIcon) so a chat mention gets the same
// can't-miss page-title/favicon treatment, under its own icon key so the
// two don't clobber each other. Scans every scope we're tracking (not
// just the active tab) so a mention in a community tab you're not
// currently looking at still flashes the title.
const { setTitleIcon } = useTitle();
function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function mentionsUser(body: string, username: string): boolean {
  return new RegExp(`@${escapeRegExp(username)}\\b`, 'i').test(body);
}
const hasUnreadMention = computed(() => {
  const me = ownUsername.value;
  if (!me) return false;
  for (const s of Object.keys(Shoutbox.messages)) {
    const cutoff = lastRead[s] ?? 0;
    for (const m of Shoutbox.messagesFor(s as ShoutboxScope)) {
      if (m.ts <= cutoff) continue;
      if (m.author === me) continue;
      if (mentionsUser(m.body, me)) return true;
    }
  }
  return false;
});
watch(hasUnreadMention, (v) => setTitleIcon('shoutbox-mention', v ? '🔔' : null), { immediate: true });
onBeforeUnmount(() => setTitleIcon('shoutbox-mention', null));

// Collapsed pill blinks whenever there's something unread waiting —
// either an ordinary unread count in any scope we're tracking (not just
// the active tab, so a message in a background community tab still makes
// the pill blink), or a mention — so it's noticeable even without opening
// the panel (a plain badge number is easy to miss at a glance on a small
// corner pill). Iterates Shoutbox.messages' own keys rather than the
// `extraCommunityScopes` computed declared further below, so this doesn't
// care about declaration order in this file.
const hasAnyUnread = computed(() => {
  if (hasUnreadMention.value) return true;
  return Object.keys(Shoutbox.messages).some((s) => unreadForScope(s as ShoutboxScope) > 0);
});

// ─── Auto-scroll to the newest message ──────────────────────────────────
// `.shoutbox-messages` only exists in the DOM while expanded (see
// `v-if="expanded"` on the panel below), so this ref is null whenever
// collapsed — scrollToBottom() below is a safe no-op in that case, not a
// bug to guard against separately.
const messagesEl = ref<HTMLElement | null>(null);
function scrollToBottom(): void {
  nextTick(() => {
    const el = messagesEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function toggleExpanded(): void {
  expanded.value = !expanded.value;
  if (expanded.value) { markScopeRead(scope.value); scrollToBottom(); }
}

const communityScope = computed<ShoutboxScope | null>(() =>
  props.communityId ? (`community:${props.communityId}` as ShoutboxScope) : null
);

// ─── Other subscribed communities' chat, surfaced only once they actually
// have something in them ─────────────────────────────────────────────────
// `extraCommunityScopes` is every OTHER community the user subscribes to
// (excluding this forum's own — that's the dedicated "Community" tab).
// These are kept in sync in the background regardless of whether their tab
// is showing (see the watcher below, and Shoutbox.setWatchedScopes()) —
// otherwise we'd only find out one has new messages by chance, whenever a
// live broadcast happens to arrive while we're connected, which is exactly
// the "didn't notice until I happened to open the tab" complaint this is
// fixing for the CURRENT community too (see unreadForScope below).
//
// `visibleExtraScopes` is the subset actually rendered as tabs — only ones
// with at least one message ever seen (read or not). Intentionally not
// "only while unread", so a tab you've already read doesn't vanish and
// reappear as you switch away and back; the trigger for a tab existing at
// all is "something was ever said there", per what was asked for.
const extraCommunityScopes = computed<ShoutboxScope[]>(() =>
  (props.userSubscriptions ?? [])
    .filter((s) => s.account !== props.communityId)
    .map((s) => `community:${s.account}` as ShoutboxScope)
);
const visibleExtraScopes = computed<ShoutboxScope[]>(() =>
  extraCommunityScopes.value.filter((s) => Shoutbox.messagesFor(s).length > 0)
);
function extraScopeTitle(s: ShoutboxScope): string {
  const account = s.slice('community:'.length);
  return props.userSubscriptions?.find((sub) => sub.account === account)?.title ?? account;
}

// ─── Channel list (replaces the old flat "Global / Community / extra
// communities / Online" tab row) ─────────────────────────────────────────
// Fixed, Discord-like ordering (Global, then this forum's own Community,
// then whatever else is subscribed) rather than the previous
// unread-first sort — a sidebar of channels that keeps reshuffling itself
// as things get read would feel wrong in a "mini Discord" layout, where
// the whole point is a stable list you learn the position of. "Online" is
// no longer one of these entries at all: it moved out to its own always-
// visible header button (see `showOnline` below) per the redesign.
interface ChannelTab { key: string; scope: ShoutboxScope; label: string; unread: number }
const channels = computed<ChannelTab[]>(() => {
  const list: ChannelTab[] = [
    { key: 'global', scope: 'global', label: 'Global', unread: unreadForScope('global') },
  ];
  if (communityScope.value) {
    list.push({ key: 'community', scope: communityScope.value, label: 'Community', unread: unreadForScope(communityScope.value) });
  }
  for (const s of visibleExtraScopes.value) {
    list.push({ key: s, scope: s, label: extraScopeTitle(s), unread: unreadForScope(s) });
  }
  return list;
});
function selectChannel(c: ChannelTab): void {
  showOnline.value = false;
  activeTab.value = c.key;
}

// ─── Online-peers overlay — a toggle, not a tab ──────────────────────────
// Previously "Online (N)" was just another entry in the tab row, which is
// exactly what crowded it out with 7 communities' worth of tabs. Now the
// peer count lives in its own persistent header inside the panel (always
// visible, whichever channel is open) and clicking it reveals/hides the
// peer list in place of the message list — the channel rail/strip stays
// visible and untouched either way.
const showOnline = ref(false);

watch(
  extraCommunityScopes,
  (scopes) => {
    Shoutbox.setWatchedScopes(scopes);
    scopes.forEach(ensureLastReadBaseline);
  },
  { immediate: true }
);

const scope = computed<ShoutboxScope>(() => {
  if (activeTab.value === 'community' && communityScope.value) return communityScope.value;
  if (activeTab.value.startsWith('community:')) return activeTab.value as ShoutboxScope;
  return 'global';
});

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
  if (expanded.value) { markScopeRead(scope.value); scrollToBottom(); }
});

onBeforeUnmount(() => {
  Shoutbox.stop();
});

watch(scope, (s) => {
  Shoutbox.setScope(s);
  ensureLastReadBaseline(s);
  if (expanded.value) { markScopeRead(s); scrollToBottom(); }
});

// If a community-scoped tab is active but the user navigates somewhere
// without a community (communityId becomes null), fall back to Global
// rather than leaving the tab pointing at a scope with no visible entry point.
watch(communityScope, (s) => { if (!s && activeTab.value === 'community') activeTab.value = 'global'; });

// Always stick to the newest message — covers messages arriving live (from
// anyone) and history/resync backfill, whenever the panel is open. Runs
// for the currently-selected scope only, same as `messages` itself.
watch(() => messages.value.length, () => { if (expanded.value) scrollToBottom(); });

// Closing the online-peers overlay (or any channel switch that lands back
// on a chat list) has to scroll too. The overlay REPLACES the message
// container (v-if / v-else in the template), so coming back mounts a
// brand-new `.shoutbox-messages` element with scrollTop = 0 — and
// `watch(scope)` above can't catch it, because `scope` doesn't change for
// that trip (Global → online overlay → Global stays 'global' the whole
// time). Watching the overlay flag itself is what actually matches what's
// being remounted.
watch(showOnline, (v) => { if (expanded.value && !v) scrollToBottom(); });


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
  // onSent (not just `if (ok) ...` below) is what actually clears the box
  // when a PIN prompt was involved — see Shoutbox.send()'s own comment on
  // why: this whole submit() call already returns long before the PIN
  // retry resolves, so the retry has no other way back to this input box.
  const ok = await Shoutbox.send(text, () => { draft.value = ''; });
  if (ok) draft.value = '';
}

// Time-only was unreadable for anything more than a few hours old — no
// way to tell "yesterday" from "last week" apart. Still just the time for
// anything from today (the common case, where a date would be pure
// noise); anything older gets a short date in front of it.
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return timePart;
  return `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })} ${timePart}`;
}

function openPost(author: string, permlink: string): void {
  props.openPostRef?.(author, permlink);
}

function openProfileFor(username: string): void {
  props.openProfileRef?.(username);
}

function scopeLabel(s: ShoutboxScope): string {
  if (s === 'global') return 'Global';
  if (s === communityScope.value) return 'Community';
  return extraScopeTitle(s);
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
    <button type="button" class="shoutbox-pill" :class="{ 'shoutbox-pill--blink': !expanded && hasAnyUnread }" @click="toggleExpanded">
      <span class="dot" :class="status"></span>
      <span class="shoutbox-pill-label">Chat</span>
      <span class="shoutbox-pill-count">{{ onlineCount }} online</span>
      <span v-if="unreadCount > 0" class="shoutbox-pill-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
      <span class="shoutbox-pill-chevron">{{ expanded ? '▾' : '▴' }}</span>
    </button>

    <div v-if="expanded" class="shoutbox">
      <div class="shoutbox-body">
        <!-- Desktop: "mini Discord" vertical channel rail -->
        <div class="channel-rail hide-mobile">
          <button
            v-for="c in channels"
            :key="c.key"
            type="button"
            class="channel-btn"
            :class="{ active: !showOnline && activeTab === c.key }"
            :title="c.label"
            @click="selectChannel(c)"
          >
            <span class="channel-label">{{ c.label }}</span>
            <span v-if="c.unread > 0" class="shoutbox-tab-badge">{{ c.unread }}</span>
          </button>
        </div>

        <div class="shoutbox-main">
          <!-- Mobile: ONE compact row — a small online toggle pinned on the
               left plus the horizontal, drag/wheel-scrollable channel strip
               (same mechanics as the player's own tabs) filling the rest.
               Previously this was two full-width rows (channel strip, then
               a separate "N online" header below it) stacked on top of each
               other, which on a short phone-height panel ate up roughly
               half the visible window before a single message was even
               visible — folding them into one row gives that space back. -->
          <div class="mobile-header-row show-mobile">
            <button
              type="button"
              class="online-toggle-compact"
              :class="{ active: showOnline }"
              :title="`${totalOnlineCount} online`"
              @click="showOnline = !showOnline"
            >
              <span class="online-header-dot"></span>{{ totalOnlineCount }}
            </button>
            <ScrollableTabs class="channel-strip">
              <button
                v-for="c in channels"
                :key="c.key"
                type="button"
                class="channel-btn"
                :class="{ active: !showOnline && activeTab === c.key }"
                :title="c.label"
                @click="selectChannel(c)"
              >
                {{ c.label }}<span v-if="c.unread > 0" class="shoutbox-tab-badge">{{ c.unread }}</span>
              </button>
            </ScrollableTabs>
          </div>

          <!-- Desktop: full-width persistent header (the rail already
               takes up a column, so there's no reason to compress this one
               down — it's mobile's limited vertical space this is about). -->
          <button
            type="button"
            class="online-header hide-mobile"
            :class="{ active: showOnline }"
            @click="showOnline = !showOnline"
          >
            <span class="online-header-dot"></span>
            {{ totalOnlineCount }} online
            <span class="online-header-chevron">{{ showOnline ? '▾' : '▸' }}</span>
          </button>

          <div v-if="showOnline" class="shoutbox-online-list">
            <div v-if="!onlinePeers.length" class="shoutbox-empty">Nobody else around right now.</div>
            <div v-for="p in onlinePeers" :key="p.peerId" class="online-row">
              <a
                v-if="p.username"
                href="#"
                class="online-name"
                :class="{ 'online-name--inert': !openProfileRef }"
                @click.prevent="openProfileFor(p.username)"
              >{{ p.username }}</a>
              <span v-else class="online-name">anonymous</span>
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
            <div class="shoutbox-messages" ref="messagesEl">
              <div v-if="!messages.length" class="shoutbox-empty">No messages yet — say hi.</div>
              <div v-for="m in messages" :key="m.id" class="shoutbox-msg">
                <a
                  href="#"
                  class="author"
                  :class="{ 'author--inert': !openProfileRef }"
                  @click.prevent="openProfileFor(m.author)"
                >{{ m.author }}</a>
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
/* Noticeable-but-not-annoying pulse so the collapsed pill draws the eye
   even when something arrives while it's closed, not just a static badge
   number that's easy to miss on a small corner element. */
.shoutbox-pill--blink { animation: shoutbox-pill-pulse 1.4s ease-in-out infinite; }
@keyframes shoutbox-pill-pulse {
  0%, 100% { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15); }
  50% { box-shadow: 0 2px 14px 3px color-mix(in srgb, var(--accent, #e0393e) 65%, transparent); }
}

.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-soft); flex-shrink: 0; }
.dot.connected { background: var(--state-active); }
.dot.connecting { background: var(--accent); }
.dot.disconnected { background: var(--alert-error-border); }

.shoutbox {
  order: 1; /* above the pill */
  display: flex;
  flex-direction: column;
  width: 420px; /* wider than before (320px) to fit the channel rail next to a still-readable message column */
  max-width: calc(100vw - 24px);
  /* Fixed height, not max-height: with max-height the panel shrank to fit
     whatever that channel happened to contain (few messages, the shorter
     online-peer list, etc.), so switching channels visibly resized the
     whole dock every time. A fixed height keeps the window steady —
     .shoutbox-messages/.shoutbox-online-list (flex: 1 each) absorb the
     difference internally via their own scrollbar instead. */
  height: 420px;
  margin-bottom: 6px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
  background: var(--card-bg);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

/* `.shoutbox-body` is the row that holds the desktop channel rail next to
   the main panel. On mobile the rail is display:none (`.hide-mobile`) and
   `.shoutbox-main` alone fills the width, so this stays `display:flex`
   unconditionally — only the rail's own visibility changes per breakpoint. */
.shoutbox-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.shoutbox-main { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }

/* ─── Desktop: "mini Discord" vertical channel rail ─────────────────────
   A fixed-width column of channel buttons, independently scrollable so a
   long list of subscribed communities doesn't push the rail (and with it
   the whole panel) taller than the messages area next to it. */
.channel-rail {
  width: 92px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  border-right: 1px solid var(--tab-border);
  background: var(--tab-bg);
}
.channel-btn {
  background: none;
  border: none;
  border-left: 3px solid transparent;
  color: var(--tab-text);
  padding: 8px 8px;
  cursor: pointer;
  font-size: 0.75rem;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.channel-rail .channel-btn { border-bottom: 1px solid var(--card-divider); }
.channel-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.channel-btn.active {
  background: var(--tab-active-bg);
  border-left-color: var(--tab-active-border);
  color: var(--tab-active-text);
  font-weight: 600;
}

/* ─── Mobile: one compact row — online toggle + channel strip ───────────
   Replaces what used to be two full-width rows (a channel strip, then a
   separate "N online" header under it). On a short mobile panel height
   that pair ate up roughly half the window before any messages were even
   visible; folding the online toggle into the same row as the channels
   (as a small pinned button, not a full row of its own) gives that space
   back for actual chat content. Desktop keeps the full-width header
   instead (see `.online-header` below) since it already has a side rail
   and isn't short on vertical room the way a phone is. */
.mobile-header-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--tab-border);
  background: var(--tab-bg);
  flex-shrink: 0;
}
.online-toggle-compact {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  background: none;
  border: none;
  border-right: 1px solid var(--card-divider);
  color: var(--card-muted-text);
  padding: 6px 8px;
  cursor: pointer;
  font-size: 0.72rem;
}
.online-toggle-compact.active { color: var(--card-about-text); font-weight: 600; }

/* Channel strip itself — wrapped in ScrollableTabs (same component the
   media player's tabs use) so it actually drag/wheel-scrolls once there
   are more channels than fit — plain `overflow-x: auto` on a touch-first
   element like this one isn't enough on its own without a real
   pointer-drag affordance for mouse users. */
.channel-strip { flex: 1; min-width: 0; }
.channel-strip .channel-btn {
  border-bottom: 2px solid transparent;
  border-left: none;
  white-space: nowrap;
  flex-shrink: 0;
}
.channel-strip .channel-btn.active { border-left: none; border-bottom-color: var(--tab-active-border); }

.shoutbox-tab-badge {
  display: inline-block;
  min-width: 15px;
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent, #e0393e);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}

/* ─── Global online-peers header ─────────────────────────────────────────
   Always visible above the message list regardless of which channel is
   selected — a single, persistent place for the peer count (previously
   its own crowded-out tab), toggling the peer list open/closed in place
   of the messages below it. */
.online-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: none;
  border: none;
  border-bottom: 1px solid var(--card-divider);
  color: var(--card-muted-text);
  padding: 6px 10px;
  cursor: pointer;
  font-size: 0.75rem;
  text-align: left;
  flex-shrink: 0;
}
.online-header:hover { background: var(--chip-bg); }
.online-header.active { color: var(--card-about-text); font-weight: 600; }
.online-header-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--state-active); flex-shrink: 0; }
.online-header-chevron { margin-left: auto; opacity: 0.7; }
.shoutbox-messages { flex: 1; overflow-y: auto; padding: 8px 10px; color: var(--card-about-text); }
.shoutbox-empty { opacity: 0.6; color: var(--card-muted-text); text-align: center; padding: 16px 0; }
.shoutbox-msg { margin-bottom: 6px; }
.shoutbox-msg .author { font-weight: 600; color: var(--brand); text-decoration: none; cursor: pointer; }
.shoutbox-msg .author:hover { text-decoration: underline; }
.shoutbox-msg .author--inert { cursor: default; }
.shoutbox-msg .author--inert:hover { text-decoration: none; }
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
.online-name { font-weight: 600; color: var(--brand); text-decoration: none; cursor: pointer; }
.online-name:hover { text-decoration: underline; }
.online-name--inert { cursor: default; }
.online-name--inert:hover { text-decoration: none; }
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
  .shoutbox { width: calc(100vw - 16px); height: 60vh; }
  .shoutbox-pill-label, .shoutbox-pill-count { display: none; } /* keep the pill small on phones */
}
</style>
