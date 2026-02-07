const path = require('path');
const url = require('url');
const fs = require('fs');
let pluginApi = null;

const state = {
  eventChannel: 'music-radio',
  pages: {
    recommend: '',
    search: '',
    settings: '',
    about: '',
    player: '',
    bgSettings: '',
    debugLyrics: '',
    discovery: '',
    playlist: '',
    history: ''
  },
  currentFloatingUrl: null,
  playlist: [],
  dailyHistory: [], // Items for the current day
  playCounts: {}, // { songId: count }
  today: '',
  dataPath: path.join(__dirname, 'data'),
  currentIndex: -1,
  tempPlaylist: null,
  settings: { removeAfterPlay: true, playMode: 'sequence', endTime: '', pauseAtEndTime: false, download: { dir: '', format: '{t} - {a}', lrc: true } },
  downloads: [],
  sources: new Map(),
  timerTriggered: false
};

const ensureDataDir = () => {
  if (!fs.existsSync(state.dataPath)) fs.mkdirSync(state.dataPath, { recursive: true });
};

const loadData = () => {
  try {
    ensureDataDir();
    // Settings
    const setFile = path.join(state.dataPath, 'settings.json');
    if (fs.existsSync(setFile)) {
        try { 
            const saved = JSON.parse(fs.readFileSync(setFile, 'utf8'));
            state.settings = { ...state.settings, ...saved };
            // Ensure deep merge for download object
            if (saved.download) state.settings.download = { ...state.settings.download, ...saved.download };
        } catch(e){}
    }

    // Play Counts
    const pcFile = path.join(state.dataPath, 'play_counts.json');
    if (fs.existsSync(pcFile)) {
        try { state.playCounts = JSON.parse(fs.readFileSync(pcFile, 'utf8')); } catch(e){}
    }
    
    // Check Date
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    state.today = `${y}-${m}-${d}`;
    
    // Daily History
    const histFile = path.join(state.dataPath, `history_${state.today}.json`);
    if (fs.existsSync(histFile)) {
        try { state.dailyHistory = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch(e){}
    } else {
        state.dailyHistory = [];
    }
    
    // Active Playlist (Check if it belongs to today)
    const plFile = path.join(state.dataPath, 'active_playlist.json');
    if (fs.existsSync(plFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(plFile, 'utf8'));
            if (data.date === state.today) {
                state.playlist = data.items || [];
                state.currentIndex = data.currentIndex || -1;
            } else {
                // New day, clear active playlist
                state.playlist = [];
                state.currentIndex = -1;
                // Maybe preserve settings?
            }
        } catch(e){}
    }
  } catch (e) { console.error('Load Data Error', e); }
};

const saveData = (type) => {
  try {
    ensureDataDir();
    if (type === 'counts') {
      fs.writeFileSync(path.join(state.dataPath, 'play_counts.json'), JSON.stringify(state.playCounts));
    } else if (type === 'history') {
      fs.writeFileSync(path.join(state.dataPath, `history_${state.today}.json`), JSON.stringify(state.dailyHistory));
    } else if (type === 'playlist') {
      const data = { date: state.today, items: state.playlist, currentIndex: state.currentIndex };
      fs.writeFileSync(path.join(state.dataPath, 'active_playlist.json'), JSON.stringify(data));
    } else if (type === 'settings') {
      fs.writeFileSync(path.join(state.dataPath, 'settings.json'), JSON.stringify(state.settings));
    }
  } catch (e) {}
};

const addToHistory = (item) => {
    // Add to daily history if valid
    if (!item || !item.id) return;
    
    // Check date change
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    
    if (today !== state.today) {
        state.today = today;
        state.dailyHistory = [];
        try {
            const histFile = path.join(state.dataPath, `history_${state.today}.json`);
            if (fs.existsSync(histFile)) {
                 state.dailyHistory = JSON.parse(fs.readFileSync(histFile, 'utf8'));
            }
        } catch(e){}
    }

    // We append to history log
    state.dailyHistory.push({ ...item, addedAt: Date.now() });
    saveData('history');
};

const functions = {
  selectDirectory: async () => {
    try {
      const electron = require('electron');
      const dialog = electron.dialog;
      const BrowserWindow = electron.BrowserWindow;
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }
      return { ok: true, path: result.filePaths[0] };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  getDownloadSettings: async () => {
    try {
      const home = require('os').homedir();
      const defaultDir = require('path').join(home, 'Downloads', 'OrbiMusic');
      if (!state.settings.download) state.settings.download = { dir: defaultDir, format: '{t} - {a}', lrc: true };
      if (!state.settings.download.dir) state.settings.download.dir = defaultDir;
      return { ok: true, settings: state.settings.download };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getPlayMode: async () => {
    return { ok: true, mode: state.settings.playMode || 'sequence' };
  },
  setPlayMode: async (mode) => {
    const modes = ['list-loop', 'single-loop', 'sequence', 'random', 'play-once'];
    if (modes.includes(mode)) {
        state.settings.playMode = mode;
        saveData('settings');
        return { ok: true };
    }
    return { ok: false, error: 'invalid mode' };
  },
  setDownloadSettings: async (settings = {}) => {
    try {
      if (!state.settings.download) state.settings.download = {};
      if (typeof settings.dir === 'string') state.settings.download.dir = settings.dir;
      if (typeof settings.format === 'string') state.settings.download.format = settings.format;
      if (typeof settings.lrc === 'boolean') state.settings.download.lrc = settings.lrc;
      saveData('settings');
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getDownloads: async () => {
    return { ok: true, items: state.downloads };
  },
  
  // Source Registry
  registerAudioSource: async (id, def) => {
    state.sources.set(id, def);
    return { ok: true };
  },
  unregisterAudioSource: async (id) => {
    state.sources.delete(id);
    return { ok: true };
  },
  getAudioSources: async () => {
    return { ok: true, sources: Array.from(state.sources.entries()).map(([id, def]) => ({ id, name: def.name, discoveryPage: def.discoveryPage })) };
  },
  
  getHistory: async (dateStr) => {
      try {
          // If asking for today, return memory state
          if (!dateStr || dateStr === state.today) {
              // Return reverse order (newest first)
              return { ok: true, items: state.dailyHistory.slice().reverse() };
          }
          // Load from file
          const f = path.join(state.dataPath, `history_${dateStr}.json`);
          if (fs.existsSync(f)) {
              const items = JSON.parse(fs.readFileSync(f, 'utf8'));
              return { ok: true, items: items.reverse() };
          }
          return { ok: true, items: [] };
      } catch (e) { return { ok: false, error: e.message }; }
  },
  
  clearHistory: async (dateStr) => {
      try {
          if (!dateStr || dateStr === state.today) {
              state.dailyHistory = [];
              saveData('history');
          } else {
              const f = path.join(state.dataPath, `history_${dateStr}.json`);
              if (fs.existsSync(f)) fs.unlinkSync(f);
          }
          return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
  },

  deleteFromHistory: async (dateStr, addedAt) => {
      try {
          const ts = Number(addedAt);
          if (!ts) return { ok: false };
          
          if (!dateStr || dateStr === state.today) {
              const idx = state.dailyHistory.findIndex(x => x.addedAt === ts);
              if (idx >= 0) {
                  state.dailyHistory.splice(idx, 1);
                  saveData('history');
              }
          } else {
              const f = path.join(state.dataPath, `history_${dateStr}.json`);
              if (fs.existsSync(f)) {
                  let items = JSON.parse(fs.readFileSync(f, 'utf8'));
                  const idx = items.findIndex(x => x.addedAt === ts);
                  if (idx >= 0) {
                      items.splice(idx, 1);
                      fs.writeFileSync(f, JSON.stringify(items));
                  }
              }
          }
          return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
  },

  cancelLoading: async () => {
      try {
        pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' });
        return { ok: true };
      } catch(e) { return { ok: false }; }
  },
  
  retryLoading: async () => {
      try {
        if (state.currentIndex >= 0 && state.currentIndex < state.playlist.length) {
            const item = state.playlist[state.currentIndex];
            // Just retry playing
            await functions.playIndex(state.currentIndex);
        }
        return { ok: true };
      } catch(e) { return { ok: false }; }
  },

  // Generic Search
  search: async (query, page, sourceId) => {
      let sId = sourceId;
      if (!sId) {
          if (state.sources.has('kuwo')) sId = 'kuwo';
          else if (state.sources.size > 0) sId = state.sources.keys().next().value;
      }
      
      const src = state.sources.get(sId);
      if (!src) return { ok: false, error: 'source not found' };
      
      try {
          const r = await pluginApi.call(src.pluginId, src.methods.search, [query, page]);
          if (r && r.ok && r.result) return r.result;
          return r;
      } catch (e) {
          return { ok: false, error: e.message };
      }
  },
  
  getPlayUrl: async (item = {}, quality = 'standard') => {
      const srcId = item.source || 'kuwo';
      const src = state.sources.get(srcId);
      if (!src) return { ok: false, error: 'source not registered' };
      
      try {
          const r = await pluginApi.call(src.pluginId, src.methods.getPlayUrl, [item, quality]);
          if (r && r.ok && r.result) return r.result;
          return r;
      } catch (e) {
          return { ok: false, error: e.message };
      }
  },
  
  fetchLyrics: async (item) => {
      const srcId = item.source || 'kuwo';
      const src = state.sources.get(srcId);
      if (!src) return { ok: false, error: 'source not registered' };
      try {
          const r = await pluginApi.call(src.pluginId, src.methods.getLyrics, [item]);
          if (r && r.ok && r.result) return r.result;
          return r;
      } catch (e) {
           return { ok: false, error: e.message };
      }
  },

  resolveCover: async (item) => {
      if (item.cover) return item.cover;
      const srcId = item.source || 'kuwo';
      if (srcId !== 'kuwo') return '';
      try {
          const src = state.sources.get(srcId);
          if (src && src.methods.getMusicInfo) {
              const r = await pluginApi.call(src.pluginId, src.methods.getMusicInfo, [item.id]);
              if (r && r.ok && r.result && r.result.cover) return r.result.cover;
          }
      } catch (e) {}
      return '';
  },

  downloadCurrent: async () => {
      if (state.currentIndex >= 0 && state.currentIndex < state.playlist.length) {
        return await functions.downloadSong(state.playlist[state.currentIndex]);
      }
      return { ok: false, error: 'no music playing' };
  },

  downloadSong: async (item = {}) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const https = require('https');
      const http = require('http');
      
      const home = require('os').homedir();
      const defaultDir = path.join(home, 'Downloads', 'OrbiMusic');
      const conf = state.settings.download || { dir: defaultDir, format: '{t} - {a}', lrc: true };
      const dir = conf.dir || defaultDir;
      const format = conf.format || '{t} - {a}';
      const saveLrc = !!conf.lrc;
      
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      
      const title = String(item.title || '未知标题').replace(/[\\/:*?"<>|]/g, '_');
      const artist = String(item.artist || '未知艺术家').replace(/[\\/:*?"<>|]/g, '_');
      const album = String(item.album || '').replace(/[\\/:*?"<>|]/g, '_');
      
      let baseName = format.replace(/\{t\}/g, title).replace(/\{n\}/g, title).replace(/\{a\}/g, artist).replace(/\{l\}/g, album);
      if (!baseName) baseName = `${title} - ${artist}`;
      baseName = baseName.replace(/[\\/:*?"<>|]/g, '_');
      
      const taskId = Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      const task = { id: taskId, title: item.title, status: 'pending', progress: 0 };
      state.downloads.unshift(task);
      if (state.downloads.length > 20) state.downloads.pop();
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'downloadList', value: state.downloads });
      
      (async () => {
        try {
          task.status = 'downloading';
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'downloadList', value: state.downloads });
          
          // Get Audio URL
          const g = await functions.getPlayUrl(item, 'standard');
          if (!g || !g.ok || !g.url || !g.url.startsWith('http')) throw new Error('无法获取音频链接');
          
          let ext = '.mp3';
          if (g.url.includes('.flac')) ext = '.flac';
          else if (g.url.includes('.m4a')) ext = '.m4a';
          else if (g.url.includes('.aac')) ext = '.aac';
          
          const finalPath = path.join(dir, `${baseName}${ext}`);
          const file = fs.createWriteStream(finalPath);
          
          await new Promise((resolve, reject) => {
            const lib = g.url.startsWith('https') ? https : http;
            lib.get(g.url, (res) => {
              if (res.statusCode !== 200) { reject(new Error(`Status ${res.statusCode}`)); return; }
              const total = parseInt(res.headers['content-length'] || '0', 10);
              let loaded = 0;
              res.on('data', (chunk) => {
                loaded += chunk.length;
                if (total > 0) {
                  const pct = Math.floor((loaded / total) * 100);
                  if (pct !== task.progress) {
                    task.progress = pct;
                    pluginApi.emit(state.eventChannel, { type: 'update', target: 'downloadList', value: state.downloads });
                  }
                }
              });
              res.pipe(file);
              file.on('finish', () => {
                file.close(resolve);
              });
              file.on('error', (err) => {
                fs.unlink(finalPath, () => {});
                reject(err);
              });
            }).on('error', reject);
          });
          
          // Download Lyrics
          if (saveLrc) {
             try {
               const lrcRes = await functions.fetchLyrics(item);
               if (lrcRes && lrcRes.ok && lrcRes.content) {
                   fs.writeFileSync(path.join(dir, `${baseName}.lrc`), lrcRes.content);
               } else if (lrcRes && lrcRes.ok && lrcRes.format === 'lrcx' && lrcRes.dataBase64) {
                   // Try to save lrcx? or just ignore if we can't decode
                   // For now ignore complex lyrics in download to keep it simple
               }
             } catch (e) { console.error('LRC Download error', e); }
          }
          
          task.status = 'completed';
          task.progress = 100;
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'downloadList', value: state.downloads });
          
        } catch (e) {
          task.status = 'failed';
          task.error = e.message;
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'downloadList', value: state.downloads });
        }
      })();
      
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  openPlaylist: async (data) => {
    try {
      state.tempPlaylist = data;
      const playlistFile = path.join(__dirname, 'float', 'playlist.html');
      state.pages.playlist = url.pathToFileURL(playlistFile).href;
      
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 860, height: 520 } });
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.playlist });
      state.currentFloatingUrl = state.pages.playlist;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  getTempPlaylist: async () => {
    return { ok: true, data: state.tempPlaylist };
  },
  openRadio: async (_params = {}) => {
    try {
      const bgFile = path.join(__dirname, 'background', 'player.html');
      const recFile = path.join(__dirname, 'float', 'recommend.html');
      const searchFile = path.join(__dirname, 'float', 'search.html');
      const settingsFile = path.join(__dirname, 'float', 'settings.html');
      const downloadFile = path.join(__dirname, 'float', 'download.html');
      const playerFile = path.join(__dirname, 'float', 'player.html');
      const bgSettingsFile = path.join(__dirname, 'float', 'bg-settings.html');
      const debugLyricsFile = path.join(__dirname, 'float', 'debug-lyrics.html');
      const aboutFile = path.join(__dirname, 'float', 'about.html');
      const discoveryFile = path.join(__dirname, 'float', 'discovery.html');
      const historyFile = path.join(__dirname, 'float', 'history.html');

      const params = {
        title: '音乐电台',
        icon: 'ri-radio-line',
        eventChannel: state.eventChannel,
        subscribeTopics: [state.eventChannel],
        callerPluginId: 'music-radio',
        width: 1680,
        height: 960,
        floatingSizePercent: 60,
        floatingWidth: 860,
        floatingHeight: 520,
        centerItems: [
          { id: 'tab-discovery', text: '发现', icon: 'ri-compass-3-line' },
          { id: 'tab-search', text: '搜索', icon: 'ri-search-line' },
          { id: 'tab-history', text: '历史', icon: 'ri-history-line' }
        ],
        leftItems: [
          { id: 'btn-settings', text: '设置', icon: 'ri-settings-3-line' },
          { id: 'btn-download', text: '下载', icon: 'ri-download-line' }
        ],
        backgroundUrl: url.pathToFileURL(bgFile).href,
        floatingUrl: null,
        floatingBounds: 'center'
      };

      state.pages.recommend = url.pathToFileURL(recFile).href;
      state.pages.search = url.pathToFileURL(searchFile).href;
      state.pages.settings = url.pathToFileURL(settingsFile).href;
      state.pages.download = url.pathToFileURL(downloadFile).href;
      state.pages.player = url.pathToFileURL(playerFile).href;
      state.pages.bgSettings = url.pathToFileURL(bgSettingsFile).href;
      state.pages.debugLyrics = url.pathToFileURL(debugLyricsFile).href;
      state.pages.about = url.pathToFileURL(aboutFile).href;
      state.pages.discovery = url.pathToFileURL(discoveryFile).href;
      state.pages.history = url.pathToFileURL(historyFile).href;

      await pluginApi.call('ui.lowbar', 'openTemplate', [params]);
      state.currentFloatingUrl = null;
      try {
        if (state.currentIndex >= 0 && state.currentIndex < state.playlist.length) {
          const cur = state.playlist[state.currentIndex];
          const g = await functions.getPlayUrl(cur, 'standard');
          if (g && g.ok && g.url) {
            await functions.setBackgroundMusic({ music: g.url, album: cur.cover, albumName: cur.album, title: cur.title, artist: cur.artist, id: cur.id, source: cur.source || 'kuwo' });
          }
        }
      } catch (e) {}
      return true;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  setBackgroundMusic: async ({ music, album, albumName, title, artist, id, source, cover }) => {
    try {
      const bgFile = path.join(__dirname, 'background', 'player.html');
      const u = new url.URL(url.pathToFileURL(bgFile).href);
      if (music) u.searchParams.set('music', String(music));
      
      let coverUrl = cover;
      // Legacy compatibility: if album argument looks like a URL, treat it as cover
      if (!coverUrl && album && (String(album).startsWith('http') || String(album).startsWith('data:') || String(album).startsWith('blob:'))) {
        coverUrl = album;
      }
      if (coverUrl) u.searchParams.set('album', String(coverUrl));

      let aName = albumName;
      // If album argument is not a URL, treat it as album name if albumName is missing
      if (!aName && album && !coverUrl) {
        aName = album;
      }
      if (aName) u.searchParams.set('albumName', String(aName));

      if (title) u.searchParams.set('title', String(title));
      if (artist) u.searchParams.set('artist', String(artist));
      
      let pCount = 0;
      if (id) {
        u.searchParams.set('id', String(id));
        // Update Play Count
        const sId = String(id);
        if (!state.playCounts[sId]) state.playCounts[sId] = 0;
        state.playCounts[sId]++;
        pCount = state.playCounts[sId];
        saveData('counts');
      }
      u.searchParams.set('playCount', String(pCount));

      if (source) u.searchParams.set('source', String(source));
      u.searchParams.set('channel', state.eventChannel);
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'backgroundUrl', value: u.href });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  enqueueTail: async (item = {}) => {
    try {
      const it = {
        ...item,
        id: String(item.id||''),
        title: String(item.title||''),
        artist: String(item.artist||''),
        album: String(item.album||''),
        cover: String(item.cover||''),
        duration: Number(item.duration||0) || 0,
        source: String(item.source||'kuwo')
      };
      if (!it.cover) it.cover = await functions.resolveCover(it);
      if (!it.id) {
        return { ok: false, error: 'invalid item' };
      }
      const wasEmpty = state.playlist.length === 0 || state.currentIndex < 0;
      state.playlist.push(it);
      addToHistory(it);
      saveData('playlist');
      if (wasEmpty) {
        state.currentIndex = 0;
        saveData('playlist');
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: it.title, artist: it.artist, playCount: state.playCounts[it.id] || 0, cover: it.cover }); } catch (e) {}
        const g = await functions.getPlayUrl(it, 'standard');
        if (g && g.ok && g.url) await functions.setBackgroundMusic({ ...it, music: g.url, albumName: it.album });
      }
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      return { ok: true, length: state.playlist.length };
    } catch (e) {
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      return { ok: false, error: e?.message || String(e) };
    }
  },
  enqueueNext: async (item = {}) => {
    try {
      const it = {
        ...item,
        id: String(item.id||''),
        title: String(item.title||''),
        artist: String(item.artist||''),
        album: String(item.album||''),
        cover: String(item.cover||''),
        duration: Number(item.duration||0) || 0,
        source: String(item.source||'kuwo')
      };
      if (!it.cover) it.cover = await functions.resolveCover(it);
      if (!it.id) {
        return { ok: false, error: 'invalid item' };
      }
      const wasEmpty = state.playlist.length === 0 || state.currentIndex < 0;
      if (wasEmpty) {
        state.playlist.push(it);
        state.currentIndex = 0;
        addToHistory(it);
        saveData('playlist');
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: it.title, artist: it.artist, playCount: state.playCounts[it.id] || 0, cover: it.cover }); } catch (e) {}
        const g = await functions.getPlayUrl(it, 'standard');
        if (g && g.ok && g.url) await functions.setBackgroundMusic({ ...it, music: g.url, albumName: it.album });
        pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
        return { ok: true, length: state.playlist.length, pos: 0 };
      } else {
        const pos = state.currentIndex >= 0 ? state.currentIndex + 1 : state.playlist.length;
        state.playlist.splice(pos, 0, it);
        addToHistory(it);
        saveData('playlist');
        pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
        // No loading screen for enqueue next if not playing
        return { ok: true, length: state.playlist.length, pos };
      }
    } catch (e) {
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      return { ok: false, error: e?.message || String(e) };
    }
  },
  playNow: async (item = {}) => {
    try {
      const id = String(item.id||'');
      if (!id) return { ok: false, error: 'invalid item id' };
      const meta = {
        ...item,
        id,
        title: String(item.title||''),
        artist: String(item.artist||''),
        album: String(item.album||''),
        cover: String(item.cover||''),
        duration: Number(item.duration||0) || 0,
        source: String(item.source||'kuwo')
      };
      if (!meta.cover) meta.cover = await functions.resolveCover(meta);
      
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: meta.title, artist: meta.artist, playCount: state.playCounts[meta.id] || 0, cover: meta.cover }); } catch (e) {}

      state.playlist.push(meta);
      state.currentIndex = state.playlist.length - 1;
      addToHistory(meta);
      saveData('playlist');
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) {
         try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
         return { ok: false, error: g?.error || 'resolve failed' };
      }
      await functions.setBackgroundMusic({ ...meta, music: g.url, albumName: meta.album });
      return { ok: true };
    } catch (e) {
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      return { ok: false, error: e?.message || String(e) };
    }
  },
  nextTrack: async (cause = 'manual') => {
    try {
      const mode = state.settings.playMode || 'sequence';
      const prevIdx = state.currentIndex;
      const len = state.playlist.length;
      if (len === 0) return { ok: false, error: 'empty playlist' };

      let nextIdx = -1;
      
      // Handle Remove After Play
      // Only active if mode is Random, Sequence, or Play Once
      const canRemove = ['random', 'sequence', 'play-once'].includes(mode);
      const shouldRemove = cause === 'ended' && state.settings.removeAfterPlay && canRemove;
      
      if (shouldRemove && prevIdx >= 0 && prevIdx < len) {
         state.playlist.splice(prevIdx, 1);
         saveData('playlist');
         pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
         
         if (state.playlist.length === 0) {
             state.currentIndex = -1;
             return { ok: false, error: 'playlist ended' };
         }

         if (mode === 'random') {
             nextIdx = Math.floor(Math.random() * state.playlist.length);
         } else if (mode === 'play-once') {
             state.currentIndex = -1; 
             return { ok: false, error: 'play once ended' };
         } else {
             // sequence
             nextIdx = prevIdx; 
             if (nextIdx >= state.playlist.length) return { ok: false, error: 'playlist ended' }; 
         }
      } else {
         if (cause === 'ended') {
             if (mode === 'single-loop') {
                 nextIdx = prevIdx;
             } else if (mode === 'play-once') {
                 return { ok: false, error: 'play once ended' };
             } else if (mode === 'random') {
                 nextIdx = Math.floor(Math.random() * len);
             } else if (mode === 'list-loop') {
                 nextIdx = (prevIdx + 1) % len;
             } else { // sequence
                 if (prevIdx >= len - 1) return { ok: false, error: 'playlist ended' };
                 nextIdx = prevIdx + 1;
             }
         } else {
             // Manual Next
             if (mode === 'random') {
                 nextIdx = Math.floor(Math.random() * len);
             } else {
                 // Sequence/PlayOnce manual -> next or stop
                 if (mode === 'sequence' || mode === 'play-once') {
                     if (prevIdx >= len - 1) return { ok: false, error: 'no next track' };
                     nextIdx = prevIdx + 1;
                 } else {
                     // List Loop, Single Loop (Manual) -> Wrap
                     nextIdx = (prevIdx + 1) % len;
                 }
             }
         }
      }

      state.currentIndex = nextIdx;
      const meta = state.playlist[nextIdx];
      
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: meta.title, artist: meta.artist, playCount: state.playCounts[meta.id] || 0, cover: meta.cover }); } catch (e) {}
      
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) {
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
        return { ok: false, error: g?.error || 'resolve failed' };
      }
      await functions.setBackgroundMusic({ ...meta, music: g.url, albumName: meta.album });
      return { ok: true };
    } catch (e) {
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      return { ok: false, error: e?.message || String(e) };
    }
  },
  prevTrack: async () => {
    try {
      const prevIdx = state.currentIndex > 0 ? state.currentIndex - 1 : -1;
      if (prevIdx < 0 || prevIdx >= state.playlist.length) return { ok: false, error: 'no previous track' };
      state.currentIndex = prevIdx;
      const meta = state.playlist[prevIdx];
      
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: meta.title, artist: meta.artist, playCount: state.playCounts[meta.id] || 0, cover: meta.cover }); } catch (e) {}
      
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) {
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
        return { ok: false, error: g?.error || 'resolve failed' };
      }
      await functions.setBackgroundMusic({ ...meta, music: g.url, albumName: meta.album });
      return { ok: true };
    } catch (e) {
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      return { ok: false, error: e?.message || String(e) };
    }
  },
  getPlaylist: async () => {
    try {
      const total = state.playlist.reduce((acc, it) => acc + (Number(it.duration)||0), 0);
      return { ok: true, items: state.playlist.slice(), currentIndex: state.currentIndex, totalSecs: total };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  setRemoveAfterPlay: async (flag = false) => {
    try { state.settings.removeAfterPlay = !!flag; saveData('settings'); return { ok: true, value: state.settings.removeAfterPlay }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  setEndTime: async (timeStr = '') => {
    try { 
        state.settings.endTime = String(timeStr || ''); 
        state.timerTriggered = false; // Reset trigger state when time changes
        saveData('settings');
        return { ok: true, value: state.settings.endTime }; 
    }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  setPauseAtEndTime: async (flag = false) => {
    try { state.settings.pauseAtEndTime = !!flag; saveData('settings'); return { ok: true, value: state.settings.pauseAtEndTime }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getSettings: async () => {
    try { return { ok: true, settings: { ...state.settings } }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  removeIndex: async (idx = 0) => {
    try {
      const i = Math.floor(Number(idx)||0);
      if (i < 0 || i >= state.playlist.length) return { ok: false, error: 'index out of range' };
      state.playlist.splice(i, 1);
      if (state.currentIndex === i) state.currentIndex = Math.min(state.currentIndex, state.playlist.length - 1);
      else if (state.currentIndex > i) state.currentIndex -= 1;
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
      return { ok: true, length: state.playlist.length };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  moveItem: async (fromIdx, toIdx) => {
    try {
      const f = Math.floor(Number(fromIdx)||0);
      const t = Math.floor(Number(toIdx)||0);
      if (f < 0 || f >= state.playlist.length || t < 0 || t >= state.playlist.length || f === t) return { ok: false };
      
      const item = state.playlist[f];
      state.playlist.splice(f, 1);
      state.playlist.splice(t, 0, item);
      
      if (state.currentIndex === f) {
        state.currentIndex = t;
      } else {
        if (f < state.currentIndex && t >= state.currentIndex) state.currentIndex--;
        else if (f > state.currentIndex && t <= state.currentIndex) state.currentIndex++;
      }
      
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  playIndex: async (idx = 0) => {
    try {
      const i = Math.floor(Number(idx)||0);
      if (i < 0 || i >= state.playlist.length) return { ok: false, error: 'index out of range' };
      state.currentIndex = i;
      const meta = state.playlist[i];
      
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: meta.title, artist: meta.artist, playCount: state.playCounts[meta.id] || 0, cover: meta.cover }); } catch (e) {}
      
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) {
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
        return { ok: false, error: g?.error || 'resolve failed' };
      }
      await functions.setBackgroundMusic({ music: g.url, album: meta.cover, albumName: meta.album, title: meta.title, artist: meta.artist, id: meta.id, source: meta.source });
      return { ok: true };
    } catch (e) {
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      return { ok: false, error: e?.message || String(e) };
    }
  },
  readFileUtf8: async (filePath) => {
    try {
      const fs = require('fs');
      const p = String(filePath || '');
      if (!p) return { ok: false, error: 'invalid path' };
      const data = fs.readFileSync(p, 'utf8');
      return { ok: true, content: data };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  onLowbarEvent: async (payload = {}) => {
    try {
      if (!payload || typeof payload !== 'object') return true;
      if (payload.type === 'update' && payload.target === 'bgModeApply') {
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'bgModeApply', value: 'apply' }); } catch (e) {}
      }
      if (payload.type === 'update' && payload.target === 'lyricsPairApply') {
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'lyricsPairApply', value: 'apply' }); } catch (e) {}
      }
      if (payload.type === 'update' && payload.target === 'floatingUrl') {
        state.currentFloatingUrl = payload.value || null;
      }
      if (payload.type === 'click' || payload.type === 'left.click') {
        if (payload.id === 'tab-discovery') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 860, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.discovery });
          state.currentFloatingUrl = state.pages.discovery;
        } else if (payload.id === 'tab-recommend') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 860, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.recommend });
          state.currentFloatingUrl = state.pages.recommend;
        } else if (payload.id === 'tab-search') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 860, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.search });
          state.currentFloatingUrl = state.pages.search;
        } else if (payload.id === 'tab-history') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 860, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.history });
          state.currentFloatingUrl = state.pages.history;
        } else if (payload.id === 'tab-settings' || payload.id === 'btn-settings') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'left-bottom' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 720, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.settings + '?tab=general' });
          state.currentFloatingUrl = state.pages.settings;
        } else if (payload.id === 'btn-download') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'left-bottom' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 720, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.settings + '?tab=download' });
          state.currentFloatingUrl = state.pages.settings;
        } else if (payload.id === 'tab-about') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'left-bottom' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 720, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.settings + '?tab=about' });
          state.currentFloatingUrl = state.pages.settings;
        } else if (payload.id === 'btn-bgmode') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'left-bottom' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 720, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.settings + '?tab=background' });
          state.currentFloatingUrl = state.pages.settings;
        } else if (payload.id === 'btn-debug-lyrics') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 920, height: 640 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.debugLyrics });
          state.currentFloatingUrl = state.pages.debugLyrics;
        }
      }
      return true;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
};

const init = async (api) => {
  pluginApi = api;
  loadData();
  
  // Start Timer Loop
  setInterval(() => {
      if (!state.settings.endTime || !state.settings.pauseAtEndTime) return;
      if (state.timerTriggered) {
          // Check if we passed the time significantly (e.g. new day), reset trigger?
          // Or if user changed time (handled in setEndTime)
          // For now, simple logic: if time matches, trigger once.
          return;
      }
      
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const [th, tm] = state.settings.endTime.split(':').map(x => parseInt(x, 10));
      
      if (h === th && m === tm) {
          state.timerTriggered = true;
          // Send pause command
          pluginApi.emit(state.eventChannel, { type: 'control', command: 'pause' });
          console.log('[MusicRadio] Timer triggered: Pausing playback');
      }
  }, 5000); // Check every 5 seconds

  api.splash.setStatus('plugin:init', '初始化 音乐电台');
  api.splash.setStatus('plugin:init', '背景为 播放器背景');
  api.splash.setStatus('plugin:init', '音乐电台加载完成');
};

module.exports = {
  name: '音乐电台',
  version: '0.1.0',
  init,
  functions: {
    ...functions,
    getVariable: async (name) => { const k=String(name||''); if (k==='timeISO') return new Date().toISOString(); return ''; },
    listVariables: () => ['timeISO']
  }
};
