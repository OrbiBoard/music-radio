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
  const loadingCover = document.getElementById('loadingCover');
  const loadingTitle = document.getElementById('loadingTitle');
  const loadingArtist = document.getElementById('loadingArtist');
  const loadingCount = document.getElementById('loadingCount');
  const btnCancelLoading = document.getElementById('btnCancelLoading');
  const btnRetryLoading = document.getElementById('btnRetryLoading');
  
  const playCount = params.get('playCount') || '0';
  
  if (btnCancelLoading) {
    btnCancelLoading.onclick = () => {
      try { window.lowbarAPI.pluginCall('music-radio', 'cancelLoading', []); } catch(e){}
    };
  }
  if (btnRetryLoading) {
    btnRetryLoading.onclick = () => {
      try { window.lowbarAPI.pluginCall('music-radio', 'retryLoading', []); } catch(e){}
    };
  }
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
  } catch (e) {}
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
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      const cover = albumUrl || (document.getElementById('audioCover')?.src) || '';
      const validCover = (cover && (cover.startsWith('http') || cover.startsWith('data:') || cover.startsWith('blob:'))) ? cover : '';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || '未知标题',
        artist: artist || '未知艺术家',
        album: new URL(location.href).searchParams.get('albumName') || '',
        artwork: validCover ? [{ src: validCover, sizes: '512x512', type: 'image/jpeg' }] : []
      });
      navigator.mediaSession.setActionHandler('play', () => { if (audio) audio.play(); });
      navigator.mediaSession.setActionHandler('pause', () => { if (audio) audio.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', async () => { try { await window.lowbarAPI.pluginCall('music-radio', 'prevTrack', []); } catch (e) { } });
      navigator.mediaSession.setActionHandler('nexttrack', async () => { try { await window.lowbarAPI.pluginCall('music-radio', 'nextTrack', ['manual']); } catch (e) { } });
      navigator.mediaSession.setActionHandler('seekto', (details) => { if (audio && details.seekTime !== undefined && Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime; });
      updatePlaybackState();
    } catch (e) {}
  }
  function updatePlaybackState() {
    if (!('mediaSession' in navigator) || !audio) return;
    try {
      navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
      if (Number.isFinite(audio.duration) && Number.isFinite(audio.currentTime)) {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime
        });
      }
    } catch (e) {}
  }
  function setRotatePlayState(running){
    try {
      const ex = document.getElementById('EX_background_fluentShine');
      if (!ex) return;
      const arr = ex.querySelectorAll('.fluentShine');
      arr.forEach((el)=>{ el.style.animationPlayState = running ? 'running' : 'paused'; });
    } catch (e) {}
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
  function updateFlowingDuration(k) {
      const style = document.getElementById('EX_bg_flowing_style');
      if (!style) return;
      const speed = Math.max(0.1, parseFloat(localStorage.getItem('radio.bg.flowing.speed')||'1.0'));
      const baseDur = 15 / speed;
      const dur = baseDur / Math.max(0.5, Math.min(2.0, k)); // higher k = faster (lower duration)
      
      let txt = String(style.textContent||'');
      txt = txt.replace(/animation: flowing-bg [0-9.]+s/, `animation: flowing-bg ${dur.toFixed(2)}s`);
      style.textContent = txt;
  }
  function setupAudioAnalysis(){
    if (!audio) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    } catch (e) { return; }
    if (!audioCtx) return;
    try {
      if (!analyser) analyser = audioCtx.createAnalyser();
      analyser.fftSize = (parseInt(localStorage.getItem('radio.analysis.fftSize')||'2048',10)||2048);
      analyser.smoothingTimeConstant = Math.min(0.99, Math.max(0, parseFloat(localStorage.getItem('radio.analysis.smoothing')||'0.8')));
      if (!mediaSrc) mediaSrc = audioCtx.createMediaElementSource(audio);
      mediaSrc.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqBuf = new Uint8Array(analyser.frequencyBinCount);
      try { timeBuf = new Float32Array(analyser.fftSize || 2048); } catch (e) { timeBuf = new Float32Array(2048); }
      analysisRunning = true;
    } catch (e) {}
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
    } catch (e) {}
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
    } catch (e) {}
    const ema = [0,0,0,0];
    const baseEma = [0,0,0,0];
    const bandV = [0,0,0,0];
    let lastEmitTs = 0;
    let lastTempoTs = 0;
    function loop(){
      if (!analysisRunning || !analyser) return;
      try { analyser.getByteFrequencyData(freqBuf); } catch (e) { requestAnimationFrame(loop); return; }
      try { if (timeBuf && timeBuf.length) analyser.getFloatTimeDomainData(timeBuf); } catch (e) {}
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
      const flowingReactive = (String(localStorage.getItem('radio.bg.flowing.audioReactive')||'0') !== '0');
      
      if ((shineReactive || flowingReactive) && (now - lastTempoTs > 1000)){
        lastTempoTs = now;
        let bpm = 0;
        if (peakTimes.length >= 2){ const span = (peakTimes[peakTimes.length-1] - peakTimes[0]) / 1000; const count = peakTimes.length - 1; if (span>0) bpm = (count/span)*60; }
        const minF = Math.max(0.5, parseFloat(localStorage.getItem('radio.tempo.factor.min')||'0.85'));
        const maxF = Math.max(minF, parseFloat(localStorage.getItem('radio.tempo.factor.max')||'1.25'));
        const k = bpm>0 ? Math.pow(120/Math.max(60, Math.min(180, bpm)), 0.5) : 1;
        tempoSmooth = tempoSmooth ? (tempoSmooth*0.9 + k*0.1) : k;
        const kClamped = Math.max(minF, Math.min(maxF, tempoSmooth));
        if (shineReactive) updateRotateDurations(kClamped);
        if (flowingReactive) updateFlowingDuration(kClamped);
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
        } catch (e) {}
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
      } catch (e) {}
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
  } catch (e) {} }
  function setBiliMode(m){ biliMode = m; try { localStorage.setItem('radio.biliVideo.mode', biliMode); } catch (e) {} applyBiliMode(); }
    if (musicUrl) {
      audio.src = musicUrl;
      audioBar.style.display = 'flex';
      const finalCover = albumUrl || '';
      audioCover.src = finalCover;
      applyThemeColors(finalCover);
      audioTitle.textContent = title || '';
      audioArtist.textContent = artist || '';
      
      // Update Loading UI
      if (songLoading) {
        songLoading.style.display = 'flex';
        if (loadingTitle) loadingTitle.textContent = title || '正在加载...';
        if (loadingArtist) loadingArtist.textContent = artist || '';
        if (loadingCount) loadingCount.textContent = `已播放 ${playCount} 次`;
        if (loadingCover) {
             loadingCover.style.display = 'none'; // Hide first
             if (finalCover) {
                 loadingCover.src = finalCover;
                 loadingCover.onload = () => { loadingCover.style.display = 'block'; };
             }
        }
        if (btnRetryLoading) btnRetryLoading.style.display = 'none';
      }

      try { audio.play(); } catch (e) { }
      try { setupAudioAnalysis(); } catch (e) { }
      try { updateMediaSession(); } catch (e) { }
      setRotatePlayState(true);
      try { updateFullscreenStyles(); let tries = 0; const tmr = setInterval(() => { updateFullscreenStyles(); if (++tries >= 10) clearInterval(tmr); }, 100); } catch (e) { }
      if (musicSource === 'bili' && biliFloat && biliVideo) {
        biliFloat.style.display = 'block';
        try { biliVideo.src = musicUrl; biliVideo.muted = true; biliVideo.play(); } catch (e) { }
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
      } catch (e) {}
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
  // --- Color Extraction & Theme Logic ---
  function extractColor(img) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 50; canvas.height = 50;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 50, 50);
        const data = ctx.getImageData(0, 0, 50, 50).data;
        
        const colorCounts = {};
        for (let i=0; i<data.length; i+=4) {
            const r = data[i]; const g = data[i+1]; const b = data[i+2];
            // Quantize to 64-level for better grouping
            const qr = Math.floor(r/64)*64;
            const qg = Math.floor(g/64)*64;
            const qb = Math.floor(b/64)*64;
            const key = `${qr},${qg},${qb}`;
            if (!colorCounts[key]) colorCounts[key] = { count: 0, r:0, g:0, b:0 };
            colorCounts[key].count++;
            colorCounts[key].r += r;
            colorCounts[key].g += g;
            colorCounts[key].b += b;
        }
        
        const sorted = Object.values(colorCounts).sort((a,b) => b.count - a.count);
        let c1 = sorted[0];
        let c2 = sorted.length > 1 ? sorted[1] : c1;
        
        // Try to find a secondary color that is distinct
        for (let i=1; i<sorted.length; i++) {
             const t = sorted[i];
             const dr = (t.r/t.count) - (c1.r/c1.count);
             const dg = (t.g/t.count) - (c1.g/c1.count);
             const db = (t.b/t.count) - (c1.b/c1.count);
             const dist = Math.sqrt(dr*dr + dg*dg + db*db);
             if (dist > 40) { c2 = t; break; }
        }

        const process = (c) => {
            if (!c) return { r:100, g:180, b:255, str:'#6ab4ff' };
            let r = Math.floor(c.r/c.count);
            let g = Math.floor(c.g/c.count);
            let b = Math.floor(c.b/c.count);
            const max = Math.max(r, g, b); const min = Math.min(r, g, b);
            if (max - min < 20) { r=Math.min(255,r+20); g=Math.min(255,g+20); b=Math.min(255,b+30); } 
            return { r, g, b, str: `rgb(${r},${g},${b})` };
        };
        
        const p1 = process(c1);
        const p2 = process(c2);
        return { ...p1, r2: p2.r, g2: p2.g, b2: p2.b, str2: p2.str };
    } catch (e) { return { r:100, g:180, b:255, str:'#6ab4ff', r2:80, g2:160, b2:240, str2:'#50a0f0' }; }
  }

  function applyThemeColors(imgUrl) {
    if (!imgUrl) return;
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imgUrl;
    img.onload = () => {
        const c = extractColor(img);
        const root = document.documentElement;
        root.style.setProperty('--theme-color', c.str);
        root.style.setProperty('--theme-r', c.r);
        root.style.setProperty('--theme-g', c.g);
        root.style.setProperty('--theme-b', c.b);
        root.style.setProperty('--theme-r2', c.r2);
        root.style.setProperty('--theme-g2', c.g2);
        root.style.setProperty('--theme-b2', c.b2);
        
        // Update specific elements
        const progress = document.getElementById('audioProgress');
        const dot = document.getElementById('audioProgressDot');
        if (progress) progress.style.background = c.str;
        if (dot) dot.style.background = c.str;
        
        // Playlist active item styling is handled by CSS using --theme-color if we update the CSS
        const style = document.getElementById('playlist-theme-style');
        if (!style) {
            const s = document.createElement('style');
            s.id = 'playlist-theme-style';
            document.head.appendChild(s);
        }
        document.getElementById('playlist-theme-style').textContent = `
            #playlist .item.active { border-left-color: ${c.str} !important; background: rgba(${c.r},${c.g},${c.b},0.2) !important; }
            #playlist .item.active .title { color: ${c.str} !important; }
            .theme-text { color: ${c.str} !important; }
        `;
        
        // Re-apply background if in gradient/flowing mode
        applyBackgroundCurrent(); 
    };
  }

  function applyGradientBackground(c) {
      if (bgRule) bgRule.textContent = `body::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg, rgba(${c.r},${c.g},${c.b},0.4) 0%, rgba(0,0,0,0.9) 100%);z-index:-1;}`;
  }
  
  function applyFlowingBackground(c) {
      if (bgRule) bgRule.textContent = '';
      let style = document.getElementById('EX_bg_flowing_style');
      if (!style) { style = document.createElement('style'); style.id = 'EX_bg_flowing_style'; document.head.appendChild(style); }
      
      const speed = Math.max(0.1, parseFloat(localStorage.getItem('radio.bg.flowing.speed')||'1.0'));
      const dur = 15 / speed;
      
      style.textContent = `
          body::before {
              content: ''; position: absolute; inset: -50%; 
              background: radial-gradient(circle at center, rgba(${c.r},${c.g},${c.b},0.6), transparent 60%),
                          linear-gradient(45deg, rgba(${c.r2},${c.g2},${c.b2},0.3), rgba(0,0,0,0.8));
              z-index: -1;
              animation: flowing-bg ${dur}s ease-in-out infinite alternate;
              filter: blur(40px);
          }
          @keyframes flowing-bg {
              0% { transform: translate(0,0) scale(1); }
              50% { transform: translate(10px, 20px) scale(1.1); }
              100% { transform: translate(-10px, -10px) scale(1); }
          }
      `;
  }

  function applyBackgroundCurrent(){ 
    try { 
        const src = document.getElementById('audioCover')?.src || albumUrl || ''; 
        const mode = localStorage.getItem('radio.bgmode') || 'blur'; 
        
        // Clean up
        const exShine = document.getElementById('EX_background_fluentShine'); if (exShine) exShine.style.display = 'none';
        const stFlow = document.getElementById('EX_bg_flowing_style'); if (stFlow) stFlow.textContent = '';
        if (bgRule) bgRule.textContent = '';

        if (mode === 'shine') {
             if (exShine) exShine.style.display = 'block';
             else if (src) applyFluentShine(src);
        } else if (mode === 'gradient') {
            const r = getComputedStyle(document.documentElement).getPropertyValue('--theme-r') || 100;
            const g = getComputedStyle(document.documentElement).getPropertyValue('--theme-g') || 100;
            const b = getComputedStyle(document.documentElement).getPropertyValue('--theme-b') || 100;
            applyGradientBackground({r,g,b});
        } else if (mode === 'flowing') {
            const r = getComputedStyle(document.documentElement).getPropertyValue('--theme-r') || 100;
            const g = getComputedStyle(document.documentElement).getPropertyValue('--theme-g') || 100;
            const b = getComputedStyle(document.documentElement).getPropertyValue('--theme-b') || 100;
            applyFlowingBackground({r,g,b});
        } else {
            // blur (default)
            if (src) applyBlurBackground(src);
        }
    } catch (e) {} 
  }
  async function renderLyrics(item) {
    try {
      const le = document.getElementById('lyrics'); if (le) le.textContent = '';
      if (lyricsLoading) lyricsLoading.style.display = 'flex';
      
      const r = await window.lowbarAPI.pluginCall('music-radio', 'fetchLyrics', [item]);
      const data = r && r.result ? r.result : r;
      
      if (!data || !data.ok) return;

      if (data.format === 'lrcx' && data.dataBase64) {
          // Handle Kuwo LRCX
          const bin = atob(String(data.dataBase64 || ''));
          const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          let text = '';
          try { text = new TextDecoder('gb18030', { fatal: false }).decode(arr); } catch (e) { text = new TextDecoder('utf-8').decode(arr); }
          const yrc = lrcxToYrcArr(text);
          mountYrc2_stream(yrc);
      } else if (data.content) {
          // Handle Standard LRC
          const yrc = parseLrcToYrc(data.content);
          mountYrc2_stream(yrc);
      }
    } catch (e) { }
    finally { if (lyricsLoading) lyricsLoading.style.display = 'none'; }
  }
  function parseLrcToYrc(lrc) {
    const lines = String(lrc || '').split('\n').filter(l => l.trim());
    const yrc = [];
    for (const line of lines) {
      const m = line.match(/^\[(\d+):(\d+)(\.(\d+))?\](.*)/);
      if (!m) continue;
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      const msStr = m[4] ? m[4].padEnd(3, '0') : '000';
      const ms = parseInt(msStr.substring(0, 3), 10);
      const ts = minutes * 60000 + seconds * 1000 + ms;
      const content = m[5];
      yrc.push({ t: ts, d: 0, c: [{ t: ts, d: 0, tx: content }] });
    }
    for(let i=0; i<yrc.length; i++) {
      const curr = yrc[i];
      const next = yrc[i+1];
      if (next) {
        const dur = next.t - curr.t;
        curr.d = dur;
        if(curr.c[0]) curr.c[0].d = dur;
      } else {
        curr.d = 5000;
        if(curr.c[0]) curr.c[0].d = 5000;
      }
    }
    return yrc;
  }
  function lrcxToYrcArr(krc) { const lines = String(krc || '').split('\n').filter(l => l.trim()); const yrc = []; let w = 0; for (const line of lines) { const m = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)/); if (!m) { const mk = line.match(/^\[kuwo:(\d+)\]/); if (mk) { w = parseInt(mk[1], 8) || 0; } continue; } const minutes = parseInt(m[1], 10), seconds = parseInt(m[2], 10), ms = parseInt(String(m[3]).padEnd(3, '0'), 10); const ts = minutes * 60000 + seconds * 1000 + ms; const content = m[4]; const words = []; const re = /<(\d+),(-?\d+)>([^<]*)/g; let mm; const k1 = Math.floor(w / 10), k2 = w % 10; while ((mm = re.exec(content))) { const v1 = parseInt(mm[1], 10), v2 = parseInt(mm[2], 10); const start = (v1 + v2) / (k1 * 2); const dur = (v1 - v2) / (k2 * 2); words.push({ t: ts + start, d: dur, tx: mm[3] }); } let ld = 0; if (words.length) { const last = words[words.length - 1]; ld = last.t + last.d - ts; } yrc.push({ t: ts, d: ld, c: words }); } return yrc; }
  function isCJK(s) { return /[\u3400-\u9FFF]/.test(String(s || '')); }
  function isPunc(s) { return /^[\s\.,!\?;:\-–—·、，。！？；：…()（）\[\]\{\}]+$/.test(String(s || '')); }
  function needSpace(a, b) { return !isPunc(a) && !isPunc(b) && !isCJK(a) && !isCJK(b); }
  function hasLatin(s) { return /[A-Za-z\u00C0-\u024F]/.test(String(s || '')); }
function mountYrc2_pair(yrc) {
  const el = document.getElementById('lyrics');
  if (!el) return;
  if (window._lyricsRaf) cancelAnimationFrame(window._lyricsRaf);
  el.innerHTML = '';
  const AUTO_SCROLL_PAUSE_MS = 4000;
  const PAIR_MS = Math.max(100, parseInt(localStorage.getItem('radio.lyric.pair.ms')||'600',10)||600);
  const sorted = Array.isArray(yrc) ? yrc.slice().sort((a, b) => (parseInt(a.t || 0, 10) || 0) - (parseInt(b.t || 0, 10) || 0)) : [];
  // Karaoke styles for stream mode
    if (!document.getElementById('karaoke-style-stream')) {
        const s = document.createElement('style');
        s.id = 'karaoke-style-stream';
        s.textContent = `
          .karaoke-word { position: relative; display: inline-block; }
          .karaoke-word::after {
             content: attr(data-text); position: absolute; left: 0; top: 0;
             color: #fff; width: var(--k-width, 0%); overflow: hidden; white-space: pre;
             pointer-events: none; transition: width 0.1s linear;
             /* text-shadow: 0 0 10px rgba(255,255,255,0.8); removed shadow */
             will-change: width;
          }
          .row.origin span { position: relative; color: rgba(255,255,255,0.55); }
        `;
        document.head.appendChild(s);
    }

    function makeRow(line, kind) {
      const row = document.createElement('div');
      row.className = 'row ' + kind;
      row.style.whiteSpace = 'normal';
      row.style.opacity = '0.9';
      line.c.forEach((w, i) => { 
          const s = document.createElement('span'); 
          s.textContent = w.tx; 
          s.dataset.text = w.tx;
          s.dataset.t = w.t; 
          s.dataset.d = w.d; 
          if (kind === 'origin') s.classList.add('karaoke-word');
          // s.style.transition = `opacity ${Math.max(0, w.d)}ms ease-out`; 
          // s.style.opacity = '0.55'; 
          s.style.display = 'inline-block'; 
          row.appendChild(s); 
          const next = line.c[i + 1]; 
          if (next && needSpace(w.tx, next.tx)) row.appendChild(document.createTextNode(' ')); 
      });
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
    c.onclick = () => { try { audio.currentTime = (parseInt(c.dataset.t || '0', 10)) / 1000; } catch (e) { } };
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
    c.onclick = () => { try { audio.currentTime = (parseInt(c.dataset.t || '0', 10)) / 1000; } catch (e) { } };
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
            
            // Karaoke Effect logic
            if (isActive && isTrans === false) { // Only for active origin line
                if (t >= st && t < se) {
                    // Current word playing
                    const progress = (t - st) / Math.max(1, sd);
                    const pct = Math.min(100, Math.max(0, progress * 100));
                    const cur = parseFloat(s.style.getPropertyValue('--k-width')||'0');
                    if (Math.abs(cur - pct) > 0.5) { 
                        s.style.setProperty('--k-width', `${pct}%`);
                    }
                } else if (t >= se) {
                    // Passed word - LOCK to 100%
                    s.style.setProperty('--k-width', '100%');
                } else {
                    // Future word
                    s.style.setProperty('--k-width', '0%');
                }
            } else {
                // Not active line or translation
                if (t >= se) { // Already passed lines
                    s.style.setProperty('--k-width', '100%');
                } else {
                    s.style.setProperty('--k-width', '0%');
                }
            }
          });
        });
      });
      if (active) { const now = Date.now(); if (now - userScrollTs > AUTO_SCROLL_PAUSE_MS) { const rect = active.getBoundingClientRect(); const viewMid = window.innerHeight * 0.42; const dy = rect.top + (rect.height / 2) - viewMid; try { el.scrollTo({ top: el.scrollTop + dy, behavior: 'smooth' }); } catch (e) { el.scrollTop += dy; } } }
    }
    // audio.addEventListener('timeupdate', update);
    function loop() {
        if (!document.getElementById('lyrics')) return;
        update();
        window._lyricsRaf = requestAnimationFrame(loop);
    }
    loop();
  }
  function mountYrc2_stream(yrc) {
    const el = document.getElementById('lyrics');
    if (!el) return;
    if (window._lyricsRaf) cancelAnimationFrame(window._lyricsRaf);
    el.innerHTML = '';
    const AUTO_SCROLL_PAUSE_MS = 4000;
    const seq = Array.isArray(yrc) ? yrc.slice() : [];
      // Init Styles for Karaoke effect
      if (!document.getElementById('karaoke-style')) {
          const s = document.createElement('style');
          s.id = 'karaoke-style';
          s.textContent = `
            .karaoke-word {
               position: relative;
               display: inline-block;
               /* background-clip: text; -webkit-background-clip: text; color: transparent; background-image: ... */
               /* Better approach: use ::after overlay */
            }
            .karaoke-word::after {
             content: attr(data-text); position: absolute; left: 0; top: 0;
             color: #fff; width: var(--k-width, 0%); overflow: hidden; white-space: pre;
             pointer-events: none; transition: width 0.1s linear;
             will-change: width;
          }
          .karaoke-word::before {
             content: attr(data-text); position: absolute; left: 0; top: 0;
             color: transparent; width: 100%; white-space: pre;
             pointer-events: none; opacity: 0; transition: opacity 0.3s ease;
             z-index: -1;
          }
          .karaoke-word.long-word-active::before {
             opacity: 1;
             text-shadow: 0 0 15px rgba(255,255,255,0.8), 0 0 5px rgba(255,255,255,0.4);
          }
          .row.origin span { position: relative; color: rgba(255,255,255,0.55); }
          .row.trans { font-size: 0.9em; opacity: 0.8; line-height: 1.2; }
          /* Override base line margin to ensure tightness */
          #lyrics .line { margin: 6px 0; }
          #lyrics .line.trans-line { margin-top: -8px; margin-bottom: 42px; }
          
          .waiting-dots {
             display: inline-block; margin-left: 10px; opacity: 0; transition: opacity 0.5s;
          }
          .waiting-dots.show { opacity: 1; }
          .waiting-dots span {
             display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.6);
             margin: 0 3px; opacity: 0; transform: scale(0); transition: opacity 0.3s, transform 0.3s;
          }
          .waiting-dots span.active {
             opacity: 1; transform: scale(1);
          }
          `;
          document.head.appendChild(s);
      }
    function makeRow(line, kind) {
      const row = document.createElement('div');
      row.className = 'row ' + kind;
      row.style.whiteSpace = 'normal';
      row.style.opacity = '0.9';
      line.c.forEach((w, i) => { 
          const s = document.createElement('span'); 
          s.textContent = w.tx; 
          s.dataset.text = w.tx;
          s.dataset.t = w.t; 
          s.dataset.d = w.d;
          if (kind === 'origin') s.classList.add('karaoke-word');
          // s.style.transition = `opacity ${Math.max(0, w.d)}ms ease-out`; 
          // s.style.opacity = '0.55'; // Controlled by CSS now for base color
          s.style.display = 'inline-block'; // Changed to inline-block for transform
          row.appendChild(s); 
          const next = line.c[i + 1]; 
          if (next && needSpace(w.tx, next.tx)) row.appendChild(document.createTextNode(' ')); 
      });
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
      if (kind === 'trans') c.classList.add('trans-line');
      const r = makeRow(line, kind);
      c.appendChild(r);
      if (kind === 'origin') {
         const dots = document.createElement('div');
         dots.className = 'waiting-dots';
         dots.innerHTML = '<span></span><span></span><span></span>';
         c.appendChild(dots);
      }
      c.onclick = () => { try { audio.currentTime = (parseInt(c.dataset.t || '0', 10)) / 1000; } catch (e) { } };
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
      let gapLine = null;

      for (let i = 0; i < lines.length; i++) {
         const c = lines[i];
         const lt = parseInt(c.dataset.t || '0', 10);
         const ld = parseInt(c.dataset.d || '0', 10);
         const next = lines[i+1];
         const nextT = next ? parseInt(next.dataset.t||'0', 10) : Infinity;

         if (t >= lt && t < lt + ld) {
             active = c;
         } else if (t >= lt + ld && t < nextT) {
             gapLine = c;
         }
         
         // Reset dots
         const dots = c.querySelector('.waiting-dots');
         if (dots) {
             dots.classList.remove('show');
             const sp = dots.querySelectorAll('span');
             sp.forEach(s => s.classList.remove('active'));
         }
      }

      if (gapLine && !active) {
         const idx = lines.indexOf(gapLine);
         const next = lines[idx+1];
         if (next) {
             const endT = parseInt(gapLine.dataset.t) + parseInt(gapLine.dataset.d);
             const startT = parseInt(next.dataset.t);
             const gap = startT - endT;
             
             if (gap > 2000) {
                 const dots = gapLine.querySelector('.waiting-dots');
                 // Check if next line is translation
                 const nextRow = next.querySelector('.row.trans');
                 if (nextRow && dots && dots.parentNode !== nextRow) {
                     nextRow.appendChild(dots); // Move dots to translation row
                     // Ensure translation row has flex layout or inline-block to show dots at end?
                     // .row.trans is block by default. We want dots at end.
                     // dots is inline-block.
                 } else if (!nextRow && dots && dots.parentNode !== gapLine) {
                     // Move back if not trans (unlikely case but for safety)
                     gapLine.appendChild(dots);
                 }

                 if (dots) {
                     dots.classList.add('show');
                     const elapsed = t - endT;
                     const phase = gap / 3;
                     const sp = dots.querySelectorAll('span');
                     // Reverse logic: 3 dots -> 2 -> 1
                     // Elapsed 0 -> phase: show 3
                     // Elapsed phase -> phase*2: show 2
                     // Elapsed phase*2 -> end: show 1
                     
                     if (sp[0]) {
                        if (elapsed < gap - 200) sp[0].classList.add('active'); 
                        else sp[0].classList.remove('active');
                     }
                     if (sp[1]) {
                        if (elapsed < (gap*0.66)) sp[1].classList.add('active'); 
                        else sp[1].classList.remove('active');
                     }
                     if (sp[2]) {
                        if (elapsed < (gap*0.33)) sp[2].classList.add('active'); 
                        else sp[2].classList.remove('active');
                     }
                 }
                 active = gapLine;
             }
         }
      }

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
            
            // Karaoke Logic Stream
            if (isActive && isTrans === false) {
                 if (t >= st && t < se) {
                     const pct = Math.min(100, Math.max(0, ((t - st) / Math.max(1, sd)) * 100));
                     const cur = parseFloat(s.style.getPropertyValue('--k-width')||'0');
                     if (Math.abs(cur - pct) > 0.5) {
                         s.style.setProperty('--k-width', `${pct}%`);
                     }
                     // Long word shadow
                     if (sd > 600) s.classList.add('long-word-active');
                     else s.classList.remove('long-word-active');
                 } else if (t >= se) {
                     s.style.setProperty('--k-width', '100%');
                     s.classList.remove('long-word-active');
                 } else {
                     s.style.setProperty('--k-width', '0%');
                     s.classList.remove('long-word-active');
                 }
            } else {
                 if (t >= se) {
                     s.style.setProperty('--k-width', '100%');
                     s.classList.remove('long-word-active');
                 } else {
                     s.style.setProperty('--k-width', '0%');
                     s.classList.remove('long-word-active');
                 }
            }
          });
        });
      });
      if (active) { const now = Date.now(); if (now - userScrollTs > AUTO_SCROLL_PAUSE_MS) { const rect = active.getBoundingClientRect(); const viewMid = window.innerHeight * 0.42; const dy = rect.top + (rect.height / 2) - viewMid; try { el.scrollTo({ top: el.scrollTop + dy, behavior: 'smooth' }); } catch (e) { el.scrollTop += dy; } } }
    }
    // audio.addEventListener('timeupdate', update);
    function loop() {
        if (!document.getElementById('lyrics')) return;
        update();
        window._lyricsRaf = requestAnimationFrame(loop);
    }
    loop();
  }
  if (musicId) {
      const item = { id: musicId, source: musicSource || 'kuwo', cid: params.get('cid') || '' };
      renderLyrics(item);
  }
  function formatTime(sec) { if (!sec) return '0:00'; const s = Math.floor(sec); const m = Math.floor(s / 60); const r = s % 60; return `${m}:${String(r).padStart(2, '0')}`; }
  const progressCurrent = document.getElementById('progressCurrent');
  const progressDuration = document.getElementById('progressDuration');
  async function getSystemNow(){ try { const r = await window.lowbarAPI.pluginCall('music-radio', 'getVariable', ['timeISO']); const d = r && r.result ? r.result : r; const iso = typeof d === 'string' ? d : (d && d.value ? d.value : ''); const t = iso ? Date.parse(iso) : Date.now(); return new Date(t); } catch (e) { return new Date(); } }
  function updateProgress() { if (!audio || !audio.duration) return; const pct = (audio.currentTime / audio.duration); progress.style.width = `${pct * 100}%`; progressDot.style.left = `${pct * 100}%`; if (progressCurrent) progressCurrent.textContent = formatTime(audio.currentTime); if (progressDuration) progressDuration.textContent = formatTime(audio.duration); }
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('canplay', () => { if (songLoading) songLoading.style.display = 'none'; });
  audio.addEventListener('waiting', () => { if (songLoading) songLoading.style.display = 'flex'; });
  audio.addEventListener('play', () => { if (biliVideo && musicSource === 'bili') { try { biliVideo.play(); } catch (e) { } } });
  audio.addEventListener('pause', () => { if (biliVideo && musicSource === 'bili') { try { biliVideo.pause(); } catch (e) { } } });
  audio.addEventListener('play', () => { setRotatePlayState(true); updatePlaybackState(); });
  audio.addEventListener('pause', () => { setRotatePlayState(false); updatePlaybackState(); });
  audio.addEventListener('ended', () => { setRotatePlayState(false); updatePlaybackState(); });
  audio.addEventListener('seeked', updatePlaybackState);
  audio.addEventListener('ratechange', updatePlaybackState);
  audio.addEventListener('durationchange', updatePlaybackState);
  audio.addEventListener('timeupdate', () => { if (biliVideo && musicSource === 'bili') { try { const dt = Math.abs((biliVideo.currentTime||0) - (audio.currentTime||0)); if (dt > 0.5) biliVideo.currentTime = audio.currentTime; } catch (e) { } } });
  if (biliCollapseBtn) biliCollapseBtn.onclick = () => { setBiliMode(biliMode === 'hidden' ? 'float' : 'hidden'); };
  if (biliExpandBtn) biliExpandBtn.onclick = () => { setBiliMode(biliMode === 'expand' ? 'float' : 'expand'); };
  try { if (bgModePanel) { const items = bgModePanel.querySelectorAll('.bgmode-item'); items.forEach((el) => { el.onclick = () => { try { const m = el.dataset.mode || 'blur'; localStorage.setItem('radio.bgmode', m); bgModePanel.style.display = 'none'; applyBackgroundCurrent(); } catch (e) {} }; }); } } catch (e) {}
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
  audio.addEventListener('ended', async () => { try { await window.lowbarAPI.pluginCall('music-radio', 'nextTrack', ['ended']); } catch (e) { } });
  async function loadPlaylist() {
    try {
      const r = await window.lowbarAPI.pluginCall('music-radio', 'getPlaylist', []);
      const data = r && r.result ? r.result : r;
      const listEl = document.getElementById('playlist');
      const totalEl = document.getElementById('playlistTotal');
      const empty = document.getElementById('emptyOverlay');
      if (!data || !listEl || !Array.isArray(data.items)) return;
      
      // Inject Styles if not exists
      if (!document.getElementById('playlist-style-v2')) {
        const s = document.createElement('style');
        s.id = 'playlist-style-v2';
        s.textContent = `
          #playlist .item { display: flex; align-items: center; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: background 0.2s; border-radius: 6px; margin-bottom: 4px; border-left: 3px solid transparent; }
          #playlist .item:hover { background: rgba(255,255,255,0.1); }
          #playlist .item.active { background: rgba(255,255,255,0.15); border-left-color: #fff; }
          #playlist .item .cover { width: 40px; height: 40px; border-radius: 4px; object-fit: cover; margin-right: 10px; background: #222; }
          #playlist .item .meta { flex: 1; display: flex; flex-direction: column; overflow: hidden; justify-content: center; }
          #playlist .item .title { font-size: 13px; color: #eee; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          #playlist .item .artist { font-size: 11px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
          #playlist .item .dur { font-size: 12px; color: #888; margin-left: 10px; }
          #playlist .menu { display: none; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 6px; margin-bottom: 6px; margin-left: 12px; margin-right: 12px; }
          #playlist .menu .actions { display: flex; gap: 8px; flex-wrap: wrap; }
          #playlist .menu button { background: rgba(255,255,255,0.1); border: 0; color: #ddd; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
          #playlist .menu button:hover { background: rgba(255,255,255,0.2); color: #fff; }
          #playlist .menu button i { font-size: 13px; }
        `;
        document.head.appendChild(s);
      }

      listEl.innerHTML = '';
      const fmt = (s) => { const n = Math.floor(Number(s) || 0); const m = Math.floor(n / 60); const r = n % 60; return `${m}:${String(r).padStart(2, '0')}`; };
      
      let openMenuId = null;

      data.items.forEach((it, idx) => {
        const container = document.createElement('div');
        
        const row = document.createElement('div');
        row.className = 'item';
        if (idx === data.currentIndex) row.classList.add('active');
        
        const img = document.createElement('img');
        img.className = 'cover';
        img.src = it.cover || '';
        
        const meta = document.createElement('div');
        meta.className = 'meta';
        const title = document.createElement('div'); title.className = 'title'; title.textContent = it.title || '未知标题';
        const artist = document.createElement('div'); artist.className = 'artist'; artist.textContent = it.artist || '未知艺术家';
        meta.appendChild(title); meta.appendChild(artist);
        
        const dur = document.createElement('div');
        dur.className = 'dur';
        dur.textContent = fmt(it.duration || 0);
        
        row.appendChild(img);
        row.appendChild(meta);
        row.appendChild(dur);
        
        const menu = document.createElement('div');
        menu.className = 'menu';
        const actions = document.createElement('div');
        actions.className = 'actions';
        
        const btnPlay = document.createElement('button');
        btnPlay.innerHTML = '<i class="ri-play-fill"></i> 播放';
        btnPlay.onclick = async (e) => { e.stopPropagation(); try { await window.lowbarAPI.pluginCall('music-radio', 'playIndex', [idx]); } catch (e) { } };
        
        const btnUp = document.createElement('button');
        btnUp.innerHTML = '<i class="ri-arrow-up-line"></i> 上移';
        btnUp.onclick = async (e) => { e.stopPropagation(); try { await window.lowbarAPI.pluginCall('music-radio', 'moveItem', [idx, idx-1]); } catch (e) { } };
        
        const btnDown = document.createElement('button');
        btnDown.innerHTML = '<i class="ri-arrow-down-line"></i> 下移';
        btnDown.onclick = async (e) => { e.stopPropagation(); try { await window.lowbarAPI.pluginCall('music-radio', 'moveItem', [idx, idx+1]); } catch (e) { } };
        
        const btnDel = document.createElement('button');
        btnDel.innerHTML = '<i class="ri-delete-bin-line"></i> 删除';
        btnDel.onclick = async (e) => { e.stopPropagation(); try { await window.lowbarAPI.pluginCall('music-radio', 'removeIndex', [idx]); } catch (e) { } };
        
        const btnBottom = document.createElement('button');
        btnBottom.innerHTML = '<i class="ri-arrow-down-double-line"></i> 移到底部';
        btnBottom.onclick = async (e) => { e.stopPropagation(); try { await window.lowbarAPI.pluginCall('music-radio', 'moveItem', [idx, data.items.length-1]); } catch (e) { } };
        
        const btnNext = document.createElement('button');
        btnNext.innerHTML = '<i class="ri-skip-forward-line"></i> 下首播放';
        btnNext.onclick = async (e) => { 
          e.stopPropagation(); 
          try { 
            let target = data.currentIndex + 1;
            if (idx < target) target--; 
            await window.lowbarAPI.pluginCall('music-radio', 'moveItem', [idx, target]); 
          } catch (e) { } 
        };

        actions.appendChild(btnPlay);
        if (idx > 0) actions.appendChild(btnUp);
        if (idx < data.items.length - 1) actions.appendChild(btnDown);
        actions.appendChild(btnDel);
        if (idx < data.items.length - 1) actions.appendChild(btnBottom);
        if (idx !== data.currentIndex && idx !== data.currentIndex + 1) actions.appendChild(btnNext);
        
        menu.appendChild(actions);
        
        row.onclick = () => {
          const d = menu.style.display;
          // Hide all others
          const allMenus = listEl.querySelectorAll('.menu');
          allMenus.forEach(m => m.style.display = 'none');
          if (d === 'block') menu.style.display = 'none';
          else menu.style.display = 'block';
        };
        
        container.appendChild(row);
        container.appendChild(menu);
        listEl.appendChild(container);
      });

      try { const tt = document.getElementById('playlistTotalText'); if (tt) tt.textContent = `总时长：${fmt(data.totalSecs || 0)}`; } catch (e) { } try { const finEl = document.getElementById('playlistFinish'); if (finEl) { const startIdx = Math.max(0, data.currentIndex || 0); const remainList = Array.isArray(data.items) ? data.items.slice(startIdx) : []; const remainSecs = Math.max(0, remainList.reduce((acc, it) => acc + (Number(it.duration) || 0), 0) - Math.floor(Number(audio.currentTime) || 0)); const dt = new Date(Date.now() + remainSecs * 1000); const hh = String(dt.getHours()).padStart(2, '0'); const mm = String(dt.getMinutes()).padStart(2, '0'); finEl.textContent = `预计播完：${hh}:${mm}`; } } catch (e) { } if (empty) empty.style.display = (data.items.length === 0) ? 'flex' : 'none'; if (!musicUrl && data.items.length > 0) { const last = data.items[data.items.length - 1]; try { if (last) { document.getElementById('audioCover').src = last.cover || ''; document.getElementById('audioTitle').textContent = last.title || ''; document.getElementById('audioArtist').textContent = last.artist || ''; } } catch (e) { } }
    } catch (e) { }
  }
  let lastFinishUpdateTs = 0;
  async function updateFinishEstimate() { try { const finEl = document.getElementById('playlistFinish'); if (!finEl) return; if (Date.now() - lastFinishUpdateTs < 3000) return; lastFinishUpdateTs = Date.now(); const r = await window.lowbarAPI.pluginCall('music-radio', 'getPlaylist', []); const data = r && r.result ? r.result : r; if (!data || !Array.isArray(data.items)) return; const startIdx = Math.max(0, data.currentIndex || 0); const remainList = data.items.slice(startIdx); const remainSecs = Math.max(0, remainList.reduce((acc, it) => acc + (Number(it.duration) || 0), 0) - Math.floor(Number(audio.currentTime) || 0)); const base = await getSystemNow(); const dt = new Date(base.getTime() + remainSecs * 1000); const hh = String(dt.getHours()).padStart(2, '0'); const mm = String(dt.getMinutes()).padStart(2, '0'); finEl.textContent = `预计播完：${hh}:${mm}`; } catch (e) { } }
  try { audio.addEventListener('timeupdate', updateFinishEstimate); } catch (e) { }
  loadPlaylist();
  try { const ch = new URL(location.href).searchParams.get('channel'); if (ch) { window.lowbarAPI.subscribe?.(ch); window.lowbarAPI.onEvent?.((name, payload) => { if (name === ch && payload && (payload.type === 'update' || payload.type === 'control')) { 
        if (payload.type === 'control') {
            if (payload.command === 'pause') { try { audio.pause(); } catch(e){} }
            else if (payload.command === 'play') { try { audio.play(); } catch(e){} }
            return;
        }
        if (payload.target === 'playlist') { loadPlaylist(); try { applyBackgroundCurrent(); } catch (e) {} (async () => { try { const r2 = await window.lowbarAPI.pluginCall('music-radio', 'getPlaylist', []); const d2 = r2 && r2.result ? r2.result : r2; if (d2 && Array.isArray(d2.items) && d2.currentIndex >= 0) { const cur = d2.items[d2.currentIndex];
        const le = document.getElementById('lyrics');
        if (cur && cur.id) {
             const item = { ...cur, source: cur.source || 'kuwo' };
             await renderLyrics(item);
        } else {
             if (le) le.textContent = '';
        } } } catch (e) { } })(); } else if (payload.target === 'songLoading') { 
            try { 
                const x = document.getElementById('songLoading'); 
                if (x) {
                    x.style.display = (payload.value === 'show') ? 'flex' : 'none';
                    if (payload.value === 'show') {
                        if (payload.title && document.getElementById('loadingTitle')) document.getElementById('loadingTitle').textContent = payload.title;
                        if (payload.artist && document.getElementById('loadingArtist')) document.getElementById('loadingArtist').textContent = payload.artist;
                        if (payload.playCount !== undefined && document.getElementById('loadingCount')) document.getElementById('loadingCount').textContent = `已播放 ${payload.playCount} 次`;
                        // Reset cover to loading state or show passed cover
                        const lc = document.getElementById('loadingCover');
                        if (lc) {
                            if (payload.cover) {
                                lc.src = payload.cover;
                                lc.style.display = 'block';
                            } else {
                                lc.style.display = 'none';
                            }
                        }
                    }
                }
            } catch (e) { } 
        } else if (payload.target === 'bgModePanel') { try { if (!bgModePanel) return; const v = String(payload.value||''); if (v === 'toggle') { const cur = bgModePanel.style.display; bgModePanel.style.display = (!cur || cur==='none') ? 'flex' : 'none'; } else if (v === 'show') bgModePanel.style.display = 'flex'; else if (v === 'hide') bgModePanel.style.display = 'none'; } catch (e) {} } else if (payload.target === 'bgModeApply') { try { applyBackgroundCurrent(); spectrumEnabled = (String(localStorage.getItem('radio.spectrum.enabled')||'1') !== '0'); if (spectrumCanvas) { spectrumCanvas.style.display = spectrumEnabled ? '' : 'none'; try { spectrumCanvas.width = spectrumCanvas.clientWidth; spectrumCanvas.height = spectrumCanvas.clientHeight; } catch (e) {} } updateFullscreenStyles(); } catch (e) {} } } }); } } catch (e) { }
  try { const toggle = document.getElementById('removeAfterPlay'); async function initToggle() { try { const r = await window.lowbarAPI.pluginCall('music-radio', 'getSettings', []); const d = r && r.result ? r.result : r; const cur = !!(d && d.settings && d.settings.removeAfterPlay); if (toggle) toggle.checked = cur; } catch (e) { } } function persistLocal() { try { if (toggle) localStorage.setItem('radio.removeAfterPlay', toggle.checked ? '1' : '0'); } catch (e) { } } if (toggle) { initToggle(); toggle.addEventListener('change', async () => { try { await window.lowbarAPI.pluginCall('music-radio', 'setRemoveAfterPlay', [toggle.checked]); persistLocal(); } catch (e) { } }); } } catch (e) { }
  try { const addBtn = document.getElementById('playlistAddBtn'); if (addBtn) addBtn.onclick = async () => { try { await window.lowbarAPI.pluginCall('music-radio', 'onLowbarEvent', [{ type: 'click', id: 'tab-search' }]); } catch (e) { } }; } catch (e) { }
  const prevBtn = document.getElementById('audioPrevBtn');
  const nextBtn = document.getElementById('audioNextBtn');
  const playBtn = document.getElementById('audioPlayBtn');
  const downloadBtn = document.getElementById('audioDownloadBtn');
  const modeBtn = document.getElementById('audioModeBtn');

  if (prevBtn) prevBtn.onclick = async () => { try { await window.lowbarAPI.pluginCall('music-radio', 'prevTrack', []); } catch (e) { } };
  if (nextBtn) nextBtn.onclick = async () => { try { await window.lowbarAPI.pluginCall('music-radio', 'nextTrack', ['manual']); } catch (e) { } };
  if (playBtn) { playBtn.onclick = () => { try { if (audio.paused) { audio.play(); playBtn.innerHTML = '<i class="ri-pause-fill"></i>'; } else { audio.pause(); playBtn.innerHTML = '<i class="ri-play-fill"></i>'; } } catch (e) { } }; audio.addEventListener('play', () => { playBtn.innerHTML = '<i class="ri-pause-fill"></i>'; }); audio.addEventListener('pause', () => { playBtn.innerHTML = '<i class="ri-play-fill"></i>'; }); }
  
  if (downloadBtn) downloadBtn.onclick = async () => { try { await window.lowbarAPI.pluginCall('music-radio', 'downloadCurrent', []); } catch (e) { } };

  const modes = ['list-loop', 'single-loop', 'sequence', 'random', 'play-once'];
  const modeIcons = {
      'list-loop': 'ri-repeat-line',
      'single-loop': 'ri-repeat-one-line',
      'sequence': 'ri-order-play-line',
      'random': 'ri-shuffle-line',
      'play-once': 'ri-stop-circle-line'
  };
  const modeTitles = {
        'list-loop': '列表循环',
        'single-loop': '单曲循环',
        'sequence': '顺序播放',
        'random': '随机播放',
        'play-once': '播完当前'
  };

  async function updateModeUI() {
      try {
          const r = await window.lowbarAPI.pluginCall('music-radio', 'getPlayMode', []);
          const res = r && r.result ? r.result : r;
          if (res && res.ok) {
              const mode = res.mode;
              if (modeBtn) {
                  modeBtn.innerHTML = `<i class="${modeIcons[mode] || 'ri-order-play-line'}"></i>`;
                  modeBtn.title = modeTitles[mode] || '播放模式';
              }
              const toggle = document.getElementById('removeAfterPlay');
              if (toggle && toggle.parentElement) {
                   const show = ['random', 'sequence', 'play-once'].includes(mode);
                   toggle.parentElement.style.display = show ? 'flex' : 'none';
              }
          }
      } catch(e) {}
  }

  if (modeBtn) modeBtn.onclick = async () => {
      try {
          const r = await window.lowbarAPI.pluginCall('music-radio', 'getPlayMode', []);
          const res = r && r.result ? r.result : r;
          if (res && res.ok) {
              const cur = res.mode;
              let idx = modes.indexOf(cur);
              if (idx < 0) idx = 2; 
              const next = modes[(idx + 1) % modes.length];
              await window.lowbarAPI.pluginCall('music-radio', 'setPlayMode', [next]);
              updateModeUI();
          }
      } catch(e) {}
  };
  updateModeUI();
  try { audio.addEventListener('play', updateFullscreenStyles); } catch (e) { }
});
function updateFullscreenStyles() { try { const fsMatch = (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches); const fs = !!document.fullscreenElement || fsMatch || (window.innerHeight >= (screen.availHeight - 1)); const bar = document.getElementById('audioBar'); if (bar) bar.style.bottom = fs ? '96px' : '16px'; const content = document.querySelector('.content-area'); if (bar && content) { const rect = bar.getBoundingClientRect(); const barH = Math.max(64, Math.floor(rect.height || 64)); const barBottomPx = parseInt(String(bar.style.bottom || '16').replace('px', ''), 10) || 16; const padding = 16; const offset = barBottomPx + barH + padding; content.style.bottom = `${offset}px`; } } catch (e) { } }
updateFullscreenStyles();
window.addEventListener('resize', updateFullscreenStyles);
document.addEventListener('fullscreenchange', updateFullscreenStyles);
try { setInterval(updateFullscreenStyles, 1500); } catch (e) { }
