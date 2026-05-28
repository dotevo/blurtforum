/**
 * BlurtForum MediaPlayer Library
 * Handles audio/video playback, queuing, and PiP UI.
 */
window.BFPlayer = (function() {
  const { reactive, watch } = Vue;

  // --- STATE ---
  const state = reactive({
    enabled: localStorage.getItem('bf-experimental-mode') === 'true',
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
    repeat: false
  });

  // --- PRIVATE VARS ---
  let audioObj = null;
  let ytPlayer = null;
  let progressTimer = null;

  // --- INTERNAL METHODS ---
  
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
      console.error('Audio error:', e);
      state.loading = false;
      setTimeout(playNext, 2000);
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
    if (ytPlayer) return;
    
    let container = document.getElementById('bf-yt-player-target');
    if (!container) {
      container = document.createElement('div');
      container.id = 'bf-yt-player-container-hidden';
      container.style.position = 'fixed';
      container.style.bottom = '-1000px';
      document.body.appendChild(container);
    }
    const targetId = container.id;

    ytPlayer = new YT.Player(targetId, {
      height: '360',
      width: '640',
      playerVars: { 'autoplay': 0, 'controls': 1, 'disablekb': 0, 'fs': 1, 'modestbranding': 1 },
      events: {
        'onReady': () => {
          if (state.currentTrack?.type === 'youtube') {
            ytPlayer.loadVideoById(state.currentTrack.id);
            ytPlayer.playVideo();
          }
        },
        'onStateChange': (event) => {
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
    state.playing = false;
    state.progress = 0;
  };

  // --- PEERTUBE API HANDLER ---
  window.addEventListener('message', (event) => {
    try {
      let data = event.data;
      if (typeof data === 'string') data = JSON.parse(data);
      
      if (state.currentTrack?.type === 'peertube') {
        const eventName = data.event || data.type;
        const eventData = data.data || data.value;

        if (eventName === 'ended' || eventName === 'onEnded') {
          playNext();
        } else if (eventName === 'playbackStatusUpdate' || eventName === 'timeupdate') {
          const pos = eventData?.position || eventData?.currentTime || (typeof eventData === 'number' ? eventData : 0);
          const dur = eventData?.duration || state.duration || 1;
          if (dur > 0) {
            state.progress = (pos / dur) * 100;
            state.duration = dur;
          }
        } else if (eventName === 'play' || eventName === 'onPlay') {
          state.playing = true;
        } else if (eventName === 'pause' || eventName === 'onPause') {
          state.playing = false;
        }
      }
    } catch (e) {}
  });

  // --- PUBLIC METHODS ---

  const playTrack = async (track) => {
    if (!state.enabled) return;
    
    stopAll();
    state.currentTrack = track;
    state.active = true;
    state.loading = true;
    state.minimized = false; 

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
      // Multi-stage subscription
      const sub = () => {
        const iframe = document.getElementById('bf-pt-player-iframe');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(JSON.stringify({ command: 'subscribe', data: ['playbackStatusUpdate', 'ended'] }), '*');
        }
      };
      setTimeout(sub, 1000);
      setTimeout(sub, 3000);
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
      if (state.currentTrack.type === 'peertube') {
        const iframe = document.getElementById('bf-pt-player-iframe');
        iframe?.contentWindow.postMessage(JSON.stringify({ command: 'pause' }), '*');
      }
    } else {
      if (state.currentTrack.type === 'suno' && audioObj) audioObj.play();
      if (state.currentTrack.type === 'youtube' && ytPlayer) ytPlayer.playVideo();
      if (state.currentTrack.type === 'peertube') {
        const iframe = document.getElementById('bf-pt-player-iframe');
        iframe?.contentWindow.postMessage(JSON.stringify({ command: 'play' }), '*');
      }
    }
  };

  const seek = (pct) => {
    const time = (pct / 100) * state.duration;
    if (state.currentTrack?.type === 'suno' && audioObj) audioObj.currentTime = time;
    else if (state.currentTrack?.type === 'youtube' && ytPlayer) ytPlayer.seekTo(time, true);
    else if (state.currentTrack?.type === 'peertube') {
      const iframe = document.getElementById('bf-pt-player-iframe');
      iframe?.contentWindow.postMessage(JSON.stringify({ command: 'seek', line: time }), '*');
    }
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
    if (state.currentTrack?.type === 'peertube') {
      const iframe = document.getElementById('bf-pt-player-iframe');
      iframe?.contentWindow.postMessage(JSON.stringify({ command: 'setVolume', value: newVol }), '*');
    }
    localStorage.setItem('bf-player-volume', newVol);
  });

  return { state, playTrack, playNext, playPrev, togglePlay, seek, addToQueue, setAutoQueue, toggleExperimental };
})();
