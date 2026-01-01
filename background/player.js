window.addEventListener('DOMContentLoaded', () => {
  const params = new URL(location.href).searchParams;
  const musicUrl = params.get('music') || '';
  const albumUrl = params.get('album') || '';
  const title = params.get('title') || '';
  const artist = params.get('artist') || '';
  const audioBar = document.getElementById('audioBar');
  const audio = document.getElementById('audio');
  const audioCover = document.getElementById('audioCover');
  const audioTitle = document.getElementById('audioTitle');
  const audioArtist = document.getElementById('audioArtist');
  const progressBar = document.getElementById('audioProgressBar');
  const progress = document.getElementById('audioProgress');
  const progressDot = document.getElementById('audioProgressDot');
  const bgRule = document.getElementById('bgRule');
  const spectrumCanvas = document.getElementById('audioSpectrum');
  const musicId = params.get('id') || '';
  const lyricsLoading = document.getElementById('lyricsLoading');
  const songLoading = document.getElementById('songLoading');
  const musicSource = params.get('source') || '';
  const biliFloat = document.getElementById('biliVideoFloat');
  const biliVideo = document.getElementById('biliVideo');
  const biliToolbar = document.getElementById('biliToolbar');
  const biliCollapseBtn = document.getElementById('biliCollapseBtn');
  const biliExpandBtn = document.getElementById('biliExpandBtn');
  const bgModePanel = document.getElementById('bgModePanel');
  try {
    if (!localStorage.getItem('radio.icon.scale.min')) localStorage.setItem('radio.icon.scale.min','1.00');
    if (!localStorage.getItem('radio.icon.scale.max')) localStorage.setItem('radio.icon.scale.max','2.50');
    if (!localStorage.getItem('radio.analysis.fftSize')) localStorage.setItem('radio.analysis.fftSize','2048');
    if (!localStorage.getItem('radio.analysis.smoothing')) localStorage.setItem('radio.analysis.smoothing','0.6');
    if (!localStorage.getItem('radio.tempo.factor.min')) localStorage.setItem('radio.tempo.factor.min','0.85');
    if (!localStorage.getItem('radio.tempo.factor.max')) localStorage.setItem('radio.tempo.factor.max','1.25');
    if (!localStorage.getItem('radio.volume.weight')) localStorage.setItem('radio.volume.weight','0.7');
    if (!localStorage.getItem('radio.volume.boost')) localStorage.setItem('radio.volume.boost','14');
    if (!localStorage.getItem('radio.volume.smoothing')) localStorage.setItem('radio.volume.smoothing','0.9');
    if (!localStorage.getItem('radio.icon.scale.gamma')) localStorage.setItem('radio.icon.scale.gamma','0.4');
    if (!localStorage.getItem('radio.band.alpha')) localStorage.setItem('radio.band.alpha','0.7');
    if (!localStorage.getItem('radio.band.base.smoothing')) localStorage.setItem('radio.band.base.smoothing','0.97');
    if (!localStorage.getItem('radio.band.gain1')) localStorage.setItem('radio.band.gain1','1.0');
    if (!localStorage.getItem('radio.band.gain2')) localStorage.setItem('radio.band.gain2','1.1');
    if (!localStorage.getItem('radio.band.gain3')) localStorage.setItem('radio.band.gain3','1.25');
    if (!localStorage.getItem('radio.band.gain4')) localStorage.setItem('radio.band.gain4','1.5');
    if (!localStorage.getItem('radio.shine.audioReactive')) localStorage.setItem('radio.shine.audioReactive','1');
    if (!localStorage.getItem('radio.lyric.pair.ms')) localStorage.setItem('radio.lyric.pair.ms','600');
    if (!localStorage.getItem('radio.lyric.back.ms')) localStorage.setItem('radio.lyric.back.ms','300');
  } catch {}
  let audioCtx = null;
  let analyser = null;
  let mediaSrc = null;
  let freqBuf = null;
  let timeBuf = null;
  let spectrumCtx = null;
  let spectrumEnabled = false;
  let lastSpecDrawTs = 0;
  let specEma = null;
  let specRanges = null;
  let specBars = 48;
  let scaleLast = [1,1,1,1];
  let analysisRunning = false;
  let lastSpec = null;
  let fluxEma = 0;
  let lastPeakTs = 0;
  const peakTimes = [];
  let tempoSmooth = 1;
  let volEma = 0;
  function setRotatePlayState(running){
    try {
      const ex = document.getElementById('EX_background_fluentShine');
      if (!ex) return;
      const arr = ex.querySelectorAll('.fluentShine');
      arr.forEach((el)=>{ el.style.animationPlayState = running ? 'running' : 'paused'; });
    } catch {}
  }
  function updateRotateDurations(k){
    const style = document.getElementById('EX_background_fluentShine_style');
    if (!style) return;
    let baseStr = style.dataset && style.dataset.baseDur ? style.dataset.baseDur : '';
    let base = null;
    if (baseStr) {
      base = baseStr.split(',').map(x=>parseFloat(x)).filter(x=>Number.isFinite(x)&&x>0);
    }
    if (!base || base.length!==4){
      const txt = String(style.textContent||'');
      const re = /\.fluentShine:nth-child\((\d)\)\{animation:[^ ]+ ([0-9.]+)s/gi;
      const arr = [null,null,null,null];
      let m;
      while ((m = re.exec(txt))) { const idx = parseInt(m[1],10)-1; if (idx>=0&&idx<4) arr[idx] = parseFloat(m[2]); }
      base = arr.map((v,i)=>Number.isFinite(v)?v:[15,12,18,14][i]);
      if (style.dataset) style.dataset.baseDur = base.join(',');
    }
    const dur = base.map(v=>v*Math.max(0.5, Math.min(2.0, k)));
    let txt = String(style.textContent||'');
    txt = txt.replace(/(\.fluentShine:nth-child\(1\)\{animation:[^ ]+ )([0-9.]+)(s)/, `$1${dur[0]}$3`);
    txt = txt.replace(/(\.fluentShine:nth-child\(2\)\{animation:[^ ]+ )([0-9.]+)(s)/, `$1${dur[1]}$3`);
    txt = txt.replace(/(\.fluentShine:nth-child\(3\)\{animation:[^ ]+ )([0-9.]+)(s)/, `$1${dur[2]}$3`);
    txt = txt.replace(/(\.fluentShine:nth-child\(4\)\{animation:[^ ]+ )([0-9.]+)(s)/, `$1${dur[3]}$3`);
    style.textContent = txt;
  }
  function setupAudioAnalysis(){
    if (!audio) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    } catch { return; }
    if (!audioCtx) return;
    try {
      if (!analyser) analyser = audioCtx.createAnalyser();
      analyser.fftSize = (parseInt(localStorage.getItem('radio.analysis.fftSize')||'2048',10)||2048);
      analyser.smoothingTimeConstant = Math.min(0.99, Math.max(0, parseFloat(localStorage.getItem('radio.analysis.smoothing')||'0.8')));
      if (!mediaSrc) mediaSrc = audioCtx.createMediaElementSource(audio);
      mediaSrc.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqBuf = new Uint8Array(analyser.frequencyBinCount);
      try { timeBuf = new Float32Array(analyser.fftSize || 2048); } catch { timeBuf = new Float32Array(2048); }
      analysisRunning = true;
    } catch {}
    spectrumEnabled = (String(localStorage.getItem('radio.spectrum.enabled')||'1') !== '0');
    try {
      if (spectrumCanvas) {
        spectrumCtx = spectrumCanvas.getContext('2d');
        const resize = () => {
          const bar = document.getElementById('audioBar');
          const rect = bar ? bar.getBoundingClientRect() : { width: spectrumCanvas.clientWidth, height: spectrumCanvas.clientHeight };
          spectrumCanvas.width = Math.max(1, Math.floor(rect.width || spectrumCanvas.clientWidth));
          spectrumCanvas.height = Math.max(1, Math.floor(rect.height || spectrumCanvas.clientHeight));
        };
        resize();
        window.addEventListener('resize', resize);
        spectrumCanvas.style.display = spectrumEnabled ? '' : 'none';
      }
    } catch {}
    const ch = new URL(location.href).searchParams.get('channel')||'';
    const ids = ['tab-recommend','tab-search','tab-settings','tab-about'];
    const minScale = Math.max(1, parseFloat(localStorage.getItem('radio.icon.scale.min')||'1.0'));
    const maxScale = Math.max(minScale, parseFloat(localStorage.getItem('radio.icon.scale.max')||'2.5'));
    const gamma = Math.min(2, Math.max(0.1, parseFloat(localStorage.getItem('radio.icon.scale.gamma')||'0.4')));
    const baseSmooth = Math.min(0.999, Math.max(0, parseFloat(localStorage.getItem('radio.band.base.smoothing')||'0.95')));
    const mixAlpha = Math.max(0, Math.min(1, parseFloat(localStorage.getItem('radio.band.alpha')||'0.7')));
    const bandG = [
      parseFloat(localStorage.getItem('radio.band.gain1')||'1.0'),
      parseFloat(localStorage.getItem('radio.band.gain2')||'1.1'),
      parseFloat(localStorage.getItem('radio.band.gain3')||'1.25'),
      parseFloat(localStorage.getItem('radio.band.gain4')||'1.5')
    ];
    const bins = analyser ? analyser.frequencyBinCount : 0;
    const sr = audioCtx.sampleRate||44100;
    function fToBin(f){ const nyq = sr/2; const idx = Math.floor((f/nyq)*(bins-1)); return Math.max(0, Math.min(bins-1, idx)); }
    const ranges = [ [20,250],[250,1000],[1000,4000],[4000,16000] ].map(([a,b])=>[fToBin(a),fToBin(b)]);
    try {
      const fMin = 30, fMax = 16000;
      const logMin = Math.log(fMin), logMax = Math.log(fMax);
      const bars = Math.max(16, Math.min(96, specBars||48));
      const out = [];
      for (let i=0;i<bars;i++){
        const f1 = Math.exp(logMin + (i/bars)*(logMax - logMin));
        const f2 = Math.exp(logMin + ((i+1)/bars)*(logMax - logMin));
        const s = fToBin(f1), e = fToBin(f2);
        out.push([Math.min(s,e), Math.max(s,e)]);
      }
      specRanges = out;
      specEma = new Array(specRanges.length).fill(0);
      specBars = bars;
    } catch {}
    const ema = [0,0,0,0];
    const baseEma = [0,0,0,0];
    const bandV = [0,0,0,0];
    let lastEmitTs = 0;
    let lastTempoTs = 0;
    function loop(){
      if (!analysisRunning || !analyser) return;
      try { analyser.getByteFrequencyData(freqBuf); } catch { requestAnimationFrame(loop); return; }
      try { if (timeBuf && timeBuf.length) analyser.getFloatTimeDomainData(timeBuf); } catch {}
      for (let i=0;i<4;i++){
        const [s,e] = ranges[i];
        let sum=0; let n=Math.max(1, e-s+1);
        for (let k=s;k<=e;k++) sum+=freqBuf[k]||0;
        const v = sum/(n*255);
        ema[i] = ema[i] ? (ema[i]*0.85 + v*0.15) : v;
        baseEma[i] = baseEma[i] ? (baseEma[i]*baseSmooth + v*(1-baseSmooth)) : v;
        bandV[i] = v;
      }
      if (!lastSpec) lastSpec = new Float32Array(freqBuf.length);
      let flux = 0;
      for (let i=0;i<freqBuf.length;i++){ const d = (freqBuf[i]||0) - (lastSpec[i]||0); if (d>0) flux += d; lastSpec[i] = freqBuf[i]; }
      fluxEma = fluxEma ? (fluxEma*0.9 + flux*0.1) : flux;
      const thr = fluxEma*1.6;
      const now = Date.now();
      if (flux>thr && (now - lastPeakTs) > 250){ lastPeakTs = now; peakTimes.push(now); while (peakTimes.length && (now - peakTimes[0]) > 8000) peakTimes.shift(); }
      const shineReactive = (String(localStorage.getItem('radio.shine.audioReactive')||'1') !== '0');
      if (shineReactive && (now - lastTempoTs > 1000)){
        lastTempoTs = now;
        let bpm = 0;
        if (peakTimes.length >= 2){ const span = (peakTimes[peakTimes.length-1] - peakTimes[0]) / 1000; const count = peakTimes.length - 1; if (span>0) bpm = (count/span)*60; }
        const minF = Math.max(0.5, parseFloat(localStorage.getItem('radio.tempo.factor.min')||'0.85'));
        const maxF = Math.max(minF, parseFloat(localStorage.getItem('radio.tempo.factor.max')||'1.25'));
        const k = bpm>0 ? Math.pow(120/Math.max(60, Math.min(180, bpm)), 0.5) : 1;
        tempoSmooth = tempoSmooth ? (tempoSmooth*0.9 + k*0.1) : k;
        const kClamped = Math.max(minF, Math.min(maxF, tempoSmooth));
        updateRotateDurations(kClamped);
      }
      const volBoost = Math.max(1, parseFloat(localStorage.getItem('radio.volume.boost')||'14'));
      const volSmooth = Math.min(0.99, Math.max(0, parseFloat(localStorage.getItem('radio.volume.smoothing')||'0.7')));
      let rms = 0;
      if (timeBuf && timeBuf.length) {
        let sumSq = 0; const n = timeBuf.length;
        for (let i=0;i<n;i++) { const v = timeBuf[i]||0; sumSq += v*v; }
        rms = Math.sqrt(sumSq / Math.max(1, timeBuf.length));
      }
      volEma = volEma ? (volEma*volSmooth + rms*(1-volSmooth)) : rms;
      const tVol = Math.max(0, Math.min(1, volEma * volBoost));
      const wVol = Math.max(0, Math.min(1, parseFloat(localStorage.getItem('radio.volume.weight')||'0.7')));
      const volFloor = Math.max(0, Math.min(0.9, parseFloat(localStorage.getItem('radio.volume.floor')||'0.25')));
      const volPower = Math.max(1, Math.min(4, parseFloat(localStorage.getItem('radio.volume.power')||'1.5')));
      let tVolEff = 0;
      if (tVol > volFloor) {
        tVolEff = Math.pow((tVol - volFloor) / Math.max(1e-6, (1 - volFloor)), volPower);
        tVolEff = Math.max(0, Math.min(1, tVolEff));
      }
      const scales = [0,1,2,3].map((i)=>{
        const base = Math.max(1e-6, baseEma[i]||1e-6);
        const rel = Math.max(0, (bandV[i]||0) - base) / base;
        const tRaw = Math.max(0, Math.min(1, rel * bandG[i]));
        const tBand = Math.max(0, Math.min(1, mixAlpha * tRaw + (1 - mixAlpha) * (bandV[i]||0)));
        const tBandGamma = Math.pow(tBand, gamma);
        const tBandAdj = tBandGamma * (0.75 + 0.25 * tVolEff);
        const tMix = Math.max(0, Math.min(1, tBandAdj * (1 + wVol * tVolEff)));
        return minScale + tMix*(maxScale-minScale);
      });
      let needEmit = false;
      for (let i=0;i<4;i++){ if (Math.abs(scales[i]-scaleLast[i])>0.01) { needEmit=true; break; } }
      const now2 = Date.now();
      if (needEmit && (now2 - lastEmitTs > 33)){
        lastEmitTs = now2;
        try {
          const ex2 = document.getElementById('EX_background_fluentShine');
          if (ex2 && (String(localStorage.getItem('radio.shine.audioReactive')||'1') !== '0')) {
            ex2.style.setProperty('--shine-s1', String(scales[0]||1));
            ex2.style.setProperty('--shine-s2', String(scales[1]||1));
            ex2.style.setProperty('--shine-s3', String(scales[2]||1));
            ex2.style.setProperty('--shine-s4', String(scales[3]||1));
          }
        } catch {}
        scaleLast = scales;
      }
      try {
        const nowDraw = Date.now();
        if (spectrumEnabled && spectrumCtx && freqBuf && freqBuf.length && (nowDraw - lastSpecDrawTs > 33)) {
          lastSpecDrawTs = nowDraw;
          const w = spectrumCanvas.width;
          const h = spectrumCanvas.height;
          spectrumCtx.clearRect(0,0,w,h);
          const rangesArr = Array.isArray(specRanges) && specRanges.length ? specRanges : [[0, Math.max(0, Math.min(freqBuf.length-1, Math.floor(freqBuf.length/2)))]];
          if (!specEma || specEma.length !== rangesArr.length) specEma = new Array(rangesArr.length).fill(0);
          const bars = rangesArr.length;
          const bw = Math.max(1, Math.floor(w / Math.max(1,bars)));
          const alpha = 0.6;
          const gamma = 0.8;
          for (let i=0;i<bars;i++){
            const [s,e] = rangesArr[i];
            let sum = 0; const n = Math.max(1, e - s + 1);
            for (let k = s; k <= e; k++){ sum += freqBuf[k]||0; }
            const v = sum / n;
            specEma[i] = specEma[i] ? (specEma[i]*alpha + v*(1-alpha)) : v;
            let pct = Math.max(0, Math.min(1, specEma[i]/255));
            pct = Math.pow(pct, gamma);
            const bh = Math.max(1, Math.floor(pct * h));
            const x = i*bw;
            const y = h - bh;
            spectrumCtx.fillStyle = 'rgba(255,255,255,0.45)';
            spectrumCtx.fillRect(x, y, bw-1, bh);
          }
        }
      } catch {}
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
  let biliMode = localStorage.getItem('radio.biliVideo.mode') || 'float';
  function applyBiliMode(){ try {
    if (!biliFloat || !biliToolbar) return;
    if (musicSource !== 'bili') { biliFloat.style.display = 'none'; biliToolbar.style.display = 'none'; return; }
    const nowLeft = document.querySelector('.now-left');
    const lyr = document.getElementById('lyrics');
    biliToolbar.style.display = 'flex';
    if (biliMode === 'hidden') {
      biliFloat.style.display = 'none';
      biliFloat.classList.remove('expand');
      biliToolbar.classList.remove('overlay');
      if (nowLeft) nowLeft.style.display = '';
      if (lyr) lyr.style.display = '';
      if (biliCollapseBtn) biliCollapseBtn.innerHTML = '<i class="ri-add-line"></i> 展开';
      if (biliExpandBtn) biliExpandBtn.innerHTML = '<i class="ri-expand-diagonal-line"></i> 放大';
    } else if (biliMode === 'expand') {
      biliFloat.style.display = 'block';
      biliFloat.classList.add('expand');
      biliToolbar.classList.add('overlay');
      if (nowLeft) nowLeft.style.display = 'none';
      if (lyr) lyr.style.display = 'none';
      if (biliExpandBtn) biliExpandBtn.innerHTML = '<i class="ri-contract-left-right-line"></i> 缩小';
      if (biliCollapseBtn) biliCollapseBtn.innerHTML = '<i class="ri-subtract-line"></i> 收起';
    } else {
      biliFloat.style.display = 'block';
      biliFloat.classList.remove('expand');
      biliToolbar.classList.remove('overlay');
      if (nowLeft) nowLeft.style.display = '';
      if (lyr) lyr.style.display = '';
      if (biliCollapseBtn) biliCollapseBtn.innerHTML = '<i class="ri-subtract-line"></i> 收起';
      if (biliExpandBtn) biliExpandBtn.innerHTML = '<i class="ri-expand-diagonal-line"></i> 放大';
    }
  } catch {} }
  function setBiliMode(m){ biliMode = m; try { localStorage.setItem('radio.biliVideo.mode', biliMode); } catch {} applyBiliMode(); }
    if (musicUrl) {
      audio.src = musicUrl;
      audioBar.style.display = 'flex';
      audioCover.src = albumUrl || '';
      audioTitle.textContent = title || '';
      audioArtist.textContent = artist || '';
      if (songLoading) songLoading.style.display = 'flex';
      try { audio.play(); } catch { }
      try { setupAudioAnalysis(); } catch { }
      setRotatePlayState(true);
      try { updateFullscreenStyles(); let tries = 0; const tmr = setInterval(() => { updateFullscreenStyles(); if (++tries >= 10) clearInterval(tmr); }, 100); } catch { }
      if (musicSource === 'bili' && biliFloat && biliVideo) {
        biliFloat.style.display = 'block';
        try { biliVideo.src = musicUrl; biliVideo.muted = true; biliVideo.play(); } catch { }
        applyBiliMode();
      } else {
        if (biliFloat) biliFloat.style.display = 'none';
        if (biliToolbar) biliToolbar.style.display = 'none';
      }
    }
  function applyBlurBackground(urlStr) {
    if (!bgRule) return;
    bgRule.textContent = `body::before{content:'';position:absolute;inset:0;background:url(${urlStr}) center/cover;filter:blur(${28}px) brightness(${0.6});z-index:-1;}`;
    const ex = document.getElementById('EX_background_fluentShine'); if (ex) ex.remove();
    const st = document.getElementById('EX_background_fluentShine_style'); if (st) st.remove();
  }
  function applyFluentShine(urlStr) {
    if (bgRule) bgRule.textContent = '';
    let ex = document.getElementById('EX_background_fluentShine');
    if (!ex) {
      ex = document.createElement('div');
      ex.id = 'EX_background_fluentShine';
      ex.style.position = 'absolute';
      ex.style.inset = '0';
      ex.style.zIndex = '-1';
      try {
        ex.style.setProperty('--shine-s1','1');
        ex.style.setProperty('--shine-s2','1');
        ex.style.setProperty('--shine-s3','1');
        ex.style.setProperty('--shine-s4','1');
      } catch {}
      document.body.appendChild(ex);
      for (let i = 1; i <= 4; i++) {
        const d = document.createElement('div');
        d.className = 'fluentShine';
        d.style.position = 'absolute';
        d.style.width = '50%';
        d.style.height = '50%';
        if (i === 1) { d.style.top = '0'; d.style.left = '0'; }
        else if (i === 2) { d.style.top = '0'; d.style.right = '0'; }
        else if (i === 3) { d.style.bottom = '0'; d.style.left = '0'; }
        else { d.style.bottom = '0'; d.style.right = '0'; }
        ex.appendChild(d);
      }
    }
    let style = document.getElementById('EX_background_fluentShine_style');
    if (!style) { style = document.createElement('style'); style.id = 'EX_background_fluentShine_style'; document.head.appendChild(style); }
    const blurPx = Number(localStorage.getItem('radio.bg.blur') || 70);
    const dark = Number(localStorage.getItem('radio.bg.dark') || 0.6);
    style.textContent = `#EX_background_fluentShine:before{content:'';position:absolute;inset:0;background:url(${urlStr}) center/cover;filter:blur(${blurPx}px) brightness(${dark});z-index:-1;}
    .fluentShine:before{content:'';position:absolute;inset:0;background:url(${urlStr}) center/cover;filter:blur(${blurPx}px) brightness(${dark});z-index:-1;transition:transform 120ms linear;}
    @keyframes rotate-clockwise{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    @keyframes rotate-counterclockwise{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}
    .fluentShine:nth-child(1){animation:rotate-clockwise 15s linear infinite}
    .fluentShine:nth-child(2){animation:rotate-counterclockwise 12s linear infinite}
    .fluentShine:nth-child(3){animation:rotate-clockwise 18s linear infinite}
    .fluentShine:nth-child(4){animation:rotate-counterclockwise 14s linear infinite}
    .fluentShine:nth-child(1):before{transform:scale(var(--shine-s1,1));}
    .fluentShine:nth-child(2):before{transform:scale(var(--shine-s2,1));}
    .fluentShine:nth-child(3):before{transform:scale(var(--shine-s3,1));}
    .fluentShine:nth-child(4):before{transform:scale(var(--shine-s4,1));}`;
  }
  const bgMode = (localStorage.getItem('radio.bgmode') || 'blur');
  if (albumUrl) { if (bgMode === 'shine') applyFluentShine(albumUrl); else applyBlurBackground(albumUrl); }
  function applyBackgroundCurrent(){ try { const src = document.getElementById('audioCover')?.src || albumUrl || ''; if (!src) return; const mode = localStorage.getItem('radio.bgmode') || 'blur'; if (mode === 'shine') applyFluentShine(src); else applyBlurBackground(src); } catch {} }
  async function renderLyricsForKuwo(id) {
    try {
      const le = document.getElementById('lyrics'); if (le) le.textContent = '';
      if (lyricsLoading) lyricsLoading.style.display = 'flex';
      const r = await window.lowbarAPI.pluginCall('radio.music', 'fetchKuwoLyrics', [id, true]);
      const data = r && r.result ? r.result : r;
      if (!data || !data.ok || !data.dataBase64) return;
      const bin = atob(String(data.dataBase64 || ''));
      const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      let text = '';
      try { text = new TextDecoder('gb18030', { fatal: false }).decode(arr); } catch { text = new TextDecoder('utf-8').decode(arr); }
      const yrc = lrcxToYrcArr(text);
      mountYrc2_stream(yrc);
    } catch { }
    finally { if (lyricsLoading) lyricsLoading.style.display = 'none'; }
  }
  function lrcxToYrcArr(krc) { const lines = String(krc || '').split('\n').filter(l => l.trim()); const yrc = []; let w = 0; for (const line of lines) { const m = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)/); if (!m) { const mk = line.match(/^\[kuwo:(\d+)\]/); if (mk) { w = parseInt(mk[1], 8) || 0; } continue; } const minutes = parseInt(m[1], 10), seconds = parseInt(m[2], 10), ms = parseInt(String(m[3]).padEnd(3, '0'), 10); const ts = minutes * 60000 + seconds * 1000 + ms; const content = m[4]; const words = []; const re = /<(\d+),(-?\d+)>([^<]*)/g; let mm; const k1 = Math.floor(w / 10), k2 = w % 10; while ((mm = re.exec(content))) { const v1 = parseInt(mm[1], 10), v2 = parseInt(mm[2], 10); const start = (v1 + v2) / (k1 * 2); const dur = (v1 - v2) / (k2 * 2); words.push({ t: ts + start, d: dur, tx: mm[3] }); } let ld = 0; if (words.length) { const last = words[words.length - 1]; ld = last.t + last.d - ts; } yrc.push({ t: ts, d: ld, c: words }); } return yrc; }
  function isCJK(s) { return /[\u3400-\u9FFF]/.test(String(s || '')); }
  function isPunc(s) { return /^[\s\.,!\?;:\-–—·、，。！？；：…()（）\[\]\{\}]+$/.test(String(s || '')); }
  function needSpace(a, b) { return !isPunc(a) && !isPunc(b) && !isCJK(a) && !isCJK(b); }
  function hasLatin(s) { return /[A-Za-z\u00C0-\u024F]/.test(String(s || '')); }
function mountYrc2_pair(yrc) {
  const el = document.getElementById('lyrics');
  if (!el) return;
  el.innerHTML = '';
  const AUTO_SCROLL_PAUSE_MS = 4000;
  const PAIR_MS = Math.max(100, parseInt(localStorage.getItem('radio.lyric.pair.ms')||'600',10)||600);
  const sorted = Array.isArray(yrc) ? yrc.slice().sort((a, b) => (parseInt(a.t || 0, 10) || 0) - (parseInt(b.t || 0, 10) || 0)) : [];
  function makeRow(line, kind) {
    const row = document.createElement('div');
    row.className = 'row ' + kind;
    row.style.whiteSpace = 'normal';
    row.style.opacity = '0.9';
    line.c.forEach((w, i) => { const s = document.createElement('span'); s.textContent = w.tx; s.dataset.t = w.t; s.dataset.d = w.d; s.style.transition = `opacity ${Math.max(0, w.d)}ms ease-out`; s.style.opacity = '0.55'; s.style.display = 'inline'; row.appendChild(s); const next = line.c[i + 1]; if (next && needSpace(w.tx, next.tx)) row.appendChild(document.createTextNode(' ')); });
    return row;
  }
  const textOf = (line) => (line && Array.isArray(line.c)) ? line.c.map(w=>String(w.tx||'')).join('') : '';
  const hasWordTiming = (line) => {
    if (!line || !Array.isArray(line.c)) return false;
    return line.c.some(w => (parseInt(w.d||0,10)||0) > 0);
  };
  const used = new Set();
  const timed = sorted.filter(l => hasWordTiming(l));
  const rest = sorted.filter(l => !hasWordTiming(l));
  const backMs = Math.max(0, parseInt(localStorage.getItem('radio.lyric.back.ms')||'300',10)||300);
  const fwdMs = PAIR_MS;
  const assigned = new Map();
  const restAssigned = new Set();
  for (let k = 0; k < timed.length; k++) {
    const origin = timed[k];
    const t0 = parseInt(origin.t || 0, 10) || 0;
    const tNext = (k + 1 < timed.length) ? (parseInt(timed[k+1].t || 0, 10) || Infinity) : Infinity;
    const winStartFwd = t0;
    const winEndFwd = Math.min(t0 + fwdMs, tNext - 1);
    let best = null; let bestDt = Infinity;
    // prefer translations between current timed and next timed
    for (let i = 0; i < rest.length; i++) {
      const r = rest[i]; if (restAssigned.has(r)) continue;
      const tr = parseInt(r.t || 0, 10) || 0;
      if (textOf(r) === textOf(origin)) continue;
      if (tr >= winStartFwd && tr <= winEndFwd) {
        const dt = tr - t0;
        if (dt >= 0 && dt <= fwdMs && dt < bestDt) { best = r; bestDt = dt; }
      }
    }
    // fallback: slight preceding translation
    if (!best) {
      const winStartBack = t0 - backMs;
      for (let i = 0; i < rest.length; i++) {
        const r = rest[i]; if (restAssigned.has(r)) continue;
        const tr = parseInt(r.t || 0, 10) || 0;
        if (textOf(r) === textOf(origin)) continue;
        if (tr >= winStartBack && tr < t0) {
          const dt = t0 - tr;
          if (dt <= backMs && dt < bestDt) { best = r; bestDt = dt; }
        }
      }
    }
    if (best) { assigned.set(k, best); restAssigned.add(best); }
  }
  for (let i = 0; i < timed.length; i++) {
    const origin = timed[i];
    const t0 = parseInt(origin.t || 0, 10) || 0;
    const trans = assigned.get(i) || null;
    if (trans) restAssigned.add(trans);
    const c = document.createElement('div');
    c.className = 'line';
    const ot = t0;
    let dmax = parseInt(origin.d || '0', 10) || 0;
    if (trans) dmax = Math.max(dmax, parseInt(trans.d || '0', 10) || 0);
    c.dataset.t = String(ot);
    c.dataset.d = String(dmax);
    const r1 = makeRow(origin, 'origin'); c.appendChild(r1);
    if (trans) { const r2 = makeRow(trans, 'trans'); r2.style.marginTop = '6px'; c.appendChild(r2); } else { c.classList.add('single'); }
    c.onclick = () => { try { audio.currentTime = (parseInt(c.dataset.t || '0', 10)) / 1000; } catch { } };
    el.appendChild(c);
  }
  // leftover non-timed lines as singles to avoid losing content
  for (const l of rest) {
    if (restAssigned.has(l)) continue;
    const c = document.createElement('div');
    c.className = 'line single';
    const t0 = parseInt(l.t || 0, 10) || 0;
    const dmax = parseInt(l.d || '0', 10) || 0;
    c.dataset.t = String(t0);
    c.dataset.d = String(dmax);
    const r1 = makeRow(l, 'origin'); c.appendChild(r1);
    c.onclick = () => { try { audio.currentTime = (parseInt(c.dataset.t || '0', 10)) / 1000; } catch { } };
    el.appendChild(c);
  }
  let userScrollTs = 0; let touchStartY = 0;
  el.addEventListener('wheel', () => { userScrollTs = Date.now(); });
    el.addEventListener('touchstart', (e) => { if (e.touches && e.touches.length === 1) { touchStartY = e.touches[0].clientY; } });
    el.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length === 1) { const dy = Math.abs(e.touches[0].clientY - touchStartY); if (dy > 5) userScrollTs = Date.now(); } });
    function update() {
      const t = audio.currentTime * 1000;
      const lines = Array.from(el.querySelectorAll('.line'));
      let active = null;
      for (let i = 0; i < lines.length; i++) { const c = lines[i]; const lt = parseInt(c.dataset.t || '0', 10); const ld = parseInt(c.dataset.d || '0', 10); if (t >= lt && t < lt + ld) { active = c; break; } }
      lines.forEach((c) => {
        const rows = c.querySelectorAll('.row');
        const isActive = (c === active);
        rows.forEach((row) => {
          const isTrans = row.classList.contains('trans');
          row.style.opacity = isActive ? (isTrans ? '0.85' : '1') : (isTrans ? '0.6' : '0.7');
          const spans = row.querySelectorAll('span');
          spans.forEach((s) => {
            const st = parseInt(s.dataset.t || '0', 10);
            const sd = parseInt(s.dataset.d || '0', 10);
            const se = st + sd;
            if (isActive && t >= st) s.style.opacity = '1'; else s.style.opacity = '0.5';
          });
        });
      });
      if (active) { const now = Date.now(); if (now - userScrollTs > AUTO_SCROLL_PAUSE_MS) { const rect = active.getBoundingClientRect(); const viewMid = window.innerHeight * 0.42; const dy = rect.top + (rect.height / 2) - viewMid; try { el.scrollTo({ top: el.scrollTop + dy, behavior: 'smooth' }); } catch { el.scrollTop += dy; } } }
    }
    audio.addEventListener('timeupdate', update);
  }
  function mountYrc2_stream(yrc) {
    const el = document.getElementById('lyrics');
    if (!el) return;
    el.innerHTML = '';
    const AUTO_SCROLL_PAUSE_MS = 4000;
    const seq = Array.isArray(yrc) ? yrc.slice() : [];
    function makeRow(line, kind) {
      const row = document.createElement('div');
      row.className = 'row ' + kind;
      row.style.whiteSpace = 'normal';
      row.style.opacity = '0.9';
      line.c.forEach((w, i) => { const s = document.createElement('span'); s.textContent = w.tx; s.dataset.t = w.t; s.dataset.d = w.d; s.style.transition = `opacity ${Math.max(0, w.d)}ms ease-out`; s.style.opacity = '0.55'; s.style.display = 'inline'; row.appendChild(s); const next = line.c[i + 1]; if (next && needSpace(w.tx, next.tx)) row.appendChild(document.createTextNode(' ')); });
      return row;
    }
    const hasWordTiming = (line) => Array.isArray(line?.c) && line.c.some(w => (parseInt(w.d||0,10)||0) > 0);
    const anyTimed = seq.some(l => hasWordTiming(l));
    seq.forEach(line => {
      const c = document.createElement('div');
      c.className = 'line';
      const lt = parseInt(line.t || 0, 10) || 0;
      const ld = parseInt(line.d || 0, 10) || 0;
      c.dataset.t = String(lt);
      c.dataset.d = String(ld);
      const kind = (anyTimed && !hasWordTiming(line)) ? 'trans' : 'origin';
      const r = makeRow(line, kind);
      c.appendChild(r);
      c.onclick = () => { try { audio.currentTime = (parseInt(c.dataset.t || '0', 10)) / 1000; } catch { } };
      el.appendChild(c);
    });
    let userScrollTs = 0; let touchStartY = 0;
    el.addEventListener('wheel', () => { userScrollTs = Date.now(); });
    el.addEventListener('touchstart', (e) => { if (e.touches && e.touches.length === 1) { touchStartY = e.touches[0].clientY; } });
    el.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length === 1) { const dy = Math.abs(e.touches[0].clientY - touchStartY); if (dy > 5) userScrollTs = Date.now(); } });
    function update() {
      const t = audio.currentTime * 1000;
      const lines = Array.from(el.querySelectorAll('.line'));
      let active = null;
      for (let i = 0; i < lines.length; i++) { const c = lines[i]; const lt = parseInt(c.dataset.t || '0', 10); const ld = parseInt(c.dataset.d || '0', 10); if (t >= lt && t < lt + ld) { active = c; break; } }
      lines.forEach((c) => {
        const rows = c.querySelectorAll('.row');
        const isActive = (c === active);
        rows.forEach((row) => {
          const isTrans = row.classList.contains('trans');
          row.style.opacity = isActive ? (isTrans ? '0.85' : '1') : (isTrans ? '0.6' : '0.7');
          const spans = row.querySelectorAll('span');
          spans.forEach((s) => {
            const st = parseInt(s.dataset.t || '0', 10);
            const sd = parseInt(s.dataset.d || '0', 10);
            const se = st + sd;
            if (isActive && t >= st) s.style.opacity = '1'; else s.style.opacity = '0.5';
          });
        });
      });
      if (active) { const now = Date.now(); if (now - userScrollTs > AUTO_SCROLL_PAUSE_MS) { const rect = active.getBoundingClientRect(); const viewMid = window.innerHeight * 0.42; const dy = rect.top + (rect.height / 2) - viewMid; try { el.scrollTo({ top: el.scrollTop + dy, behavior: 'smooth' }); } catch { el.scrollTop += dy; } } }
    }
    audio.addEventListener('timeupdate', update);
  }
  function mountYrc2(yrc) { const el = document.getElementById('lyrics'); if (!el) return; el.innerHTML = ''; const AUTO_SCROLL_PAUSE_MS = 4000; const sorted = Array.isArray(yrc) ? yrc.slice().sort((a, b) => (parseInt(a.t || 0, 10) || 0) - (parseInt(b.t || 0, 10) || 0)) : []; function makeRow(line, kind) { const row = document.createElement('div'); row.className = 'row ' + kind; row.style.whiteSpace = 'normal'; row.style.opacity = '0.9'; line.c.forEach((w, i) => { const s = document.createElement('span'); s.textContent = w.tx; s.dataset.t = w.t; s.dataset.d = w.d; s.style.transition = `opacity ${Math.max(0, w.d)}ms ease-out`; s.style.opacity = '0.55'; s.style.display = 'inline'; row.appendChild(s); const next = line.c[i + 1]; if (next && needSpace(w.tx, next.tx)) row.appendChild(document.createTextNode(' ')); }); return row; } const CLUSTER_MS = 600; let i = 0; while (i < sorted.length) { const start = parseInt(sorted[i].t || 0, 10) || 0; const cluster = []; let j = i; while (j < sorted.length) { const tt = parseInt(sorted[j].t || 0, 10) || 0; if (tt - start <= CLUSTER_MS) { cluster.push(sorted[j]); j++; } else break; } let origin = cluster[0]; let trans = null; if (cluster.length >= 2) { const types = cluster.map(l => ({ l, cjk: l.c.some(w => isCJK(w.tx)), lat: l.c.some(w => hasLatin(w.tx)) })); const nonCjk = types.find(x => !x.cjk && x.lat); const cjk = types.find(x => x.cjk); if (nonCjk && cjk) { origin = nonCjk.l; trans = cjk.l; } else { origin = cluster[0]; trans = cluster[1]; } } const c = document.createElement('div'); c.className = 'line'; c.dataset.t = String(origin.t); let dmax = parseInt(origin.d || '0', 10) || 0; if (trans) dmax = Math.max(dmax, parseInt(trans.d || '0', 10) || 0); c.dataset.d = String(dmax); const r1 = makeRow(origin, 'origin'); c.appendChild(r1); if (trans) { const r2 = makeRow(trans, 'trans'); r2.style.marginTop = '2px'; c.appendChild(r2); } else { c.classList.add('single'); } c.onclick = () => { try { audio.currentTime = (parseInt(c.dataset.t || '0', 10)) / 1000; } catch { } }; el.appendChild(c); const leftovers = cluster.filter(l => l !== origin && l !== trans); leftovers.forEach((ln) => { const sc = document.createElement('div'); sc.className = 'line single'; sc.dataset.t = String(ln.t); sc.dataset.d = String(parseInt(ln.d || '0', 10) || 0); const r = makeRow(ln, 'origin'); sc.appendChild(r); sc.onclick = () => { try { audio.currentTime = (parseInt(sc.dataset.t || '0', 10)) / 1000; } catch { } }; el.appendChild(sc); }); i = j; } let userScrollTs = 0; let touchStartY = 0; el.addEventListener('wheel', () => { userScrollTs = Date.now(); }); el.addEventListener('touchstart', (e) => { if (e.touches && e.touches.length === 1) { touchStartY = e.touches[0].clientY; } }); el.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length === 1) { const dy = Math.abs(e.touches[0].clientY - touchStartY); if (dy > 5) userScrollTs = Date.now(); } }); function update() { const t = audio.currentTime * 1000; const lines = Array.from(el.querySelectorAll('.line')); let active = null; for (let k = 0; k < lines.length; k++) { const c = lines[k]; const lt = parseInt(c.dataset.t || '0', 10); const ld = parseInt(c.dataset.d || '0', 10); if (t >= lt && t < lt + ld) { active = c; break; } } lines.forEach((c) => { const rows = c.querySelectorAll('.row'); const isActive = (c === active); rows.forEach((row) => { row.style.opacity = isActive ? '1' : '0.7'; const spans = row.querySelectorAll('span'); spans.forEach((s) => { const st = parseInt(s.dataset.t || '0', 10); const sd = parseInt(s.dataset.d || '0', 10); const se = st + sd; if (isActive && t >= st && t < se) { s.style.opacity = '1'; } else if (isActive && t >= se) { s.style.opacity = '1'; } else { s.style.opacity = '0.5'; } }); }); }); if (active && (Date.now() - userScrollTs > AUTO_SCROLL_PAUSE_MS)) { const rect = active.getBoundingClientRect(); const mid = rect.top + (rect.height / 2); const viewMid = window.innerHeight * 0.42; const dy = mid - viewMid; try { el.scrollTo({ top: el.scrollTop + dy, behavior: 'smooth' }); } catch { el.scrollTop += dy; } } } audio.addEventListener('timeupdate', update); }
  function mountYrc(yrc) { const el = document.getElementById('lyrics'); if (!el) return; el.innerHTML = ''; yrc.forEach((line) => { const c = document.createElement('div'); c.className = 'line'; c.dataset.t = line.t; c.dataset.d = line.d; const row = document.createElement('div'); row.style.whiteSpace = 'normal'; row.style.opacity = '0.9'; line.c.forEach((w, i) => { const s = document.createElement('span'); s.textContent = w.tx; s.dataset.t = w.t; s.dataset.d = w.d; s.style.transition = `opacity ${Math.max(0, w.d)}ms ease-out`; s.style.opacity = '0.55'; s.style.display = 'inline'; row.appendChild(s); if (i < line.c.length - 1) row.appendChild(document.createTextNode(' ')); }); c.appendChild(row); c.onclick = () => { try { audio.currentTime = (parseInt(c.dataset.t || '0', 10)) / 1000; } catch { } }; el.appendChild(c); }); let userScrollTs = 0; let touchStartY = 0; el.addEventListener('wheel', () => { userScrollTs = Date.now(); }); el.addEventListener('touchstart', (e) => { if (e.touches && e.touches.length === 1) { touchStartY = e.touches[0].clientY; } }); el.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length === 1) { const dy = Math.abs(e.touches[0].clientY - touchStartY); if (dy > 5) userScrollTs = Date.now(); } }); function update() { const t = audio.currentTime * 1000; const lines = Array.from(el.querySelectorAll('.line')); let active = null; for (let i = 0; i < lines.length; i++) { const c = lines[i]; const lt = parseInt(c.dataset.t || '0', 10); const ld = parseInt(c.dataset.d || '0', 10); if (t >= lt && t < lt + ld) { active = c; break; } } lines.forEach((c) => { const lt = parseInt(c.dataset.t || '0', 10); const ld = parseInt(c.dataset.d || '0', 10); const row = c.firstChild; const isActive = (c === active); row.style.opacity = isActive ? '1' : '0.7'; const spans = row.querySelectorAll('span'); spans.forEach((s) => { const st = parseInt(s.dataset.t || '0', 10); const sd = parseInt(s.dataset.d || '0', 10); const se = st + sd; if (isActive && t >= st && t < se) { s.style.opacity = '1'; } else if (isActive && t >= se) { s.style.opacity = '1'; } else { s.style.opacity = '0.5'; } }); }); if (active && (Date.now() - userScrollTs > 250)) { const rect = active.getBoundingClientRect(); const mid = rect.top + (rect.height / 2); const viewMid = (window.innerHeight / 2); const dy = mid - viewMid; const el2 = document.getElementById('lyrics'); el2.scrollTop += dy; } } audio.addEventListener('timeupdate', update); }
  if (musicId && musicSource === 'kuwo') renderLyricsForKuwo(musicId);
  function formatTime(sec) { if (!sec) return '0:00'; const s = Math.floor(sec); const m = Math.floor(s / 60); const r = s % 60; return `${m}:${String(r).padStart(2, '0')}`; }
  const progressCurrent = document.getElementById('progressCurrent');
  const progressDuration = document.getElementById('progressDuration');
  async function getSystemNow(){ try { const r = await window.lowbarAPI.pluginCall('radio.music', 'getVariable', ['timeISO']); const d = r && r.result ? r.result : r; const iso = typeof d === 'string' ? d : (d && d.value ? d.value : ''); const t = iso ? Date.parse(iso) : Date.now(); return new Date(t); } catch { return new Date(); } }
  function updateProgress() { if (!audio || !audio.duration) return; const pct = (audio.currentTime / audio.duration); progress.style.width = `${pct * 100}%`; progressDot.style.left = `${pct * 100}%`; if (progressCurrent) progressCurrent.textContent = formatTime(audio.currentTime); if (progressDuration) progressDuration.textContent = formatTime(audio.duration); }
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('canplay', () => { if (songLoading) songLoading.style.display = 'none'; });
  audio.addEventListener('waiting', () => { if (songLoading) songLoading.style.display = 'flex'; });
  audio.addEventListener('play', () => { if (biliVideo && musicSource === 'bili') { try { biliVideo.play(); } catch { } } });
  audio.addEventListener('pause', () => { if (biliVideo && musicSource === 'bili') { try { biliVideo.pause(); } catch { } } });
  audio.addEventListener('play', () => { setRotatePlayState(true); });
  audio.addEventListener('pause', () => { setRotatePlayState(false); });
  audio.addEventListener('ended', () => { setRotatePlayState(false); });
  audio.addEventListener('timeupdate', () => { if (biliVideo && musicSource === 'bili') { try { const dt = Math.abs((biliVideo.currentTime||0) - (audio.currentTime||0)); if (dt > 0.5) biliVideo.currentTime = audio.currentTime; } catch { } } });
  if (biliCollapseBtn) biliCollapseBtn.onclick = () => { setBiliMode(biliMode === 'hidden' ? 'float' : 'hidden'); };
  if (biliExpandBtn) biliExpandBtn.onclick = () => { setBiliMode(biliMode === 'expand' ? 'float' : 'expand'); };
  try { if (bgModePanel) { const items = bgModePanel.querySelectorAll('.bgmode-item'); items.forEach((el) => { el.onclick = () => { try { const m = el.dataset.mode || 'blur'; localStorage.setItem('radio.bgmode', m); bgModePanel.style.display = 'none'; applyBackgroundCurrent(); } catch {} }; }); } } catch {}
  let isDragging = false;
  function seekByClientX(x){ if (!audio.duration) return; const rect = progressBar.getBoundingClientRect(); const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width)); audio.currentTime = pct * audio.duration; }
  if (progressBar) {
    progressBar.addEventListener('click', (e) => { if (!audio.duration) return; const rect = progressBar.getBoundingClientRect(); const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); audio.currentTime = pct * audio.duration; });
    progressBar.addEventListener('mousedown', (e) => { isDragging = true; seekByClientX(e.clientX); });
    window.addEventListener('mousemove', (e) => { if (isDragging) seekByClientX(e.clientX); });
    window.addEventListener('mouseup', () => { isDragging = false; });
    progressBar.addEventListener('touchstart', (e) => { if (e.touches && e.touches.length) { isDragging = true; seekByClientX(e.touches[0].clientX); } });
    window.addEventListener('touchmove', (e) => { if (isDragging && e.touches && e.touches.length) { seekByClientX(e.touches[0].clientX); } });
    window.addEventListener('touchend', () => { isDragging = false; });
  }
  audio.addEventListener('ended', async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'nextTrack', ['ended']); } catch { } });
  async function loadPlaylist() {
    try {
      const r = await window.lowbarAPI.pluginCall('radio.music', 'getPlaylist', []);
      const data = r && r.result ? r.result : r;
      const listEl = document.getElementById('playlist');
      const totalEl = document.getElementById('playlistTotal');
      const empty = document.getElementById('emptyOverlay');
      if (!data || !listEl || !Array.isArray(data.items)) return;
      listEl.innerHTML = '';
      const fmt = (s) => { const n = Math.floor(Number(s) || 0); const m = Math.floor(n / 60); const r = n % 60; return `${m}:${String(r).padStart(2, '0')}`; };
      try {
        if (!listEl.dataset.captureBound) {
          listEl.addEventListener('mousedown', (e) => {
            const row = e.target && e.target.closest ? e.target.closest('.item') : null;
            if (row) { try { e.stopImmediatePropagation(); } catch {} }
          }, true);
          listEl.dataset.captureBound = '1';
        }
        if (!listEl.dataset.ctxBound) {
          listEl.addEventListener('contextmenu', async (e) => {
            const row = e.target && e.target.closest ? e.target.closest('.item') : null;
            if (!row) return;
            e.preventDefault();
            const idx = Array.prototype.indexOf.call(listEl.children, row);
            if (idx >= 0) {
              try { await window.lowbarAPI.pluginCall('radio.music', 'removeIndex', [idx]); } catch {}
            }
          });
          listEl.dataset.ctxBound = '1';
        }
      } catch {}
      data.items.forEach((it, idx) => { const row = document.createElement('div'); row.className = 'item'; const name = document.createElement('div'); name.textContent = `${it.title || ''}`; const dur = document.createElement('div'); dur.textContent = fmt(it.duration || 0); row.appendChild(name); row.appendChild(dur); if (idx === data.currentIndex) row.classList.add('active'); row.onclick = async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'playIndex', [idx]); } catch { } }; let pressTimer = null; row.addEventListener('mousedown', () => { pressTimer = setTimeout(async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'removeIndex', [idx]); } catch { } }, 600); }); row.addEventListener('mouseup', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }); row.addEventListener('mouseleave', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }); listEl.appendChild(row); }); try { const tt = document.getElementById('playlistTotalText'); if (tt) tt.textContent = `总时长：${fmt(data.totalSecs || 0)}`; } catch { } try { const finEl = document.getElementById('playlistFinish'); if (finEl) { const startIdx = Math.max(0, data.currentIndex || 0); const remainList = Array.isArray(data.items) ? data.items.slice(startIdx) : []; const remainSecs = Math.max(0, remainList.reduce((acc, it) => acc + (Number(it.duration) || 0), 0) - Math.floor(Number(audio.currentTime) || 0)); const dt = new Date(Date.now() + remainSecs * 1000); const hh = String(dt.getHours()).padStart(2, '0'); const mm = String(dt.getMinutes()).padStart(2, '0'); finEl.textContent = `预计播完：${hh}:${mm}`; } } catch { } if (empty) empty.style.display = (data.items.length === 0) ? 'flex' : 'none'; if (!musicUrl && data.items.length > 0) { const last = data.items[data.items.length - 1]; try { if (last) { document.getElementById('audioCover').src = last.cover || ''; document.getElementById('audioTitle').textContent = last.title || ''; document.getElementById('audioArtist').textContent = last.artist || ''; } } catch { } }
    } catch { }
  }
  let lastFinishUpdateTs = 0;
  async function updateFinishEstimate() { try { const finEl = document.getElementById('playlistFinish'); if (!finEl) return; if (Date.now() - lastFinishUpdateTs < 3000) return; lastFinishUpdateTs = Date.now(); const r = await window.lowbarAPI.pluginCall('radio.music', 'getPlaylist', []); const data = r && r.result ? r.result : r; if (!data || !Array.isArray(data.items)) return; const startIdx = Math.max(0, data.currentIndex || 0); const remainList = data.items.slice(startIdx); const remainSecs = Math.max(0, remainList.reduce((acc, it) => acc + (Number(it.duration) || 0), 0) - Math.floor(Number(audio.currentTime) || 0)); const base = await getSystemNow(); const dt = new Date(base.getTime() + remainSecs * 1000); const hh = String(dt.getHours()).padStart(2, '0'); const mm = String(dt.getMinutes()).padStart(2, '0'); finEl.textContent = `预计播完：${hh}:${mm}`; } catch { } }
  try { audio.addEventListener('timeupdate', updateFinishEstimate); } catch { }
  loadPlaylist();
  try { const ch = new URL(location.href).searchParams.get('channel'); if (ch) { window.lowbarAPI.subscribe?.(ch); window.lowbarAPI.onEvent?.((name, payload) => { if (name === ch && payload && payload.type === 'update') { if (payload.target === 'playlist') { loadPlaylist(); try { applyBackgroundCurrent(); } catch {} (async () => { try { const r2 = await window.lowbarAPI.pluginCall('radio.music', 'getPlaylist', []); const d2 = r2 && r2.result ? r2.result : r2; if (d2 && Array.isArray(d2.items) && d2.currentIndex >= 0) { const cur = d2.items[d2.currentIndex]; const le = document.getElementById('lyrics'); if (cur && cur.id && cur.source === 'kuwo') { await renderLyricsForKuwo(cur.id); } else { if (le) le.textContent = ''; } } } catch { } })(); } else if (payload.target === 'songLoading') { try { const x = document.getElementById('songLoading'); if (x) x.style.display = (payload.value === 'show') ? 'flex' : 'none'; } catch { } } else if (payload.target === 'bgModePanel') { try { if (!bgModePanel) return; const v = String(payload.value||''); if (v === 'toggle') { const cur = bgModePanel.style.display; bgModePanel.style.display = (!cur || cur==='none') ? 'flex' : 'none'; } else if (v === 'show') bgModePanel.style.display = 'flex'; else if (v === 'hide') bgModePanel.style.display = 'none'; } catch {} } else if (payload.target === 'bgModeApply') { try { applyBackgroundCurrent(); spectrumEnabled = (String(localStorage.getItem('radio.spectrum.enabled')||'1') !== '0'); if (spectrumCanvas) { spectrumCanvas.style.display = spectrumEnabled ? '' : 'none'; try { spectrumCanvas.width = spectrumCanvas.clientWidth; spectrumCanvas.height = spectrumCanvas.clientHeight; } catch {} } updateFullscreenStyles(); } catch {} } } }); } } catch { }
  try { const toggle = document.getElementById('removeAfterPlay'); async function initToggle() { try { const r = await window.lowbarAPI.pluginCall('radio.music', 'getSettings', []); const d = r && r.result ? r.result : r; const cur = !!(d && d.settings && d.settings.removeAfterPlay); if (toggle) toggle.checked = cur; } catch { } } function persistLocal() { try { if (toggle) localStorage.setItem('radio.removeAfterPlay', toggle.checked ? '1' : '0'); } catch { } } if (toggle) { initToggle(); toggle.addEventListener('change', async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'setRemoveAfterPlay', [toggle.checked]); persistLocal(); } catch { } }); } } catch { }
  try { const addBtn = document.getElementById('playlistAddBtn'); if (addBtn) addBtn.onclick = async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'onLowbarEvent', [{ type: 'click', id: 'tab-search' }]); } catch { } }; } catch { }
  const prevBtn = document.getElementById('audioPrevBtn');
  const nextBtn = document.getElementById('audioNextBtn');
  const playBtn = document.getElementById('audioPlayBtn');
  if (prevBtn) prevBtn.onclick = async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'prevTrack', []); } catch { } };
  if (nextBtn) nextBtn.onclick = async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'nextTrack', ['manual']); } catch { } };
  if (playBtn) { playBtn.onclick = () => { try { if (audio.paused) { audio.play(); playBtn.innerHTML = '<i class="ri-pause-fill"></i>'; } else { audio.pause(); playBtn.innerHTML = '<i class="ri-play-fill"></i>'; } } catch { } }; audio.addEventListener('play', () => { playBtn.innerHTML = '<i class="ri-pause-fill"></i>'; }); audio.addEventListener('pause', () => { playBtn.innerHTML = '<i class="ri-play-fill"></i>'; }); }
  try { audio.addEventListener('play', updateFullscreenStyles); } catch { }
});
function updateFullscreenStyles() { try { const fsMatch = (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches); const fs = !!document.fullscreenElement || fsMatch || (window.innerHeight >= (screen.availHeight - 1)); const bar = document.getElementById('audioBar'); if (bar) bar.style.bottom = fs ? '96px' : '16px'; const content = document.querySelector('.content-area'); if (bar && content) { const rect = bar.getBoundingClientRect(); const barH = Math.max(64, Math.floor(rect.height || 64)); const barBottomPx = parseInt(String(bar.style.bottom || '16').replace('px', ''), 10) || 16; const padding = 16; const offset = barBottomPx + barH + padding; content.style.bottom = `${offset}px`; } } catch { } }
updateFullscreenStyles();
window.addEventListener('resize', updateFullscreenStyles);
document.addEventListener('fullscreenchange', updateFullscreenStyles);
try { setInterval(updateFullscreenStyles, 1500); } catch { }
