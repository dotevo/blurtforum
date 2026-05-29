/**
 * BlurtForum MediaPlayer Library
 * Handles audio/video playback, queuing, and PiP UI.
 */
window.BFPlayer = (function() {
  const { reactive, watch } = Vue;

  // --- STATE ---
  const state = reactive({
    enabled: true,
    active: false,      // is player visible?
    playing: false,     // is currently playing?
    loading: false,     // is buffering?
    currentTrack: null, // { title, author, type, id, url, postId, permlink, host }
    queue: [],          // manual queue
    autoQueue: [],      // automatic queue from current view
    volume: parseFloat(localStorage.getItem('bf-player-volume') || '0.7'),
    progress: 0,
    duration: 0,
    minimized: false,
    expanded: false,
    expandedTab: 'video', // 'video' or 'queue' for mobile
    expandedHeight: parseInt(localStorage.getItem('bf-player-height') || '600'),
    repeat: false
  });

  // --- PRIVATE VARS ---
  let audioObj = null;
  let ytPlayer = null;
  let ptPlayer = null;
  let progressTimer = null;
  let isResizing = false;

  // --- INTERNAL METHODS ---

  const loadSavedQueue = () => {
    try {
      const saved = localStorage.getItem('bf-player-queue');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          state.queue = parsed;
          if (state.queue.length > 0) {
            state.active = true;
            state.minimized = true;
          }
        }
      }
    } catch (e) { console.warn('Failed to load queue:', e); }
  };
  loadSavedQueue();

  const handleError = (msg) => {
    if (!state.currentTrack) return;
    if (state.currentTrack._errorHandled) return;
    state.currentTrack._errorHandled = true;

    const oldTitle = state.currentTrack.title;
    state.currentTrack.title = `⚠️ ERROR: ${msg} (Skipping in 5s...)`;
    state.loading = false;
    state.playing = false;
    
    setTimeout(() => {
      if (state.currentTrack && state.currentTrack.title.startsWith('⚠️ ERROR:')) {
         state.currentTrack.title = oldTitle;
         playNext();
      }
    }, 5000);
  };
  
  const initResize = (e) => {
    isResizing = true;
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('touchmove', handleResize);
    document.addEventListener('touchend', stopResize);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
  };

  const handleResize = (e) => {
    if (!isResizing) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const height = window.innerHeight - clientY;
    // Constrain height
    if (height > 250 && height < window.innerHeight * 0.9) {
      state.expandedHeight = height;
    }
  };

  const stopResize = () => {
    isResizing = false;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    document.removeEventListener('touchmove', handleResize);
    document.removeEventListener('touchend', stopResize);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    localStorage.setItem('bf-player-height', state.expandedHeight);
  };

  const initAudio = () => {
    if (audioObj) return;
    audioObj = new Audio();
    audioObj.volume = state.volume;
    
    audioObj.addEventListener('play', () => { state.playing = true; state.loading = false; });
    audioObj.addEventListener('pause', () => { state.playing = false; });
    audioObj.addEventListener('waiting', () => { state.loading = true; });
    audioObj.addEventListener('playing', () => { state.loading = false; });
    audioObj.addEventListener('timeupdate', () => {
      if (audioObj.duration) {
        state.progress = (audioObj.currentTime / audioObj.duration) * 100;
        state.duration = audioObj.duration;
      }
    });
    audioObj.addEventListener('ended', () => {
      playNext();
    });
    audioObj.addEventListener('error', (e) => {
      console.error('BFPlayer Audio error:', e);
      handleError('Audio/Suno file error or broken link');
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
    console.log('BFPlayer: Initializing YouTube API...');
    await loadYTAPI();
    if (ytPlayer) {
      console.log('BFPlayer: YouTube player already exists, reusing.');
      return;
    }
    
    let container = document.getElementById('bf-yt-player-target');
    if (!container) {
      console.warn('BFPlayer: bf-yt-player-target not found in DOM!');
      container = document.createElement('div');
      container.id = 'bf-yt-player-container-hidden';
      container.style.position = 'fixed';
      container.style.bottom = '-1000px';
      document.body.appendChild(container);
    }
    const targetId = container.id;
    console.log('BFPlayer: Creating YT.Player on target:', targetId);

    ytPlayer = new YT.Player(targetId, {
      height: '360',
      width: '640',
      playerVars: { 'autoplay': 1, 'controls': 1, 'disablekb': 0, 'fs': 1, 'modestbranding': 1, 'origin': window.location.origin },
      events: {
        'onReady': () => {
          console.log('BFPlayer: YT Player Ready');
          if (state.currentTrack?.type === 'youtube') {
            console.log('BFPlayer: Loading video:', state.currentTrack.id);
            ytPlayer.loadVideoById(state.currentTrack.id);
            ytPlayer.playVideo();
          }
        },
        'onError': (e) => {
          console.error('YT Player Error:', e.data);
          handleError('YouTube video unavailable or broken link');
        },
        'onStateChange': (event) => {
          console.log('BFPlayer: YT State Change:', event.data);
          if (event.data === YT.PlayerState.PLAYING) {
            state.playing = true;
            state.loading = false;
            startYTProgress();
          } else if (event.data === YT.PlayerState.PAUSED) {
            state.playing = false;
            stopYTProgress();
          } else if (event.data === YT.PlayerState.BUFFERING) {
            state.loading = true;
          } else if (event.data === YT.PlayerState.ENDED) {
            stopYTProgress();
            playNext();
          }
        }
      }
    });
  };

  const initPT = () => {
    const iframe = document.getElementById('bf-pt-player-iframe');
    if (!iframe || !window.PeerTubePlayer) return;

    console.log('BFPlayer: Initializing PeerTube API instance...');
    
    // Create new player instance
    ptPlayer = new window.PeerTubePlayer(iframe);
    
    ptPlayer.ready.then(() => {
      console.log('BFPlayer: PeerTube API Ready');
      ptPlayer.setVolume(state.volume);
      // Auto-play via API too, just in case ?autoplay=1 was blocked
      console.log('BFPlayer: Triggering PeerTube play()');
      ptPlayer.play();
      
      ptPlayer.addEventListener('playbackStatusUpdate', (stats) => {
        if (state.currentTrack?.type !== 'peertube') return;
        if (stats && typeof stats.position !== 'undefined') {
          state.progress = (stats.position / stats.duration) * 100;
          state.duration = stats.duration;
          if (stats.playbackState === 'ended') {
            console.log('BFPlayer: PeerTube ended, moving to next');
            playNext();
          }
        }
      });

      ptPlayer.addEventListener('playbackStatusChange', (playbackState) => {
        if (state.currentTrack?.type !== 'peertube') return;
        state.playing = (playbackState === 'playing');
      });

      ptPlayer.addEventListener('error', (err) => {
        console.warn('PeerTube error:', err);
        handleError('blurt.media (PeerTube) playback error');
      });
    }).catch(err => {
      console.warn('BFPlayer: PeerTube ready error:', err);
    });
  };

  const startYTProgress = () => {
    stopYTProgress();
    progressTimer = setInterval(() => {
      if (ytPlayer && ytPlayer.getCurrentTime) {
        const cur = ytPlayer.getCurrentTime();
        const dur = ytPlayer.getDuration();
        if (dur > 0) {
          state.progress = (cur / dur) * 100;
          state.duration = dur;
        }
      }
    }, 500);
  };

  const stopYTProgress = () => {
    if (progressTimer) clearInterval(progressTimer);
  };

  const stopAll = () => {
    if (audioObj) {
      audioObj.pause();
      audioObj.src = '';
    }
    if (ytPlayer && ytPlayer.stopVideo) {
      ytPlayer.stopVideo();
    }
    if (ptPlayer && ptPlayer.pause) {
      // Don't kill instance yet, just stop playback
      try { ptPlayer.pause(); } catch(e) {}
    }
    state.playing = false;
    state.progress = 0;
  };

  // --- PUBLIC METHODS ---

  const playTrack = async (track, isManual = false, manualIdx = -1) => {
    if (!state.enabled) return;
    
    stopAll();
    state.currentTrack = track;
    state.active = true;
    state.loading = true;
    state.minimized = false; 

    // Remove from manual queue if playing from it
    if (isManual && manualIdx !== -1) {
      state.queue.splice(manualIdx, 1);
    }

    if (track.type === 'suno') {
      initAudio();
      audioObj.src = `https://cdn1.suno.ai/${track.id}.mp3`;
      audioObj.play().catch(e => console.warn('Play error:', e));
    } else if (track.type === 'youtube') {
      if (!ytPlayer) {
        await initYT();
      } else {
        ytPlayer.loadVideoById(track.id);
        ytPlayer.playVideo();
      }
    } else if (track.type === 'peertube') {
      state.playing = true;
      state.loading = false;
      // Wait for Vue to recreate the iframe with new :key
      Vue.nextTick(() => {
        setTimeout(() => {
          initPT();
        }, 1000); // Give it time to load src
      });
    }
  };

  const playNext = () => {
    if (state.queue.length > 0) {
      playTrack(state.queue.shift());
    } else if (state.autoQueue.length > 0) {
      const idx = state.autoQueue.findIndex(t => t.id === state.currentTrack?.id);
      if (idx !== -1 && idx < state.autoQueue.length - 1) {
        playTrack(state.autoQueue[idx + 1]);
      } else if (state.repeat) {
        playTrack(state.autoQueue[0]);
      } else {
        state.playing = false;
      }
    } else {
      state.playing = false;
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
    if (state.playing) {
      if (state.currentTrack.type === 'suno' && audioObj) audioObj.pause();
      if (state.currentTrack.type === 'youtube' && ytPlayer) ytPlayer.pauseVideo();
      if (state.currentTrack.type === 'peertube' && ptPlayer) ptPlayer.pause();
    } else {
      if (state.currentTrack.type === 'suno' && audioObj) audioObj.play();
      if (state.currentTrack.type === 'youtube' && ytPlayer) ytPlayer.playVideo();
      if (state.currentTrack.type === 'peertube' && ptPlayer) ptPlayer.play();
    }
  };

  const seek = (pct) => {
    const time = (pct / 100) * state.duration;
    if (state.currentTrack?.type === 'suno' && audioObj) audioObj.currentTime = time;
    else if (state.currentTrack?.type === 'youtube' && ytPlayer) ytPlayer.seekTo(time, true);
    else if (state.currentTrack?.type === 'peertube' && ptPlayer) ptPlayer.seek(time);
  };

  const addToQueue = (track) => {
    if (!state.enabled || state.queue.find(t => t.id === track.id)) return;
    state.queue.push(track);
    state.active = true;
  };

  const setAutoQueue = (tracks) => { state.autoQueue = tracks; };

  const toggleExperimental = () => {
    state.enabled = !state.enabled;
    localStorage.setItem('bf-experimental-mode', state.enabled);
    if (!state.enabled) { stopAll(); state.active = false; }
  };

  watch(() => state.minimized, (isMin) => {
    if (isMin) state.expanded = false;
  });

  watch(() => state.volume, (newVol) => {
    if (audioObj) audioObj.volume = newVol;
    if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(newVol * 100);
    if (ptPlayer && ptPlayer.setVolume) ptPlayer.setVolume(newVol);
    localStorage.setItem('bf-player-volume', newVol);
  });

  watch(() => [...state.queue], (newQueue) => {
    localStorage.setItem('bf-player-queue', JSON.stringify(newQueue));
  }, { deep: true });

  return { state, initResize, playTrack, playNext, playPrev, togglePlay, seek, addToQueue, setAutoQueue, toggleExperimental };
})();
