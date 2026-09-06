/**
 * BlurtForum MediaPlayer Library
 * Handles audio/video playback, queuing, playlists, event emitter and plugin API.
 */
import { reactive, watch, nextTick, ref, computed } from 'vue';
import type { MediaTrack, MediaEntryMirror, PlayerState, Playlist, PlaylistState, PlayerEvent, PlayerPlugin, BFPlayerAPI, PlayMode, TrackActionZone, TrackActionContribution, PeerActionContribution, PlayerTabContribution, RailItemContribution, PlayerButtonContribution, PlayerWidgetContribution } from './types';
import { trackEvent } from '../analytics';
import * as WTPool from './webtorrent-pool';
import type { WebtorrentStats, SeedManifestEntry, TorrentSnapshot } from './webtorrent-pool';


// Minimal YouTube IFrame API typings
export interface YTPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number): void;
  setVolume(vol: number): void;
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
}
export interface YTNamespace {
  Player: new (el: string, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; BUFFERING: number; ENDED: number };
}

export interface PTPlayer {
  ready: Promise<void>;
  setVolume(v: number): void;
  addEventListener(evt: string, cb: (data: unknown) => void): void;
  getDuration(): Promise<number>;
  getCurrentTime(): Promise<number>;
  pause(): void;
  play(): void;
  seek(t: number): void;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
    PeerTubePlayer?: new (iframe: HTMLElement) => PTPlayer;
    __bfPlayerEnabled?: boolean;
  }
}

// ─── State ─────────────────────────────────────────────────────────────────

export const state = reactive<PlayerState>({
  enabled: true,
  active: true,
  playing: false,
  loading: false,
  minimized: true,
  expanded: false,
  expandedHeight: 400,
  tabsWidth: 340,
  expandedTab: 'video',
  cinema: false,
  hidden: false,
  cinemaBrowseView: 'categories',
  cinemaControlsVisible: true,
  currentTrack: null,
  queue: [],
  autoQueue: [],
  history: [],
  progress: 0,
  duration: 0,
  volume: parseFloat(localStorage.getItem('bf-player-volume') || '0.7'),
  experimental: localStorage.getItem('bf-player-experimental') === 'true',
  isAutoStarting: false,
  playMode: (localStorage.getItem('bf-player-mode') as PlayMode) || 'sequential',
  skipLocked: false,
  seedingEnabled: WTPool.isSeedingEnabled()
});

// Cinema mode currently keeps YouTube/PeerTube's own native controls (their
// iframe UI) rather than disabling them and building replacements -- mainly
// because remote/keyboard focus reaching *into* an iframe's own controls is
// untested and may not work well on TV. If that turns out to be a real
// problem, flip this one flag to hide native controls everywhere and fall
// back to our own bottom bar for every source, not just audio/webtorrent.
export const CINEMA_HIDE_NATIVE_CONTROLS = true;

const defaultPriorities = ['youtube', 'audio', 'suno', 'peertube'];
const getPriorities = () => JSON.parse(localStorage.getItem('bf-player-priorities') || JSON.stringify(defaultPriorities)) as string[];

const findBestSourceIndex = (sources: MediaEntryMirror[]): number => {
  const priorities = getPriorities();
  for (const type of priorities) {
    const idx = sources.findIndex(s => s.type === type);
    if (idx !== -1) {
          return idx;
    }
  }
  console.log('[BFPlayer] findBestSourceIndex: No priority match, falling back to 0');
  return 0;
};

export const playlistState = reactive<PlaylistState>({ playlists: [] });

export const currentSource = computed<MediaEntryMirror | null>(() => {
  if (!state.currentTrack || !state.currentTrack.sources.length) return null;
  return state.currentTrack.sources[state.currentTrack.activeSourceIndex || 0];
});

/**
 * Compares two MediaEntryMirror sources by VALUE (type + id) instead of by
 * JS object reference.
 *
 * Real bug this closes: `state` is `reactive(...)`, so reading
 * `state.currentTrack.sources[i]` returns a Vue reactivity Proxy wrapping
 * the raw source object — a genuinely different JS reference from the raw
 * object (e.g. `activeSource` captured directly off the `track` argument
 * inside playTrack() before that track was ever assigned into `state`).
 * `currentSource.value !== activeSource` was therefore true almost any time
 * `track` wasn't ALREADY a reactive object before playTrack() ran (e.g. any
 * manually-constructed MediaTrack — a "play this stored torrent" entry from
 * WebtorrentSettingsModal, a freshly-built track from a forum post/embed,
 * etc.) — even while playing the exact same source, never mind actually
 * switching to a different one. That's what caused "switch to a different
 * webtorrent link, and it just hangs at 0:00 with the previous video's
 * duration showing" — loadWebtorrentSource() legitimately fetched the new
 * torrent's metadata, then immediately abandoned attaching it because this
 * comparison wrongly believed the user had already navigated away, leaving
 * the video element stuck showing whatever the PREVIOUS torrent had loaded.
 * Tracks played via any path that already hands playTrack() an
 * already-reactive object (e.g. clicking an entry that came from the
 * playlist / "recently played" list, both backed by reactive state) never
 * hit this, which lined up with "picking it from playlist/last played
 * works fine".
 */
const sameSource = (a: MediaEntryMirror | null | undefined, b: MediaEntryMirror | null | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.type === b.type && a.id === b.id;
};

window.__bfPlayerEnabled = state.enabled;


// ─── Event Emitter ─────────────────────────────────────────────────────────

const _listeners: Partial<Record<PlayerEvent, Array<(data: unknown) => void>>> = {};

const on = (event: PlayerEvent, fn: (data: unknown) => void): void => {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event]!.push(fn);
};

const off = (event: PlayerEvent, fn: (data: unknown) => void): void => {
  if (_listeners[event]) {
    _listeners[event] = _listeners[event]!.filter(f => f !== fn);
  }
};

const _emit = (event: PlayerEvent, data?: unknown): void => {
  (_listeners[event] || []).forEach(fn => {
    try { fn(data); } catch (e) { console.warn(`BFPlayer plugin error in "${event}":`, e); }
  });
};

// ─── Plugin API ─────────────────────────────────────────────────────────────

const _plugins: PlayerPlugin[] = [];

const registerPlugin = (plugin: PlayerPlugin): void => {
  if (!plugin?.name) { console.warn('BFPlayer.registerPlugin: plugin must have a name'); return; }
  if (_plugins.find(p => p.name === plugin.name)) { console.warn(`BFPlayer: plugin "${plugin.name}" already registered`); return; }
  _plugins.push(plugin);
  if (typeof plugin.install === 'function') plugin.install(BFPlayer);
  if (typeof plugin.onTrackChange === 'function') on('trackChange', plugin.onTrackChange.bind(plugin) as (data: unknown) => void);
};

// ─── Track-action UI registry ──────────────────────────────────────────────
// Lets plugins contribute their own, independent Vue component to the
// player's track-actions area, without knowing about each other and without
// being merged into a single shared host file. `zone` controls where it's
// allowed to render: the collapsed mini bar, the expanded panel header, or
// both (the player core has no opinion on what any of this renders).

const _trackActions: TrackActionContribution[] = [];

const registerTrackAction = (contribution: TrackActionContribution): void => {
  if (!contribution?.id) { console.warn('BFPlayer.registerTrackAction: contribution must have an id'); return; }
  if (_trackActions.find(a => a.id === contribution.id)) { console.warn(`BFPlayer: track action "${contribution.id}" already registered`); return; }
  _trackActions.push(contribution);
};

const getTrackActions = (zone: Exclude<TrackActionZone, 'both'>): TrackActionContribution[] =>
  _trackActions.filter(a => a.zone === zone || a.zone === 'both');

// Same idea, but for the expanded panel's tab bar: a plugin registers a tab
// (id/label/icon/component) and the core renders it generically alongside
// the built-in video/queue/playlists/settings tabs, with zero knowledge of
// what it shows. Order = registration order.
//
// MUST be `reactive`, not a plain array: MediaPlayer.vue reads this through
// `visibleExpandedTabs = computed(() => props.player.getExpandedTabs()...)`.
// A `computed` only re-runs when a reactive dependency it read changes --
// and a plain array's `.push()` isn't one, so with a plain array the very
// first evaluation (which happens as soon as MediaPlayer.vue itself first
// renders) permanently freezes `visibleExpandedTabs`'s value. Every plugin
// that registers a tab during app bootstrap (i.e. before MediaPlayer.vue
// exists at all) happened to land before that first evaluation, so this
// never showed up before -- but WebtorrentVideo.vue registers its
// 'webtorrent-audio-subs' tab from its OWN setup(), which only runs once
// mounted as MediaPlayer.vue's child, i.e. strictly after that first
// evaluation: the push happened, but nothing was listening for it, so the
// tab (and its cinema-mode side icon) silently never appeared. `reactive()`
// here is what makes `.push()` actually notify that computed. (Contrast
// with getPlayerButtons()/getPlayerWidgets() below -- those are called
// directly inline in the template rather than through a memoizing
// `computed`, so frequent playback-driven re-renders paper over the same
// underlying non-reactivity there; this file doesn't rely on that
// coincidence to fix this bug going forward.)
const _expandedTabs = reactive<PlayerTabContribution[]>([]);

export const registerExpandedTab = (contribution: PlayerTabContribution): void => {
  if (!contribution?.id) { console.warn('BFPlayer.registerExpandedTab: contribution must have an id'); return; }
  if (_expandedTabs.find(t => t.id === contribution.id)) { console.warn(`BFPlayer: expanded tab "${contribution.id}" already registered`); return; }
  _expandedTabs.push(contribution);
};

const getExpandedTabs = (): PlayerTabContribution[] => _expandedTabs;

// Same idea, but for cinema mode's left rail (see RailItemContribution in
// types.ts). Native player features (Playlists below) register here exactly
// the same way an external plugin would -- no special-casing.

const _railItems: RailItemContribution[] = [];

const registerRailItem = (contribution: RailItemContribution): void => {
  if (!contribution?.id) { console.warn('BFPlayer.registerRailItem: contribution must have an id'); return; }
  if (_railItems.find(r => r.id === contribution.id)) { console.warn(`BFPlayer: rail item "${contribution.id}" already registered`); return; }
  _railItems.push(contribution);
};

const getRailItems = (): RailItemContribution[] => _railItems;

// ── Cinema-mode button/widget registry ──────────────────────────────────
// The generic mechanism a source (WebTorrent today, potentially others
// later) uses to add its own controls to the player's cinema-mode chrome —
// see PlayerButtonContribution/PlayerWidgetContribution in types.ts for the
// full reasoning. Two ideas kept deliberately separate:
//   - "buttons" are cheap, stateless (icon/label/onClick/badge) — fine to
//     re-render on every tick, safe to have described once and rendered
//     wherever the matching zone happens to be in the template.
//   - "widgets" are a whole component with its own state/side effects
//     (e.g. the subtitle picker actually attaches <track> elements to the
//     video) — the player mounts `component` directly, exactly once, at
//     whichever single template location the requested zone corresponds
//     to. Nothing here ever moves a widget's DOM around (no Teleport): the
//     source hands the player a description, the player owns the one place
//     it actually renders.
//
// Filtering happens in one place (here), against whatever's actually
// playing right now (`currentSource`) — a contribution only has to declare
// which source type(s) it's for; it never needs to check `state.cinema` or
// any other display-mode flag itself, and the template call sites never
// need to filter by source type either.
const _playerButtons: PlayerButtonContribution[] = [];
const _playerWidgets: PlayerWidgetContribution[] = [];

const _matchesCurrentSource = (sourceTypes: MediaEntryMirror['type'][] | 'all'): boolean =>
  sourceTypes === 'all' || (!!currentSource.value && sourceTypes.includes(currentSource.value.type));

export const registerPlayerButton = (contribution: PlayerButtonContribution): void => {
  if (!contribution?.id) { console.warn('BFPlayer.registerPlayerButton: contribution must have an id'); return; }
  if (_playerButtons.find(b => b.id === contribution.id)) { console.warn(`BFPlayer: player button "${contribution.id}" already registered`); return; }
  _playerButtons.push(contribution);
};
export const unregisterPlayerButton = (id: string): void => {
  const idx = _playerButtons.findIndex(b => b.id === id);
  if (idx !== -1) _playerButtons.splice(idx, 1);
};
export const getPlayerButtons = (zone: PlayerButtonContribution['zone']): PlayerButtonContribution[] =>
  _playerButtons.filter(b => b.zone === zone && _matchesCurrentSource(b.sourceTypes));

export const registerPlayerWidget = (contribution: PlayerWidgetContribution): void => {
  if (!contribution?.id) { console.warn('BFPlayer.registerPlayerWidget: contribution must have an id'); return; }
  if (_playerWidgets.find(w => w.id === contribution.id)) { console.warn(`BFPlayer: player widget "${contribution.id}" already registered`); return; }
  _playerWidgets.push(contribution);
};
export const unregisterPlayerWidget = (id: string): void => {
  const idx = _playerWidgets.findIndex(w => w.id === id);
  if (idx !== -1) _playerWidgets.splice(idx, 1);
};
export const getPlayerWidgets = (zone: PlayerWidgetContribution['zone']): PlayerWidgetContribution[] =>
  _playerWidgets.filter(w => w.zone === zone && _matchesCurrentSource(w.sourceTypes));

// Built-in: surface Playlists in cinema mode's left rail, opening the same
// playlists tab the bottom control bar's icon opens. Only shown once the
// user actually has a playlist (see `visible`), so it doesn't clutter the
// rail for people who've never used them.
registerRailItem({
  id: 'playlists',
  label: 'Playlists',
  icon: 'fa-solid fa-list',
  visible: () => playlistState.playlists.length > 0,
  badge: () => playlistState.playlists.length || null,
  onClick: () => {
    state.cinemaBrowseView = 'playlists';
  },
});

// ── Cinema mode auto-hide ────────────────────────────────────────────────
// One shared timer for the whole floating chrome (top bar, side icons,
// bottom bar, and anything teleported in by a source-specific component
// like WebtorrentVideo.vue) -- everything shows/hides together, driven by
// a single call site instead of N independent timers.
let _cinemaHideTimer: ReturnType<typeof setTimeout> | null = null;

export const showCinemaControls = (): void => {
  if (!state.cinema) return;
  state.cinemaControlsVisible = true;
  if (_cinemaHideTimer) clearTimeout(_cinemaHideTimer);
  if (state.expandedTab !== 'video') return; // a side panel is open -- stay visible
  _cinemaHideTimer = setTimeout(() => { state.cinemaControlsVisible = false; }, 3000);
};

watch(() => state.cinema, (isCinema) => {
  if (isCinema) showCinemaControls();
  else {
    state.cinemaControlsVisible = true;
    if (_cinemaHideTimer) clearTimeout(_cinemaHideTimer);
  }
});

// Same idea as track actions, but for a webtorrent peer-list row — no zone,
// since peer rows only exist in one place (WebtorrentInfoModal.vue).
const _peerActions: PeerActionContribution[] = [];

export const registerPeerAction = (contribution: PeerActionContribution): void => {
  if (!contribution?.id) { console.warn('BFPlayer.registerPeerAction: contribution must have an id'); return; }
  if (_peerActions.find(a => a.id === contribution.id)) { console.warn(`BFPlayer: peer action "${contribution.id}" already registered`); return; }
  _peerActions.push(contribution);
};

export const getPeerActions = (): PeerActionContribution[] => _peerActions;

// ─── WebTorrent settings/introspection (delegates to webtorrent-pool.ts) ──

const setSeedingEnabled = (enabled: boolean): void => {
  state.seedingEnabled = enabled;
  WTPool.setSeedingEnabled(enabled);
};
const setMaxSeedStorageBytes = (bytes: number): void => WTPool.setMaxStorageBytes(bytes);
const getMaxSeedStorageBytes = (): number => WTPool.getMaxStorageBytes();
const getWebtorrentStats = (): WebtorrentStats => WTPool.getStats();
const getWebtorrentManifest = (): SeedManifestEntry[] => WTPool.getManifest();
const getWebtorrentStorageEstimate = (): Promise<{ usage: number; quota: number } | null> => WTPool.getStorageEstimate();
const clearWebtorrentData = (): Promise<void> => WTPool.clearAllSeedData();
export const registerWireExtension = (factory: (wire: any) => any): void => WTPool.registerWireExtension(factory);

// ─── Internals ─────────────────────────────────────────────────────────────

let audioObj: HTMLAudioElement | null = null;
let ytPlayer: YTPlayer | null = null;
let ptPlayer: PTPlayer | null = null;
// Bumped every time playback is torn down (stopAll()). Any async
// initialization/ready callback that could eventually call .play() on its
// own (initPT()'s retry loop + its .ready callback, initYT()'s onReady)
// captures this at the start and checks it again right before doing so --
// see stopAll() below for why: without this, one of those chains still in
// flight when the user closes/switches away survives past stopAll(), and
// later forces playback to resume on a track the user already left.
let mediaGeneration = 0;
let client: any = null;
let lastLoadedSourceId: string | null = null;

const setClient = (c: any) => { client = client || c; };

const refreshTrackSources = async (track: MediaTrack): Promise<void> => {
  if (!client) return;
  // EXPERIMENT: Disable background parsing to see if it fixes Suno duplicates
  console.log(`[BFPlayer] refreshTrackSources called for ${track.author}/${track.permlink} - PARSING DISABLED`);
  /*
  try {
    const post = await Blockchain.getContent(client, track.author, track.permlink);
    if (post && post.body) {
       // ... existing logic ...
    }
  } catch (e) { console.warn('Refresh track sources failed:', e); }
  */
};
let progressTimer: ReturnType<typeof setInterval> | null = null;
let errorTimer: ReturnType<typeof setTimeout> | null = null;

const loadSavedQueue = (): void => {
  try {
    const saved = localStorage.getItem('bf-player-queue');
    const savedCurrent = localStorage.getItem('bf-player-current');
    const savedHistory = localStorage.getItem('bf-player-history');

    const ensureMirrors = (t: any): MediaTrack => ({
      ...t,
      sources: t.sources || (t.id ? [{ type: t.type, id: t.id, src: t.src, host: t.host }] : []),
      activeSourceIndex: t.activeSourceIndex || 0
    });

    if (saved) {
      const q = JSON.parse(saved) as any[];
      state.queue = q.map(ensureMirrors);
    }
    if (savedHistory) {
      const h = JSON.parse(savedHistory) as any[];
      state.history = h.map(ensureMirrors);
    }

    const restoredTrack = savedCurrent ? JSON.parse(savedCurrent) : null;
    if (restoredTrack) {
      state.currentTrack = ensureMirrors(restoredTrack);
      state.minimized = false;
    } else if (state.queue.length > 0) {
      state.minimized = false;
      state.currentTrack = state.queue[0];
    }
  } catch (e) { console.warn('Load saved queue failed:', e); }
};

loadSavedQueue();

let _playlistNamespace: string | null = null;
const _playlistsKey = (): string => (_playlistNamespace ? `bf-player-playlists:${_playlistNamespace}` : 'bf-player-playlists');

const _loadPlaylists = (): void => {
  try {
    const raw = localStorage.getItem(_playlistsKey());
    playlistState.playlists = raw ? JSON.parse(raw) : [];
  } catch (e) { console.warn('BFPlayer: failed to load playlists:', e); }
};
_loadPlaylists();

const _savePlaylists = (): void => {
  localStorage.setItem(_playlistsKey(), JSON.stringify(playlistState.playlists));
};

/**
 * Scopes playlist storage to `ns` (any string key) instead of the shared
 * default -- used by device-profiles.ts so each TV profile gets its own
 * playlists instead of sharing one global list. Player core itself has no
 * idea *why* the namespace changed, just that it did, and reloads from
 * the new key. Pass null to go back to the shared/default key.
 */
export function setPlaylistNamespace(ns: string | null): void {
  if (_playlistNamespace === ns) return;
  _playlistNamespace = ns;
  _loadPlaylists();
}

const handleError = (msg: string): void => {
  if (!state.currentTrack) return;
  const trackWithError = state.currentTrack;
  if (state.playing && !state.loading && audioObj && !audioObj.paused && audioObj.currentTime > 0) {
    console.warn('BFPlayer: Ignored transient error because media is playing:', msg);
    return;
  }
  if (trackWithError._errorHandled) return;
  trackWithError._errorHandled = true;
  const oldTitle = trackWithError.title;
  trackWithError.title = `⚠️ ERROR: ${msg} (Skipping in 5s...)`;
  state.loading = false;
  state.playing = false;
  _emit('error', { track: trackWithError, message: msg });
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => {
    if (trackWithError.title?.startsWith('⚠️ ERROR:')) trackWithError.title = oldTitle;
    if (state.currentTrack === trackWithError) playNext(true);
    errorTimer = null;
  }, 5000);
};

const initTabsResize = (e: MouseEvent | TouchEvent): void => {
  let isResizing = true;
  const startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const startW = state.tabsWidth;
  const onMove = (ee: MouseEvent | TouchEvent) => {
    if (!isResizing) return;
    const currentX = 'touches' in ee ? ee.touches[0].clientX : ee.clientX;
    // Tabs sidebar sits to the right of the video, so dragging left grows it.
    const delta = startX - currentX;
    state.tabsWidth = Math.max(260, Math.min(window.innerWidth * 0.65, startW + delta));
  };
  const onUp = () => {
    isResizing = false;
    document.removeEventListener('mousemove', onMove as EventListener);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove as EventListener);
    document.removeEventListener('touchend', onUp);
  };
  document.addEventListener('mousemove', onMove as EventListener);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove as EventListener);
  document.addEventListener('touchend', onUp);
};

const initResize = (e: MouseEvent | TouchEvent): void => {
  let isResizing = true;
  const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  const startH = state.expandedHeight;
  const onMove = (ee: MouseEvent | TouchEvent) => {
    if (!isResizing) return;
    const currentY = 'touches' in ee ? ee.touches[0].clientY : ee.clientY;
    const delta = startY - currentY;
    state.expandedHeight = Math.max(200, Math.min(window.innerHeight * 0.8, startH + delta));
  };
  const onUp = () => {
    isResizing = false;
    document.removeEventListener('mousemove', onMove as EventListener);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove as EventListener);
    document.removeEventListener('touchend', onUp);
  };
  document.addEventListener('mousemove', onMove as EventListener);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove as EventListener);
  document.addEventListener('touchend', onUp);
};

const initAudio = (): void => {
  if (audioObj) return;
  audioObj = new Audio();
  audioObj.volume = state.volume;
  const isAudioTrack = () => currentSource.value?.type === 'audio';
  audioObj.addEventListener('play', () => { if (isAudioTrack()) { state.playing = true; state.loading = false; } });
  audioObj.addEventListener('pause', () => { if (isAudioTrack()) state.playing = false; });
  audioObj.addEventListener('waiting', () => { if (isAudioTrack()) state.loading = true; });
  audioObj.addEventListener('playing', () => { if (isAudioTrack()) { state.loading = false; if (audioObj && audioObj.duration) state.duration = audioObj.duration; } });
  audioObj.addEventListener('timeupdate', () => {
    if (audioObj && isAudioTrack() && audioObj.duration > 0) {
      state.duration = audioObj.duration;
      state.progress = (audioObj.currentTime / audioObj.duration) * 100;
    }
  });
  audioObj.addEventListener('ended', () => { if (isAudioTrack()) { _emit('ended', state.currentTrack); playNext(true); } });
  audioObj.addEventListener('error', (e) => {
    if (isAudioTrack()) { console.error('BFPlayer Audio error:', e); handleError('Audio file error or broken link'); }
  });
};

let wtVideoEl: HTMLVideoElement | null = null;
let wtActiveInfoHash: string | null = null; // whichever torrent we're actively fetching pieces for right now

/**
 * The file index actually attached to playback right now — set right after
 * a successful attachPlayback()/playWebtorrentFile(), read by
 * WebtorrentVideo.vue's piece-map bar. Previously that component guessed
 * this via `files.find(f => f.isVideo || f.isAudio)` (the first video/audio
 * file in the torrent, full stop) instead of tracking what was actually
 * selected — harmless for a single-video-file torrent, but wrong the moment
 * a torrent has more than one video/audio file (e.g. multiple quality
 * versions, or once alternate audio tracks are involved), showing progress
 * for the wrong file entirely.
 */
export const wtActiveFileIndex = ref<number | null>(null);

// ── Alternate audio track (lektor/dub) ─────────────────────────────────────
// See torrent-lib.js's attachExtraAudio for the actual sync/volume/offset
// mechanics; this layer just tracks which file is picked, exposes reactive
// state for the UI, and remembers the user's settings per-torrent.
export const wtAudioTrackIndex = ref<number | null>(null); // null = original audio only
export const wtAudioMode = ref<'lektor' | 'dub'>('dub'); // 'lektor' = alongside original, 'dub' = replaces it
export const wtAudioOffsetMs = ref<number>(0);
export const wtAudioOrigVolume = ref<number>(0); // original video track's volume
export const wtAudioTrackVolume = ref<number>(1); // alternate track's own volume

let wtExtraAudioHandle: ReturnType<typeof WTPool.attachExtraAudio> | null = null;

const AUDIO_SETTINGS_PREFIX = 'bf-player-wt-audio:';
interface StoredWtAudioSettings {
  fileIndex: number; mode: 'lektor' | 'dub'; offsetMs: number; origVolume: number; trackVolume: number;
}
const loadWtAudioSettings = (infoHash: string): StoredWtAudioSettings | null => {
  try {
    const raw = localStorage.getItem(AUDIO_SETTINGS_PREFIX + infoHash);
    return raw ? (JSON.parse(raw) as StoredWtAudioSettings) : null;
  } catch { return null; }
};
const saveWtAudioSettings = (infoHash: string | null): void => {
  if (!infoHash) return;
  if (wtAudioTrackIndex.value == null) { localStorage.removeItem(AUDIO_SETTINGS_PREFIX + infoHash); return; }
  const data: StoredWtAudioSettings = {
    fileIndex: wtAudioTrackIndex.value, mode: wtAudioMode.value, offsetMs: wtAudioOffsetMs.value,
    origVolume: wtAudioOrigVolume.value, trackVolume: wtAudioTrackVolume.value,
  };
  try { localStorage.setItem(AUDIO_SETTINGS_PREFIX + infoHash, JSON.stringify(data)); } catch { /* quota — non-critical */ }
};

/** Resets the reactive audio-track UI state without touching localStorage — used when switching to a different torrent (the engine already tore down the previous extra-audio handle via detachPlayback()). */
const resetWtAudioTrackState = (): void => {
  wtExtraAudioHandle = null;
  wtAudioTrackIndex.value = null;
  wtAudioMode.value = 'dub';
  wtAudioOffsetMs.value = 0;
  wtAudioOrigVolume.value = 0;
  wtAudioTrackVolume.value = 1;
};

/**
 * Selects (or clears, with fileIndex = null) an alternate audio track for
 * whatever webtorrent is currently attached. Defaults the mode from the
 * filename convention (see torrent-lib.js's isLectorTrack) unless this
 * exact file already has saved settings for this torrent, in which case
 * those are restored instead.
 */
export const selectWebtorrentAudioTrack = (fileIndex: number | null): void => {
  if (!wtActiveInfoHash) return;
  const infoHash = wtActiveInfoHash;

  if (fileIndex == null) {
    WTPool.detachExtraAudio();
    resetWtAudioTrackState();
    saveWtAudioSettings(infoHash);
    return;
  }

  const snap = WTPool.getTorrent(infoHash);
  const file = snap?.files.find(f => f.index === fileIndex);
  if (!file) return;

  const persisted = loadWtAudioSettings(infoHash);
  const reuse = !!persisted && persisted.fileIndex === fileIndex;
  const mode: 'lektor' | 'dub' = reuse ? persisted!.mode : (WTPool.isLectorTrack(file.name) ? 'lektor' : 'dub');
  const origVolume = reuse ? persisted!.origVolume : (mode === 'lektor' ? 0.15 : 0);
  const trackVolume = reuse ? persisted!.trackVolume : 1;
  const offsetMs = reuse ? persisted!.offsetMs : 0;

  wtExtraAudioHandle = WTPool.attachExtraAudio(infoHash, fileIndex, { mode, origVolume, trackVolume, offsetMs });
  wtAudioTrackIndex.value = fileIndex;
  wtAudioMode.value = mode;
  wtAudioOffsetMs.value = offsetMs;
  wtAudioOrigVolume.value = origVolume;
  wtAudioTrackVolume.value = trackVolume;
  saveWtAudioSettings(infoHash);
};

export const setWebtorrentAudioMode = (mode: 'lektor' | 'dub'): void => {
  wtAudioMode.value = mode;
  wtExtraAudioHandle?.setMode(mode);
  saveWtAudioSettings(wtActiveInfoHash);
};
export const setWebtorrentAudioOffsetMs = (ms: number): void => {
  wtAudioOffsetMs.value = ms;
  wtExtraAudioHandle?.setOffsetMs(ms);
  saveWtAudioSettings(wtActiveInfoHash);
};
export const setWebtorrentAudioOrigVolume = (v: number): void => {
  wtAudioOrigVolume.value = v;
  wtExtraAudioHandle?.setOrigVolume(v);
  saveWtAudioSettings(wtActiveInfoHash);
};
export const setWebtorrentAudioTrackVolume = (v: number): void => {
  wtAudioTrackVolume.value = v;
  wtExtraAudioHandle?.setTrackVolume(v);
  saveWtAudioSettings(wtActiveInfoHash);
};

// ── Subtitles (delegates entirely to torrent-lib.js's format conversion) ───
// Lives at module level for the same reason the audio-track state above
// does: the actual <track> elements are attached directly to wtVideoEl (this
// module's own persistent video element), so their lifetime has to survive
// whichever UI happens to be rendering the subtitle/audio picker at any
// given moment being unmounted and remounted elsewhere -- e.g. toggling
// cinema mode, which swaps which zone the picker renders into (see the
// player-button/widget contribution registry further down). None of that
// should mean re-fetching subtitle files from the torrent or losing the
// user's current selection, which is exactly what would happen if this
// lived in component-local state instead.
//
// IMPORTANT: once mounted, a <track> element is never removed and recreated
// individually -- only ever all-at-once via clearWtSubtitleTracks(), same
// restriction as before this was hoisted out of the component: removing/
// recreating a single <track> broke the browser's native CC menu in
// Chrome/Firefox.
export const wtSubtitleTrackIndex = ref<number | null>(null); // null = subtitles off
export const wtSubtitleLoading = ref<boolean>(false);

const _wtSubTrackEls = new Map<number, HTMLTrackElement>();
const _wtSubUrls = new Map<number, string>();

const setActiveWtSubtitleTrackEl = (fileIndex: number | null): void => {
  _wtSubTrackEls.forEach((el, idx) => { el.track.mode = idx === fileIndex ? 'showing' : 'disabled'; });
};

/** Picks (or clears, with fileIndex = null) which already-prefetched subtitle file is showing right now. */
export const selectWebtorrentSubtitleTrack = (fileIndex: number | null): void => {
  wtSubtitleTrackIndex.value = fileIndex;
  setActiveWtSubtitleTrackEl(fileIndex);
};

/** Removes every mounted <track> element and revokes its blob URL — called when leaving the current torrent entirely (a new one loading, or stopAll()). */
const clearWtSubtitleTracks = (): void => {
  _wtSubTrackEls.forEach(el => el.remove());
  _wtSubTrackEls.clear();
  _wtSubUrls.forEach(url => URL.revokeObjectURL(url));
  _wtSubUrls.clear();
  wtSubtitleTrackIndex.value = null;
};

/**
 * Fetches and mounts every subtitle file in `files` up front — subtitle
 * files are tiny (typically tens of KB, nothing like the video itself), so
 * doing this eagerly rather than "only the one the user picks" is cheap and
 * means the browser's own native CC/subtitles button (which only ever lists
 * <track> elements already mounted on the video) shows the complete list
 * immediately too, without needing our own picker opened first.
 */
export const prefetchWtSubtitleTracks = async (infoHash: string, files: TorrentSnapshot['files']): Promise<void> => {
  if (!wtVideoEl) return;
  const subFiles = files.filter(f => f.isSub);
  const toFetch = subFiles.filter(f => !_wtSubTrackEls.has(f.index));
  if (!toFetch.length) return;

  wtSubtitleLoading.value = true;
  await Promise.all(toFetch.map(async (f) => {
    try {
      const track = await WTPool.getSubtitleTrack(infoHash, f.index);
      // The torrent could have changed (or this file could have stopped
      // being a subtitle file — shouldn't happen, but cheap to guard)
      // while this particular fetch was in flight.
      if (wtActiveInfoHash !== infoHash || !subFiles.some(sf => sf.index === f.index)) {
        URL.revokeObjectURL(track.url);
        return;
      }
      _wtSubUrls.set(f.index, track.url);
      const el = document.createElement('track');
      el.kind = 'subtitles';
      el.label = track.name;
      el.srclang = track.srclang;
      el.src = track.url;
      wtVideoEl!.appendChild(el);
      el.track.mode = 'disabled'; // mounted (so it's listed) but off until explicitly picked
      _wtSubTrackEls.set(f.index, el);
    } catch (err) {
      console.warn('[BFPlayer] prefetchWtSubtitleTracks: failed to prefetch subtitle', f.name, err);
    }
  }));
  wtSubtitleLoading.value = false;
};

const initWT = (): void => {
  if (wtVideoEl) return;
  wtVideoEl = document.getElementById('bf-wt-player-video') as HTMLVideoElement | null;
  if (!wtVideoEl) { console.warn('[BFPlayer] #bf-wt-player-video element not found in DOM'); return; }
  wtVideoEl.volume = state.volume;
  const isWTTrack = () => currentSource.value?.type === 'webtorrent';
  wtVideoEl.addEventListener('play', () => { if (isWTTrack()) { state.playing = true; state.loading = false; } });
  wtVideoEl.addEventListener('pause', () => { if (isWTTrack()) state.playing = false; });
  wtVideoEl.addEventListener('waiting', () => { if (isWTTrack()) state.loading = true; });
  wtVideoEl.addEventListener('playing', () => { if (isWTTrack()) { state.loading = false; if (wtVideoEl?.duration) state.duration = wtVideoEl.duration; } });
  wtVideoEl.addEventListener('timeupdate', () => {
    if (wtVideoEl && isWTTrack() && wtVideoEl.duration > 0) {
      state.duration = wtVideoEl.duration;
      state.progress = (wtVideoEl.currentTime / wtVideoEl.duration) * 100;
    }
  });
  wtVideoEl.addEventListener('ended', () => { if (isWTTrack()) { _emit('ended', state.currentTrack); playNext(true); } });
  wtVideoEl.addEventListener('error', (e) => {
    if (!isWTTrack()) return;
    const err = wtVideoEl?.error;
    console.error('[BFPlayer] WebTorrent video element error:', e, '· MediaError code/message:', err?.code, err?.message);
    handleError('WebTorrent playback error');
  });
  // Extra diagnostic-only listeners (per user request: "dodaj dużo
  // dodatkowych logów") — these fire rarely enough (once per state
  // transition, not per frame/tick) that leaving them on permanently is
  // cheap, and they're exactly the events you'd want in the console when
  // "nothing plays and there's no error."
  wtVideoEl.addEventListener('loadedmetadata', () => { if (isWTTrack()) console.log('[BFPlayer] WebTorrent video: loadedmetadata — duration =', wtVideoEl?.duration); });
  wtVideoEl.addEventListener('loadeddata', () => { if (isWTTrack()) console.log('[BFPlayer] WebTorrent video: loadeddata'); });
  wtVideoEl.addEventListener('canplay', () => { if (isWTTrack()) console.log('[BFPlayer] WebTorrent video: canplay'); });
  wtVideoEl.addEventListener('stalled', () => { if (isWTTrack()) console.warn('[BFPlayer] WebTorrent video: stalled — browser is trying to fetch data but nothing is arriving'); });
  wtVideoEl.addEventListener('suspend', () => { if (isWTTrack()) console.log('[BFPlayer] WebTorrent video: suspend (browser paused fetching, often normal once buffered)'); });
  wtVideoEl.addEventListener('abort', () => { if (isWTTrack()) console.log('[BFPlayer] WebTorrent video: abort (fetch aborted — normal during stopAll()/track switch)'); });
  // Keep our own subtitle-track state in sync when the user picks a
  // subtitle from the browser's OWN native CC menu instead of ours —
  // video.textTracks fires 'change' whenever ANY track's mode changes,
  // regardless of which UI did it.
  wtVideoEl.textTracks.addEventListener('change', () => {
    let found: number | null = null;
    _wtSubTrackEls.forEach((el, idx) => { if (el.track.mode === 'showing') found = idx; });
    wtSubtitleTrackIndex.value = found;
  });
};

// Interrupting a <video> element's in-flight network fetch by clearing its
// src / calling .load() (which stopAll() below does on every track switch)
// makes the browser reject an *internal* resource-fetch promise with
// "AbortError: The fetching process for the media resource was aborted by
// the user agent at the user's request." This is NOT the promise returned by
// our own .play() call (that one is already handled via .catch() at every
// call site) — it's a separate, browser-internal promise, so no try/catch at
// any call site can catch it. It's a well-documented, harmless side effect
// of stopping playback this way, but it still spams the console as a red
// "Uncaught (in promise)" error. We filter exactly this one known-benign
// signature (and only this one), so real errors stay visible.
if (typeof window !== 'undefined' && !(window as any).__bfPlayerAbortFilterInstalled) {
  (window as any).__bfPlayerAbortFilterInstalled = true;
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const isExpectedMediaAbort = reason instanceof DOMException
      && reason.name === 'AbortError'
      && /fetching process for the media resource was aborted/i.test(reason.message || '');
    if (isExpectedMediaAbort) {
      console.debug('[BFPlayer] Ignoring expected media-fetch abort (caused by stopAll() interrupting a track switch):', reason.message);
      event.preventDefault();
    }
  });
}

/**
 * activeSource.id is the magnet URI by convention (see MediaEntryMirror doc
 * comment). File selection, the streaming-vs-full-download-blob decision,
 * and the position-aware download window are all handled inside
 * torrent-lib.js's attachPlayback() now — see webtorrent-pool.ts's header
 * comment for why this used to be duplicated (badly) here.
 */
const loadWebtorrentSource = async (activeSource: MediaEntryMirror, track: MediaTrack): Promise<void> => {
  initWT();
  if (!wtVideoEl) { handleError('WebTorrent video element not found'); return; }
  const title = track.title;
  console.log('[BFPlayer] WebTorrent: loadWebtorrentSource start for', title, '·', activeSource.id.slice(0, 90));
  state.loading = true;
  try {
    await WTPool.initWebtorrent(); // ensures the SW registration attempt has settled before we ask attachPlayback to decide stream-vs-blob
    console.log('[BFPlayer] WebTorrent: init settled, streaming server ready =', WTPool.isStreamingServerReady());

    const snap = await WTPool.getOrAddTorrent(activeSource.id, title);
    if (!sameSource(currentSource.value, activeSource)) {
      console.warn('[BFPlayer] WebTorrent: abandoning load — currentSource changed while waiting for metadata', {
        wasLoading: title, nowPlaying: currentSource.value?.id?.slice(0, 60),
      });
      return;
    }

    WTPool.markActive(snap.infoHash);
    if (wtActiveInfoHash !== snap.infoHash) clearWtSubtitleTracks();
    wtActiveInfoHash = snap.infoHash;

    // Prefer the torrent's own metadata name over the forum post title —
    // post titles are frequently unrelated to what's actually behind the
    // magnet link (e.g. a throwaway reply post used just to host a link).
    // Keep the original post title in track.meta so it isn't lost (e.g. for
    // future UI that wants to show both), but only ever swap it in once we
    // have a real name — never fall back to showing the bare infoHash.
    if (snap.name && snap.name !== snap.infoHash) {
      if (!track.meta) track.meta = {};
      if (track.meta.postTitle === undefined) track.meta.postTitle = title;
      if (track.title !== snap.name) {
        track.title = snap.name;
        console.log('[BFPlayer] WebTorrent: using torrent metadata name as track title:', snap.name);
      }
    }

    // Full file listing up front — the single most useful log line when
    // "metadata arrived but nothing plays": shows immediately whether the
    // torrent even has a video file, whether it's natively playable in this
    // browser, and which one we're about to pick.
    console.log('[BFPlayer] WebTorrent: file list for', snap.name, '—', snap.files.map(f =>
      `[${f.index}] ${f.name} (${f.length}B, video=${f.isVideo}, audio=${f.isAudio}, sub=${f.isSub}, nativePlayable=${f.nativePlayable})`,
    ));

    // Selection mirrors the verified-working standalone PoC (index.html's
    // autoPlayBestVideo): among video files, pick the LARGEST one, not just
    // the first isVideo match. Torrents commonly bundle a small sample/
    // trailer clip alongside the real movie file (e.g. "Sample/sample.mp4");
    // plain .find() picks whichever comes first in the torrent's own file
    // order, which is NOT guaranteed to be the real content — a very
    // plausible explanation for "correct file list shown, but nothing
    // meaningful plays, duration 0:00" on some torrents. We also prefer a
    // nativePlayable file (the browser can actually decode it) over one that
    // isn't, same spirit as the PoC's warn-but-still-let-you-try behavior.
    const videoFiles = snap.files.filter(f => f.isVideo).sort((a, b) => b.length - a.length);
    const audioFiles = snap.files.filter(f => f.isAudio).sort((a, b) => b.length - a.length);
    const nativeVideo = videoFiles.find(f => f.nativePlayable);
    const file = nativeVideo || videoFiles[0] || audioFiles[0]
      || snap.files.reduce((a, b) => (a.length > b.length ? a : b));
    if (!file) { handleError('No playable file found in this torrent'); return; }

    if (videoFiles.length > 1) {
      console.log('[BFPlayer] WebTorrent: multiple video files found, candidates by size:', videoFiles.map(f => `${f.name} (${f.length}B)`));
    }
    if (file.isVideo && !file.nativePlayable) {
      console.warn('[BFPlayer] WebTorrent: selected file', file.name, 'is not natively playable in this browser (e.g. MKV/AVI codec) — expect it to fail or show only sound, if anything.');
    }
    console.log('[BFPlayer] WebTorrent: playing file', file.name, 'size', file.length, 'of', snap.files.length, 'file(s), index', file.index);

    const handle = WTPool.attachPlayback(snap.infoHash, file.index, wtVideoEl, {
      lookaheadSec: 90, behindSec: 15,
    });
    console.log('[BFPlayer] WebTorrent: attachPlayback returned', {
      streaming: handle.streaming, videoSrc: wtVideoEl.src || '(empty)', readyState: wtVideoEl.readyState,
      networkState: wtVideoEl.networkState, paused: wtVideoEl.paused,
    });
    if (!sameSource(currentSource.value, activeSource)) {
      console.warn('[BFPlayer] WebTorrent: abandoning attach — currentSource changed mid-attach');
      handle.detach();
      return;
    }
    wtActiveFileIndex.value = file.index;
    // New source, new torrent — the engine already tore down any extra
    // audio track from the previous torrent (attachPlayback -> detachPlayback
    // -> detachExtraAudio internally), but our own reactive UI state doesn't
    // know that yet, so reset it before possibly restoring a saved choice
    // for THIS torrent below.
    resetWtAudioTrackState();
    const savedAudio = loadWtAudioSettings(snap.infoHash);
    if (savedAudio && snap.files.some(f => f.index === savedAudio.fileIndex && f.isAudio)) {
      selectWebtorrentAudioTrack(savedAudio.fileIndex);
    }
    void prefetchWtSubtitleTracks(snap.infoHash, snap.files);

    // Watchdog: if we're still "loading" and duration is still 0 a few
    // seconds after attaching, something is silently stuck (SW not actually
    // serving bytes, wrong file selected, peers stalled, etc.) — exactly the
    // "no error, no video, 0:00 forever" symptom, so make it loud in the
    // console with everything we know at that moment instead of leaving it a
    // silent mystery.
    const watchdogSource = activeSource;
    setTimeout(() => {
      if (!sameSource(currentSource.value, watchdogSource)) return; // user moved on already
      if (!wtVideoEl || wtVideoEl.duration > 0) return; // it's fine
      console.warn('[BFPlayer] WebTorrent WATCHDOG: 6s after attach, video still has no duration/data. Diagnostic snapshot:', {
        videoSrc: wtVideoEl.src || '(empty)',
        readyState: wtVideoEl.readyState, // 0=NOTHING,1=METADATA,2=CURRENT,3=FUTURE,4=ENOUGH
        networkState: wtVideoEl.networkState, // 0=EMPTY,1=IDLE,2=LOADING,3=NO_SOURCE
        error: wtVideoEl.error ? { code: wtVideoEl.error.code, message: wtVideoEl.error.message } : null,
        paused: wtVideoEl.paused,
        streamingServerReady: WTPool.isStreamingServerReady(),
        torrentSnapshot: WTPool.getTorrent(snap.infoHash),
      });
      console.warn('[BFPlayer] WebTorrent WATCHDOG: likely causes — (1) Service Worker not actually intercepting range requests for this origin/scope (check DevTools → Application → Service Workers, and the Network tab for the streamURL request), (2) selected file has a codec the browser cannot decode even though the container extension looked native, (3) zero peers actually sending data (see numPeers/downloadSpeed above).');
    }, 6000);

    if (handle.streaming) {
      if (wtVideoEl.src) {
        wtVideoEl.play().then(() => {
          console.log('[BFPlayer] WebTorrent: play() promise resolved');
        }).catch((err) => {
          // Most commonly an autoplay-policy rejection (needs a user gesture),
          // not a real failure — the <video controls> play button still works.
          console.warn('[BFPlayer] WebTorrent: autoplay blocked, tap play to start:', err?.name, err?.message || err);
        });
      } else {
        // Full-download blob fallback: attachPlayback() resolves file.blob()
        // and assigns videoEl.src asynchronously, so there's nothing to
        // play() yet on this tick — wait for the element to actually have data.
        console.log('[BFPlayer] WebTorrent: no streaming server, but torrent is fully downloaded — waiting for blob to attach');
        wtVideoEl.addEventListener('loadeddata', () => {
          console.log('[BFPlayer] WebTorrent: blob attached, src =', wtVideoEl?.src);
          wtVideoEl?.play().catch((err) => console.warn('[BFPlayer] WebTorrent: autoplay blocked:', err?.message || err));
        }, { once: true });
      }
    } else {
      console.warn('[BFPlayer] WebTorrent: handle.streaming is false — no Service Worker / streaming server, and torrent is not fully downloaded yet.');
      handleError('Streaming unavailable in this browser/context — wait for the download to finish and try again');
    }
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e);
    console.error('[BFPlayer] WebTorrent load error:', detail, e);
    handleError('Could not load magnet link');
  }
};

/**
 * Manually (re)attach playback to a specific file index within whatever
 * torrent is currently loaded — the equivalent of the standalone PoC's
 * per-file "▶ Play" button. Exposed so the UI (WebtorrentInfoModal's file
 * list) can let the user override the automatic "largest video file"
 * selection, which matters for two real cases: (1) auto-selection guessed
 * wrong (rare, but possible with unusual torrent layouts), and (2) the user
 * just wants to manually sanity-check whether a specific file plays at all
 * while debugging — the exact workflow the user relied on in index.html.
 */
export const playWebtorrentFile = (fileIndex: number): void => {
  if (currentSource.value?.type !== 'webtorrent' || !wtActiveInfoHash || !wtVideoEl) {
    console.warn('[BFPlayer] playWebtorrentFile: no active WebTorrent track to attach to');
    return;
  }
  const infoHash = wtActiveInfoHash;
  const snap = WTPool.getTorrent(infoHash);
  const file = snap?.files.find(f => f.index === fileIndex);
  if (!snap || !file) {
    console.warn('[BFPlayer] playWebtorrentFile: file', fileIndex, 'not found in torrent', infoHash);
    return;
  }
  console.log('[BFPlayer] playWebtorrentFile: manually switching to file', file.name, `[${fileIndex}]`, 'nativePlayable =', file.nativePlayable);
  if (wtVideoEl.src?.startsWith('blob:')) { try { URL.revokeObjectURL(wtVideoEl.src); } catch { /* ignore */ } }
  state.loading = true;
  const handle = WTPool.attachPlayback(infoHash, fileIndex, wtVideoEl, { lookaheadSec: 90, behindSec: 15 });
  console.log('[BFPlayer] playWebtorrentFile: attachPlayback returned', {
    streaming: handle.streaming, videoSrc: wtVideoEl.src || '(empty)', readyState: wtVideoEl.readyState,
  });
  wtActiveFileIndex.value = file.index;
  // attachPlayback() already tore down any extra audio track at the engine
  // level (detachPlayback -> detachExtraAudio) — re-sync our reactive state
  // and, if this torrent had a saved audio-track choice, restore it.
  resetWtAudioTrackState();
  const savedAudio = loadWtAudioSettings(infoHash);
  if (savedAudio && snap.files.some(f => f.index === savedAudio.fileIndex && f.isAudio)) {
    selectWebtorrentAudioTrack(savedAudio.fileIndex);
  }
  if (handle.streaming && wtVideoEl.src) {
    wtVideoEl.play().then(() => console.log('[BFPlayer] playWebtorrentFile: play() resolved'))
      .catch(err => console.warn('[BFPlayer] playWebtorrentFile: autoplay blocked, tap play to start:', err?.name, err?.message || err));
  } else if (!handle.streaming) {
    console.warn('[BFPlayer] playWebtorrentFile: streaming unavailable for this file — no SW / not fully downloaded.');
    handleError('Streaming unavailable in this browser/context — wait for the download to finish and try again');
  }
};

// ─── Suno (custom Cloudflare Worker embed) ─────────────────────────────────
//
// Suno stopped allowing direct .mp3 downloads, so playback no longer goes
// through an <audio> element -- it goes through our OWN worker's <iframe>
// embed page instead, controlled with a small hand-rolled postMessage
// protocol (there's no official SDK for this, unlike YouTube/PeerTube
// above, so this plays the same structural role as ptPlayer/initPT() but
// without a library to lean on).
//
// CONFIRMED: https://calm-darkness-5ea2.dotevo.workers.dev/embed/<id>
export const SUNO_EMBED_BASE = 'https://calm-darkness-5ea2.dotevo.workers.dev/embed';

const sunoSend = (action: string, payload: Record<string, unknown> = {}): void => {
  const iframe = document.getElementById('bf-suno-player-iframe') as HTMLIFrameElement | null;
  iframe?.contentWindow?.postMessage({ action, ...payload }, '*');
};

let sunoListenerAttached = false;
// Which track's iframe has actually had setVolume/attachSunoListener/initial
// play sent to it. This is the fix for: "restore last-played Suno track on
// page load, hit the global play button -> audio genuinely starts (the
// worker answers postMessage commands statelessly, no init needed for that
// part) but status/seekbar never update". Root cause was two-fold:
//   1) attachSunoListener() was only ever called from inside initSuno(),
//      and initSuno() was only called from playTrack()'s 'suno' branch --
//      which never runs on a page-load restore (that path only restores
//      `state`/`currentSource`, it doesn't replay the original playTrack()
//      call). So the window 'message' listener genuinely never existed yet.
//   2) togglePlay()'s "was this restored-but-never-loaded?" guard checked
//      `!document.getElementById('bf-suno-player-iframe')` -- but the
//      iframe is always in the DOM (just CSS-hidden) as soon as
//      currentSource is 'suno', restored or not, so that check was never
//      true and initSuno() never got a second chance to run from there
//      either.
// Fixing (2) needs a real "have we actually initialized playback for this
// exact track" flag instead of a DOM-presence check -- this is it.
let sunoInitializedTrackId: string | null = null;

// Attached once for the whole app lifetime, unconditionally, at module load
// -- not lazily from initSuno() any more (see the note above on why that
// was the bug). It's just a window-level postMessage listener with no
// per-track state of its own, so there's no cost to having it live from the
// very first page load regardless of whether a Suno track ever plays.
const attachSunoListener = (): void => {
  if (sunoListenerAttached) return;
  sunoListenerAttached = true;
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.source !== 'suno-embed') return;
    // Guard against messages arriving from an iframe we've already
    // navigated away from (e.g. a slow 'timeupdate' landing right after the
    // user skipped to a different track) -- same spirit as the
    // mediaGeneration guards on YT/PT below, just keyed off currentSource
    // directly since there's no async init chain here to race against.
    if (currentSource.value?.type !== 'suno') return;

    if (msg.type === 'init' || msg.type === 'ready') {
      // Fires once the embed has actually loaded the track -- gives us
      // duration immediately instead of waiting for the first timeupdate.
      if (msg.duration > 0) state.duration = msg.duration;
    } else if (msg.type === 'play') {
      state.playing = true; state.loading = false;
    } else if (msg.type === 'pause') {
      state.playing = false;
    } else if (msg.type === 'ended') {
      state.playing = false;
      _emit('ended', state.currentTrack);
      playNext(true);
    } else if (msg.type === 'timeupdate') {
      if (msg.duration > 0) {
        state.duration = msg.duration;
        state.progress = (msg.currentTime / msg.duration) * 100;
      }
    } else if (msg.type === 'volumechange') {
      // The embed has its own volume control the user could touch directly
      // inside the iframe -- reflect that back into our own slider instead
      // of silently drifting out of sync with it.
      if (typeof msg.volume === 'number') state.volume = msg.volume;
    }
    // msg.title / msg.imageUrl / msg.thumbnailUrl also arrive on every
    // message per the worker's README, but feed the *card* thumbnail,
    // which is a separate follow-up (per the "miniatury są zawsze te
    // domyślne" bug filed alongside this one), not the player itself.
  });
};
attachSunoListener();

// Same race as initPT() (see its comment above): the iframe is keyed by
// currentSource.id in MediaPlayer.vue, so Vue tears down and re-mounts a
// brand new DOM node on every track switch rather than reusing one -- this
// has to win that race on every single play, not just the first.
const initSuno = (retriesLeft = 15, generation = mediaGeneration): void => {
  if (generation !== mediaGeneration) return;
  if (!currentSource.value || currentSource.value.type !== 'suno') return;

  const iframe = document.getElementById('bf-suno-player-iframe') as HTMLIFrameElement | null;
  if (!iframe) {
    if (retriesLeft > 0) {
      setTimeout(() => initSuno(retriesLeft - 1, generation), 200);
    } else {
      console.warn('[BFPlayer] initSuno: gave up waiting for Suno iframe');
    }
    return;
  }

  sunoInitializedTrackId = currentSource.value.id;
  state.loading = false;
  sunoSend('setVolume', { volume: state.volume });
  // Confirmed: the worker embed does NOT autoplay on load, unlike
  // PeerTube's iframe -- it starts paused, so this actually starts
  // playback. Uses the explicit 'play' action (not 'toggle') now that the
  // updated worker README confirms play/pause/toggle are all separately
  // available -- 'play' is idempotent if something (e.g. ?autoplay=1 on
  // the iframe src) already started it, whereas 'toggle' would have paused
  // it right back out from under us in that case.
  sunoSend('play');
};

const loadYTAPI = (): Promise<void> => {
  if (window.YT) return Promise.resolve();
  return new Promise(resolve => {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.getElementsByTagName('script')[0].parentNode?.insertBefore(tag, document.getElementsByTagName('script')[0]);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
};

const initYT = async (): Promise<void> => {
  const generation = mediaGeneration;
  await loadYTAPI();
  ytPlayer = new window.YT!.Player('bf-yt-player-target', {
    height: '100%', width: '100%',
    playerVars: { autoplay: 1, controls: (CINEMA_HIDE_NATIVE_CONTROLS && state.cinema) ? 0 : 1, disablekb: (CINEMA_HIDE_NATIVE_CONTROLS && state.cinema) ? 1 : 0, modestbranding: 1, rel: 0 },
    events: {
      onReady: (event: { target: YTPlayer }) => {
        // loadYTAPI() and the YT.Player constructor are both async (script
        // load + the iframe's own handshake) -- stopAll() may well have run
        // in the meantime, same reasoning as initPT()'s generation check.
        if (generation !== mediaGeneration) return;
        event.target.setVolume(state.volume * 100);
        if (currentSource.value?.type === 'youtube') event.target.loadVideoById(currentSource.value.id);
      },
      onStateChange: (event: { data: number }) => {
        const YT = window.YT!;
        if (event.data === YT.PlayerState.PLAYING) {
          state.playing = true; state.loading = false;
          state.duration = ytPlayer!.getDuration();
          startYTProgress();
        } else if (event.data === YT.PlayerState.PAUSED) {
          state.playing = false; stopYTProgress();
        } else if (event.data === YT.PlayerState.BUFFERING) {
          state.loading = true;
        } else if (event.data === YT.PlayerState.ENDED) {
          state.playing = false; stopYTProgress();
          _emit('ended', state.currentTrack);
          playNext(true);
        }
      },
      onError: (e: unknown) => { console.error('BFPlayer YT error:', e); handleError('YouTube video unavailable or blocked'); },
    },
  });
};

// stopAll() nulls ptPlayer on every track switch (unlike ytPlayer/audioObj,
// which are created once and reused for the whole session), and the
// peertube iframe is re-keyed by currentSource.id so Vue tears it down and
// re-mounts a fresh one on every new video. That means initPT() has to
// win a real race against the DOM re-render (and the iframe's own
// embed-page + SDK handshake) on *every single play*, not just the first
// one. A single fixed-delay check was enough most of the time, but lost
// the race often enough under extra render pressure (e.g. cinema mode
// mounting/expanding the panel at the same time) to leave ptPlayer stuck
// null — which silently breaks every transport control (play/pause/seek/
// volume all guard on `if (ptPlayer)` and just no-op). Retry briefly
// instead of giving up after one shot.
const initPT = (retriesLeft = 15, generation = mediaGeneration): void => {
  // Superseded (stopAll() ran, e.g. the user closed/switched away) while
  // this retry chain was waiting -- stop, there's nothing left to attach to.
  if (generation !== mediaGeneration) return;
  if (!currentSource.value || currentSource.value.type !== 'peertube') return;

  const iframe = document.getElementById('bf-pt-player-iframe') as HTMLIFrameElement;
  if (!iframe || !window.PeerTubePlayer) {
    if (retriesLeft > 0) {
      setTimeout(() => initPT(retriesLeft - 1, generation), 200);
    } else {
      console.warn('[BFPlayer] initPT: gave up waiting for PT iframe/SDK', { hasIframe: !!iframe, hasSdk: !!window.PeerTubePlayer });
    }
    return;
  }

  const PTConstructor = window.PeerTubePlayer as any;
  if (PTConstructor) {
    ptPlayer = new PTConstructor(iframe);
    // We push our own volume into the embed first (below), but that's an
    // async postMessage — the very next playbackStatusUpdate can still
    // reflect the embed's pre-sync volume. Ignore just that first report so
    // we never clobber state.volume with a stale value; every update after
    // that genuinely reflects the embed (including the user adjusting it
    // inside the iframe), so it's safe to trust from then on.
    let ptVolumeSynced = false;
    ptPlayer!.ready.then(() => {
       // Checked again here, not just before construction: this can resolve
       // a while later (it's the iframe's own postMessage handshake), and
       // stopAll() may well have run in the meantime -- forcing .play() on
       // whatever the user has since closed/paused/switched away from is
       // exactly the "content unpauses itself a moment after leaving" bug
       // this whole generation counter exists to prevent.
       if (generation !== mediaGeneration) return;
       state.loading = false;
       ptPlayer!.setVolume(state.volume);
       ptPlayer!.play(); // Auto-play via API as in legacy
       
       ptPlayer!.addEventListener('playbackStatusUpdate', (stats: any) => {
          if (currentSource.value?.type !== 'peertube') return;
          if (stats && typeof stats.position !== 'undefined' && stats.duration > 0) {
            state.progress = (stats.position / stats.duration) * 100;
            state.duration = stats.duration;
            if (ptVolumeSynced) {
              state.volume = stats.volume;
            } else {
              ptVolumeSynced = true;
            }
            if (stats.playbackState === 'ended') playNext(true);
          }
       });

       ptPlayer!.addEventListener('playbackStatusChange', (playbackState: any) => {
          if (currentSource.value?.type !== 'peertube') return;
          state.playing = (playbackState === 'playing');
       });
    });
  }
};

const startYTProgress = (): void => {
  stopYTProgress();
  progressTimer = setInterval(() => {
    if (ytPlayer?.getCurrentTime && ytPlayer.getDuration() > 0) {
      state.duration = ytPlayer.getDuration();
      state.progress = (ytPlayer.getCurrentTime() / state.duration) * 100;
    }
  }, 500);
};

const stopYTProgress = (): void => { if (progressTimer) clearInterval(progressTimer); };

export const stopAll = (): void => {
  mediaGeneration++;
  if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
  if (audioObj) { audioObj.pause(); audioObj.src = ''; }
  if (ytPlayer?.stopVideo) { try { ytPlayer.stopVideo(); } catch { /* ignore */ } }
  if (ptPlayer?.pause) { try { ptPlayer.pause(); } catch { /* ignore */ } }
  ptPlayer = null; // Important: reset PT player instance
  // No object to null out for Suno (sunoSend() looks the iframe up by ID
  // fresh every call, there's no cached instance like ptPlayer). Explicit
  // 'pause' action now (not 'toggle') per the worker's updated README --
  // safe to call unconditionally regardless of state.playing, unlike
  // toggle would have been.
  if (currentSource.value?.type === 'suno') { try { sunoSend('pause'); } catch { /* ignore */ } }
  sunoInitializedTrackId = null;
  if (wtVideoEl && wtVideoEl.src) {
    console.log('[BFPlayer] stopAll: tearing down WebTorrent video element (had src =', wtVideoEl.src.slice(0, 80), ')');
    wtVideoEl.pause();
    // torrent-lib.js's full-download fallback assigns a blob: URL directly to
    // videoEl.src without tracking/revoking it itself — do that housekeeping
    // here instead of inside the (unmodified) library.
    if (wtVideoEl.src.startsWith('blob:')) { try { URL.revokeObjectURL(wtVideoEl.src); } catch { /* ignore */ } }
    wtVideoEl.removeAttribute('src');
    // NOTE: .load() here interrupts any in-flight fetch for the previous
    // track — expected/necessary, but see the 'unhandledrejection' filter
    // installed in initWT() above for why that produces a (harmless)
    // AbortError in the console.
    wtVideoEl.load();
  }
  if (wtActiveInfoHash) {
    console.log('[BFPlayer] stopAll: pausing download for', wtActiveInfoHash, '(torrent stays in the pool and keeps seeding)');
    // Stop pulling new pieces for whatever we were just watching — but
    // leave it in the pool so it keeps seeding whatever's already down.
    // Wrapped: torrent-lib.js's own streamURL access is now guarded at the
    // source (see _safeStreamURL there), but this call crosses into a
    // third-party library (webtorrent) we don't fully control — if
    // anything else in there ever throws, stopAll() should still finish
    // resetting player state below rather than abort mid-cleanup and leave
    // the UI stuck thinking something is still playing.
    try {
      WTPool.pauseDownload(wtActiveInfoHash);
    } catch (e) {
      console.warn('[BFPlayer] stopAll: pauseDownload threw, continuing cleanup anyway —', e);
    }
    wtActiveInfoHash = null;
    wtActiveFileIndex.value = null;
    resetWtAudioTrackState();
    clearWtSubtitleTracks();
  }
  state.playing = false; 
  state.progress = 0;
  state.duration = 0;
  state.isAutoStarting = false;
  lastLoadedSourceId = null;
};

const scrollToCurrent = (): void => {
  nextTick(() => {
    const anchor = document.getElementById('current-queue-anchor');
    const list = document.querySelector<HTMLElement>('.queue-list');
    if (anchor && list) list.scrollTop = anchor.offsetTop - 40;
  });
};

// ─── Public Playback Methods ────────────────────────────────────────────────

export const playTrack = async (track: MediaTrack, isManual = false, manualIdx = -1, fromHistory = false): Promise<void> => {
  if (!state.enabled) return;
  
  console.log(`[BFPlayer] playTrack init: ${track.author}/${track.permlink}/${track.subId || 'default'}, isManual: ${isManual}, initialSources: ${track.sources.length}`);

  // If not manual (e.g. Micro mode), try to find the "full" track in our registry
  // to make sure we have all available mirrors for priority selection.
  if (!isManual) {
    const registered = visibleTracks.value.find(t => t.author === track.author && t.permlink === track.permlink && t.subId === track.subId);
    if (registered) {
      console.log(`[BFPlayer] Registry lookup successful: found ${registered.sources.length} mirrors.`);
      // Merge metadata from incoming track into registered one if needed
      if (track.title && track.title !== 'Media Content') registered.title = track.title;
      if (track.cover) registered.cover = track.cover;
      track = registered;
    } else {
      console.log('[BFPlayer] Registry lookup failed: track not in visibleTracks.');
    }
  }

  console.log('[BFPlayer] playTrack requested:', { 
    author: track.author, 
    permlink: track.permlink, 
    subId: track.subId,
    sourceCount: track.sources?.length,
    isManual
  });
  
  refreshTrackSources(track);

  if (!track.sources || track.sources.length === 0) {
    console.error('[BFPlayer] FATAL: Track has no sources!', track);
    return;
  }

  // Priority: 
  // 1. Explicitly provided manualIdx
  // 2. Already set manual activeSourceIndex (for Card mode)
  // 3. Automatic selection based on priorities (for Micro/Autoplay)
  if (manualIdx !== -1) {
    track.activeSourceIndex = manualIdx;
    console.log('[BFPlayer] Using provided explicit index:', manualIdx);
  } else if (isManual && typeof track.activeSourceIndex !== 'undefined' && track.activeSourceIndex !== -1) {
    console.log('[BFPlayer] Using already set manual source index:', track.activeSourceIndex);
  } else {
    console.log('[BFPlayer] Finding best source index based on priorities...');
    track.activeSourceIndex = findBestSourceIndex(track.sources);
  }
  
  let activeSource = track.sources[track.activeSourceIndex];
  if (!activeSource && track.sources.length > 0) {
     console.warn('[BFPlayer] Active source at index', track.activeSourceIndex, 'missing, falling back to 0');
     track.activeSourceIndex = 0;
     activeSource = track.sources[0];
  }
  
  if (!activeSource || !activeSource.id || !activeSource.type) {
    console.error('[BFPlayer] FATAL: Active source is invalid!', JSON.stringify(activeSource));
    state.loading = false;
    return;
  }
  
  console.log('[BFPlayer] Selected source:', activeSource.type, activeSource.id);

  // If already loading/playing THIS EXACT SOURCE, ignore
  if (state.loading && lastLoadedSourceId === activeSource.id) {
     console.log('[BFPlayer] Source already loading, ignoring.');
     return;
  }
  
  if (state.playing && lastLoadedSourceId === activeSource.id) {
     console.log('[BFPlayer] Source already playing, ignoring.');
     return;
  }

  // Singleton: stop everything else before starting new track
  console.log('[BFPlayer] Stopping previous playback (if any)...');
  stopAll();
  lastLoadedSourceId = activeSource.id;

  // Save to history if we were playing something AND it's a different track
  if (state.currentTrack && (state.currentTrack.author !== track.author || state.currentTrack.permlink !== track.permlink) && !fromHistory) {
    const historyEntry = { ...state.currentTrack };
    state.history = state.history.filter(t => !(t.author === historyEntry.author && t.permlink === historyEntry.permlink));
    state.history.push(historyEntry);
    if (state.history.length > 20) state.history.shift();
  }

  state.currentTrack = track;
  state.loading = true;
  state.minimized = false;
  scrollToCurrent();
  trackEvent('player:trackChange', 'title', state.currentTrack?.title);
  _emit('trackChange', track);

  if (isManual && manualIdx !== -1) {
    state.queue.splice(manualIdx, 1);
  }

  if (activeSource.type === 'audio') {
    console.log('[BFPlayer] Initializing Audio playback...');
    initAudio();
    try {
      if (!activeSource.src && activeSource.id) { 
        try { activeSource.src = atob(activeSource.id); } catch { activeSource.src = activeSource.id; } 
      }
      console.log('[BFPlayer] Audio SRC:', activeSource.src);
      audioObj!.src = activeSource.src!;
      audioObj!.play().then(() => {
        console.log('[BFPlayer] Audio playback started successfully');
      }).catch(e => {
        console.warn('[BFPlayer] Audio play error, retrying once:', e);
        setTimeout(() => audioObj?.play(), 100);
      });
    } catch (e) { console.error('[BFPlayer] Failed to load audio:', e); handleError('Invalid audio link'); }
  } else if (activeSource.type === 'youtube') {
    console.log('[BFPlayer] Initializing YouTube playback...', activeSource.id);
    if (!ytPlayer) {
      console.log('[BFPlayer] First time YT init...');
      await initYT();
    } else { 
      console.log('[BFPlayer] YT player exists, loading ID...');
      ytPlayer.loadVideoById(activeSource.id); 
      ytPlayer.playVideo(); 
    }
  } else if (activeSource.type === 'peertube') {
    console.log('[BFPlayer] Initializing PeerTube playback...', activeSource.id);
    state.playing = true; state.loading = false;
    state.isAutoStarting = true;
    nextTick(() => { 
      console.log('[BFPlayer] Triggering PT init after nextTick');
      setTimeout(() => initPT(), 1000); 
    });
  } else if (activeSource.type === 'suno') {
    console.log('[BFPlayer] Initializing Suno playback...', activeSource.id);
    state.playing = true; state.loading = true;
    state.isAutoStarting = true;
    nextTick(() => {
      console.log('[BFPlayer] Triggering Suno init after nextTick');
      setTimeout(() => initSuno(), 1000);
    });
  } else if (activeSource.type === 'webtorrent') {
    console.log('[BFPlayer] Initializing WebTorrent playback...', activeSource.id);
    void loadWebtorrentSource(activeSource, track);
  }
};

const lockSkip = (): void => { state.skipLocked = true; };
const unlockSkip = (): void => { state.skipLocked = false; };

const playNext = (isAuto = false): void => {
  console.log('[BFPlayer] playNext called, isAuto:', isAuto, 'PlayMode:', state.playMode);
  if (!isAuto && state.skipLocked) {
    console.log('[BFPlayer] playNext ignored: skip is locked');
    return;
  }
  _emit('next', state.currentTrack);

  // Handle repeat 'repeat-one'
  if (isAuto && state.playMode === 'repeat-one' && state.currentTrack) {
    console.log('[BFPlayer] Repeat One: replaying current track');
    playTrack(state.currentTrack);
    return;
  }

  if (state.queue.length > 0) {
    const next = state.queue.shift()!;
    console.log('[BFPlayer] Playing from user queue:', next.title);
    playTrack(next);
    return;
  } 
  
  if (state.autoQueue.length > 0) {
    let nextTrack: MediaTrack | null = null;
    
    if (state.playMode === 'shuffle') {
      const remaining = state.autoQueue.filter(t => !(t.author === state.currentTrack?.author && t.permlink === state.currentTrack?.permlink && t.subId === state.currentTrack?.subId));
      if (remaining.length > 0) {
        nextTrack = remaining[Math.floor(Math.random() * remaining.length)];
      }
    } else {
      const currentIndex = state.currentTrack ? state.autoQueue.findIndex(t => t.author === state.currentTrack?.author && t.permlink === state.currentTrack?.permlink && t.subId === state.currentTrack?.subId) : -1;
      console.log('[BFPlayer] AutoQueue search, currentIndex:', currentIndex, 'Total:', state.autoQueue.length);
      if (currentIndex !== -1 && currentIndex < state.autoQueue.length - 1) {
        nextTrack = state.autoQueue[currentIndex + 1];
      } else if (state.playMode === 'repeat-all' || (currentIndex === -1 && state.autoQueue.length > 0)) {
        nextTrack = state.autoQueue[0];
      }
    }

    if (nextTrack) {
      console.log('[BFPlayer] Playing next track from AutoQueue:', nextTrack.title);
      playTrack(nextTrack);
      return;
    }
  }

  console.log('[BFPlayer] End of queue, stopping.');
  // End of queue/autoplay
  state.minimized = true;
  state.playing = false;
  if (audioObj) audioObj.pause();
  if (ytPlayer) ytPlayer.pauseVideo();
  if (ptPlayer) ptPlayer.pause();
  if (currentSource.value?.type === 'suno') sunoSend('pause');
};

const playPrev = (): void => {
  _emit('prev', state.currentTrack);
  
  if (state.history.length > 0) {
    // Current track goes back to queue (or just ignore it)
    const prev = state.history.pop()!;
    playTrack(prev, false, -1, true);
  } else if (state.autoQueue.length > 0) {
    const currentIndex = state.currentTrack ? state.autoQueue.findIndex(t => t.author === state.currentTrack?.author && t.permlink === state.currentTrack?.permlink && t.subId === state.currentTrack?.subId) : -1;
    if (currentIndex > 0) {
      playTrack(state.autoQueue[currentIndex - 1]);
    } else if (state.playMode === 'repeat-all') {
      playTrack(state.autoQueue[state.autoQueue.length - 1]);
    }
  }
};

export const togglePlayMode = (): void => {
  const modes: PlayMode[] = ['sequential', 'shuffle', 'repeat-all', 'repeat-one'];
  const currentIdx = modes.indexOf(state.playMode);
  state.playMode = modes[(currentIdx + 1) % modes.length];
  localStorage.setItem('bf-player-mode', state.playMode);
};

export const togglePlay = (): void => {
  if (!state.currentTrack || !currentSource.value) return;

  // If we have a track but no media object initialized (e.g. after refresh,
  // or initPT() losing its race against a panel re-render -- see initPT()),
  // (re-)initialize directly rather than going through playTrack(): that
  // function's "already playing this source, ignoring" dedupe guard would
  // just swallow the click here, since state.playing is already true even
  // though the actual player object never got created.
  if (currentSource.value.type === 'audio' && !audioObj) {
    playTrack(state.currentTrack);
    return;
  }
  if (currentSource.value.type === 'youtube' && !ytPlayer) {
    initYT();
    return;
  }
  if (currentSource.value.type === 'peertube' && !ptPlayer) {
    initPT();
    return;
  }
  if (currentSource.value.type === 'webtorrent' && !wtVideoEl) {
    // Same "restored from localStorage but never actually loaded" case as
    // audio/youtube/peertube above — without this branch, wtVideoEl stays
    // null forever and every click on play silently no-ops (and any
    // subsequent manual file-select via playWebtorrentFile() also no-ops,
    // since it requires wtVideoEl/wtActiveInfoHash to already be set).
    playTrack(state.currentTrack);
    return;
  }
  // Real "restored on page load but never actually initialized" guard --
  // the iframe itself is always in the DOM as soon as currentSource is
  // 'suno' (just CSS-hidden), restored-from-boot or not, so checking for
  // its presence (like the wtVideoEl/ptPlayer checks above do for their
  // own objects) never actually caught this case. sunoInitializedTrackId
  // is set by initSuno() itself, per track, so this only fires exactly
  // once per genuinely-uninitialized track -- which was the whole bug:
  // clicking play on a boot-restored Suno track sent commands to an iframe
  // nobody had ever called attachSunoListener()/setVolume() for, so audio
  // would actually start (the worker answers postMessage regardless) but
  // status/seekbar never updated because nothing was listening yet.
  if (currentSource.value.type === 'suno' && sunoInitializedTrackId !== currentSource.value.id) {
    initSuno();
    return;
  }

  if (currentSource.value.type === 'youtube' && ytPlayer?.getPlayerState) {
    state.playing = ytPlayer.getPlayerState() === window.YT!.PlayerState.PLAYING;
  }

  if (state.playing) {
    if (currentSource.value.type === 'audio' && audioObj) audioObj.pause();
    if (currentSource.value.type === 'youtube' && ytPlayer) ytPlayer.pauseVideo();
    if (currentSource.value.type === 'peertube' && ptPlayer) ptPlayer.pause();
    if (currentSource.value.type === 'webtorrent' && wtVideoEl) wtVideoEl.pause();
    if (currentSource.value.type === 'suno') sunoSend('pause');
  } else {
    if (currentSource.value.type === 'audio' && audioObj) audioObj.play();
    if (currentSource.value.type === 'youtube' && ytPlayer) ytPlayer.playVideo();
    if (currentSource.value.type === 'peertube' && ptPlayer) ptPlayer.play();
    if (currentSource.value.type === 'webtorrent' && wtVideoEl) {
      wtVideoEl.play().catch((err) => console.warn('[BFPlayer] WebTorrent: play() rejected:', err?.message || err));
    }
    if (currentSource.value.type === 'suno') sunoSend('play');
  }
};

const seek = (pct: number): void => {
  const time = (pct / 100) * state.duration;
  if (currentSource.value?.type === 'youtube' && ytPlayer) ytPlayer.seekTo(time);
  else if (currentSource.value?.type === 'audio' && audioObj) audioObj.currentTime = time;
  else if (currentSource.value?.type === 'peertube' && ptPlayer) ptPlayer.seek(time);
  else if (currentSource.value?.type === 'webtorrent' && wtVideoEl) wtVideoEl.currentTime = time;
  // Updated worker README confirms {time: seconds} is also supported (not
  // just {progress}) -- use that instead now, consistent with every other
  // source type in this function already working in absolute seconds.
  else if (currentSource.value?.type === 'suno') sunoSend('seek', { time });
};

export const addToQueue = (track: MediaTrack, position: 'start' | 'end' = 'end'): void => {
  if (position === 'start') state.queue.unshift(track);
  else state.queue.push(track);
};
const setAutoQueue = (tracks: MediaTrack[]): void => { state.autoQueue = tracks; };

// ─── DOM-aware Auto-queue ───────────────────────────────────────────────────
//
// Views emit a CustomEvent 'bf:scan-view' instead of passing data.
// The player scans the DOM for <forum-media> elements and builds the
// autoQueue. It can also modify these elements (e.g., add 'is-playing' class).
//
// <forum-media> attributes:
//   data-type     — 'audio' | 'youtube' | 'peertube'
//   data-id       — media identifier
//   data-src      | direct audio URL (optional)
//   data-cover    | thumbnail URL (optional)
//   data-host     | PeerTube host (optional)
//   data-title    | display title
//   data-author   | identity field (opaque to player core)
//   data-permlink | identity field (opaque to player core)
//   data-pending  | requires resolution ('true'/'false', optional)

// ─── Track Registration (Vue-centric) ──────────────────────────────────────

const visibleTracks = ref<MediaTrack[]>([]);

/**
 * Registers a track as currently visible/available in the view.
 * Components call this onMounted. Now groups by post (author/permlink).
 */
export const registerTrack = (incoming: any): void => {
  const author = incoming.author;
  const permlink = incoming.permlink;
  const subId = incoming.subId;
  if (!author || !permlink) return;

  const incomingSources: MediaEntryMirror[] = incoming.sources || [];
  // Fallback for flat registration objects
  if (incomingSources.length === 0 && incoming.id && incoming.type) {
    incomingSources.push({
        type: incoming.type,
        id: incoming.id,
        src: incoming.src,
        host: incoming.host,
        thumb: incoming.thumb,
        group: incoming.group,
        typeIndex: incoming.typeIndex
    });
  }

  if (incomingSources.length === 0) {
    console.warn('[BFPlayer] Skipping registration of track with no sources:', author, permlink, subId);
    return;
  }

  console.log(`[BFPlayer] registerTrack call: ${author}/${permlink}/${subId || 'default'} with ${incomingSources.length} sources`);

  const existingIdx = visibleTracks.value.findIndex(t => t.author === author && t.permlink === permlink && t.subId === subId);
  
  if (existingIdx === -1) {
    const track: MediaTrack = {
      author, permlink, subId,
      title: incoming.title || 'Media Content',
      cover: incoming.cover,
      pending: incoming.pending,
      sources: incomingSources.map(s => ({ ...s })),
      activeSourceIndex: 0
    };
    visibleTracks.value.push(track);
  } else {
    const track = visibleTracks.value[existingIdx];
    // Merge sources
    incomingSources.forEach(newS => {
       const existingS = track.sources.find(s => s.id === newS.id && s.type === newS.type);
       if (!existingS) {
         track.sources.push({ ...newS });
       } else {
         // Update existing source data if new data is provided
         if (newS.thumb) existingS.thumb = newS.thumb;
         if (newS.src) existingS.src = newS.src;
         if (newS.host) existingS.host = newS.host;
       }
    });
    
    // Update metadata
    if (incoming.cover && !track.cover) {
       track.cover = incoming.cover;
    }
    if (incoming.title && incoming.title !== 'Media Content') track.title = incoming.title;
  }
  
  state.autoQueue = [...visibleTracks.value];

  // Sync with current track if it's the same track
  if (state.currentTrack && state.currentTrack.author === author && state.currentTrack.permlink === permlink && state.currentTrack.subId === subId) {
    console.log('[BFPlayer] Syncing with ACTIVE track');
    const track = visibleTracks.value[existingIdx === -1 ? visibleTracks.value.length - 1 : existingIdx];

    track.sources.forEach(s => {
      const existing = state.currentTrack!.sources.find(os => os.id === s.id && os.type === s.type);
      if (!existing) {
        state.currentTrack!.sources.push({ ...s });
      } else {
        // Update existing source properties if they are now available (like thumb)
        if (s.thumb && !existing.thumb) existing.thumb = s.thumb;
        if (s.src && !existing.src) existing.src = s.src;
      }
    });

    if (track.cover && !state.currentTrack.cover) {
      state.currentTrack.cover = track.cover;
    }
    if (track.title && track.title !== 'Media Content') state.currentTrack.title = track.title;
  }
  };
/**
 * Unregisters a track source.
 */
export const unregisterTrack = (trackId: string, type: string, author?: string, permlink?: string, subId?: string): void => {
  if (author && permlink) {
    const track = visibleTracks.value.find(t => t.author === author && t.permlink === permlink && t.subId === subId);
    if (track) {
      track.sources = track.sources.filter(s => !(s.id === trackId && s.type === type));
      if (track.sources.length === 0) {
        visibleTracks.value = visibleTracks.value.filter(t => !(t.author === author && t.permlink === permlink && t.subId === subId));
      }
    }
  } else {
    // Fallback: search all tracks for this source
    visibleTracks.value.forEach(track => {
      track.sources = track.sources.filter(s => !(s.id === trackId && s.type === type));
    });
    visibleTracks.value = visibleTracks.value.filter(t => t.sources.length > 0);
  }
  state.autoQueue = [...visibleTracks.value];
};

/**
 * Clears all registered tracks. Useful for page transitions if needed.
 */
const clearTracks = (): void => {
  visibleTracks.value = [];
  state.autoQueue = [];
};

// Updates <forum-media> attributes/classes based on player state.
// Called on every currentTrack change.
const _syncForumMediaDOM = (): void => {
  document.querySelectorAll<HTMLElement>('forum-media').forEach(el => {
    const author   = el.getAttribute('data-author');
    const permlink = el.getAttribute('data-permlink');
    const isActive =
      state.currentTrack?.author === author &&
      state.currentTrack?.permlink === permlink;
    el.classList.toggle('is-playing', isActive && state.playing);
    el.classList.toggle('is-active',  isActive);
  });
};

const scanView = (_container?: Element | null): void => {
  // scanView is now mostly a no-op or a bridge for non-Vue content.
  // For Vue content, registration is automatic.
  console.log('[Player] scanView called (registration is now component-based)');
};

// Export for backward compatibility or manual use from outside Vue.
export const dispatchScanView = (container?: Element | null): void => {
  window.dispatchEvent(new CustomEvent('bf:scan-view', {
    detail: { container: container ?? null },
  }));
};

// Keep the old name as an alias — simplifies migration of places that
// haven't been rewritten yet.
export const dispatchPageChange = dispatchScanView;

if (typeof window !== 'undefined') {
  window.addEventListener('bf:scan-view', (e: Event) => {
    const container = (e as CustomEvent<{ container: Element | null }>).detail?.container;
    scanView(container);
  });
}

// Sync DOM on every currentTrack and playing state change.
watch(
  () => [state.currentTrack?.author, state.currentTrack?.permlink, state.currentTrack?.subId, state.playing] as const,
  () => { nextTick(_syncForumMediaDOM); },
);

const toggleExperimental = (val: boolean): void => {
  state.experimental = val;
  localStorage.setItem('bf-player-experimental', String(val));
  window.__bfPlayerEnabled = val;
};

// ─── Playlist Methods ───────────────────────────────────────────────────────

const createPlaylist = (name: string, color = '#1a9b78'): Playlist | null => {
  if (!name?.trim()) return null;
  const pl: Playlist = {
    id: 'pl_' + Date.now(),
    name: name.trim(), color,
    createdAt: Date.now(), updatedAt: Date.now(),
    tracks: [],
  };
  playlistState.playlists.unshift(pl);
  _savePlaylists();
  return pl;
};

const deletePlaylist = (id: string): void => {
  playlistState.playlists = playlistState.playlists.filter(p => p.id !== id);
  _savePlaylists();
};

const renamePlaylist = (id: string, newName: string): void => {
  const pl = playlistState.playlists.find(p => p.id === id);
  if (pl && newName?.trim()) { pl.name = newName.trim(); pl.updatedAt = Date.now(); _savePlaylists(); }
};

const addTrackToPlaylist = (playlistId: string, track: MediaTrack): boolean => {
  const pl = playlistState.playlists.find(p => p.id === playlistId);
  if (!pl) return false;
  if (pl.tracks.some(t => t.author === track.author && t.permlink === track.permlink && t.subId === track.subId)) return false;
  pl.tracks.push({ ...track, addedAt: Date.now() });
  pl.updatedAt = Date.now();
  _savePlaylists();
  return true;
};

const removeTrackFromPlaylist = (playlistId: string, author: string, permlink: string, subId?: string): void => {
  const pl = playlistState.playlists.find(p => p.id === playlistId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter(t => !(t.author === author && t.permlink === permlink && t.subId === subId));
  pl.updatedAt = Date.now();
  _savePlaylists();
};

const playPlaylist = (playlistId: string, startIndex = 0): void => {
  const pl = playlistState.playlists.find(p => p.id === playlistId);
  if (!pl || !pl.tracks.length) return;
  state.autoQueue = [...pl.tracks];
  if (state.autoQueue[startIndex]) playTrack(state.autoQueue[startIndex]);
};

// ─── Watchers ───────────────────────────────────────────────────────────────

watch(() => state.volume, v => {
  if (audioObj) audioObj.volume = v;
  if (ytPlayer) ytPlayer.setVolume(v * 100);
  if (ptPlayer) ptPlayer.setVolume(v);
  if (wtVideoEl) wtVideoEl.volume = v;
  if (currentSource.value?.type === 'suno') sunoSend('setVolume', { volume: v });
  localStorage.setItem('bf-player-volume', String(v));
  _emit('volumeChange', v);
});

watch(() => state.playing, isPlaying => {
  _emit(isPlaying ? 'play' : 'pause', state.currentTrack);
});

watch(() => state.queue, q => { localStorage.setItem('bf-player-queue', JSON.stringify(q)); }, { deep: true });
watch(() => state.currentTrack, t => { localStorage.setItem('bf-player-current', JSON.stringify(t)); }, { deep: true });
watch(() => state.history, h => { localStorage.setItem('bf-player-history', JSON.stringify(h)); }, { deep: true });
watch(() => state.expandedTab, tab => { if (tab === 'queue') scrollToCurrent(); });

// ─── Public API ─────────────────────────────────────────────────────────────

export const BFPlayer: BFPlayerAPI = {
  state,
  playlistState,
  playTrack, playNext, playPrev, togglePlay, seek,
  addToQueue, setAutoQueue, scanView,
  registerTrack, unregisterTrack, clearTracks,
  setClient,
  initResize, initTabsResize, scrollToCurrent, toggleExperimental,
  lockSkip, unlockSkip,
  togglePlayMode,
  on, off, registerPlugin,
  registerTrackAction, getTrackActions,
  registerExpandedTab, getExpandedTabs,
  registerRailItem, getRailItems,
  registerPlayerButton, unregisterPlayerButton, getPlayerButtons,
  registerPlayerWidget, unregisterPlayerWidget, getPlayerWidgets,
  showCinemaControls,
  createPlaylist, deletePlaylist, renamePlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist, playPlaylist,
  setSeedingEnabled, setMaxSeedStorageBytes, getMaxSeedStorageBytes,
  getWebtorrentStats, getWebtorrentManifest, getWebtorrentStorageEstimate, clearWebtorrentData,
  playWebtorrentFile,
  // Namespaced surface, requested explicitly so protocol-specific plugin
  // code reads as `player.webtorrent.foo(...)` instead of flat
  // `player.foo(...)` — the player also supports YouTube/PeerTube/plain
  // audio, which have nothing to do with any of this. Same functions as the
  // flat properties just above — kept there too, unremoved, so nothing
  // already calling the old flat names breaks.
  webtorrent: {
    setSeedingEnabled, setMaxSeedStorageBytes, getMaxSeedStorageBytes,
    getWebtorrentStats, getWebtorrentManifest, getWebtorrentStorageEstimate, clearWebtorrentData,
    playWebtorrentFile,
    registerWireExtension, registerPeerAction, getPeerActions,
  },
};