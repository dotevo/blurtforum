/**
 * BlurtForum MediaPlayer Library
 * Handles audio/video playback, queuing, and PiP UI.
 */
import { reactive, watch, nextTick } from 'vue';
import type { MediaTrack } from '../types';
import { Parser } from './parser';

interface PlayerState {
  enabled: boolean;
  active: boolean;
  playing: boolean;
  loading: boolean;
  minimized: boolean;
  expanded: boolean;
  expandedHeight: number;
  expandedTab: 'video' | 'queue';
  currentTrack: MediaTrack | null;
  queue: MediaTrack[];
  autoQueue: MediaTrack[];
  history: MediaTrack[];
  progress: number;
  duration: number;
  volume: number;
  experimental: boolean;
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

// Minimal PeerTube embed API typings
export interface PTPlayer {
  ready: Promise<void>;
  setVolume(v: number): void;
  addEventListener(evt: string, cb: (data: unknown) => void): void;
  getDuration(): Promise<number>;
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

const state = reactive<PlayerState>({
  enabled: true,
  active: false,
  playing: false,
  loading: false,
  minimized: false,
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
});

// Sync flag for Parser to know if player is enabled
window.__bfPlayerEnabled = state.enabled;

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
      state.active = true;
    } else if (state.queue.length > 0) {
      state.active = true;
      state.currentTrack = state.queue[0];
    }
  } catch (e) { console.warn('Failed to load queue:', e); }
};
loadSavedQueue();

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
  audioObj.addEventListener('playing', () => { if (isAudioTrack()) state.loading = false; });
  audioObj.addEventListener('timeupdate', () => {
    if (isAudioTrack() && audioObj!.duration) {
      state.progress = (audioObj!.currentTime / audioObj!.duration) * 100;
      state.duration = audioObj!.duration;
    }
  });
  audioObj.addEventListener('ended', () => { if (isAudioTrack()) playNext(); });
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
          state.playing = false; stopYTProgress(); playNext();
        }
      },
      onError: (e: unknown) => { console.error('BFPlayer YT error:', e); handleError('YouTube video unavailable or blocked'); },
    },
  });
};

const initPT = (): void => {
  const iframe = document.getElementById('bf-pt-player-iframe');
  if (!iframe || !window.PeerTubePlayer) return;
  ptPlayer = new window.PeerTubePlayer(iframe);
  ptPlayer.ready.then(() => {
    ptPlayer!.setVolume(state.volume);
    ptPlayer!.addEventListener('playbackStatusUpdate', (status: unknown) => {
      if (status === 'playing') state.playing = true;
      else if (status === 'paused') state.playing = false;
    });
    ptPlayer!.addEventListener('timeupdate', (time: unknown) => {
      ptPlayer!.getDuration().then(dur => {
        state.duration = dur;
        state.progress = ((time as number) / dur) * 100;
      });
    });
  });
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
  state.playing = false; state.progress = 0;
};

const scrollToCurrent = (): void => {
  nextTick(() => {
    const anchor = document.getElementById('current-queue-anchor');
    const list = document.querySelector<HTMLElement>('.queue-list');
    if (anchor && list) list.scrollTop = anchor.offsetTop - 40;
  });
};

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

  stopAll();

  if (state.currentTrack && state.currentTrack.id !== track.id && !fromHistory) {
    state.history = state.history.filter(t => t.id !== state.currentTrack!.id);
    state.history.unshift(state.currentTrack);
    if (state.history.length > 20) state.history.pop();
  }

  state.currentTrack = track;
  state.active = true;
  state.loading = true;
  state.minimized = false;
  scrollToCurrent();

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
    nextTick(() => { setTimeout(() => initPT(), 1000); });
  }
};

export const playNext = (): void => {
  if (state.queue.length > 0) {
    playTrack(state.queue.shift()!);
  } else if (state.autoQueue.length > 0) {
    if (state.currentTrack && state.autoQueue[0].id === state.currentTrack.id) {
      const current = state.autoQueue.shift()!;
      state.autoQueue.push(current);
    }
    playTrack(state.autoQueue[0]);
  } else {
    state.active = false; state.currentTrack = null; stopAll();
  }
};

export const playPrev = (): void => {
  if (state.history.length > 0) {
    playTrack(state.history.shift()!, false, -1, true);
  } else if (state.autoQueue.length > 0) {
    const last = state.autoQueue.pop()!;
    state.autoQueue.unshift(last);
    playTrack(state.autoQueue[0]);
  }
};

export const togglePlay = (): void => {
  if (!state.currentTrack) return;
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

// Persist state to localStorage
watch(() => state.volume, v => {
  if (audioObj) audioObj.volume = v;
  if (ytPlayer) ytPlayer.setVolume(v * 100);
  if (ptPlayer) ptPlayer.setVolume(v);
  localStorage.setItem('bf-player-volume', String(v));
});
watch(() => state.queue, q => { localStorage.setItem('bf-player-queue', JSON.stringify(q)); }, { deep: true });
watch(() => state.currentTrack, t => { localStorage.setItem('bf-player-current', JSON.stringify(t)); }, { deep: true });
watch(() => state.history, h => { localStorage.setItem('bf-player-history', JSON.stringify(h)); }, { deep: true });
watch(() => state.expandedTab, tab => { if (tab === 'queue') scrollToCurrent(); });

export const BFPlayer = {
  state,
  initResize,
  playTrack,
  playNext,
  playPrev,
  togglePlay,
  seek,
  addToQueue,
  setAutoQueue,
  toggleExperimental,
  scrollToCurrent,
};
