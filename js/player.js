/**
 * BlurtForum MediaPlayer Library
 * Handles audio/video playback, queuing, and PiP UI.
 */
window.BFPlayer = (function() {
  const { reactive, watch } = Vue;

  // --- STATE ---
  const state = reactive({
    enabled: true,
    active: false,
    playing: false,
    loading: false,
    minimized: false,
    expanded: false,
    expandedHeight: 400,
    expandedTab: 'video', // 'video' or 'queue'
    currentTrack: null, // { type: 'youtube'|'peertube'|'audio', id, src?, cover?, title, author, permlink, host? }
    queue: [],
    autoQueue: [],
    progress: 0,
    duration: 0,
    volume: parseFloat(localStorage.getItem('bf-player-volume') || '0.7'),
    experimental: localStorage.getItem('bf-player-experimental') === 'true'
  });

  let audioObj = null;
  let ytPlayer = null;
  let ptPlayer = null;
  let progressTimer = null;
  let isResizing = false;
  let errorTimer = null;

  // --- INTERNAL METHODS ---

  const loadSavedQueue = () => {
    try {
      const saved = localStorage.getItem('bf-player-queue');
      if (saved) state.queue = JSON.parse(saved);
    } catch (e) { console.warn('Failed to load queue:', e); }
  };
  loadSavedQueue();

  const handleError = (msg) => {
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
      if (trackWithError.title && trackWithError.title.startsWith('⚠️ ERROR:')) {
         trackWithError.title = oldTitle;
      }
      if (state.currentTrack === trackWithError) {
         playNext();
      }
      errorTimer = null;
    }, 5000);
  };
  
  const initResize = (e) => {
    isResizing = true;
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const startH = state.expandedHeight;
    const onMove = (ee) => {
      if (!isResizing) return;
      const currentY = ee.touches ? ee.touches[0].clientY : ee.clientY;
      const delta = startY - currentY;
      state.expandedHeight = Math.max(200, Math.min(window.innerHeight * 0.8, startH + delta));
    };
    const onUp = () => {
      isResizing = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onUp);
  };

  const initAudio = () => {
    if (audioObj) return;
    audioObj = new Audio();
    audioObj.volume = state.volume;
    
    const isAudioTrack = () => state.currentTrack?.type === 'audio';

    audioObj.addEventListener('play', () => { 
      if (isAudioTrack()) { state.playing = true; state.loading = false; }
    });
    audioObj.addEventListener('pause', () => { 
      if (isAudioTrack()) { state.playing = false; }
    });
    audioObj.addEventListener('waiting', () => { 
      if (isAudioTrack()) { state.loading = true; }
    });
    audioObj.addEventListener('playing', () => { 
      if (isAudioTrack()) { state.loading = false; }
    });
    audioObj.addEventListener('timeupdate', () => {
      if (isAudioTrack() && audioObj.duration) {
        state.progress = (audioObj.currentTime / audioObj.duration) * 100;
        state.duration = audioObj.duration;
      }
    });
    audioObj.addEventListener('ended', () => {
      if (isAudioTrack()) playNext();
    });
    audioObj.addEventListener('error', (e) => {
      if (isAudioTrack()) {
        console.error('BFPlayer Audio error:', e);
        handleError('Audio file error or broken link');
      }
    });
  };

  const loadYTAPI = () => {
    if (window.YT) return Promise.resolve();
    return new Promise((resolve) => {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      window.onYouTubeIframeAPIReady = () => resolve();
    });
  };

  const initYT = async () => {
    await loadYTAPI();
    ytPlayer = new YT.Player('bf-yt-player-target', {
      height: '100%', width: '100%',
      playerVars: { 'autoplay': 1, 'controls': 1, 'modestbranding': 1, 'rel': 0 },
      events: {
        'onReady': (event) => {
          event.target.setVolume(state.volume * 100);
          if (state.currentTrack?.type === 'youtube') event.target.loadVideoById(state.currentTrack.id);
        },
        'onStateChange': (event) => {
          if (event.data === YT.PlayerState.PLAYING) {
            state.playing = true; state.loading = false;
            state.duration = ytPlayer.getDuration();
            startYTProgress();
          } else if (event.data === YT.PlayerState.PAUSED) {
            state.playing = false; stopYTProgress();
          } else if (event.data === YT.PlayerState.BUFFERING) {
            state.loading = true;
          } else if (event.data === YT.PlayerState.ENDED) {
            state.playing = false; stopYTProgress(); playNext();
          }
        },
        'onError': (e) => {
          console.error('BFPlayer YT error:', e);
          handleError('YouTube video unavailable or blocked');
        }
      }
    });
  };

  const initPT = () => {
    const iframe = document.getElementById('bf-pt-player-iframe');
    if (!iframe) return;
    ptPlayer = new PeerTubePlayer(iframe);
    ptPlayer.ready.then(() => {
       ptPlayer.setVolume(state.volume);
       ptPlayer.addEventListener('playbackStatusUpdate', (status) => {
          if (status === 'playing') state.playing = true;
          else if (status === 'paused') state.playing = false;
       });
       ptPlayer.addEventListener('timeupdate', (time) => {
          ptPlayer.getDuration().then(dur => {
             state.duration = dur;
             state.progress = (time / dur) * 100;
          });
       });
    });
  };

  const startYTProgress = () => {
    stopYTProgress();
    progressTimer = setInterval(() => {
      if (ytPlayer && ytPlayer.getCurrentTime) {
        state.progress = (ytPlayer.getCurrentTime() / ytPlayer.getDuration()) * 100;
      }
    }, 500);
  };

  const stopYTProgress = () => { if (progressTimer) clearInterval(progressTimer); };

  const stopAll = () => {
    if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
    if (audioObj) { audioObj.pause(); audioObj.src = ''; }
    if (ytPlayer && ytPlayer.stopVideo) { try { ytPlayer.stopVideo(); } catch(e) {} }
    if (ptPlayer && ptPlayer.pause) { try { ptPlayer.pause(); } catch(e) {} }
    state.playing = false; state.progress = 0;
  };

  // --- PUBLIC METHODS ---

  const playTrack = async (track, isManual = false, manualIdx = -1) => {
    if (!state.enabled) return;
    
    // Safety check: if track is missing src (e.g. from auto-queue shortlink), resolve it now
    if (track.type === 'audio' && !track.src && track.id && track.id.length < 30) {
      const resolved = await Parser.resolveMedia(track);
      if (resolved && resolved.src) {
        track = resolved;
      } else {
        handleError('Could not resolve audio source');
        return;
      }
    }

    stopAll();
    state.currentTrack = track;
    state.active = true;
    state.loading = true;
    state.minimized = false; 

    if (isManual && manualIdx !== -1) state.queue.splice(manualIdx, 1);

    if (track.type === 'audio') {
      initAudio();
      try {
        if (!track.src && track.id) {
           // Fallback for legacy base64 IDs
           try { track.src = atob(track.id); } catch(e) { track.src = track.id; }
        }
        audioObj.src = track.src;
        audioObj.play().catch(e => console.warn('Play error:', e));
      } catch(e) {
        console.error('Failed to load audio:', e);
        handleError('Invalid audio link');
      }
    } else if (track.type === 'youtube') {
      if (!ytPlayer) await initYT();
      else { ytPlayer.loadVideoById(track.id); ytPlayer.playVideo(); }
    } else if (track.type === 'peertube') {
      state.playing = true; state.loading = false;
      Vue.nextTick(() => { setTimeout(() => initPT(), 1000); });
    }
  };

  const playNext = () => {
    if (state.queue.length > 0) playTrack(state.queue.shift());
    else if (state.autoQueue.length > 0) {
      const idx = state.autoQueue.findIndex(t => t.id === state.currentTrack?.id);
      if (idx !== -1 && idx < state.autoQueue.length - 1) playTrack(state.autoQueue[idx + 1]);
    }
  };

  const playPrev = () => {
    if (state.autoQueue.length > 0) {
      const idx = state.autoQueue.findIndex(t => t.id === state.currentTrack?.id);
      if (idx > 0) playTrack(state.autoQueue[idx - 1]);
    }
  };

  const togglePlay = () => {
    if (!state.currentTrack) return;
    if (state.currentTrack.type === 'youtube' && ytPlayer && ytPlayer.getPlayerState) {
      state.playing = (ytPlayer.getPlayerState() === YT.PlayerState.PLAYING);
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

  const seek = (pct) => {
    const time = (pct / 100) * state.duration;
    if (state.currentTrack?.type === 'youtube' && ytPlayer) ytPlayer.seekTo(time);
    else if (state.currentTrack?.type === 'audio' && audioObj) audioObj.currentTime = time;
    else if (state.currentTrack?.type === 'peertube' && ptPlayer) ptPlayer.seek(time);
  };

  const addToQueue = (track) => { state.queue.push(track); };
  const setAutoQueue = (tracks) => { state.autoQueue = tracks; };
  const toggleExperimental = (val) => { state.experimental = val; localStorage.setItem('bf-player-experimental', val); };

  watch(() => state.volume, (newVol) => {
    if (audioObj) audioObj.volume = newVol;
    if (ytPlayer) ytPlayer.setVolume(newVol * 100);
    if (ptPlayer) ptPlayer.setVolume(newVol);
    localStorage.setItem('bf-player-volume', newVol);
  });
  watch(() => state.queue, (newQueue) => { localStorage.setItem('bf-player-queue', JSON.stringify(newQueue)); }, { deep: true });

  return { state, initResize, playTrack, playNext, playPrev, togglePlay, seek, addToQueue, setAutoQueue, toggleExperimental };
})();
