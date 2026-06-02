/**
 * BlurtForum MediaPlayer Library
 * Handles audio/video playback, queuing, playlists, event emitter and plugin API.
 */
import { reactive, watch, nextTick } from 'vue';
import type { MediaTrack } from '../types';
import { Parser } from './parser';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PlayerState {
  enabled: boolean;
  active: boolean;
  playing: boolean;
  loading: boolean;
  minimized: boolean;
  expanded: boolean;
  expandedHeight: number;
  expandedTab: 'video' | 'queue' | 'playlists';
  currentTrack: MediaTrack | null;
  queue: MediaTrack[];
  autoQueue: MediaTrack[];
  history: MediaTrack[];
  progress: number;
  duration: number;
  volume: number;
  experimental: boolean;
  isAutoStarting: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  tracks: (MediaTrack & { addedAt?: number })[];
}

export interface PlaylistState {
  playlists: Playlist[];
}

export type PlayerEvent =
  | 'trackChange' | 'play' | 'pause' | 'next' | 'prev'
  | 'ended' | 'volumeChange' | 'error';

export interface PlayerPlugin {
  name: string;
  install?: (player: BFPlayerAPI) => void;
  onTrackChange?: (track: MediaTrack) => void;
}

export interface BFPlayerAPI {
  state: PlayerState;
  playlistState: PlaylistState;
  playTrack: (track: MediaTrack, isManual?: boolean, manualIdx?: number, fromHistory?: boolean) => Promise<void>;
  playNext: () => void;
  playPrev: () => void;
  togglePlay: () => void;
  seek: (pct: number) => void;
  addToQueue: (track: MediaTrack) => void;
  setAutoQueue: (tracks: MediaTrack[]) => void;
  initResize: (e: MouseEvent | TouchEvent) => void;
  scrollToCurrent: () => void;
  toggleExperimental: (val: boolean) => void;
  on: (event: PlayerEvent, fn: (data: unknown) => void) => void;
  off: (event: PlayerEvent, fn: (data: unknown) => void) => void;
  registerPlugin: (plugin: PlayerPlugin) => void;
  createPlaylist: (name: string, color?: string) => Playlist | null;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, newName: string) => void;
  addTrackToPlaylist: (playlistId: string, track: MediaTrack) => boolean;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  playPlaylist: (playlistId: string, startIndex?: number) => void;
}

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

const state = reactive<PlayerState>({
  enabled: true,
  active: true,
  playing: false,
  loading: false,
  minimized: true,
  expanded: false,
  expandedHeight: 400,
  expandedTab: 'video',
  currentTrack: null,
  queue: [],
  autoQueue: [],
  history: [],
  progress: 0,
  duration: 0,
  volume: parseFloat(localStorage.getItem('bf-player-volume') || '0.7'),
  experimental: localStorage.getItem('bf-player-experimental') === 'true',
  isAutoStarting: false
});

const playlistState = reactive<PlaylistState>({ playlists: [] });

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

// ─── Internals ─────────────────────────────────────────────────────────────

let audioObj: HTMLAudioElement | null = null;
let ytPlayer: YTPlayer | null = null;
let ptPlayer: PTPlayer | null = null;
let progressTimer: ReturnType<typeof setInterval> | null = null;
let errorTimer: ReturnType<typeof setTimeout> | null = null;

const loadSavedQueue = (): void => {
  try {
    const saved = localStorage.getItem('bf-player-queue');
    const savedCurrent = localStorage.getItem('bf-player-current');
    const savedHistory = localStorage.getItem('bf-player-history');
    if (saved) state.queue = JSON.parse(saved);
    if (savedHistory) state.history = JSON.parse(savedHistory);
    const restoredTrack = savedCurrent ? JSON.parse(savedCurrent) : null;
    if (restoredTrack) {
      state.currentTrack = restoredTrack;
      state.minimized = false;
    } else if (state.queue.length > 0) {
      state.minimized = false;
      state.currentTrack = state.queue[0];
    } else {
      state.minimized = true;
    }
    state.playing = false; // Force paused on load
  } catch (e) { console.warn('Failed to load queue:', e); }
};
loadSavedQueue();

const _loadPlaylists = (): void => {
  try {
    const raw = localStorage.getItem('bf-player-playlists');
    if (raw) playlistState.playlists = JSON.parse(raw);
  } catch (e) { console.warn('BFPlayer: failed to load playlists:', e); }
};
_loadPlaylists();

const _savePlaylists = (): void => {
  localStorage.setItem('bf-player-playlists', JSON.stringify(playlistState.playlists));
};

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
    if (state.currentTrack === trackWithError) playNext();
    errorTimer = null;
  }, 5000);
};

export const initResize = (e: MouseEvent | TouchEvent): void => {
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
  const isAudioTrack = () => state.currentTrack?.type === 'audio';
  audioObj.addEventListener('play', () => { if (isAudioTrack()) { state.playing = true; state.loading = false; } });
  audioObj.addEventListener('pause', () => { if (isAudioTrack()) state.playing = false; });
  audioObj.addEventListener('waiting', () => { if (isAudioTrack()) state.loading = true; });
  audioObj.addEventListener('playing', () => { if (isAudioTrack()) { state.loading = false; if (audioObj && audioObj.duration) state.duration = audioObj.duration; } });
  audioObj.addEventListener('timeupdate', () => {
    if (audioObj && isAudioTrack() && audioObj.duration > 0) {
      if (!state.duration) state.duration = audioObj.duration;
      state.progress = (audioObj.currentTime / audioObj.duration) * 100;
    }
  });
  audioObj.addEventListener('ended', () => { if (isAudioTrack()) { _emit('ended', state.currentTrack); playNext(); } });
  audioObj.addEventListener('error', (e) => {
    if (isAudioTrack()) { console.error('BFPlayer Audio error:', e); handleError('Audio file error or broken link'); }
  });
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
  await loadYTAPI();
  ytPlayer = new window.YT!.Player('bf-yt-player-target', {
    height: '100%', width: '100%',
    playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0 },
    events: {
      onReady: (event: { target: YTPlayer }) => {
        event.target.setVolume(state.volume * 100);
        if (state.currentTrack?.type === 'youtube') event.target.loadVideoById(state.currentTrack.id);
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
          playNext();
        }
      },
      onError: (e: unknown) => { console.error('BFPlayer YT error:', e); handleError('YouTube video unavailable or blocked'); },
    },
  });
};

const initPT = (): void => {
  const iframe = document.getElementById('bf-pt-player-iframe') as HTMLIFrameElement;
  if (!iframe || !window.PeerTubePlayer || !state.currentTrack || state.currentTrack.type !== 'peertube') return;

  const PTConstructor = window.PeerTubePlayer as any;
  if (PTConstructor) {
    ptPlayer = new PTConstructor(iframe);
    ptPlayer!.ready.then(() => {
       state.loading = false;
       ptPlayer!.setVolume(state.volume);
       ptPlayer!.play(); // Auto-play via API as in legacy
       
       ptPlayer!.addEventListener('playbackStatusUpdate', (stats: any) => {
          if (state.currentTrack?.type !== 'peertube') return;
          if (stats && typeof stats.position !== 'undefined') {
            state.progress = (stats.position / stats.duration) * 100;
            state.duration = stats.duration;
            if (stats.playbackState === 'ended') playNext();
          }
       });

       ptPlayer!.addEventListener('playbackStatusChange', (playbackState: any) => {
          if (state.currentTrack?.type !== 'peertube') return;
          state.playing = (playbackState === 'playing');
       });
    });
  }
};

const startYTProgress = (): void => {
  stopYTProgress();
  progressTimer = setInterval(() => {
    if (ytPlayer?.getCurrentTime) {
      state.progress = (ytPlayer.getCurrentTime() / ytPlayer.getDuration()) * 100;
    }
  }, 500);
};

const stopYTProgress = (): void => { if (progressTimer) clearInterval(progressTimer); };

const stopAll = (): void => {
  if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
  if (audioObj) { audioObj.pause(); audioObj.src = ''; }
  if (ytPlayer?.stopVideo) { try { ytPlayer.stopVideo(); } catch { /* ignore */ } }
  if (ptPlayer?.pause) { try { ptPlayer.pause(); } catch { /* ignore */ } }
  ptPlayer = null; // Important: reset PT player instance
  state.playing = false; 
  state.progress = 0;
  state.isAutoStarting = false;
};

export const scrollToCurrent = (): void => {
  nextTick(() => {
    const anchor = document.getElementById('current-queue-anchor');
    const list = document.querySelector<HTMLElement>('.queue-list');
    if (anchor && list) list.scrollTop = anchor.offsetTop - 40;
  });
};

// ─── Public Playback Methods ────────────────────────────────────────────────

export const playTrack = async (track: MediaTrack, isManual = false, manualIdx = -1, fromHistory = false): Promise<void> => {
  if (!state.enabled) return;
  if (track.type === 'audio' && !track.src && track.id && track.id.length < 30) {
    const originalId = track.id;
    const resolved = await Parser.resolveMedia(track);
    if (resolved?.src) {
      track = resolved;
      const aqIdx = state.autoQueue.findIndex(t => t.id === originalId);
      if (aqIdx !== -1) Object.assign(state.autoQueue[aqIdx], resolved);
    } else { handleError('Could not resolve audio source'); return; }
  }

  // Save to history if we were playing something AND it's a different track
  if (state.currentTrack && state.currentTrack.id !== track.id && !fromHistory) {
    const historyEntry = { ...state.currentTrack };
    state.history = state.history.filter(t => t.id !== historyEntry.id);
    state.history.push(historyEntry); // Add to end (bottom of history section)                                                                                                                                                                                                                                                                                                                                                │
    if (state.history.length > 20) state.history.shift();
  }

  stopAll();
  state.currentTrack = track;
  state.loading = true;
  state.minimized = false;
  scrollToCurrent();
  _emit('trackChange', track);

  if (isManual && manualIdx !== -1) state.queue.splice(manualIdx, 1);

  if (track.type === 'audio') {
    initAudio();
    try {
      if (!track.src && track.id) { try { track.src = atob(track.id); } catch { track.src = track.id; } }
      audioObj!.src = track.src!;
      audioObj!.play().catch(e => console.warn('Play error:', e));
    } catch (e) { console.error('Failed to load audio:', e); handleError('Invalid audio link'); }
  } else if (track.type === 'youtube') {
    if (!ytPlayer) await initYT();
    else { ytPlayer.loadVideoById(track.id); ytPlayer.playVideo(); }
  } else if (track.type === 'peertube') {
    state.playing = true; state.loading = false;
    state.isAutoStarting = true;
    nextTick(() => { setTimeout(() => initPT(), 1000); });
  }
};

export const playNext = (): void => {
  _emit('next', state.currentTrack);
  if (state.queue.length > 0) {
    playTrack(state.queue.shift()!);
  } else if (state.autoQueue.length > 0) {
    if (state.currentTrack && state.autoQueue[0].id === state.currentTrack.id) {
      const current = state.autoQueue.shift()!;
      state.autoQueue.push(current);
    }
    playTrack(state.autoQueue[0]);
  } else {
    state.minimized = true; state.currentTrack = null; stopAll();
  }
};

export const playPrev = (): void => {
  _emit('prev', state.currentTrack);
  if (state.history.length > 0) {
    playTrack(state.history.pop()!, false, -1, true);
  } else if (state.autoQueue.length > 0) {
    const last = state.autoQueue.pop()!;
    state.autoQueue.unshift(last);
    playTrack(state.autoQueue[0]);
  }
};

export const togglePlay = (): void => {
  if (!state.currentTrack) return;

  // If we have a track but no media object initialized (e.g. after refresh),
  // start playback properly instead of just toggling the state.
  if (state.currentTrack.type === 'audio' && !audioObj) {
    playTrack(state.currentTrack);
    return;
  }
  if (state.currentTrack.type === 'youtube' && !ytPlayer) {
    playTrack(state.currentTrack);
    return;
  }
  if (state.currentTrack.type === 'peertube' && !ptPlayer) {
    playTrack(state.currentTrack);
    return;
  }

  if (state.currentTrack.type === 'youtube' && ytPlayer?.getPlayerState) {
    state.playing = ytPlayer.getPlayerState() === window.YT!.PlayerState.PLAYING;
  }

  if (state.playing) {
    if (state.currentTrack.type === 'audio' && audioObj) audioObj.pause();
    if (state.currentTrack.type === 'youtube' && ytPlayer) ytPlayer.pauseVideo();
    if (state.currentTrack.type === 'peertube' && ptPlayer) ptPlayer.pause();
  } else {
    if (state.currentTrack.type === 'audio' && audioObj) audioObj.play();
    if (state.currentTrack.type === 'youtube' && ytPlayer) ytPlayer.playVideo();
    if (state.currentTrack.type === 'peertube' && ptPlayer) ptPlayer.play();
  }
};

export const seek = (pct: number): void => {
  const time = (pct / 100) * state.duration;
  if (state.currentTrack?.type === 'youtube' && ytPlayer) ytPlayer.seekTo(time);
  else if (state.currentTrack?.type === 'audio' && audioObj) audioObj.currentTime = time;
  else if (state.currentTrack?.type === 'peertube' && ptPlayer) ptPlayer.seek(time);
};

export const addToQueue = (track: MediaTrack): void => { state.queue.push(track); };
export const setAutoQueue = (tracks: MediaTrack[]): void => { state.autoQueue = tracks; };

export const toggleExperimental = (val: boolean): void => {
  state.experimental = val;
  localStorage.setItem('bf-player-experimental', String(val));
  window.__bfPlayerEnabled = val;
};

// ─── Playlist Methods ───────────────────────────────────────────────────────

export const createPlaylist = (name: string, color = '#1a9b78'): Playlist | null => {
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

export const deletePlaylist = (id: string): void => {
  playlistState.playlists = playlistState.playlists.filter(p => p.id !== id);
  _savePlaylists();
};

export const renamePlaylist = (id: string, newName: string): void => {
  const pl = playlistState.playlists.find(p => p.id === id);
  if (pl && newName?.trim()) { pl.name = newName.trim(); pl.updatedAt = Date.now(); _savePlaylists(); }
};

export const addTrackToPlaylist = (playlistId: string, track: MediaTrack): boolean => {
  const pl = playlistState.playlists.find(p => p.id === playlistId);
  if (!pl) return false;
  if (pl.tracks.some(t => t.id === track.id)) return false;
  pl.tracks.push({ ...track, addedAt: Date.now() });
  pl.updatedAt = Date.now();
  _savePlaylists();
  return true;
};

export const removeTrackFromPlaylist = (playlistId: string, trackId: string): void => {
  const pl = playlistState.playlists.find(p => p.id === playlistId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter(t => t.id !== trackId);
  pl.updatedAt = Date.now();
  _savePlaylists();
};

export const playPlaylist = (playlistId: string, startIndex = 0): void => {
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
  addToQueue, setAutoQueue,
  initResize, scrollToCurrent, toggleExperimental,
  on, off, registerPlugin,
  createPlaylist, deletePlaylist, renamePlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist, playPlaylist,
};