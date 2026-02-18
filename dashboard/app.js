/* ─────────────────────────────────────────
   NeuroRest — app.js
   WebSocket + Demo simulation logic
───────────────────────────────────────── */

// ── EEG channels for EPOC X (5-channel) ──
const EEG_CHANNELS = ['AF3', 'T7', 'Pz', 'T8', 'AF4'];
const CQ_CHANNELS = ['AF3', 'T7', 'Pz', 'T8', 'AF4', 'OVERALL'];
const BANDS = ['theta', 'alpha', 'betaL', 'betaH', 'gamma'];
const METRICS = [
  { key: 'eng', label: '投入度 Engagement' },
  { key: 'exc', label: '興奮度 Excitement' },
  { key: 'lex', label: '長期興奮 Lex' },
  { key: 'str', label: '壓力 Stress' },
  { key: 'rel', label: '放鬆度 Relaxation' },
  { key: 'int', label: '興趣度 Interest' },
  { key: 'foc', label: '專注度 Focus' },
];
const MENTAL_ACTIONS = ['neutral', 'push', 'pull', 'lift', 'drop', 'left', 'right'];
const EYE_ACTIONS = ['neutral', 'blink', 'winkL', 'winkR', 'horiEye', 'lookUp', 'lookDown'];
const UPPER_ACTIONS = ['neutral', 'surprise', 'frown', 'clench'];
const LOWER_ACTIONS = ['neutral', 'smile', 'clench', 'smirkLeft', 'smirkRight'];

// ── EEG ring buffer for waveform ──
const EEG_HISTORY = 200;
let eegBuffer = EEG_CHANNELS.map(() => new Array(EEG_HISTORY).fill(4096));

// ── Band-average ring buffer (theta / alpha / beta / gamma) ──
const POW_HISTORY = 150;
const POW_BAND_COLORS = { theta: '#7c3aed', alpha: '#06b6d4', beta: '#10b981', gamma: '#ef4444' };
let powAvgBuffer = { theta: new Array(POW_HISTORY).fill(0), alpha: new Array(POW_HISTORY).fill(0), beta: new Array(POW_HISTORY).fill(0), gamma: new Array(POW_HISTORY).fill(0) };

// ── State ──
let demoMode = false;
let demoInterval = null;
let ws = null;

let comHistory = [];

// ── Watchdog ──
let lastPowTime = Date.now();

// ── Subscription tracking ──
// Maps stream name → subscribe request id (100-based)
const ALL_STREAMS = ['eeg', 'mot', 'dev', 'met', 'pow', 'com', 'fac', 'sys'];
const STREAM_SUB_ID = {}; // stream → id
ALL_STREAMS.forEach((s, i) => STREAM_SUB_ID[s] = 100 + i);
const SUB_ID_STREAM = {}; // id → stream
ALL_STREAMS.forEach((s, i) => SUB_ID_STREAM[100 + i] = s);
// Maps stream → panel element id
const STREAM_PANEL = {
  eeg: 'panel-eeg', mot: 'panel-mot', dev: 'panel-dev',
  met: 'panel-met', pow: 'panel-pow', com: 'panel-com',
  fac: 'panel-fac', sys: 'panel-sys'
};
const subscribedStreams = new Set();

// ─────────────────────────────────────────
// INIT UI
// ─────────────────────────────────────────
function initUI() {
  buildEEGGrid();
  buildCQGrid();
  buildMetGrid();
  buildPowGrid();
  setupTabs();
  setupTabs();
  setupModal();

  // Fetch config from server
  fetch('/config')
    .then(r => r.json())
    .then(config => {
      if (config.clientId) document.getElementById('clientId').value = config.clientId;
      if (config.clientSecret) document.getElementById('clientSecret').value = config.clientSecret;
    })
    .catch(err => console.log('Config fetch failed (local file mode?):', err));

  // Watchdog: if no pow data for 2 seconds, reset to 0
  setInterval(() => {
    if (Date.now() - lastPowTime > 2000) {
      updatePow({ pow: new Array(EEG_CHANNELS.length * 5).fill(0), time: Date.now() });
    }
  }, 1000);
}

function buildEEGGrid() {
  const grid = document.getElementById('eegGrid');
  grid.innerHTML = EEG_CHANNELS.map(ch => `
    <div class="eeg-channel" id="eeg-${ch}">
      <div class="eeg-ch-name">${ch}</div>
      <div class="eeg-ch-val" id="eegVal-${ch}">—</div>
      <div class="eeg-ch-unit">μV</div>
    </div>
  `).join('');
}

function buildCQGrid() {
  const grid = document.getElementById('cqGrid');
  grid.innerHTML = CQ_CHANNELS.map(ch => `
    <div class="cq-card">
      <div class="cq-name">${ch}</div>
      <div class="cq-bar-wrap"><div class="cq-bar" id="cqBar-${ch}" style="width:0%"></div></div>
      <div class="cq-val" id="cqVal-${ch}">—</div>
    </div>
  `).join('');
}

function buildMetGrid() {
  const grid = document.getElementById('metGrid');
  grid.innerHTML = METRICS.map(m => `
    <div class="met-card" id="metCard-${m.key}">
      <div class="met-name">${m.label}</div>
      <div class="met-val" id="metVal-${m.key}">—</div>
      <div class="met-bar-wrap"><div class="met-bar" id="metBar-${m.key}" style="width:0%"></div></div>
      <span class="met-active-badge off" id="metBadge-${m.key}">inactive</span>
    </div>
  `).join('');
}

function buildPowGrid() {
  const grid = document.getElementById('powGrid');
  grid.innerHTML = EEG_CHANNELS.map(ch => `
    <div class="pow-card">
      <div class="pow-ch">${ch}</div>
      <div class="pow-bands">
        ${BANDS.map(b => `
          <div class="pow-band-row">
            <span class="pow-band-name">${b}</span>
            <div class="pow-band-bar-wrap">
              <div class="pow-band-bar band-${b}" id="powBar-${ch}-${b}" style="width:0%"></div>
            </div>
            <span class="pow-band-val" id="powVal-${ch}-${b}">—</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// ─────────────────────────────────────────
// TABS
// ─────────────────────────────────────────
function setupTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ─────────────────────────────────────────
// MODAL / CONNECTION
// ─────────────────────────────────────────
function setupModal() {
  document.getElementById('connectBtn').addEventListener('click', () => {
    const useDemo = document.getElementById('demoToggle').checked;
    if (useDemo) {
      startDemo();
      hideModal();
      return;
    }
    const id = document.getElementById('clientId').value.trim();
    const sec = document.getElementById('clientSecret').value.trim();
    if (!id || !sec) { alert('請填入 Client ID 與 Client Secret'); return; }
    connectWebSocket(id, sec);
  });
}

function hideModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

function setStatus(state, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  dot.className = 'status-dot ' + state;
  txt.textContent = text;
  // Hide headset name when not connected
  if (state !== 'connected' && state !== 'demo') {
    const hn = document.getElementById('headsetName');
    if (hn) { hn.textContent = ''; hn.style.display = 'none'; }
  }
}

// ─────────────────────────────────────────
// NO-SUBSCRIPTION OVERLAY
// ─────────────────────────────────────────
function showNoSub(stream) {
  const panelId = STREAM_PANEL[stream];
  if (!panelId) return;
  const panel = document.getElementById(panelId);
  if (!panel || panel.querySelector('.no-sub-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'no-sub-overlay';
  overlay.innerHTML = `
    <div class="no-sub-icon">🔒</div>
    <div class="no-sub-title">無訂閱</div>
    <div class="no-sub-desc">此分頁需要 <code>${stream}</code> 資料流授權<br>請在 Emotiv 開發者平台開啟相應訂閱。</div>
  `;
  panel.appendChild(overlay);
}

function clearNoSub(stream) {
  const panelId = STREAM_PANEL[stream];
  if (!panelId) return;
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const overlay = panel.querySelector('.no-sub-overlay');
  if (overlay) overlay.remove();
}

// ─────────────────────────────────────────
// WEBSOCKET (real Cortex connection)
// ─────────────────────────────────────────
function connectWebSocket(clientId, clientSecret) {
  setStatus('', '連線中…');
  try {
    ws = new WebSocket('wss://localhost:6868');
    ws.onopen = () => {
      setStatus('connected', '已連線');
      hideModal();
      // hasAccessRight
      ws.send(JSON.stringify({
        jsonrpc: '2.0', method: 'hasAccessRight',
        params: { clientId, clientSecret }, id: 20
      }));
    };
    ws.onmessage = (evt) => {
      try { handleCortexMessage(JSON.parse(evt.data), clientId, clientSecret); }
      catch (e) { console.error(e); }
    };
    ws.onerror = () => setStatus('', '連線失敗');
    ws.onclose = () => setStatus('', '已斷線');
  } catch (e) {
    setStatus('', '連線失敗');
  }
}

let cortexAuth = '';
let cortexSession = '';

function handleCortexMessage(msg, clientId, clientSecret) {
  if (msg.result !== undefined) {
    const id = msg.id;
    if (id === 20) { // hasAccessRight
      if (msg.result.accessGranted) {
        ws.send(JSON.stringify({
          jsonrpc: '2.0', method: 'authorize',
          params: { clientId, clientSecret, license: '', debit: 10 }, id: 4
        }));
      } else {
        ws.send(JSON.stringify({
          jsonrpc: '2.0', method: 'requestAccess',
          params: { clientId, clientSecret }, id: 3
        }));
      }
    } else if (id === 3) { // requestAccess
      // Waiting for user to approve in Emotiv Launcher
      setStatus('', '等待 Emotiv Launcher 授權…');
    } else if (id === 4) { // authorize
      cortexAuth = msg.result.cortexToken;
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'queryHeadsets', params: {}, id: 1 }));
    } else if (id === 1) { // queryHeadsets
      const headsets = msg.result;
      if (!headsets || headsets.length === 0) {
        setStatus('', '找不到裝置，請確認頭戴裝置已開啟');
        // Retry after 3 seconds
        setTimeout(() => ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'queryHeadsets', params: {}, id: 1 })), 3000);
        return;
      }
      const hs = headsets[0];
      // Show headset name in header
      const hn = document.getElementById('headsetName');
      if (hn) { hn.textContent = '📟 ' + hs.id; hn.style.display = 'inline-flex'; }
      setStatus('connected', '已連線 · ' + hs.id);
      ws.send(JSON.stringify({
        jsonrpc: '2.0', method: 'createSession',
        params: { cortexToken: cortexAuth, headset: hs.id, status: 'active' }, id: 5
      }));
    } else if (id === 5) { // createSession
      cortexSession = msg.result.id;
      setStatus('connected', '訂閱串流中…');
      updateSys(['Session Created', 'id=' + cortexSession]);
      // Subscribe each stream individually so failures don't block others
      ALL_STREAMS.forEach(stream => {
        const req = {
          jsonrpc: '2.0', method: 'subscribe',
          params: { cortexToken: cortexAuth, session: cortexSession, streams: [stream] },
          id: STREAM_SUB_ID[stream]
        };
        console.log('Sending subscribe:', req);
        ws.send(JSON.stringify(req));
      });
    } else {
      // Handle per-stream subscribe responses (id 100–107)
      const stream = SUB_ID_STREAM[id];
      if (stream) {
        const success = (msg.result?.success || []).map(s => s.streamName);
        const failure = (msg.result?.failure || []);
        if (success.includes(stream)) {
          subscribedStreams.add(stream);
          clearNoSub(stream);
          updateSys(['✅ 訂閱成功', stream]);
        } else if (failure.length) {
          subscribedStreams.delete(stream);
          showNoSub(stream);
          const reason = failure[0]?.message || '授權不足';
          updateSys(['⚠ 訂閱失敗', stream, reason]);
        }
        // Update status when all subscriptions have responded
        const responded = subscribedStreams.size +
          ALL_STREAMS.filter(s => document.getElementById(STREAM_PANEL[s])?.querySelector('.no-sub-overlay')).length;
        if (responded >= ALL_STREAMS.length) {
          const n = subscribedStreams.size;
          setStatus('connected', `資料串流中 ✓ (${n}/${ALL_STREAMS.length})`);
        }
      } else {
        // Unknown ID result
        console.log('Unknown result:', msg);
      }
    }
  } else if (msg.error) {
    // Handle Cortex API errors
    const code = msg.error.code;
    const emsg = msg.error.message || '未知錯誤';
    console.error('[Cortex Error]', code, emsg);
    // Check if this error is for a per-stream subscribe request (id 100–107)
    const errStream = SUB_ID_STREAM[msg.id];
    if (errStream) {
      subscribedStreams.delete(errStream);
      showNoSub(errStream);
      updateSys(['⚠ 訂閱失敗', errStream, emsg]);
      // Update status count
      const responded = subscribedStreams.size +
        ALL_STREAMS.filter(s => document.getElementById(STREAM_PANEL[s])?.querySelector('.no-sub-overlay')).length;
      if (responded >= ALL_STREAMS.length) {
        const n = subscribedStreams.size;
        setStatus('connected', `資料串流中 ✓ (${n}/${ALL_STREAMS.length})`);
      }
    } else if (code === -32021 || code === -32022) {
      setStatus('', '❌ 授權失敗：Client ID / Secret 無效');
      updateSys(['❌ Cortex Error', 'code=' + code, emsg]);
    } else if (code === -32046) {
      setStatus('', '❌ 無存取權限，請在 Emotiv Launcher 核准');
      updateSys(['❌ Cortex Error', 'code=' + code, emsg]);
    } else {
      setStatus('', '❌ 錯誤 ' + code);
      updateSys(['❌ Cortex Error', 'code=' + code, emsg]);
    }
  } else if (msg.warning) {
    // Handle Cortex warning events
    const code = msg.warning.code;
    const wmsg = msg.warning.message || '';
    // code 103 = headset disconnected timeout
    // code 0   = cortex stop all streams
    // code 1   = session closed
    if (code === 103 || code === 0 || code === 1) {
      setStatus('', '裝置已斷線 (code ' + code + ')');
      updateSys(['⚠ Cortex warning', 'code=' + code, wmsg]);
    } else {
      updateSys(['Cortex warning', 'code=' + code, wmsg]);
    }
  } else if (msg.sid) {
    dispatchStreamData(msg);
  }
}

// ─────────────────────────────────────────
// STREAM DATA DISPATCH
// ─────────────────────────────────────────
function dispatchStreamData(d) {
  const t = d.time;


  // eeg: [COUNTER, INTERPOLATED, AF3, T7, Pz, T8, AF4, RAW_CQ, MARKER_HARDWARE]
  // slice(2, 7) → only the 5 electrode values (AF3, T7, Pz, T8, AF4)
  if (d.eeg) updateEEG({ eeg: d.eeg.slice(2, 7), time: t });
  if (d.mot) updateMot({ mot: d.mot, time: t });
  // dev: [headsetId, signal(0~1), [AF3,T7,Pz,T8,AF4,OVERALL], batteryPercent]
  if (d.dev) updateDev({ signal: d.dev[1], dev: Array.isArray(d.dev[2]) ? d.dev[2] : [], batteryPercent: d.dev[3], time: t });
  if (d.met) updateMet({ met: d.met, time: t });
  if (d.pow) updatePow({ pow: d.pow, time: t });
  if (d.com) updateCom({ action: d.com[0], power: d.com[1], time: t });
  if (d.fac) updateFac({ eyeAct: d.fac[0], uAct: d.fac[1], uPow: d.fac[2], lAct: d.fac[3], lPow: d.fac[4], time: t });
  if (d.sys) updateSys(d.sys);
}

// ─────────────────────────────────────────
// UPDATE FUNCTIONS
// ─────────────────────────────────────────
function updateEEG(data) {
  const vals = data.eeg;
  EEG_CHANNELS.forEach((ch, i) => {
    const v = vals[i] !== undefined ? vals[i] : 0;
    const el = document.getElementById('eegVal-' + ch);
    if (el) el.textContent = v.toFixed(3);
    eegBuffer[i].push(v);
    if (eegBuffer[i].length > EEG_HISTORY) eegBuffer[i].shift();
  });
  drawEEGCanvas();
  document.getElementById('eegRaw').textContent = JSON.stringify(data, null, 2);
}

function drawEEGCanvas() {
  const canvas = document.getElementById('eegCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth; const H = canvas.offsetHeight;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const colors = ['#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];
  const rowH = H / EEG_CHANNELS.length;

  EEG_CHANNELS.forEach((ch, i) => {
    const buf = eegBuffer[i];
    const min = Math.min(...buf); const max = Math.max(...buf);
    const range = max - min || 1;
    const y0 = i * rowH + rowH / 2;

    ctx.beginPath();
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;

    buf.forEach((v, x) => {
      const px = (x / (EEG_HISTORY - 1)) * W;
      const py = y0 - ((v - min) / range - 0.5) * rowH * 0.8;
      x === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = colors[i];
    ctx.font = '10px Inter';
    ctx.fillText(ch, 6, i * rowH + 14);
    ctx.globalAlpha = 1;
  });
}

function updateMot(data) {
  const m = data.mot;
  // [COUNTER_MEMS, INTERPOLATED_MEMS, Q0, Q1, Q2, Q3, ACCX, ACCY, ACCZ, MAGX, MAGY, MAGZ]
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = typeof v === 'number' ? v.toFixed(4) : v; };
  set('q0', m[2]); set('q1', m[3]); set('q2', m[4]); set('q3', m[5]);
  set('accX', m[6]); set('accY', m[7]); set('accZ', m[8]);
  set('magX', m[9]); set('magY', m[10]); set('magZ', m[11]);
  document.getElementById('motRaw').textContent = JSON.stringify(data, null, 2);
}

function updateDev(data) {
  const pct = data.batteryPercent || 0;
  const sig = (data.signal || 0) * 100;
  const devArr = data.dev || [];

  document.getElementById('batBar').style.width = pct + '%';
  document.getElementById('batPct').textContent = pct + '%';

  const arc = document.getElementById('signalArc');
  const circumference = 213.6;
  arc.style.strokeDashoffset = circumference - (sig / 100) * circumference;
  document.getElementById('signalPct').textContent = sig.toFixed(0) + '%';

  CQ_CHANNELS.forEach((ch, i) => {
    const val = devArr[i] !== undefined ? devArr[i] : 0;
    const pctCQ = Math.min(100, (val / 4) * 100);
    const bar = document.getElementById('cqBar-' + ch);
    const valEl = document.getElementById('cqVal-' + ch);
    if (bar) {
      bar.style.width = pctCQ + '%';
      bar.style.background = pctCQ > 66 ? '#10b981' : pctCQ > 33 ? '#f59e0b' : '#ef4444';
    }
    if (valEl) valEl.textContent = val;
  });
  document.getElementById('devRaw').textContent = JSON.stringify(data, null, 2);
}

function updateMet(data) {
  // met: [eng.isActive, eng, exc.isActive, exc, lex, str.isActive, str, rel.isActive, rel, int.isActive, int, foc.isActive, foc]
  const m = data.met;
  const map = {
    eng: { isActive: m[0], val: m[1] },
    exc: { isActive: m[2], val: m[3] },
    lex: { isActive: true, val: m[4] },
    str: { isActive: m[5], val: m[6] },
    rel: { isActive: m[7], val: m[8] },
    int: { isActive: m[9], val: m[10] },
    foc: { isActive: m[11], val: m[12] },
  };
  METRICS.forEach(({ key }) => {
    const d = map[key];
    if (!d) return;
    const v = d.val;
    const el = document.getElementById('metVal-' + key);
    const bar = document.getElementById('metBar-' + key);
    const badge = document.getElementById('metBadge-' + key);
    const card = document.getElementById('metCard-' + key);
    if (el) el.textContent = typeof v === 'number' ? (v * 100).toFixed(1) + '%' : '—';
    if (bar) bar.style.width = (v * 100) + '%';
    if (badge) {
      badge.textContent = d.isActive ? 'active' : 'inactive';
      badge.className = 'met-active-badge ' + (d.isActive ? 'on' : 'off');
    }
    if (card) card.classList.toggle('active-metric', !!d.isActive);
  });
  document.getElementById('metRaw').textContent = JSON.stringify(data, null, 2);
}

function updatePow(data) {
  lastPowTime = Date.now();
  // pow: [AF3/theta, AF3/alpha, AF3/betaL, AF3/betaH, AF3/gamma, T7/theta, ...]
  const p = data.pow;
  let idx = 0;
  const maxPow = 10;

  // Accumulators for cross-electrode average
  let sumTheta = 0, sumAlpha = 0, sumBetaL = 0, sumBetaH = 0, sumGamma = 0;
  const n = EEG_CHANNELS.length;

  EEG_CHANNELS.forEach(ch => {
    BANDS.forEach(b => {
      let v = p[idx++];
      if (typeof v !== 'number' || isNaN(v)) v = 0;
      const bar = document.getElementById('powBar-' + ch + '-' + b);
      const val = document.getElementById('powVal-' + ch + '-' + b);
      if (bar) bar.style.width = Math.min(100, (v / maxPow) * 100) + '%';
      if (val) val.textContent = v.toFixed(2);
      if (b === 'theta') sumTheta += v;
      if (b === 'alpha') sumAlpha += v;
      if (b === 'betaL') sumBetaL += v;
      if (b === 'betaH') sumBetaH += v;
      if (b === 'gamma') sumGamma += v;
    });
  });

  // Compute averages; merge betaL + betaH into beta
  const avgTheta = sumTheta / n;
  const avgAlpha = sumAlpha / n;
  const avgBeta = (sumBetaL + sumBetaH) / (2 * n);
  const avgGamma = sumGamma / n;

  // Update badge values
  const setAvg = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v.toFixed(3); };
  setAvg('avgTheta', avgTheta);
  setAvg('avgAlpha', avgAlpha);
  setAvg('avgBeta', avgBeta);
  setAvg('avgGamma', avgGamma);

  // Push to ring buffers
  const push = (key, v) => { powAvgBuffer[key].push(v); if (powAvgBuffer[key].length > POW_HISTORY) powAvgBuffer[key].shift(); };
  push('theta', avgTheta);
  push('alpha', avgAlpha);
  push('beta', avgBeta);
  push('gamma', avgGamma);

  drawPowAvgCanvas();
  document.getElementById('powRaw').textContent = JSON.stringify(data, null, 2);
}

function drawPowAvgCanvas() {
  const canvas = document.getElementById('powAvgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || canvas.parentElement.offsetWidth;
  const H = canvas.offsetHeight || 220;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  // Draw subtle grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (i / 4) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const bands = ['theta', 'alpha', 'beta', 'gamma'];
  bands.forEach(band => {
    const buf = powAvgBuffer[band];
    const allVals = Object.values(powAvgBuffer).flat();
    const globalMax = Math.max(...allVals) || 1;
    const globalMin = Math.min(...allVals);
    const range = globalMax - globalMin || 1;

    ctx.beginPath();
    ctx.strokeStyle = POW_BAND_COLORS[band];
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;

    buf.forEach((v, x) => {
      const px = (x / (POW_HISTORY - 1)) * W;
      const py = H - ((v - globalMin) / range) * H * 0.9 - H * 0.05;
      x === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function updateCom(data) {
  const action = data.action || '—';
  const power = typeof data.power === 'number' ? data.power : 0;

  document.getElementById('comAction').textContent = action;
  document.getElementById('comPowerBar').style.width = (power * 100) + '%';
  document.getElementById('comPowerVal').textContent = (power * 100).toFixed(1) + '%';

  // history
  comHistory.unshift({ action, power, time: new Date().toLocaleTimeString() });
  if (comHistory.length > 8) comHistory.pop();
  const list = document.getElementById('comHistoryList');
  list.innerHTML = comHistory.map(h => `
    <li>
      <span class="sys-time">${h.time}</span>
      <span class="sys-msg">${h.action}</span>
      <span>${(h.power * 100).toFixed(1)}%</span>
    </li>
  `).join('');

  document.getElementById('comRaw').textContent = JSON.stringify(data, null, 2);
}

function updateFac(data) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('eyeAct', data.eyeAct || '—');
  set('uAct', data.uAct || '—');
  set('uPow', typeof data.uPow === 'number' ? (data.uPow * 100).toFixed(1) + '%' : '—');
  set('lAct', data.lAct || '—');
  set('lPow', typeof data.lPow === 'number' ? (data.lPow * 100).toFixed(1) + '%' : '—');
  document.getElementById('facRaw').textContent = JSON.stringify(data, null, 2);
}

function updateSys(data) {
  const log = document.getElementById('sysLog');
  const empty = log.querySelector('.sys-log-empty');
  if (empty) empty.remove();

  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  const msg = Array.isArray(data) ? data.join(' | ') : JSON.stringify(data);
  li.innerHTML = `
    <span class="sys-time">${time}</span>
    <span class="sys-msg">${msg}</span>
    <span class="sys-tag info">INFO</span>
  `;
  log.prepend(li);
  if (log.children.length > 50) log.lastElementChild.remove();
  document.getElementById('sysRaw').textContent = JSON.stringify(data, null, 2);
}

// ─────────────────────────────────────────
// DEMO MODE
// ─────────────────────────────────────────
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

function startDemo() {
  demoMode = true;
  setStatus('demo', '模擬資料');

  // Inject initial system events
  const sysEvents = ['Training started', 'Profile loaded', 'Headset connected', 'Session active'];
  sysEvents.forEach((msg, i) => {
    setTimeout(() => updateSys([msg]), i * 600);
  });

  demoInterval = setInterval(() => {
    const t = Date.now() / 1000;

    // EEG
    const eegVals = EEG_CHANNELS.map((_, i) =>
      4096 + Math.sin(t * (0.5 + i * 0.3)) * 200 + rand(-50, 50)
    );
    updateEEG({ eeg: eegVals, time: t });

    // Motion
    updateMot({
      mot: [
        0, 0,
        Math.sin(t * 0.3), Math.cos(t * 0.3), Math.sin(t * 0.2), Math.cos(t * 0.2),
        rand(-1, 1), rand(-1, 1), rand(9, 10),
        rand(-80, 80), rand(-20, 20), rand(30, 50)
      ], time: t
    });

    // Device
    const cqVals = CQ_CHANNELS.map(() => randInt(2, 4));
    updateDev({
      signal: rand(0.7, 1.0),
      dev: cqVals,
      batteryPercent: 75 + Math.sin(t * 0.01) * 5,
      time: t
    });

    // Metrics
    updateMet({
      met: [
        true, rand(0.3, 0.9),  // eng
        true, rand(0.2, 0.7),  // exc
        rand(0.1, 0.5),         // lex
        false, rand(0.1, 0.4),  // str
        true, rand(0.4, 0.8),  // rel
        true, rand(0.3, 0.7),  // int
        true, rand(0.5, 0.95), // foc
      ], time: t
    });

    // Band Power
    const pow = [];
    EEG_CHANNELS.forEach(() => {
      pow.push(rand(3, 8));   // theta
      pow.push(rand(2, 6));   // alpha
      pow.push(rand(1, 4));   // betaL
      pow.push(rand(0.5, 3)); // betaH
      pow.push(rand(0.1, 1)); // gamma
    });
    updatePow({ pow, time: t });

    // Mental Command (changes every ~3s)
    if (Math.random() < 0.05) {
      updateCom({ action: pick(MENTAL_ACTIONS), power: rand(0.3, 1.0), time: t });
    }

    // Facial Expression (changes every ~2s)
    if (Math.random() < 0.08) {
      updateFac({
        eyeAct: pick(EYE_ACTIONS),
        uAct: pick(UPPER_ACTIONS), uPow: rand(0.3, 1.0),
        lAct: pick(LOWER_ACTIONS), lPow: rand(0.3, 1.0),
        time: t
      });
    }

    // System (occasional)
    if (Math.random() < 0.02) {
      updateSys(['Training event', pick(['MC_Succeeded', 'MC_Failed', 'MC_Completed', 'FE_Succeeded'])]);
    }

  }, 100); // 10 Hz
}

// ─────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  // Initial com state
  updateCom({ action: 'neutral', power: 0, time: Date.now() / 1000 });
  updateFac({ eyeAct: 'neutral', uAct: 'neutral', uPow: 0, lAct: 'neutral', lPow: 0, time: Date.now() / 1000 });
});
