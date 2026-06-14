/**
 * BlurtForum MediaPlayer Library
 * Handles audio/video playback, queuing, playlists, event emitter and plugin API.
 */
import { reactive, watch, nextTick, ref, computed } from 'vue';
import { Parser } from './parser';
import type { MediaTrack, MediaEntryMirror, PlayerState, Playlist, PlaylistState, PlayerEvent, PlayerPlugin, BFPlayerAPI, PlayMode } from '../types';

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
  expandedTab: 'video',
  currentTrack: null,
  queue: [],
  autoQueue: [],
  history: [],
  progress: 0,
  duration: 0,
  volume: parseFloat(localStorage.getItem('bf-player-volume') || '0.7'),
  experimental: localStorage.getItem('bf-player-experimental') === 'true',
  isAutoStarting: false,
  playMode: (localStorage.getItem('bf-player-mode') as PlayMode) || 'sequential'
});

const defaultPriorities = ['audio', 'peertube', 'youtube'];
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
let client: any = null;
let lastLoadedSourceId: string | null = null;

export const setClient = (c: any) => { client = client || c; };

const refreshTrackSources = async (track: MediaTrack): Promise<void> => {
  if (!client) return;
  // EXPERIMENT: Disable background parsing to see if it fixes Suno duplicates
  console.log(`[BFPlayer] refreshTrackSources called for ${track.author}/${track.permlink} - PARSING DISABLED`);
  /*
  try {
    const post = await client.condenser.getContent(track.author, track.permlink);
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
    if (state.currentTrack === trackWithError) playNext(true);
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

const initPT = (): void => {
  const iframe = document.getElementById('bf-pt-player-iframe') as HTMLIFrameElement;
  if (!iframe || !window.PeerTubePlayer || !currentSource.value || currentSource.value.type !== 'peertube') return;

  const PTConstructor = window.PeerTubePlayer as any;
  if (PTConstructor) {
    ptPlayer = new PTConstructor(iframe);
    ptPlayer!.ready.then(() => {
       state.loading = false;
       ptPlayer!.setVolume(state.volume);
       ptPlayer!.play(); // Auto-play via API as in legacy
       
       ptPlayer!.addEventListener('playbackStatusUpdate', (stats: any) => {
          if (currentSource.value?.type !== 'peertube') return;
          if (stats && typeof stats.position !== 'undefined' && stats.duration > 0) {
            state.progress = (stats.position / stats.duration) * 100;
            state.duration = stats.duration;
            state.volume = stats.volume;
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

const stopAll = (): void => {
  if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
  if (audioObj) { audioObj.pause(); audioObj.src = ''; }
  if (ytPlayer?.stopVideo) { try { ytPlayer.stopVideo(); } catch { /* ignore */ } }
  if (ptPlayer?.pause) { try { ptPlayer.pause(); } catch { /* ignore */ } }
  ptPlayer = null; // Important: reset PT player instance
  state.playing = false; 
  state.progress = 0;
  state.duration = 0;
  state.isAutoStarting = false;
  lastLoadedSourceId = null;
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
  
  console.log(`[BFPlayer] playTrack init: ${track.author}/${track.permlink}, isManual: ${isManual}, initialSources: ${track.sources.length}`);

  // If not manual (e.g. Micro mode), try to find the "full" track in our registry
  // to make sure we have all available mirrors for priority selection.
  if (!isManual) {
    const registered = visibleTracks.value.find(t => t.author === track.author && t.permlink === track.permlink);
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
  }
};

export const playNext = (isAuto = false): void => {
  console.log('[BFPlayer] playNext called, isAuto:', isAuto, 'PlayMode:', state.playMode);
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
      const remaining = state.autoQueue.filter(t => !(t.author === state.currentTrack?.author && t.permlink === state.currentTrack?.permlink));
      if (remaining.length > 0) {
        nextTrack = remaining[Math.floor(Math.random() * remaining.length)];
      }
    } else {
      const currentIndex = state.currentTrack ? state.autoQueue.findIndex(t => t.author === state.currentTrack?.author && t.permlink === state.currentTrack?.permlink) : -1;
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
};

export const playPrev = (): void => {
  _emit('prev', state.currentTrack);
  
  if (state.history.length > 0) {
    // Current track goes back to queue (or just ignore it)
    const prev = state.history.pop()!;
    playTrack(prev, false, -1, true);
  } else if (state.autoQueue.length > 0) {
    const currentIndex = state.currentTrack ? state.autoQueue.findIndex(t => t.author === state.currentTrack?.author && t.permlink === state.currentTrack?.permlink) : -1;
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

  // If we have a track but no media object initialized (e.g. after refresh),
  // start playback properly instead of just toggling the state.
  if (currentSource.value.type === 'audio' && !audioObj) {
    playTrack(state.currentTrack);
    return;
  }
  if (currentSource.value.type === 'youtube' && !ytPlayer) {
    playTrack(state.currentTrack);
    return;
  }
  if (currentSource.value.type === 'peertube' && !ptPlayer) {
    playTrack(state.currentTrack);
    return;
  }

  if (currentSource.value.type === 'youtube' && ytPlayer?.getPlayerState) {
    state.playing = ytPlayer.getPlayerState() === window.YT!.PlayerState.PLAYING;
  }

  if (state.playing) {
    if (currentSource.value.type === 'audio' && audioObj) audioObj.pause();
    if (currentSource.value.type === 'youtube' && ytPlayer) ytPlayer.pauseVideo();
    if (currentSource.value.type === 'peertube' && ptPlayer) ptPlayer.pause();
  } else {
    if (currentSource.value.type === 'audio' && audioObj) audioObj.play();
    if (currentSource.value.type === 'youtube' && ytPlayer) ytPlayer.playVideo();
    if (currentSource.value.type === 'peertube' && ptPlayer) ptPlayer.play();
  }
};

export const seek = (pct: number): void => {
  const time = (pct / 100) * state.duration;
  if (currentSource.value?.type === 'youtube' && ytPlayer) ytPlayer.seekTo(time);
  else if (currentSource.value?.type === 'audio' && audioObj) audioObj.currentTime = time;
  else if (currentSource.value?.type === 'peertube' && ptPlayer) ptPlayer.seek(time);
};

export const addToQueue = (track: MediaTrack): void => { state.queue.push(track); };
export const setAutoQueue = (tracks: MediaTrack[]): void => { state.autoQueue = tracks; };

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
//   data-title    | post title
//   data-author   | post author
//   data-permlink | post permlink
//   data-payout   | payout (float, optional)
//   data-votecount| vote count (int, optional)
//   data-voted    | is voted ('true'/'false', optional)
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
  if (!author || !permlink) return;

  const incomingSources: MediaEntryMirror[] = incoming.sources || [];
  // Fallback for flat registration objects
  if (incomingSources.length === 0 && incoming.id && incoming.type) {
    incomingSources.push({
        type: incoming.type,
        id: incoming.id,
        src: incoming.src,
        host: incoming.host,
        thumb: incoming.thumb
    });
  }

  if (incomingSources.length === 0) {
    console.warn('[BFPlayer] Skipping registration of track with no sources:', author, permlink);
    return;
  }

  console.log(`[BFPlayer] registerTrack call: ${author}/${permlink} with ${incomingSources.length} sources`);

  const existingIdx = visibleTracks.value.findIndex(t => t.author === author && t.permlink === permlink);
  
  if (existingIdx === -1) {
    const track: MediaTrack = {
      author, permlink,
      title: incoming.title || 'Media Content',
      cover: incoming.cover,
      payout: incoming.payout,
      voteCount: incoming.voteCount,
      voted: incoming.voted,
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
    
    // Update metadata: prioritize better covers (non-Blurt blog defaults)
    if (incoming.cover && (!track.cover || track.cover.includes('images.blurt.blog'))) {
       track.cover = incoming.cover;
    }
    if (incoming.payout) track.payout = incoming.payout;
    if (incoming.title && incoming.title !== 'Media Content') track.title = incoming.title;
  }
  
  state.autoQueue = [...visibleTracks.value];

  // Sync with current track if it's the same post
  if (state.currentTrack && state.currentTrack.author === author && state.currentTrack.permlink === permlink) {
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

    if (track.cover && (!state.currentTrack.cover || state.currentTrack.cover.includes('images.blurt.blog'))) {
      state.currentTrack.cover = track.cover;
    }
    if (track.title && track.title !== 'Media Content') state.currentTrack.title = track.title;
  }
  };
/**
 * Unregisters a track source.
 */
export const unregisterTrack = (trackId: string, type: string, author?: string, permlink?: string): void => {
  if (author && permlink) {
    const track = visibleTracks.value.find(t => t.author === author && t.permlink === permlink);
    if (track) {
      track.sources = track.sources.filter(s => !(s.id === trackId && s.type === type));
      if (track.sources.length === 0) {
        visibleTracks.value = visibleTracks.value.filter(t => !(t.author === author && t.permlink === permlink));
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
export const clearTracks = (): void => {
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

export const scanView = (container?: Element | null): void => {
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
  () => [state.currentTrack?.author, state.currentTrack?.permlink, state.playing] as const,
  () => { nextTick(_syncForumMediaDOM); },
);

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
  if (pl.tracks.some(t => t.author === track.author && t.permlink === track.permlink)) return false;
  pl.tracks.push({ ...track, addedAt: Date.now() });
  pl.updatedAt = Date.now();
  _savePlaylists();
  return true;
};

export const removeTrackFromPlaylist = (playlistId: string, author: string, permlink: string): void => {
  const pl = playlistState.playlists.find(p => p.id === playlistId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter(t => !(t.author === author && t.permlink === permlink));
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
  addToQueue, setAutoQueue, scanView,
  registerTrack, unregisterTrack, clearTracks,
  setClient,
  initResize, scrollToCurrent, toggleExperimental,

  togglePlayMode,
  on, off, registerPlugin,
  createPlaylist, deletePlaylist, renamePlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist, playPlaylist,
};