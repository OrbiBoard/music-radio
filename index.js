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
  dailyHistory: [],
  playCounts: {},
  today: '',
  dataPath: path.join(__dirname, 'data'),
  currentIndex: -1,
  tempPlaylist: null,
  settings: { removeAfterPlay: true, playMode: 'sequence', endTime: '', pauseAtEndTime: false, download: { dir: '', format: '{t} - {a}', lrc: true } },
  downloads: [],
  sources: new Map(),
  timerTriggered: false,
  abortController: null
};

const loadData = () => {
  try {
    const savedSettings = pluginApi.store.get('settings');
    if (savedSettings) {
      state.settings = { ...state.settings, ...savedSettings };
      if (savedSettings.download) state.settings.download = { ...state.settings.download, ...savedSettings.download };
    }

    state.playCounts = pluginApi.store.get('playCounts') || {};
    
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    state.today = `${y}-${m}-${d}`;
    
    const todayData = pluginApi.store.get(`data_${state.today}`) || { playlist: [], history: [] };
    state.playlist = Array.isArray(todayData.playlist) ? todayData.playlist : [];
    state.dailyHistory = Array.isArray(todayData.history) ? todayData.history : [];
    
    const savedIndex = pluginApi.store.get('currentIndex');
    if (typeof savedIndex === 'number' && savedIndex >= 0 && savedIndex < state.playlist.length) {
      state.currentIndex = savedIndex;
    } else {
      state.currentIndex = -1;
    }

  } catch (e) { console.error('Load Data Error', e); }
};

const saveData = (type) => {
  try {
    if (type === 'counts') {
      pluginApi.store.set('playCounts', state.playCounts);
    } else if (type === 'history') {
      const todayData = pluginApi.store.get(`data_${state.today}`) || { playlist: [], history: [] };
      todayData.history = state.dailyHistory;
      pluginApi.store.set(`data_${state.today}`, todayData);
    } else if (type === 'playlist') {
      const todayData = pluginApi.store.get(`data_${state.today}`) || { playlist: [], history: [] };
      todayData.playlist = state.playlist;
      pluginApi.store.set(`data_${state.today}`, todayData);
      pluginApi.store.set('currentIndex', state.currentIndex);
    } else if (type === 'settings') {
      pluginApi.store.set('settings', state.settings);
    }
  } catch (e) {}
};

const checkDateChange = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${m}-${d}`;
  
  if (today !== state.today) {
    state.today = today;
    const todayData = pluginApi.store.get(`data_${state.today}`) || { playlist: [], history: [] };
    state.playlist = todayData.playlist || [];
    state.dailyHistory = todayData.history || [];
    state.currentIndex = -1;
    return true;
  }
  return false;
};

const getVisiblePlaylist = () => {
  return state.playlist.filter(item => !item.hidden);
};

const findNextVisibleIndex = (fromIdx) => {
  for (let i = fromIdx + 1; i < state.playlist.length; i++) {
    if (!state.playlist[i].hidden) return i;
  }
  for (let i = 0; i < fromIdx; i++) {
    if (!state.playlist[i].hidden) return i;
  }
  return -1;
};

const getVisibleIndex = (realIdx) => {
  if (realIdx < 0) return -1;
  let visibleCount = 0;
  for (let i = 0; i < realIdx; i++) {
    if (!state.playlist[i].hidden) visibleCount++;
  }
  return visibleCount;
};

const addToHistory = (item) => {
    if (!item || !item.id) return;
    
    checkDateChange();

    if (!item.id) return;
    const itemToSave = { ...item, id: String(item.id), addedAt: Date.now() };

    state.dailyHistory.push(itemToSave);
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
          if (!dateStr || dateStr === state.today) {
              checkDateChange();
              return { ok: true, items: state.dailyHistory.slice().reverse() };
          }
          const data = pluginApi.store.get(`data_${dateStr}`);
          if (data && Array.isArray(data.history)) {
              return { ok: true, items: data.history.slice().reverse() };
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
              const data = pluginApi.store.get(`data_${dateStr}`) || { playlist: [], history: [] };
              data.history = [];
              pluginApi.store.set(`data_${dateStr}`, data);
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
              let data = pluginApi.store.get(`data_${dateStr}`);
              if (data && Array.isArray(data.history)) {
                  const idx = data.history.findIndex(x => x.addedAt === ts);
                  if (idx >= 0) {
                      data.history.splice(idx, 1);
                      pluginApi.store.set(`data_${dateStr}`, data);
                  }
              }
          }
          return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
  },

  cancelLoading: async () => {
      try {
        if (state.abortController) {
          state.abortController.abort();
          state.abortController = null;
        }
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

  // --- Built-in Source Implementations ---
  httpProxy: async (targetUrl = '', options = {}) => {
    try {
      const u = String(targetUrl || '').trim();
      if (!u) return { ok: false, error: 'empty url' };
      const parsed = new url.URL(u);
      const wl = new Set(['search.kuwo.cn', 'newlyric.kuwo.cn']);
      if (!wl.has(parsed.host)) return { ok: false, error: 'domain not allowed' };
      const http = require('http');
      const https = require('https');
      const zlib = require('zlib');
      const method = String(options.method || 'GET').toUpperCase();
      const rawHeaders = options.headers && typeof options.headers === 'object' ? options.headers : {};
      const headers = {};
      for (const k of Object.keys(rawHeaders)) {
        const lk = k.toLowerCase();
        if (lk === 'host' || lk === 'referer' || lk === 'origin') continue;
        headers[k] = rawHeaders[k];
      }
      if (!headers['Accept-Encoding']) headers['Accept-Encoding'] = 'gzip, deflate';
      if (!headers['User-Agent']) headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
      if (!headers['Accept-Language']) headers['Accept-Language'] = 'zh-CN,zh;q=0.9';
      const body = options.body;
      async function fetchOnce(href){
        const reqMod = href.startsWith('https:') ? https : http;
        return await new Promise((resolve, reject) => {
          const req = reqMod.request(href, { method, headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              try {
                const status = res.statusCode || 0;
                const redirect = status >= 300 && status < 400 && res.headers && res.headers.location;
                const raw = Buffer.concat(chunks);
                resolve({ status, headers: res.headers, contentBuffer: raw, redirect });
              } catch (e) { reject(e); }
            });
          });
          req.on('error', reject);
          if (body && method !== 'GET' && method !== 'HEAD') {
            if (Buffer.isBuffer(body)) req.write(body);
            else req.write(String(body));
          }
          req.end();
        });
      }
      let href = u; let redirects = 0;
      while (redirects < 5) {
        const r = await fetchOnce(href);
        if (r.redirect) {
          const nextUrl = new url.URL(r.redirect, href).href;
          const nextParsed = new url.URL(nextUrl);
          if (!wl.has(nextParsed.host)) return { ok: false, error: 'redirect domain not allowed', status: r.status };
          href = nextUrl; redirects += 1; continue;
        }
        let buf = r.contentBuffer;
        const enc = (r.headers['content-encoding']||'').toLowerCase();
        if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
        else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
        const content = buf.toString('utf8');
        return { ok: true, status: r.status, headers: r.headers, content };
      }
      return { ok: false, error: 'too many redirects' };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  searchKuwo: async (keyword = '', page = 0) => {
    try {
      const q = String(keyword || '').trim();
      if (!q) return { ok: false, error: 'empty keyword' };
      const rn = 20;
      const buildUrl = (pn) => `https://search.kuwo.cn/r.s?all=${encodeURIComponent(q)}&pn=${pn}&rn=${rn}&vipver=100&ft=music&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
      async function fetchJson(urlStr){
        const res = await functions.httpProxy(urlStr, { method: 'GET', headers: { 'Accept': 'application/json, text/plain, */*' } });
        const rawTxt = String(res && res.content ? res.content : '');
        let txt = rawTxt;
        if (txt.trim()[0] !== '{') {
          const s = txt.indexOf('{'); const e = txt.lastIndexOf('}');
          if (s >= 0 && e > s) txt = txt.slice(s, e+1);
        }
        let obj = null;
        try { obj = JSON.parse(txt); } catch (e) {}
        return { obj, raw: rawTxt };
      }
      let dat = await fetchJson(buildUrl(page));
      let data = dat.obj;
      let raw = dat.raw;
      let list = Array.isArray(data?.abslist) ? data.abslist : [];
      if (!list.length) {
        dat = await fetchJson(buildUrl(page === 0 ? 1 : page));
        data = dat.obj;
        raw = dat.raw;
        list = Array.isArray(data?.abslist) ? data.abslist : [];
      }
      const items = list.map((item) => {
        const id = String(item.MUSICRID || '').replace('MUSIC_', '');
        const cover = item.web_albumpic_short
          ? `https://img3.kuwo.cn/star/albumcover/${String(item.web_albumpic_short).replace('120/', '256/')}`
          : (item.web_artistpic_short ? `https://star.kuwo.cn/star/starheads/${String(item.web_artistpic_short).replace('120/', '500/')}` : '');
        const rawTitle = item.SONGNAME || '';
        const title = rawTitle.includes('-') ? rawTitle.split('-').slice(0, -1).join('-').trim() : rawTitle;
        return { id, title, artist: item.ARTIST || '', album: item.ALBUM || '', duration: item.DURATION || 0, cover, source: 'kuwo' };
      });
      const hasMore = (data?.PN || (page||0)) * (data?.RN || rn) < (data?.TOTAL || 0);
      return { ok: true, items, hasMore, raw };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  searchBili: async (keyword = '', page = 1) => {
    try {
      const q = String(keyword || '').trim();
      if (!q) return { ok: false, error: 'empty keyword' };
      const https = require('https');
      async function fetchJson(u){ return await new Promise((resolve, reject) => { https.get(u, { headers: { 'User-Agent': 'OrbiBoard/Radio', 'Accept': 'application/json' } }, (res) => { const chunks=[]; res.on('data',(c)=>chunks.push(c)); res.on('end',()=>{ try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }catch(e){ reject(e); } }); }).on('error', reject); }); }
      const data = await fetchJson(`https://api.3r60.top/v2/bili/s/?keydown=${encodeURIComponent(q)}`);
      const arr = data && data.data && Array.isArray(data.data.result) ? data.data.result : [];
      const pageSize = 20;
      const pageArr = arr.slice(((Math.max(1, Number(page)||1)-1)*pageSize), (Math.max(1, Number(page)||1)*pageSize));
      const items = [];
      for (const it of pageArr) {
        const bvid = it && it.bvid ? String(it.bvid) : '';
        if (!bvid) continue;
        try {
          const meta = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
          const m = meta && meta.data ? meta.data : {};
          const title = String(m.title || '');
          const artist = (m.owner && m.owner.name) ? m.owner.name : '';
          const album = m.tname_v2 ? String(m.tname_v2) : (m.tname ? String(m.tname) : '');
          const duration = Number(m.duration || 0) || 0;
          const cover = m.pic ? (String(m.pic).startsWith('http') ? m.pic : ('https:' + String(m.pic))) : '';
          items.push({ id: bvid, title, artist, album, duration, cover, source: 'bili', cid: 'default' });
        } catch (e) {}
      }
      const hasMore = arr.length > (Math.max(1, Number(page)||1) * pageSize);
      return { ok: true, items, hasMore };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  getBiliPlayUrl: async (bvid = '', cid = '') => {
    try {
      state.abortController = new AbortController();
      const signal = state.abortController.signal;
      const https = require('https');
      const fs = require('fs');
      const os = require('os');
      
      async function fetchJson(u){ 
        return await new Promise((resolve, reject) => { 
          const req = https.get(u, { 
            headers: { 'User-Agent': 'OrbiBoard/Radio', 'Accept': 'application/json' },
            signal
          }, (res) => { 
            const chunks=[]; 
            res.on('data',(c)=>chunks.push(c)); 
            res.on('end',()=>{ try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }catch(e){ reject(e); } }); 
          }); 
          req.on('error', (e) => {
            if (e.name === 'AbortError') reject(new Error('cancelled'));
            else reject(e);
          });
        }); 
      }
      
      let c = String(cid || '');
      if (!c || c === 'default') {
        const v = await fetchJson(`https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(String(bvid||''))}`);
        c = v && v.data && Array.isArray(v.data) && v.data[0] && v.data[0].cid ? String(v.data[0].cid) : '';
      }
      if (!bvid || !c) return { ok: false, error: 'invalid bvid/cid' };
      const info = await fetchJson(`https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(c)}`);
      const durl = info && info.data && Array.isArray(info.data.durl) ? info.data.durl : [];
      const url0 = durl[0] && durl[0].url ? durl[0].url : null;
      if (!url0) return { ok: false, error: 'resolve failed' };
      const tempDir = require('path').join(os.tmpdir(), 'orbiboard.radio.bilibili', 'cache');
      try { if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true }); } catch (e) {}
      const fileName = `${String(bvid)}-${String(c)}.mp4`;
      const cachePath = require('path').join(tempDir, fileName);
      if (fs.existsSync(cachePath)) return { ok: true, url: require('url').pathToFileURL(cachePath).href };
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show' }); } catch (e) {}
      
      async function headSize(u){ 
        return await new Promise((resolve, reject) => { 
          const req = https.get(u, { 
            method: 'HEAD', 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36', 'Accept-Encoding': 'gzip', 'Origin': 'https://www.bilibili.com', 'Referer': `https://www.bilibili.com/${String(bvid)}` },
            signal
          }, (res) => { const len = parseInt(res.headers['content-length']||'0', 10) || 0; resolve(len); }); 
          req.on('error', (e) => {
            if (e.name === 'AbortError') reject(new Error('cancelled'));
            else reject(e);
          });
        }); 
      }
      
      async function fetchRange(u, start, end){ 
        return await new Promise((resolve, reject) => { 
          const req = https.get(u, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36', 'Accept-Encoding': 'gzip', 'Origin': 'https://www.bilibili.com', 'Referer': `https://www.bilibili.com/${String(bvid)}`, 'Range': `bytes=${start}-${end}` },
            signal
          }, (res) => { const chunks=[]; res.on('data',(c)=>chunks.push(c)); res.on('end',()=>resolve(Buffer.concat(chunks))); }); 
          req.on('error', (e) => {
            if (e.name === 'AbortError') reject(new Error('cancelled'));
            else reject(e);
          });
        }); 
      }
      
      const size = await headSize(url0);
      if (!size) return { ok: false, error: 'invalid content size' };
      const parts = 10;
      const chunk = Math.ceil(size / parts);
      const tasks = [];
      for (let i=0;i<parts;i++){ const s=i*chunk; const e=Math.min(size-1, (i+1)*chunk-1); tasks.push(fetchRange(url0, s, e)); }
      const bufs = await Promise.all(tasks);
      const out = Buffer.concat(bufs);
      fs.writeFileSync(cachePath, out);
      try {
        const files = fs.readdirSync(tempDir);
        const maxTemp = 50;
        if (files.length > maxTemp) {
          const oldest = files.sort((a,b)=>fs.statSync(require('path').join(tempDir,a)).mtime - fs.statSync(require('path').join(tempDir,b)).mtime)[0];
          try { fs.unlinkSync(require('path').join(tempDir, oldest)); } catch (e) {}
        }
      } catch (e) {}
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      return { ok: true, url: require('url').pathToFileURL(cachePath).href };
    } catch (e) {
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      if (e.message === 'cancelled') return { ok: false, error: 'cancelled', cancelled: true };
      return { ok: false, error: e?.message || String(e) };
    } finally {
      state.abortController = null;
    }
  },
  getKuwoPlayUrl: async (id, quality = 'standard') => {
    try {
      state.abortController = new AbortController();
      const https = require('https');
      const q = String(quality || 'standard');
      const api = `https://api.limeasy.cn/kwmpro/v1/?id=${encodeURIComponent(String(id||''))}&quality=${encodeURIComponent(q)}`;
      const data = await new Promise((resolve, reject) => {
        const req = https.get(api, { 
          headers: { 'User-Agent': 'OrbiBoard/Radio' },
          signal: state.abortController.signal
        }, (res) => {
          const chunks = []; res.on('data', (c) => chunks.push(c));
          res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
        });
        req.on('error', (e) => {
          if (e.name === 'AbortError') reject(new Error('cancelled'));
          else reject(e);
        });
        req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
      });
      if (data && (data.code === 200 || data.code === 201) && data.url) return { ok: true, url: data.url };
      return { ok: false, error: 'resolve failed' };
    } catch (e) {
      if (e.message === 'cancelled') return { ok: false, error: 'cancelled', cancelled: true };
      return { ok: false, error: e?.message || String(e) };
    } finally {
      state.abortController = null;
    }
  },
  fetchKuwoLyrics: async (item) => {
    try {
      const isLyricx = true;
      const id = item.id;
      const https = require('https');
      const http = require('http');
      const zlib = require('zlib');
      const bufKey = Buffer.from('yeelion');
      function buildParams(mid, lrcx){
        let params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${String(mid)}`;
        if (lrcx) params += '&lrcx=1';
        const src = Buffer.from(params);
        const out = Buffer.alloc(src.length * 2);
        let k = 0;
        for (let i=0;i<src.length;){ for (let j=0;j<bufKey.length && i<src.length; j++, i++){ out[k++] = bufKey[j] ^ src[i]; } }
        return out.slice(0, k).toString('base64');
      }
      async function inflateAsync(buf){ return await new Promise((resolve, reject) => zlib.inflate(buf, (e, r) => e ? reject(e) : resolve(r))); }
      function requestRaw(u){ return new Promise((resolve, reject) => { const lib = u.startsWith('https') ? https : http; const req = lib.get(u, (res) => { const chunks=[]; res.on('data',(c)=>chunks.push(c)); res.on('end',()=>resolve(Buffer.concat(chunks))); }).on('error', reject); req.setTimeout(15000, () => { try{req.destroy(new Error('timeout'));}catch (e) {} }); }); }
      const api = `http://newlyric.kuwo.cn/newlyric.lrc?${buildParams(id, !!isLyricx)}`;
      const raw = await requestRaw(api);
      const head = raw.toString('utf8', 0, 12);
      if (!head.startsWith('tp=content')) return { ok: false, error: 'no content' };
      const start = raw.indexOf('\r\n\r\n');
      const inflated = await inflateAsync(raw.slice(start + 4));
      if (!isLyricx) return { ok: true, format: 'plain', dataBase64: Buffer.from(inflated).toString('base64') };
      const base = Buffer.from(inflated.toString('utf8'), 'base64');
      const out = Buffer.alloc(base.length * 2);
      let k = 0;
      for (let i=0;i<base.length;){ for (let j=0;j<bufKey.length && i<base.length; j++, i++){ out[k++] = base[i] ^ bufKey[j]; } }
      return { ok: true, format: 'lrcx', dataBase64: out.slice(0, k).toString('base64') };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  fetchBiliLyrics: async (item) => {
    return { ok: false, error: 'Bilibili音源暂无内置歌词，请使用备用音源搜索' };
  },

  searchLyrics: async (query, sourceId = 'kuwo') => {
    const src = state.sources.get(sourceId);
    if (!src) return { ok: false, error: 'source not found' };
    try {
      const r = await pluginApi.call(src.pluginId, src.methods.search, [query, 1]);
      if (r && r.ok && r.result) return { ok: true, result: r.result, sourceId, sourceName: src.name };
      return r;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  fetchLyricsFromItem: async (item, sourceId = 'kuwo') => {
    const src = state.sources.get(sourceId);
    if (!src) return { ok: false, error: 'source not found' };
    try {
      const r = await pluginApi.call(src.pluginId, src.methods.getLyrics, [item]);
      if (r && r.ok && r.result) return r;
      return r;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  getBiliPages: async (bvid) => {
    try {
      const https = require('https');
      const data = await new Promise((resolve, reject) => {
        https.get(`https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`, {
          headers: { 'User-Agent': 'OrbiBoard/Radio' }
        }, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        }).on('error', reject);
      });
      if (data && data.data && Array.isArray(data.data)) {
        return { ok: true, pages: data.data.map(p => ({ cid: p.cid, title: p.part, duration: p.duration })) };
      }
      return { ok: false, error: 'no pages' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  getBiliSeason: async (bvid) => {
    try {
      const https = require('https');
      const data = await new Promise((resolve, reject) => {
        https.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
          headers: { 'User-Agent': 'OrbiBoard/Radio' }
        }, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        }).on('error', reject);
      });
      if (data && data.data && data.data.ugc_season) {
        const season = data.data.ugc_season;
        const episodes = season.sections && season.sections[0] ? season.sections[0].episodes : [];
        return { 
          ok: true, 
          season: {
            title: season.title,
            cover: season.cover,
            episodes: episodes.map(ep => ({
              bvid: ep.bvid,
              title: ep.title,
              duration: ep.page && ep.page.duration ? ep.page.duration : ep.duration,
              cover: ep.arc && ep.arc.pic ? ep.arc.pic : ''
            }))
          }
        };
      }
      return { ok: false, error: 'no season' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  getSourceContextMenuItems: (item) => {
    const srcId = item.source || 'kuwo';
    const src = state.sources.get(srcId);
    if (!src || !src.contextMenuItems) return [];
    try {
      return src.contextMenuItems(item) || [];
    } catch (e) {
      return [];
    }
  },

  executeContextMenuHandler: async (item, menuIndex) => {
    const srcId = item.source || 'kuwo';
    const src = state.sources.get(srcId);
    if (!src || !src.contextMenuItems) return { ok: false, error: 'no context menu' };
    try {
      const items = src.contextMenuItems(item) || [];
      const menuItem = items[menuIndex];
      if (!menuItem || !menuItem.handler) return { ok: false, error: 'no handler' };
      return await menuItem.handler();
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
          if (cur && !cur.hidden) {
            await functions.setBackgroundMusic({ 
              album: cur.cover, 
              albumName: cur.album, 
              title: cur.title, 
              artist: cur.artist, 
              id: cur.id, 
              source: cur.source || 'kuwo',
              playCount: state.playCounts[cur.id] || 0
            });
          }
        }
      } catch (e) {}
      return true;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  setBackgroundMusic: async ({ music, album, albumName, title, artist, id, source, cover, playCount: externalPlayCount }) => {
    try {
      const bgFile = path.join(__dirname, 'background', 'player.html');
      const u = new url.URL(url.pathToFileURL(bgFile).href);
      if (music) u.searchParams.set('music', String(music));
      
      let coverUrl = cover;
      if (!coverUrl && album && (String(album).startsWith('http') || String(album).startsWith('data:') || String(album).startsWith('blob:'))) {
        coverUrl = album;
      }
      if (coverUrl) u.searchParams.set('album', String(coverUrl));

      let aName = albumName;
      if (!aName && album && !coverUrl) {
        aName = album;
      }
      if (aName) u.searchParams.set('albumName', String(aName));

      if (title) u.searchParams.set('title', String(title));
      if (artist) u.searchParams.set('artist', String(artist));
      
      let pCount = 0;
      if (id) {
        u.searchParams.set('id', String(id));
        if (music) {
          const sId = String(id);
          if (!state.playCounts[sId]) state.playCounts[sId] = 0;
          state.playCounts[sId]++;
          pCount = state.playCounts[sId];
          saveData('counts');
        } else if (typeof externalPlayCount === 'number') {
          pCount = externalPlayCount;
        } else {
          pCount = state.playCounts[String(id)] || 0;
        }
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
      const wasEmpty = getVisiblePlaylist().length === 0 || state.currentIndex < 0;
      state.playlist.push(it);
      addToHistory(it);
      saveData('playlist');
      if (wasEmpty) {
        state.currentIndex = state.playlist.length - 1;
        saveData('playlist');
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: it.title, artist: it.artist, playCount: state.playCounts[it.id] || 0, cover: it.cover }); } catch (e) {}
        const g = await functions.getPlayUrl(it, 'standard');
        if (g && g.ok && g.url) await functions.setBackgroundMusic({ ...it, music: g.url, albumName: it.album });
        else if (g && g.cancelled) {
          try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
          return { ok: false, error: 'cancelled', cancelled: true };
        }
      }
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: getVisiblePlaylist().length } });
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      return { ok: true, length: getVisiblePlaylist().length };
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
      const wasEmpty = getVisiblePlaylist().length === 0 || state.currentIndex < 0;
      if (wasEmpty) {
        state.playlist.push(it);
        state.currentIndex = state.playlist.length - 1;
        addToHistory(it);
        saveData('playlist');
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: it.title, artist: it.artist, playCount: state.playCounts[it.id] || 0, cover: it.cover }); } catch (e) {}
        const g = await functions.getPlayUrl(it, 'standard');
        if (g && g.ok && g.url) await functions.setBackgroundMusic({ ...it, music: g.url, albumName: it.album });
        else if (g && g.cancelled) {
          try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
          return { ok: false, error: 'cancelled', cancelled: true };
        }
        pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: getVisiblePlaylist().length } });
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
        return { ok: true, length: getVisiblePlaylist().length, pos: 0 };
      } else {
        const pos = state.currentIndex >= 0 ? state.currentIndex + 1 : state.playlist.length;
        state.playlist.splice(pos, 0, it);
        addToHistory(it);
        saveData('playlist');
        pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: getVisiblePlaylist().length } });
        return { ok: true, length: getVisiblePlaylist().length, pos };
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
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: getVisiblePlaylist().length } });
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) {
         try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
         if (g && g.cancelled) return { ok: false, error: 'cancelled', cancelled: true };
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
      const visible = getVisiblePlaylist();
      const visibleLen = visible.length;
      if (visibleLen === 0) return { ok: false, error: 'empty playlist' };

      let nextIdx = -1;
      
      const canRemove = ['random', 'sequence', 'play-once'].includes(mode);
      const shouldRemove = cause === 'ended' && state.settings.removeAfterPlay && canRemove;
      
      if (shouldRemove && prevIdx >= 0 && prevIdx < state.playlist.length) {
         state.playlist[prevIdx].hidden = true;
         saveData('playlist');
         pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: getVisiblePlaylist().length } });
         
         const newVisible = getVisiblePlaylist();
         if (newVisible.length === 0) {
             state.currentIndex = -1;
             return { ok: false, error: 'playlist ended' };
         }

         if (mode === 'random') {
             const randomItem = newVisible[Math.floor(Math.random() * newVisible.length)];
             nextIdx = state.playlist.findIndex(it => !it.hidden && it.id === randomItem.id && it === randomItem);
         } else if (mode === 'play-once') {
             state.currentIndex = -1; 
             return { ok: false, error: 'play once ended' };
         } else {
             nextIdx = findNextVisibleIndex(prevIdx);
             if (nextIdx < 0) return { ok: false, error: 'playlist ended' }; 
         }
      } else {
         if (cause === 'ended') {
             if (mode === 'single-loop') {
                 nextIdx = prevIdx;
             } else if (mode === 'play-once') {
                 return { ok: false, error: 'play once ended' };
             } else if (mode === 'random') {
                 const randomItem = visible[Math.floor(Math.random() * visibleLen)];
                 nextIdx = state.playlist.findIndex(it => !it.hidden && it.id === randomItem.id && it === randomItem);
             } else if (mode === 'list-loop') {
                 nextIdx = findNextVisibleIndex(prevIdx);
                 if (nextIdx < 0) nextIdx = findNextVisibleIndex(-1);
             } else {
                 nextIdx = findNextVisibleIndex(prevIdx);
                 if (nextIdx < 0) return { ok: false, error: 'playlist ended' };
             }
         } else {
             if (mode === 'random') {
                 const randomItem = visible[Math.floor(Math.random() * visibleLen)];
                 nextIdx = state.playlist.findIndex(it => !it.hidden && it.id === randomItem.id && it === randomItem);
             } else {
                 nextIdx = findNextVisibleIndex(prevIdx);
                 if (nextIdx < 0) {
                     if (mode === 'list-loop' || mode === 'single-loop') {
                         nextIdx = findNextVisibleIndex(-1);
                     } else {
                         return { ok: false, error: 'no next track' };
                     }
                 }
             }
         }
      }

      if (nextIdx < 0 || nextIdx >= state.playlist.length || state.playlist[nextIdx].hidden) {
          return { ok: false, error: 'no valid next track' };
      }

      state.currentIndex = nextIdx;
      const meta = state.playlist[nextIdx];
      
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: meta.title, artist: meta.artist, playCount: state.playCounts[meta.id] || 0, cover: meta.cover }); } catch (e) {}
      
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) {
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
        if (g && g.cancelled) return { ok: false, error: 'cancelled', cancelled: true };
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
      let prevIdx = -1;
      for (let i = state.currentIndex - 1; i >= 0; i--) {
        if (!state.playlist[i].hidden) { prevIdx = i; break; }
      }
      if (prevIdx < 0) {
          for (let i = state.playlist.length - 1; i > state.currentIndex; i--) {
            if (!state.playlist[i].hidden) { prevIdx = i; break; }
          }
      }
      if (prevIdx < 0) return { ok: false, error: 'no previous track' };
      state.currentIndex = prevIdx;
      const meta = state.playlist[prevIdx];
      
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: meta.title, artist: meta.artist, playCount: state.playCounts[meta.id] || 0, cover: meta.cover }); } catch (e) {}
      
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) {
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
        if (g && g.cancelled) return { ok: false, error: 'cancelled', cancelled: true };
        return { ok: false, error: g?.error || 'resolve failed' };
      }
      await functions.setBackgroundMusic({ ...meta, music: g.url, albumName: meta.album });
      return { ok: true };
    } catch (e) {
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
      return { ok: false, error: e?.message || String(e) };
    }
  },
  playCurrent: async () => {
    try {
      if (state.currentIndex < 0 || state.currentIndex >= state.playlist.length) {
        return { ok: false, error: 'no current track' };
      }
      const meta = state.playlist[state.currentIndex];
      if (!meta || meta.hidden) {
        return { ok: false, error: 'current track not available' };
      }
      
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: meta.title, artist: meta.artist, playCount: state.playCounts[meta.id] || 0, cover: meta.cover }); } catch (e) {}
      
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) {
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
        if (g && g.cancelled) return { ok: false, error: 'cancelled', cancelled: true };
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
      const visible = getVisiblePlaylist();
      const total = visible.reduce((acc, it) => acc + (Number(it.duration)||0), 0);
      const visibleCurrentIdx = getVisibleIndex(state.currentIndex);
      return { ok: true, items: visible, currentIndex: visibleCurrentIdx, totalSecs: total };
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
  setLyricFallbackSource: async (sourceId = 'kuwo') => {
    try { state.settings.lyricFallbackSource = String(sourceId || 'kuwo'); saveData('settings'); return { ok: true, value: state.settings.lyricFallbackSource }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  setAutoSearchLyrics: async (flag = false) => {
    try { state.settings.autoSearchLyrics = !!flag; saveData('settings'); return { ok: true, value: state.settings.autoSearchLyrics }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  setLyricSearchCountdown: async (seconds = 10) => {
    try { state.settings.lyricSearchCountdown = Math.max(3, Math.min(30, parseInt(seconds, 10) || 10)); saveData('settings'); return { ok: true, value: state.settings.lyricSearchCountdown }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getSettings: async () => {
    try { return { ok: true, settings: { ...state.settings } }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  removeIndex: async (idx = 0) => {
    try {
      const visibleIdx = Math.floor(Number(idx)||0);
      const visible = getVisiblePlaylist();
      if (visibleIdx < 0 || visibleIdx >= visible.length) return { ok: false, error: 'index out of range' };
      
      const targetItem = visible[visibleIdx];
      const i = state.playlist.findIndex(it => !it.hidden && it === targetItem);
      if (i < 0) return { ok: false, error: 'item not found' };
      
      state.playlist[i].hidden = true;
      saveData('playlist');
      
      if (state.currentIndex === i) state.currentIndex = findNextVisibleIndex(i);
      else if (state.currentIndex > i) state.currentIndex -= 1;
      
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: getVisiblePlaylist().length } });
      return { ok: true, length: getVisiblePlaylist().length };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  moveItem: async (fromIdx, toIdx) => {
    try {
      const visible = getVisiblePlaylist();
      const visibleFrom = Math.floor(Number(fromIdx)||0);
      const visibleTo = Math.floor(Number(toIdx)||0);
      
      if (visibleFrom < 0 || visibleFrom >= visible.length || visibleTo < 0 || visibleTo >= visible.length || visibleFrom === visibleTo) return { ok: false };
      
      const fromItem = visible[visibleFrom];
      const toItem = visible[visibleTo];
      
      const f = state.playlist.findIndex(it => !it.hidden && it === fromItem);
      const t = state.playlist.findIndex(it => !it.hidden && it === toItem);
      
      if (f < 0 || t < 0 || f === t) return { ok: false };
      
      const item = state.playlist[f];
      state.playlist.splice(f, 1);
      state.playlist.splice(t, 0, item);
      
      if (state.currentIndex === f) {
        state.currentIndex = t;
      } else {
        if (f < state.currentIndex && t >= state.currentIndex) state.currentIndex--;
        else if (f > state.currentIndex && t <= state.currentIndex) state.currentIndex++;
      }
      
      saveData('playlist');
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: getVisiblePlaylist().length } });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  playIndex: async (idx = 0) => {
    try {
      const visibleIdx = Math.floor(Number(idx)||0);
      const visible = getVisiblePlaylist();
      if (visibleIdx < 0 || visibleIdx >= visible.length) return { ok: false, error: 'index out of range' };
      
      const targetItem = visible[visibleIdx];
      const realIdx = state.playlist.findIndex(it => !it.hidden && it === targetItem);
      if (realIdx < 0) return { ok: false, error: 'item not found' };
      
      state.currentIndex = realIdx;
      const meta = state.playlist[realIdx];
      
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show', title: meta.title, artist: meta.artist, playCount: state.playCounts[meta.id] || 0, cover: meta.cover }); } catch (e) {}
      
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) {
        try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch (e) {}
        if (g && g.cancelled) return { ok: false, error: 'cancelled', cancelled: true };
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
  
  // Register Built-in Sources
  state.sources.set('kuwo', {
      name: '酷我',
      pluginId: 'music-radio',
      methods: { search: 'searchKuwo', getPlayUrl: 'getKuwoPlayUrl', getLyrics: 'fetchKuwoLyrics', getMusicInfo: 'searchKuwo' }
  });
  state.sources.set('bili', {
      name: 'Bilibili',
      pluginId: 'music-radio',
      methods: { search: 'searchBili', getPlayUrl: 'getBiliPlayUrl', getLyrics: 'fetchBiliLyrics' },
      contextMenuItems: (item) => {
        const bvid = item.id;
        if (!bvid) return [];
        return [
          {
            label: '查看分P',
            icon: 'ri-play-list-2-line',
            handler: async () => {
              const r = await functions.getBiliPages(bvid);
              if (r && r.ok && r.pages && r.pages.length > 0) {
                const items = r.pages.map((p, idx) => ({
                  id: bvid,
                  cid: p.cid,
                  title: p.title || `P${idx + 1}`,
                  artist: item.title || '',
                  duration: p.duration,
                  cover: '',
                  source: 'bili'
                }));
                return { ok: true, type: 'playlist', items, title: `${item.title || '分P列表'} - 共${items.length}个` };
              }
              return { ok: false, error: '该视频没有分P' };
            }
          },
          {
            label: '查看合集',
            icon: 'ri-folder-music-line',
            handler: async () => {
              const r = await functions.getBiliSeason(bvid);
              if (r && r.ok && r.season) {
                const items = r.season.episodes.map(ep => ({
                  id: ep.bvid,
                  cid: 'default',
                  title: ep.title,
                  artist: r.season.title,
                  duration: ep.duration,
                  cover: ep.cover,
                  source: 'bili'
                }));
                return { ok: true, type: 'playlist', items, title: `${r.season.title} - 共${items.length}个` };
              }
              return { ok: false, error: '该视频不属于任何合集' };
            }
          }
        ];
      }
  });

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
    // Expose for self-registration
    searchKuwo: functions.searchKuwo,
    searchBili: functions.searchBili,
    getKuwoPlayUrl: functions.getKuwoPlayUrl,
    getBiliPlayUrl: functions.getBiliPlayUrl,
    fetchKuwoLyrics: functions.fetchKuwoLyrics,
    fetchBiliLyrics: functions.fetchBiliLyrics,
    
    getVariable: async (name) => { const k=String(name||''); if (k==='timeISO') return new Date().toISOString(); return ''; },
    listVariables: () => ['timeISO']
  }
};
