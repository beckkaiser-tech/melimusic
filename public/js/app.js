(() => {
  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];

  const state = {
    queue: [],
    queueIndex: -1,
    favorites: JSON.parse(localStorage.getItem('ms_favs') || '[]'),
    recentlyPlayed: JSON.parse(localStorage.getItem('ms_recent') || '[]'),
    shuffle: false,
    repeat: 0,
    currentPage: 'home',
    history: [],
    historyIndex: -1,
    searchQuery: '',
    searchFilter: 'songs',
    playing: false,
    currentTime: 0,
    duration: 0,
    karaoke: {
      lines: [],
      currentIndex: -1,
      fontSize: 20,
      autoScroll: true,
      loaded: false,
    },
  };

  let player = null;
  let playerReady = false;
  let progressInterval = null;

  const view = $('#view');
  const miniplayer = $('#miniplayer');
  const nowplaying = $('#nowplaying');
  const toast = $('#toast');

  // ─── YOUTUBE IFRAME API ───
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('yt-holder', {
      height: '0',
      width: '0',
      playerVars: { autoplay: 0, controls: 0 },
      events: {
        onReady: () => { playerReady = true; },
        onStateChange: onPlayerStateChange,
        onError: (e) => { console.error('YT Error', e.data); showToast('Playback error'); }
      }
    });
  };

  function onPlayerStateChange(e) {
    if (e.data === YT.PlayerState.PLAYING) {
      state.playing = true;
      updatePlayButtons(true);
      startProgress();
    } else if (e.data === YT.PlayerState.PAUSED) {
      state.playing = false;
      updatePlayButtons(false);
      stopProgress();
    } else if (e.data === YT.PlayerState.ENDED) {
      state.playing = false;
      updatePlayButtons(false);
      stopProgress();
      onTrackEnd();
    }
  }

  function startProgress() {
    stopProgress();
    progressInterval = setInterval(updateProgress, 500);
  }

  function stopProgress() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = null;
  }

  function updateProgress() {
    if (!player || !playerReady) return;
    state.currentTime = player.getCurrentTime() || 0;
    state.duration = player.getDuration() || 0;
    if (state.duration <= 0) return;
    const pct = (state.currentTime / state.duration) * 100;
    $('#mini-progress-fill').style.width = pct + '%';
    $('#mini-cur').textContent = fmtTime(state.currentTime);
    $('#mini-dur').textContent = fmtTime(state.duration);
    $('#np-cur').textContent = fmtTime(state.currentTime);
    $('#np-dur').textContent = fmtTime(state.duration);
    $('#np-range').value = (state.currentTime / state.duration) * 1000;
    const pbKnob = $('.pb-knob', $('#mini-bar'));
    if (pbKnob) pbKnob.style.left = pct + '%';
    updateKaraokeHighlight();
  }

  function onTrackEnd() {
    if (state.repeat === 2) {
      player.seekTo(0, true);
      player.playVideo();
    } else if (state.repeat === 1 || state.queueIndex < state.queue.length - 1) {
      playNext();
    }
  }

  function playVideoById(id) {
    if (!playerReady) {
      setTimeout(() => playVideoById(id), 500);
      return;
    }
    player.loadVideoById(id);
  }

  // ─── SPLASH ───
  setTimeout(() => {
    const splash = $('#splash');
    if (splash) splash.classList.add('hide');
    setTimeout(() => splash?.remove(), 500);
  }, 1500);

  // ─── THEME ───
  const savedTheme = localStorage.getItem('ms_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon();

  $('#theme-toggle').onclick = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ms_theme', next);
    updateThemeIcon();
  };

  function updateThemeIcon() {
    const theme = document.documentElement.getAttribute('data-theme');
    $('#theme-ic use').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  }

  // ─── NAVIGATION ───
  $$('.nav-item').forEach(item => {
    item.onclick = (e) => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    };
  });

  function navigateTo(page, pushHistory = true) {
    state.currentPage = page;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));

    if (pushHistory) {
      state.history = state.history.slice(0, state.historyIndex + 1);
      state.history.push(page);
      state.historyIndex = state.history.length - 1;
    }

    renderPage();
  }

  $('#nav-back').onclick = () => {
    if (state.historyIndex > 0) {
      state.historyIndex--;
      navigateTo(state.history[state.historyIndex], false);
    }
  };

  $('#nav-fwd').onclick = () => {
    if (state.historyIndex < state.history.length - 1) {
      state.historyIndex++;
      navigateTo(state.history[state.historyIndex], false);
    }
  };

  function renderPage() {
    view.innerHTML = '';
    switch (state.currentPage) {
      case 'home': renderHome(); break;
      case 'search': renderSearch(); break;
      case 'videos': renderVideos(); break;
      case 'charts': renderCharts(); break;
      case 'library': renderLibrary(); break;
    }
  }

  // ─── HOME ───
  function renderHome() {
    const home = document.createElement('div');
    home.className = 'home-view fade-in';
    home.innerHTML = `
      <h2 class="section-title">Good ${getTimeGreeting()}</h2>
      <div style="font-size:16px;margin:0 0 16px;color:var(--text-sub)">Discover music</div>
      ${state.recentlyPlayed.length > 0 ? `
        <div style="margin-bottom:32px">
          <h2 class="section-title">Recently Played</h2>
          <div class="recent-grid" id="recent-grid"></div>
        </div>
      ` : ''}
      <div class="card-grid" id="home-cards"></div>
      <h2 class="section-title">Trending Now</h2>
      <div class="song-list" id="home-trending"></div>
    `;
    view.appendChild(home);
    loadRecentGrid();
    loadHomeCards();
    loadTrending();
  }

  function getTimeGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Morning';
    if (h < 18) return 'Afternoon';
    return 'Evening';
  }

  function loadRecentGrid() {
    const grid = $('#recent-grid');
    if (!grid || state.recentlyPlayed.length === 0) return;
    grid.innerHTML = state.recentlyPlayed.slice(0, 6).map(s => `
      <div class="recent-card" data-id="${s.id}">
        <img src="${escAttr(s.thumbnail)}" alt="" loading="lazy" />
        <div class="recent-card-title">${escHTML(s.title)}</div>
      </div>
    `).join('');
    $$('.recent-card', grid).forEach(card => {
      card.onclick = () => {
        const song = state.recentlyPlayed.find(s => s.id === card.dataset.id);
        if (song) playSong(song, state.recentlyPlayed);
      };
    });
  }

  function addToRecentlyPlayed(song) {
    state.recentlyPlayed = state.recentlyPlayed.filter(s => s.id !== song.id);
    state.recentlyPlayed.unshift({ id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, duration: song.duration });
    if (state.recentlyPlayed.length > 20) state.recentlyPlayed = state.recentlyPlayed.slice(0, 20);
    localStorage.setItem('ms_recent', JSON.stringify(state.recentlyPlayed));
  }

  const homeGenres = [
    { name: 'Anime', query: 'anime music opening', color: '#FF6437' },
  ];

  function loadHomeCards() {
    const grid = $('#home-cards');
    if (!grid) return;
    grid.innerHTML = homeGenres.map(g => `
      <div class="card" data-query="${g.query}">
        <div style="width:100%;aspect-ratio:1;border-radius:6px;background:${g.color};display:flex;align-items:center;justify-content:center;font-size:48px;margin-bottom:12px;box-shadow:0 8px 24px rgba(0,0,0,.3)">
          <svg class="ic" style="width:48px;height:48px;fill:#fff"><use href="#i-note"/></svg>
        </div>
        <div class="card-title">${g.name}</div>
      </div>
    `).join('');

    $$('.card', grid).forEach(card => {
      card.onclick = () => {
        state.searchQuery = card.dataset.query;
        navigateTo('search');
        setTimeout(() => {
          const input = $('.search-input');
          if (input) { input.value = state.searchQuery; doSearch(); }
        }, 100);
      };
    });
  }

  async function loadTrending() {
    const list = $('#home-trending');
    if (!list) return;
    list.innerHTML = '<div class="loading-note">Loading...</div>';
    try {
      const res = await fetch('/api/trending');
      const data = await res.json();
      if (data.results) {
        list.innerHTML = data.results.slice(0, 10).map((s, i) => songItemHTML(s, i)).join('');
        bindSongItems(list);
      }
    } catch (e) {
      list.innerHTML = '<div class="loading-note">Failed to load</div>';
    }
  }

  // ─── SEARCH ───
  function renderSearch() {
    const div = document.createElement('div');
    div.className = 'search-view fade-in';
    div.innerHTML = `
      <div class="search-input-wrap">
        <svg class="ic search-icon"><use href="#i-search"/></svg>
        <input class="search-input" type="text" placeholder="What do you want to play?" value="${escHTML(state.searchQuery)}" />
      </div>
      <div class="filter-tabs">
        <button class="filter-tab ${state.searchFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
        <button class="filter-tab ${state.searchFilter === 'songs' ? 'active' : ''}" data-filter="songs">Songs</button>
        <button class="filter-tab ${state.searchFilter === 'videos' ? 'active' : ''}" data-filter="videos">Videos</button>
      </div>
      <div id="search-results"></div>
    `;
    view.appendChild(div);

    const input = $('.search-input');
    let debounce;
    input.focus();
    input.oninput = () => {
      state.searchQuery = input.value;
      clearTimeout(debounce);
      debounce = setTimeout(doSearch, 400);
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };

    $$('.filter-tab').forEach(tab => {
      tab.onclick = () => {
        state.searchFilter = tab.dataset.filter;
        $$('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === state.searchFilter));
        doSearch();
      };
    });

    if (state.searchQuery) doSearch();
  }

  async function doSearch() {
    const q = state.searchQuery.trim();
    if (!q) return;
    const results = $('#search-results');
    if (!results) return;
    results.innerHTML = '<div class="loading-note">Searching...</div>';

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=30`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        if (state.searchFilter === 'videos') {
          results.innerHTML = `<div class="video-grid" id="video-results"></div>`;
          renderVideoCards(data.results, $('#video-results'));
        } else {
          results.innerHTML = `<div class="song-list" id="song-results"></div>`;
          const list = $('#song-results');
          list.innerHTML = data.results.map((s, i) => songItemHTML(s, i)).join('');
          bindSongItems(list);
        }
      } else {
        results.innerHTML = '<div class="loading-note">No results found</div>';
      }
    } catch (e) {
      results.innerHTML = '<div class="loading-note">Search failed</div>';
    }
  }

  // ─── VIDEOS ───
  function renderVideos() {
    const div = document.createElement('div');
    div.className = 'fade-in';
    div.innerHTML = `
      <h2 class="section-title">Videos</h2>
      <div class="search-input-wrap">
        <svg class="ic search-icon"><use href="#i-search"/></svg>
        <input class="search-input" id="video-search-input" type="text" placeholder="Search for music videos..." value="${escHTML(state.searchQuery)}" />
      </div>
      <div class="video-grid" id="videos-grid"></div>
    `;
    view.appendChild(div);

    const input = $('#video-search-input');
    let debounce;
    input.focus();
    input.oninput = () => {
      state.searchQuery = input.value;
      clearTimeout(debounce);
      debounce = setTimeout(searchVideos, 400);
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') searchVideos(); };

    if (state.searchQuery) searchVideos();
    else loadTrendingVideos();
  }

  async function searchVideos() {
    const q = state.searchQuery.trim();
    if (!q) return;
    const grid = $('#videos-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading-note">Searching videos...</div>';

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=24`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        renderVideoCards(data.results, grid);
      } else {
        grid.innerHTML = '<div class="loading-note">No videos found</div>';
      }
    } catch (e) {
      grid.innerHTML = '<div class="loading-note">Search failed</div>';
    }
  }

  async function loadTrendingVideos() {
    const grid = $('#videos-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading-note">Loading videos...</div>';

    try {
      const res = await fetch('/api/trending');
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        renderVideoCards(data.results, grid);
      } else {
        grid.innerHTML = '<div class="loading-note">No videos available</div>';
      }
    } catch (e) {
      grid.innerHTML = '<div class="loading-note">Failed to load</div>';
    }
  }

  function renderVideoCards(songs, container) {
    container.innerHTML = songs.map(s => `
      <div class="video-card" data-id="${s.id}">
        <div style="position:relative">
          <img class="video-thumb" src="${escAttr(s.thumbnail)}" alt="" loading="lazy" />
          <div class="video-play-overlay">
            <div class="video-play-btn">
              <svg class="ic"><use href="#i-play"/></svg>
            </div>
          </div>
        </div>
        <div class="video-info">
          <div class="video-title">${escHTML(s.title)}</div>
          <div class="video-artist">${escHTML(s.artist)}${s.views && s.views !== '0' ? ` \u00B7 ${s.views} plays` : ''}</div>
        </div>
      </div>
    `).join('');

    $$('.video-card', container).forEach(card => {
      card.onclick = () => {
        const song = songs.find(s => s.id === card.dataset.id);
        if (song) playSong(song, songs);
      };
    });
  }

  // ─── CHARTS ───
  async function renderCharts() {
    const div = document.createElement('div');
    div.className = 'fade-in';
    div.innerHTML = `
      <div class="chart-header">
        <div class="chart-cover" style="background:linear-gradient(135deg,#1DB954,#191414);display:flex;align-items:center;justify-content:center">
          <svg class="ic" style="width:80px;height:80px;fill:#fff"><use href="#i-chart"/></svg>
        </div>
        <div class="chart-info">
          <h1>Top Charts</h1>
          <p>The most played songs right now</p>
        </div>
      </div>
      <div class="song-list" id="chart-list"></div>
    `;
    view.appendChild(div);

    const list = $('#chart-list');
    list.innerHTML = '<div class="loading-note">Loading charts...</div>';
    try {
      const res = await fetch('/api/trending');
      const data = await res.json();
      if (data.results) {
        list.innerHTML = data.results.map((s, i) => songItemHTML(s, i, true)).join('');
        bindSongItems(list);
      }
    } catch (e) {
      list.innerHTML = '<div class="loading-note">Failed to load</div>';
    }
  }

  // ─── LIBRARY ───
  function renderLibrary() {
    const div = document.createElement('div');
    div.className = 'fade-in';
    div.innerHTML = `
      <h2 class="section-title">Your Library</h2>
      ${state.favorites.length === 0 ? '<div class="loading-note">No favorites yet. Search for songs and tap the heart icon to add them here.</div>' : ''}
      <div class="song-list" id="lib-songs"></div>
    `;
    view.appendChild(div);

    const list = $('#lib-songs');
    if (state.favorites.length > 0) {
      list.innerHTML = state.favorites.map((s, i) => songItemHTML(s, i)).join('');
      bindSongItems(list);
    }
  }

  function updateSidebarLibrary() {
    const libList = $('#lib-list');
    if (!libList) return;
    if (state.favorites.length === 0) {
      libList.innerHTML = '<div class="empty-msg">Your library is empty</div>';
      return;
    }
    libList.innerHTML = state.favorites.slice(0, 10).map(s => `
      <div class="song-item sidebar-song" data-id="${s.id}" style="grid-template-columns:32px 1fr;padding:6px 8px;">
        <img class="song-art" style="width:32px;height:32px" src="${escAttr(s.thumbnail)}" alt="" loading="lazy" />
        <div class="song-info">
          <div class="song-name" style="font-size:13px">${escHTML(s.title)}</div>
          <div class="song-artist" style="font-size:11px">${escHTML(s.artist)}</div>
        </div>
      </div>
    `).join('');

    $$('.sidebar-song', libList).forEach(item => {
      item.onclick = () => {
        const song = state.favorites.find(s => s.id === item.dataset.id);
        if (song) playSong(song, state.favorites);
      };
    });
  }

  // ─── SONG ITEMS ───
  function songItemHTML(song, index, showRank = false) {
    const isPlaying = state.queue[state.queueIndex]?.id === song.id;
    const isFav = state.favorites.some(f => f.id === song.id);
    return `
      <div class="song-item ${isPlaying ? 'playing' : ''}" data-id="${song.id}" data-index="${index}">
        ${showRank ? `<div style="font-size:16px;font-weight:700;color:var(--text-sub);text-align:center;min-width:24px">${index + 1}</div>` : ''}
        <img class="song-art" src="${escAttr(song.thumbnail)}" alt="" loading="lazy" />
        <div class="song-info">
          <div class="song-name">${escHTML(song.title)}</div>
          <div class="song-artist">${escHTML(song.artist)}${song.views && song.views !== '0' ? ` \u00B7 ${song.views} plays` : ''}</div>
        </div>
        <div class="song-duration">${song.duration || ''}</div>
        <div class="song-actions">
          <button class="icon-btn fav-btn ${isFav ? 'active' : ''}" data-id="${song.id}" title="Favorite">
            <svg class="ic"><use href="${isFav ? '#i-heart-f' : '#i-heart-o'}"/></svg>
          </button>
          <button class="icon-btn dl-btn" data-id="${song.id}" title="Download">
            <svg class="ic"><use href="#i-download"/></svg>
          </button>
          <button class="icon-btn add-q-btn" data-id="${song.id}" title="Add to queue">
            <svg class="ic"><use href="#i-plus"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function bindSongItems(container) {
    $$('.song-item', container).forEach(item => {
      item.onclick = (e) => {
        if (e.target.closest('.fav-btn') || e.target.closest('.add-q-btn') || e.target.closest('.dl-btn')) return;
        const songs = [];
        $$('.song-item', container).forEach(si => {
          songs.push({
            id: si.dataset.id,
            title: $('.song-name', si)?.textContent || '',
            artist: $('.song-artist', si)?.textContent || '',
            thumbnail: $('img', si)?.src || '',
            duration: $('.song-duration', si)?.textContent || ''
          });
        });
        const idx = songs.findIndex(s => s.id === item.dataset.id);
        if (idx >= 0) playSong(songs[idx], songs);
      };
    });

    $$('.fav-btn', container).forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        toggleFavorite(btn.dataset.id);
      };
    });

    $$('.dl-btn', container).forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const song = findSongById(btn.dataset.id);
        if (song) downloadSong(song);
      };
    });

    $$('.add-q-btn', container).forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const song = findSongById(btn.dataset.id);
        if (song) addToQueue(song);
      };
    });
  }

  function findSongById(id) {
    for (const item of $$('.song-item')) {
      if (item.dataset.id === id) {
        return {
          id,
          title: $('.song-name', item)?.textContent || '',
          artist: $('.song-artist', item)?.textContent || '',
          thumbnail: $('img', item)?.src || '',
          duration: $('.song-duration', item)?.textContent || ''
        };
      }
    }
    const fav = state.favorites.find(f => f.id === id);
    if (fav) return fav;
    const q = state.queue.find(s => s.id === id);
    if (q) return q;
    return null;
  }

  // ─── PLAYER ───
  function playSong(song, playlist = null) {
    if (playlist) {
      state.queue = [...playlist];
      state.queueIndex = playlist.findIndex(s => s.id === song.id);
      if (state.queueIndex < 0) {
        state.queue.unshift(song);
        state.queueIndex = 0;
      }
    }

    addToRecentlyPlayed(song);
    resetKaraoke();
    updatePlayerUI(song);
    showToast(`Playing: ${song.title}`);
    updateSidebarQueue();
    playVideoById(song.id);
  }

  function updatePlayerUI(song) {
    miniplayer.classList.remove('hidden');
    $('#mini-art').src = song.thumbnail || '';
    $('#mini-title').textContent = song.title || '---';
    $('#mini-artist').textContent = song.artist || '---';
    $('#np-art').src = song.thumbnail || '';
    $('#np-title').textContent = song.title || '---';
    $('#np-artist').textContent = song.artist || '---';

    if (song.thumbnail) {
      $('#np-bg').style.backgroundImage = `url(${song.thumbnail})`;
    }

    updateLikeButton();
    updatePlayingHighlight();
  }

  function updatePlayingHighlight() {
    $$('.song-item').forEach(item => {
      item.classList.toggle('playing', item.dataset.id === state.queue[state.queueIndex]?.id);
    });
  }

  function updatePlayButtons(playing) {
    const icon = playing ? '#i-pause' : '#i-play';
    $$('#mini-play use, #np-play use').forEach(u => u.setAttribute('href', icon));
  }

  function updateLikeButton() {
    const song = state.queue[state.queueIndex];
    if (!song) return;
    const isFav = state.favorites.some(f => f.id === song.id);
    $$('#mini-like use').forEach(u => u.setAttribute('href', isFav ? '#i-heart-f' : '#i-heart-o'));
    $$('#np-like use').forEach(u => u.setAttribute('href', isFav ? '#i-heart-f' : '#i-heart-o'));
  }

  // ─── DOWNLOAD ───
  const activeDownloads = new Set();

  function downloadFilename(song) {
    const t = song ? song.title : 'track';
    const a = song ? (song.artist || '').split(',')[0].trim() : '';
    const raw = (a ? `${a} - ${t}` : t).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return `${raw.slice(0, 80) || 'track'}.mp3`;
  }

  function clickDownload(href, name) {
    const aEl = document.createElement('a');
    aEl.href = href;
    aEl.download = name || '';
    aEl.target = '_blank';
    aEl.rel = 'noopener noreferrer';
    document.body.appendChild(aEl);
    aEl.click();
    aEl.remove();
  }

  async function downloadSong(song) {
    if (!song || !song.id) return;
    if (activeDownloads.has(song.id)) { showToast('Already downloading...'); return; }
    activeDownloads.add(song.id);
    showToast(`Preparing "${song.title}"...`);
    try {
      const st = await (await fetch(`/api/download-start?videoId=${encodeURIComponent(song.id)}`)).json();
      if (!st.progressUrl) throw new Error('no progress url');

      let url = null;
      let lastProg = -1;
      for (let i = 0; i < 60; i++) {
        if (i) await new Promise(r => setTimeout(r, 2500));
        try {
          const p = await (await fetch(`/api/download-progress?progressUrl=${encodeURIComponent(st.progressUrl)}`)).json();
          if (p.done && p.url) { url = p.url; break; }
          const raw = Number(p.progress) || 0;
          const pct = Math.min(99, raw > 100 ? Math.round(raw / 10) : Math.round(raw));
          if (pct !== lastProg) {
            lastProg = pct;
            showToast(pct <= 5 && p.text ? String(p.text) : `Converting... ${pct}%`);
          }
        } catch {}
      }
      if (!url) throw new Error('timeout');

      showToast(`Downloading "${song.title}"...`);
      const name = downloadFilename(song);
      try {
        const r = await fetch(url, { mode: 'cors' });
        if (!r.ok) throw new Error('fetch');
        const blob = await r.blob();
        const obj = URL.createObjectURL(blob);
        clickDownload(obj, name);
        setTimeout(() => URL.revokeObjectURL(obj), 8000);
      } catch {
        clickDownload(url, name);
      }
      showToast('Download started');
    } catch (e) {
      console.error('Download error:', e);
      showToast('Download failed - try again later');
    } finally {
      activeDownloads.delete(song.id);
    }
  }

  function toggleFavorite(id) {
    const idx = state.favorites.findIndex(f => f.id === id);
    if (idx >= 0) {
      state.favorites.splice(idx, 1);
      showToast('Removed from favorites');
    } else {
      const song = findSongById(id);
      if (song) {
        state.favorites.push({ id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, duration: song.duration });
        showToast('Added to favorites');
      }
    }
    localStorage.setItem('ms_favs', JSON.stringify(state.favorites));
    updateLikeButton();
    updateSidebarLibrary();
    renderPage();
  }

  // ─── QUEUE ───
  function addToQueue(song) {
    state.queue.push(song);
    showToast('Added to queue');
    updateSidebarQueue();
  }

  function clearQueue() {
    state.queue = [];
    state.queueIndex = -1;
    if (playerReady) player.stopVideo();
    miniplayer.classList.add('hidden');
    nowplaying.classList.add('hidden');
    updateSidebarQueue();
  }

  function updateSidebarQueue() {
    const qBox = $('#side-queue');
    const clearBtn = $('#side-q-clear');
    if (!qBox) return;
    if (state.queue.length === 0) {
      qBox.innerHTML = '<div class="empty-msg">Your queue is empty</div>';
      clearBtn.classList.add('hidden');
      return;
    }
    clearBtn.classList.remove('hidden');
    qBox.innerHTML = state.queue.map((s, i) => `
      <div class="song-item sidebar-q-item ${i === state.queueIndex ? 'playing' : ''}" data-qi="${i}" style="grid-template-columns:32px 1fr;padding:6px 8px;">
        <img class="song-art" style="width:32px;height:32px" src="${escAttr(s.thumbnail)}" alt="" loading="lazy" />
        <div class="song-info">
          <div class="song-name" style="font-size:13px">${escHTML(s.title)}</div>
          <div class="song-artist" style="font-size:11px">${escHTML(s.artist)}</div>
        </div>
      </div>
    `).join('');

    $$('.sidebar-q-item', qBox).forEach(item => {
      item.onclick = () => {
        const qi = parseInt(item.dataset.qi);
        state.queueIndex = qi;
        playSong(state.queue[qi]);
      };
    });
  }

  // ─── CONTROLS ───
  function togglePlay() {
    if (!playerReady) return;
    if (state.playing) player.pauseVideo();
    else player.playVideo();
  }

  function playNext() {
    if (state.queue.length === 0) return;
    if (state.shuffle) {
      state.queueIndex = Math.floor(Math.random() * state.queue.length);
    } else {
      state.queueIndex = (state.queueIndex + 1) % state.queue.length;
    }
    playSong(state.queue[state.queueIndex]);
  }

  function playPrev() {
    if (state.queue.length === 0) return;
    if (state.currentTime > 3 && playerReady) {
      player.seekTo(0, true);
      return;
    }
    state.queueIndex = (state.queueIndex - 1 + state.queue.length) % state.queue.length;
    playSong(state.queue[state.queueIndex]);
  }

  ['mini-play', 'np-play'].forEach(id => { $(`#${id}`).onclick = togglePlay; });
  ['mini-next', 'np-next'].forEach(id => { $(`#${id}`).onclick = playNext; });
  ['mini-prev', 'np-prev'].forEach(id => { $(`#${id}`).onclick = playPrev; });

  ['mini-shuffle', 'np-shuffle'].forEach(id => {
    $(`#${id}`).onclick = () => {
      state.shuffle = !state.shuffle;
      $$('#mini-shuffle, #np-shuffle').forEach(b => b.classList.toggle('active', state.shuffle));
      showToast(state.shuffle ? 'Shuffle on' : 'Shuffle off');
    };
  });

  ['mini-repeat', 'np-repeat'].forEach(id => {
    $(`#${id}`).onclick = () => {
      state.repeat = (state.repeat + 1) % 3;
      $$('#mini-repeat, #np-repeat').forEach(b => {
        b.classList.toggle('active', state.repeat > 0);
        const ic = $('use', b);
        ic.setAttribute('href', state.repeat === 2 ? '#i-repeat-1' : '#i-repeat');
      });
      showToast(['Repeat off', 'Repeat all', 'Repeat one'][state.repeat]);
    };
  });

  ['mini-like', 'np-like'].forEach(id => {
    $(`#${id}`).onclick = () => {
      const song = state.queue[state.queueIndex];
      if (song) toggleFavorite(song.id);
    };
  });

  $('#np-download').onclick = () => {
    const song = state.queue[state.queueIndex];
    if (song) downloadSong(song);
  };

  const volSlider = $('#mini-volume');
  volSlider.oninput = () => {
    if (playerReady) player.setVolume(parseInt(volSlider.value));
  };

  // Seek (mini)
  $('#mini-bar').onclick = (e) => {
    if (!playerReady || !state.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    player.seekTo(pct * state.duration, true);
  };

  // Seek (now playing)
  $('#np-range').oninput = (e) => {
    if (!playerReady || !state.duration) return;
    player.seekTo((e.target.value / 1000) * state.duration, true);
  };

  // ─── NOW PLAYING PANEL ───
  $('#np-close').onclick = () => nowplaying.classList.add('hidden');

  function openNowPlaying() {
    if (!miniplayer.classList.contains('hidden')) nowplaying.classList.remove('hidden');
  }

  miniplayer.addEventListener('click', (e) => {
    if (e.target.closest('.icon-btn') || e.target.closest('input') || e.target.closest('.pb-bar')) return;
    openNowPlaying();
  });

  // Mobile: also handle touch on miniplayer
  miniplayer.addEventListener('touchend', (e) => {
    if (e.target.closest('.icon-btn') || e.target.closest('input') || e.target.closest('.pb-bar')) return;
    e.preventDefault();
    openNowPlaying();
  });

  // Swipe down to close now-playing
  (function() {
    let startY = 0, currentY = 0, isDragging = false;
    const np = nowplaying;
    const handle = np.querySelector('.np-handle');
    if (!handle) return;

    handle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      isDragging = true;
      np.style.transition = 'none';
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const diff = currentY - startY;
      if (diff > 0) {
        np.style.transform = `translateY(${diff}px)`;
        np.style.opacity = 1 - (diff / 400);
      }
    }, { passive: true });

    handle.addEventListener('touchend', () => {
      isDragging = false;
      np.style.transition = '';
      const diff = currentY - startY;
      if (diff > 100) {
        np.classList.add('hidden');
      }
      np.style.transform = '';
      np.style.opacity = '';
    }, { passive: true });
  })();

  $$('[data-nptab]').forEach(tab => {
    tab.onclick = () => {
      $$('[data-nptab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.np-pane').forEach(p => p.classList.remove('active'));
      $(`#np-${tab.dataset.nptab}`).classList.add('active');
      if (tab.dataset.nptab === 'related') loadRelated();
      if (tab.dataset.nptab === 'queue') renderNPQueue();
      if (tab.dataset.nptab === 'karaoke') loadKaraoke();
      if (tab.dataset.nptab === 'lyrics') loadLyricsTab();
    };
  });

  async function loadRelated() {
    const list = $('#related-list');
    const song = state.queue[state.queueIndex];
    if (!song) { list.innerHTML = '<div class="loading-note">No song playing</div>'; return; }
    list.innerHTML = '<div class="loading-note">Loading...</div>';
    try {
      const res = await fetch(`/api/related/${song.id}`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        list.innerHTML = data.results.map((s, i) => songItemHTML(s, i)).join('');
        bindSongItems(list);
      } else {
        list.innerHTML = '<div class="loading-note">No related songs</div>';
      }
    } catch (e) {
      list.innerHTML = '<div class="loading-note">Failed to load</div>';
    }
  }

  function renderNPQueue() {
    const list = $('#queue-list');
    if (state.queue.length === 0) { list.innerHTML = '<div class="loading-note">Queue is empty</div>'; return; }
    list.innerHTML = state.queue.map((s, i) => songItemHTML(s, i)).join('');
    bindSongItems(list);
  }

  // ─── KARAOKE ───
  async function fetchLyrics(artist, title) {
    try {
      const res = await fetch(`/api/lyrics/search?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.syncedLyrics || data.plainLyrics) return data;
      }
    } catch (e) { console.log('lyrics fetch error:', e.message); }
    return null;
  }

  async function loadKaraoke() {
    const song = state.queue[state.queueIndex];
    const lyricsDiv = $('#karaoke-lyrics');
    const titleEl = $('#karaoke-song-title');
    const artistEl = $('#karaoke-song-artist');

    if (!song) {
      lyricsDiv.innerHTML = '<div class="lyrics-empty">No song playing</div>';
      return;
    }

    titleEl.textContent = song.title || '---';
    artistEl.textContent = song.artist || '---';

    if (state.karaoke.loaded && state.karaoke.lines.length > 0) return;

    lyricsDiv.innerHTML = '<div class="lyrics-empty">Searching lyrics...</div>';

    const rawArtist = song.artist || '';
    const rawTitle = song.title || '';

    // Try original name first
    let lyrics = await fetchLyrics(rawArtist, rawTitle);

    // Try cleaning artist name (remove "- Topic", "VEVO", etc)
    if (!lyrics) {
      const cleanArtist = rawArtist.replace(/ - Topic$/gi, '').replace(/ VEVO$/gi, '').replace(/ Official$/gi, '').trim();
      if (cleanArtist !== rawArtist) {
        lyrics = await fetchLyrics(cleanArtist, rawTitle);
      }
    }

    // Try cleaning title (remove everything after " - ")
    if (!lyrics) {
      const shortTitle = rawTitle.split(' - ')[0].split('(')[0].trim();
      if (shortTitle !== rawTitle) {
        lyrics = await fetchLyrics(rawArtist, shortTitle);
      }
    }

    // Try first word of artist only
    if (!lyrics) {
      const firstWord = rawArtist.split(/[\s\-]/)[0];
      if (firstWord && firstWord.length > 1) {
        lyrics = await fetchLyrics(firstWord, rawTitle);
      }
    }

    // Try title only
    if (!lyrics) {
      lyrics = await fetchLyrics('', rawTitle);
    }

    if (lyrics) {
      if (lyrics.syncedLyrics) {
        parseLRC(lyrics.syncedLyrics);
      } else if (lyrics.plainLyrics) {
        parsePlainLyrics(lyrics.plainLyrics);
      }
      renderKaraokeLyrics();
    } else {
      fallbackKaraoke(song);
    }
  }

  function parsePlainLyrics(text) {
    const lines = text.split('\n').filter(l => l.trim());
    state.karaoke.lines = lines.map((t, i) => ({
      time: i * 4,
      text: t.trim()
    }));
    state.karaoke.loaded = true;
  }

  function fallbackKaraoke(song) {
    const lyricsDiv = $('#karaoke-lyrics');
    const lines = [
      { time: 0, text: `${song.artist || ''}` },
      { time: 3, text: `${song.title || ''}` },
      { time: 8, text: `` },
      { time: 10, text: `No lyrics found for this song` },
    ];

    state.karaoke.lines = lines;
    state.karaoke.loaded = true;
    renderKaraokeLyrics();
  }

  function parseLRC(lrcText) {
    const lines = [];
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/g;
    let match;

    while ((match = regex.exec(lrcText)) !== null) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const ms = parseInt(match[3]);
      const time = min * 60 + sec + ms / (match[3].length === 3 ? 1000 : 100);
      const text = match[4].trim();
      if (text) lines.push({ time, text });
    }

    lines.sort((a, b) => a.time - b.time);
    state.karaoke.lines = lines;
    state.karaoke.loaded = true;
  }

  function renderKaraokeLyrics() {
    const lyricsDiv = $('#karaoke-lyrics');
    if (state.karaoke.lines.length === 0) {
      lyricsDiv.innerHTML = '<div class="lyrics-empty">No lyrics found</div>';
      return;
    }

    lyricsDiv.innerHTML = state.karaoke.lines.map((line, i) =>
      `<div class="karaoke-line" data-index="${i}" data-time="${line.time}">${escHTML(line.text) || '&nbsp;'}</div>`
    ).join('');

    $$('.karaoke-line', lyricsDiv).forEach(el => {
      el.onclick = () => {
        const time = parseFloat(el.dataset.time);
        if (playerReady) player.seekTo(time, true);
      };
    });

    updateKaraokeFontSize();
  }

  function updateKaraokeHighlight() {
    if (!state.karaoke.loaded || state.karaoke.lines.length === 0) return;

    const lines = $$('.karaoke-line');
    let newIndex = -1;

    for (let i = state.karaoke.lines.length - 1; i >= 0; i--) {
      if (state.currentTime >= state.karaoke.lines[i].time) {
        newIndex = i;
        break;
      }
    }

    if (newIndex !== state.karaoke.currentIndex) {
      state.karaoke.currentIndex = newIndex;
      lines.forEach((el, i) => {
        el.classList.remove('active', 'past');
        if (i === newIndex) el.classList.add('active');
        else if (i < newIndex) el.classList.add('past');
      });

      if (state.karaoke.autoScroll && newIndex >= 0) {
        const activeLine = lines[newIndex];
        if (activeLine) {
          const container = $('#karaoke-lyrics');
          const offset = activeLine.offsetTop - container.offsetHeight / 2 + activeLine.offsetHeight / 2;
          container.scrollTo({ top: offset, behavior: 'smooth' });
        }
      }
    }
  }

  function updateKaraokeFontSize() {
    $$('.karaoke-line').forEach(el => {
      el.style.fontSize = state.karaoke.fontSize + 'px';
    });
  }

  $('#karaoke-font-up')?.addEventListener('click', () => {
    state.karaoke.fontSize = Math.min(40, state.karaoke.fontSize + 2);
    updateKaraokeFontSize();
  });

  $('#karaoke-font-down')?.addEventListener('click', () => {
    state.karaoke.fontSize = Math.max(14, state.karaoke.fontSize - 2);
    updateKaraokeFontSize();
  });

  $('#karaoke-scroll-toggle')?.addEventListener('click', () => {
    state.karaoke.autoScroll = !state.karaoke.autoScroll;
    $('#karaoke-scroll-toggle').classList.toggle('active', state.karaoke.autoScroll);
  });

  function resetKaraoke() {
    state.karaoke.lines = [];
    state.karaoke.currentIndex = -1;
    state.karaoke.loaded = false;
    const lyricsDiv = $('#karaoke-lyrics');
    if (lyricsDiv) lyricsDiv.innerHTML = '<div class="lyrics-empty">Press play and open karaoke to see lyrics</div>';
  }

  // ─── LYRICS TAB ───
  async function loadLyricsTab() {
    const song = state.queue[state.queueIndex];
    const container = $('#lyrics-container');
    if (!song) { container.innerHTML = '<div class="lyrics-empty">No song playing</div>'; return; }

    container.innerHTML = '<div class="lyrics-empty">Searching lyrics...</div>';

    let lyrics = null;

    // Reuse karaoke data if already loaded
    if (state.karaoke.loaded && state.karaoke.lines.length > 0) {
      container.innerHTML = state.karaoke.lines.map(line =>
        `<div style="padding:6px 0;font-size:16px;color:var(--text-sub)">${escHTML(line.text) || '&nbsp;'}</div>`
      ).join('');
      return;
    }

    // Fetch lyrics
    const rawArtist = song.artist || '';
    const rawTitle = song.title || '';

    lyrics = await fetchLyrics(rawArtist, rawTitle);
    if (!lyrics) {
      const cleanArtist = rawArtist.replace(/ - Topic$/gi, '').replace(/ VEVO$/gi, '').trim();
      if (cleanArtist !== rawArtist) lyrics = await fetchLyrics(cleanArtist, rawTitle);
    }
    if (!lyrics) {
      const shortTitle = rawTitle.split(' - ')[0].split('(')[0].trim();
      if (shortTitle !== rawTitle) lyrics = await fetchLyrics(rawArtist, shortTitle);
    }
    if (!lyrics) {
      const firstWord = rawArtist.split(/[\s\-]/)[0];
      if (firstWord) lyrics = await fetchLyrics(firstWord, rawTitle);
    }

    if (lyrics) {
      let text = lyrics.syncedLyrics || lyrics.plainLyrics || '';
      // Remove LRC timestamps for display
      text = text.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '');
      const lines = text.split('\n').filter(l => l.trim());
      container.innerHTML = lines.map(l =>
        `<div style="padding:6px 0;font-size:16px;color:var(--text-sub)">${escHTML(l.trim())}</div>`
      ).join('');
    } else {
      container.innerHTML = '<div class="lyrics-empty">No lyrics found for this song</div>';
    }
  }

  $('#side-q-clear').onclick = clearQueue;
  $('#side-queue-btn').onclick = () => navigateTo('search');

  // ─── UTILITY ───
  function fmtTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function escHTML(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function escAttr(s) {
    return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2000);
  }

  $('#tb-search').onclick = () => navigateTo('search');

  // ─── INIT ───
  navigateTo('home');
  updateSidebarLibrary();
  updateSidebarQueue();
})();
