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

// ── Web Console Interception ──
const origConsoleLog = console.log;
const origConsoleWarn = console.warn;
const origConsoleError = console.error;

function appendWebConsoleLog(level, args) {
  const logEl = document.getElementById('webConsoleLog');
  if (!logEl) return;
  const empty = logEl.querySelector('.sys-log-empty');
  if (empty) empty.remove();

  const msg = Array.from(args).map(a => {
    if (a instanceof Error) return a.toString() + (a.stack ? '\n' + a.stack : '');
    return typeof a === 'object' ? JSON.stringify(a) : String(a);
  }).join(' ');
  const time = new Date().toLocaleTimeString();

  const li = document.createElement('li');
  let tagClass = 'info';
  if (level === 'WARN') tagClass = 'warn';
  else if (level === 'ERROR') tagClass = 'error';

  li.innerHTML = `
    <span class="sys-time">${time}</span>
    <span class="sys-msg">${msg}</span>
    <span class="sys-tag ${tagClass}">${level}</span>
  `;
  logEl.prepend(li);
  if (logEl.children.length > 100) logEl.lastElementChild.remove();
}

window.addEventListener('error', function (e) {
  appendWebConsoleLog('ERROR', [e.message, 'at', e.filename + ':' + e.lineno]);
});
window.addEventListener('unhandledrejection', function (e) {
  appendWebConsoleLog('ERROR', ['Unhandled Promise Rejection:', e.reason]);
});

console.log = function (...args) {
  origConsoleLog.apply(console, args);
  appendWebConsoleLog('INFO', args);
};
console.warn = function (...args) {
  origConsoleWarn.apply(console, args);
  appendWebConsoleLog('WARN', args);
};
console.error = function (...args) {
  origConsoleError.apply(console, args);
  appendWebConsoleLog('ERROR', args);
};

// ── EEG ring buffer for waveform ──
const EEG_HISTORY = 200;
let eegBuffer = EEG_CHANNELS.map(() => new Array(EEG_HISTORY).fill(4096));

// ── Band-average ring buffer (theta / alpha / beta / gamma) ──
const POW_HISTORY = 150;
const POW_BAND_COLORS = { theta: '#a855f7', alpha: '#06b6d4', beta: '#10b981', gamma: '#ef4444', thetaAlpha: '#f59e0b' };
let powAvgBuffer = { theta: new Array(POW_HISTORY).fill(0), alpha: new Array(POW_HISTORY).fill(0), beta: new Array(POW_HISTORY).fill(0), gamma: new Array(POW_HISTORY).fill(0), thetaAlpha: new Array(POW_HISTORY).fill(0) };
let powBandVisible = { theta: true, alpha: true, beta: true, gamma: true, thetaAlpha: true };

window.togglePowBand = function (bandStr, el) {
  powBandVisible[bandStr] = !powBandVisible[bandStr];
  el.style.opacity = powBandVisible[bandStr] ? '1' : '0.4';
  drawPowAvgCanvas();
};

// ── Band Power history table data (for CSV export) ──
let powTableData = [];  // [{time, theta, alpha, beta, gamma}, ...]
let lastPowRecordTime = 0; // 節流：每秒最多記錄 1 筆到 powTableData
let latestPowData = { theta: 0, alpha: 0, beta: 0, gamma: 0, thetaAlpha: 0, valid: false };

// ── State ──
let demoMode = false;
let demoInterval = null;
let ws = null;

let comHistory = [];

// ── 歷史記錄 buffer（無上限，用於 CSV 完整匯出）──
let motHistory = [];  // [{time, q0,q1,q2,q3,accX,accY,accZ,magX,magY,magZ}, ...]
let devHistory = [];  // [{time, signal, batteryPercent, AF3,T7,Pz,T8,AF4,OVERALL}, ...]
let metHistory = [];  // [{time, eng, exc, lex, str, rel, int, foc}, ...]
let lastMetRecordTime = 0;  // 節流：每秒最多記錄 1 筆
let facHistory = [];  // [{time, eyeAct, uAct, uPow, lAct, lPow}, ...]
let lastFacRecordTime = 0;  // 節流：每秒最多記錄 1 筆
let sysHistory = [];  // [{time, msg, tag}, ...]
let bleHistory = [];  // [{time, hr, rr}, ...]
let lastBleRecordTime = 0; // 節流：每秒最多記錄 1 筆
let currentBleData = { hr: '—', rr: '—' };
const BLE_CHART_HISTORY = 100;
let bleChartBuffer = new Array(BLE_CHART_HISTORY).fill(null); // store raw HR values

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
  fac: 'panel-mot', sys: 'panel-sys'
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

  // Watchdog: if no pow data for 2 seconds, reset display to 0
  // NOTE: 只重置 UI 顯示，不追加到 powTableData（避免汙染歷史記錄）
  setInterval(() => {
    if (Date.now() - lastPowTime > 2000) {
      const zeros = new Array(EEG_CHANNELS.length * 5).fill(0);
      let idx = 0;
      EEG_CHANNELS.forEach(ch => {
        BANDS.forEach(b => {
          const bar = document.getElementById('powBar-' + ch + '-' + b);
          const val = document.getElementById('powVal-' + ch + '-' + b);
          if (bar) bar.style.width = '0%';
          if (val) val.textContent = '0.00';
          idx++;
        });
      });
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
        setStatus('', 'EEG未連線');
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
  // 追加歷史記錄（與 facial 共用 time 同步，在 updateFac 裡也會觸發更新 unified 表格）
  motHistory.push({
    time: getTimestamp(),
    q0: m[2], q1: m[3], q2: m[4], q3: m[5],
    accX: m[6], accY: m[7], accZ: m[8],
    magX: m[9], magY: m[10], magZ: m[11]
  });
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
  // 追加歷史記錄
  const rec = { time: getTimestamp(), signal: sig.toFixed(1) + '%', batteryPercent: pct + '%' };
  CQ_CHANNELS.forEach((ch, i) => { rec[ch] = devArr[i] !== undefined ? devArr[i] : 0; });
  devHistory.push(rec);
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
  const timeStr = getTimestamp();
  METRICS.forEach(({ key, label }) => {
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

  // ── 每秒記錄 1 筆（所有指標單行）──
  var now_ms = Date.now();
  if (now_ms - lastMetRecordTime >= 1000) {
    lastMetRecordTime = now_ms;
    var fmt = function (key) {
      var v = map[key] && typeof map[key].val === 'number' ? (map[key].val * 100).toFixed(1) + '%' : '—';
      return v;
    };
    var rec = {
      time: timeStr,
      eng: fmt('eng'), exc: fmt('exc'), lex: fmt('lex'),
      str: fmt('str'), rel: fmt('rel'), int: fmt('int'), foc: fmt('foc')
    };
    metHistory.push(rec);

    var tbody = document.getElementById('metTableBody');
    if (tbody) {
      var empty = tbody.querySelector('.met-table-empty');
      if (empty) empty.remove();
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + timeStr + '</td>'
        + '<td style="color:#06b6d4">' + rec.eng + '</td>'
        + '<td style="color:#f59e0b">' + rec.exc + '</td>'
        + '<td style="color:#f59e0b">' + rec.lex + '</td>'
        + '<td style="color:#ef4444">' + rec.str + '</td>'
        + '<td style="color:#10b981">' + rec.rel + '</td>'
        + '<td style="color:#a78bfa">' + rec.int + '</td>'
        + '<td style="color:#7c3aed">' + rec.foc + '</td>';
      tbody.prepend(tr);
      while (tbody.rows.length > 200) tbody.deleteRow(tbody.rows.length - 1);
    }
    var countEl = document.getElementById('metTableCount');
    if (countEl) countEl.textContent = metHistory.length + ' 筆';
  }
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
  // θ/α ratio
  const taVal = avgAlpha > 0 ? avgTheta / avgAlpha : 0;
  const thetaAlphaEl = document.getElementById('avgThetaAlpha');
  if (thetaAlphaEl) thetaAlphaEl.textContent = avgAlpha > 0 ? taVal.toFixed(3) : '∞';

  // Update latestPowData for history recording
  latestPowData = {
    theta: avgTheta,
    alpha: avgAlpha,
    beta: avgBeta,
    gamma: avgGamma,
    thetaAlpha: avgAlpha > 0 ? taVal : null,
    valid: true
  };

  // Push to ring buffers
  const push = (key, v) => { powAvgBuffer[key].push(v); if (powAvgBuffer[key].length > POW_HISTORY) powAvgBuffer[key].shift(); };
  push('theta', avgTheta);
  push('alpha', avgAlpha);
  push('beta', avgBeta);
  push('gamma', avgGamma);
  push('thetaAlpha', avgAlpha > 0 ? avgTheta / avgAlpha : 0);

  drawPowAvgCanvas();
}

function drawPowAvgCanvas() {
  const canvas = document.getElementById('powAvgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  let W = canvas.parentElement.offsetWidth;
  if (W < 1300) W = 1300;
  
  const H = canvas.parentElement.offsetHeight || 220;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  // Draw subtle grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (i / 4) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const bands = ['theta', 'alpha', 'beta', 'gamma', 'thetaAlpha'];
  let visibleVals = [];
  bands.forEach(band => {
    if (powBandVisible[band]) {
      visibleVals.push(...powAvgBuffer[band]);
    }
  });

  const globalMax = Math.max(...visibleVals) || 1;
  const globalMin = Math.min(...visibleVals);
  const range = globalMax - globalMin || 1;

  bands.forEach(band => {
    if (!powBandVisible[band]) return;
    const buf = powAvgBuffer[band];

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

  // history（無上限，保留所有記錄供 CSV 匯出）
  comHistory.unshift({ action, power, time: new Date().toLocaleTimeString() });
  // UI 只顯示最近 8 筆（comHistory 本身保留全部供 CSV 匯出）
  const list = document.getElementById('comHistoryList');
  list.innerHTML = comHistory.slice(0, 8).map(h => `
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
  const eyeAct = data.eyeAct || '—';
  const uAct = data.uAct || '—';
  const lAct = data.lAct || '—';
  const uPow = typeof data.uPow === 'number' ? (data.uPow * 100).toFixed(1) + '%' : '—';
  const lPow = typeof data.lPow === 'number' ? (data.lPow * 100).toFixed(1) + '%' : '—';
  set('eyeAct', eyeAct);
  set('uAct', uAct);
  set('uPow', uPow);
  set('lAct', lAct);
  set('lPow', lPow);
  document.getElementById('facRaw').textContent = JSON.stringify(data, null, 2);

  // ── 追加歷史記錄（節流：每秒最多 1 筆）──
  var now_ms = Date.now();
  if (now_ms - lastFacRecordTime >= 1000) {
    lastFacRecordTime = now_ms;
    var timeStr = getTimestamp();
    var rec = { time: timeStr, eyeAct: eyeAct, uAct: uAct, uPow: uPow, lAct: lAct, lPow: lPow };
    facHistory.push(rec);

    // 取得最近的一筆 Motion 資料
    var motRec = motHistory.length > 0 ? motHistory[motHistory.length - 1] : null;
    var motCols = '';
    if (motRec && Math.abs(Date.parse(motRec.time) - Date.parse(timeStr)) < 2000) {
        // 資料夠新鮮
        var quatStr = `${motRec.q0.toFixed(2)}, ${motRec.q1.toFixed(2)}, ${motRec.q2.toFixed(2)}, ${motRec.q3.toFixed(2)}`;
        var accStr = `${motRec.accX.toFixed(2)}, ${motRec.accY.toFixed(2)}, ${motRec.accZ.toFixed(2)}`;
        var magStr = `${motRec.magX.toFixed(2)}, ${motRec.magY.toFixed(2)}, ${motRec.magZ.toFixed(2)}`;
        motCols = `
          <td style="color:#06b6d4">${quatStr}</td>
          <td style="color:#10b981">${accStr}</td>
          <td style="color:#f59e0b">${magStr}</td>
        `;
    } else {
        motCols = `
          <td style="color:#06b6d4">—</td>
          <td style="color:#10b981">—</td>
          <td style="color:#f59e0b">—</td>
        `;
    }

    var tbody = document.getElementById('facTableBody');
    if (tbody) {
      var empty = tbody.querySelector('.fac-table-empty');
      if (empty) empty.remove();
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + timeStr + '</td>'
        + '<td>' + eyeAct + '</td>'
        + '<td>' + uAct + '</td>'
        + '<td style="color:#a78bfa">' + uPow + '</td>'
        + '<td>' + lAct + '</td>'
        + '<td style="color:#a78bfa">' + lPow + '</td>'
        + motCols;
      tbody.prepend(tr);
      while (tbody.rows.length > 200) tbody.deleteRow(tbody.rows.length - 1);
    }
    var countEl = document.getElementById('facTableCount');
    if (countEl) countEl.textContent = facHistory.length + ' 筆';
  }
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
  // 追加完整歷史記錄（無上限）
  sysHistory.push({ time, msg, tag: 'INFO' });
}

// ─────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────
function downloadCSV(filename, rows) {
  // 非同步構建 CSV，避免大量資料時卡住 UI
  setTimeout(() => {
    const bom = '\uFEFF'; // UTF-8 BOM for Excel compatibility
    const csvContent = bom + rows.map(r =>
      r.map(cell => {
        const s = String(cell ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? '"' + s.replace(/"/g, '""') + '"'
          : s;
      }).join(',')
    ).join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    // 優先使用 showSaveFilePicker（Chrome/Edge 支援，不受 COOP/COEP 影響）
    if (window.showSaveFilePicker) {
      window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'CSV 檔案', accept: { 'text/csv': ['.csv'] } }]
      }).then(fileHandle => fileHandle.createWritable())
        .then(writable => writable.write(blob).then(() => writable.close()))
        .catch(err => {
          if (err.name !== 'AbortError') {
            console.warn('showSaveFilePicker failed, fallback to Blob URL:', err);
            blobURLDownload(blob, filename);
          }
        });
    } else {
      blobURLDownload(blob, filename);
    }
  }, 0);
}

function blobURLDownload(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (e) {
    console.error('CSV download failed:', e);
    alert('CSV 下載失敗，請嘗試重新整理頁面後再試。\n錯誤：' + e.message);
  }
}

// 產生「2026/3/2 下午2:08:00」格式的繁中时間字串
function getTimestamp() {
  return new Date().toLocaleString('zh-TW', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function exportCSV(tab) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  let rows = [];
  const getText = id => { const el = document.getElementById(id); return el ? el.textContent.trim() : ''; };
  const now = getTimestamp(); // 匯出當下的電腦時間

  switch (tab) {
    case 'eeg': {
      // Export the latest N samples from eegBuffer for each channel
      rows.push(['電腦時間', 'Sample', ...EEG_CHANNELS]);
      const len = eegBuffer[0].length;
      for (let i = 0; i < len; i++) {
        rows.push([now, i + 1, ...EEG_CHANNELS.map((_, ci) => eegBuffer[ci][i]?.toFixed(3) ?? '')]);
      }
      break;
    }
    case 'mot': {
      // 合併 Motion 與 Facial Data
      rows.push(['記錄時間', 'Q0', 'Q1', 'Q2', 'Q3', 'AccX', 'AccY', 'AccZ', 'MagX', 'MagY', 'MagZ', 'Eye Action', 'Upper Action', 'Upper Power', 'Lower Action', 'Lower Power']);
      
      const combined = {};
      const uniqueTimes = new Set();
      
      motHistory.forEach(d => {
        if (!combined[d.time]) combined[d.time] = {};
        combined[d.time].mot = d;
        uniqueTimes.add(d.time);
      });
      
      facHistory.forEach(d => {
        if (!combined[d.time]) combined[d.time] = {};
        combined[d.time].fac = d;
        uniqueTimes.add(d.time);
      });
      
      const sortedTimes = Array.from(uniqueTimes).sort((a,b) => Date.parse(a) - Date.parse(b));

      if (sortedTimes.length === 0) {
        rows.push([now, '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—']);
      } else {
        sortedTimes.forEach(t => {
          const m = combined[t]?.mot;
          const f = combined[t]?.fac;
          
          let mCols = m ? [
            m.q0.toFixed(4), m.q1.toFixed(4), m.q2.toFixed(4), m.q3.toFixed(4),
            m.accX.toFixed(4), m.accY.toFixed(4), m.accZ.toFixed(4),
            m.magX.toFixed(4), m.magY.toFixed(4), m.magZ.toFixed(4)
          ] : Array(10).fill('—');

          let fCols = f ? [
            f.eyeAct, f.uAct, f.uPow, f.lAct, f.lPow
          ] : Array(5).fill('—');

          rows.push([t, ...mCols, ...fCols]);
        });
      }
      break;
    }
    case 'dev': {
      const devCols = ['記錄時間', 'Signal Quality', 'Battery %', ...CQ_CHANNELS];
      rows.push(devCols);
      if (devHistory.length === 0) {
        rows.push([now, '—', '—', ...CQ_CHANNELS.map(() => '—')]);
      } else {
        devHistory.forEach(d => {
          rows.push([d.time, d.signal, d.batteryPercent, ...CQ_CHANNELS.map(ch => d[ch])]);
        });
      }
      break;
    }
    case 'met': {
      rows.push(['記錄時間', '投入度', '興奮度', '長期興奮', '壓力', '放鬆度', '興趣度', '專注度']);
      if (metHistory.length === 0) {
        rows.push([now, '—', '—', '—', '—', '—', '—', '—']);
      } else {
        metHistory.forEach(d => {
          rows.push([d.time, d.eng, d.exc, d.lex, d.str, d.rel, d.int, d.foc]);
        });
      }
      break;
    }
    case 'pow': {
      rows.push(['記錄時間', 'Theta', 'Alpha', 'Beta', 'Gamma', 'θ/α', '即時心率 (BPM)', '心跳間期 (ms)', '血氧濃度 SpO2 (%)', '呼吸速率 (次/分)']);

      const combined = {};
      const uniqueTimes = [];

      powTableData.forEach(d => {
        if (!combined[d.time]) {
          combined[d.time] = {};
          uniqueTimes.push(d.time);
        }
        combined[d.time].pow = d;
      });

      bleHistory.forEach(d => {
        if (!combined[d.time]) {
          combined[d.time] = {};
          uniqueTimes.push(d.time);
        }
        combined[d.time].ble = d;
      });

      if (uniqueTimes.length === 0) {
        rows.push([now, '—', '—', '—', '—', '—', '—', '—', '—', '—']);
      } else {
        // 反轉陣列，讓最新時間的排在最前面
        [...uniqueTimes].reverse().forEach(t => {
          const p = combined[t].pow;
          const b = combined[t].ble;

          let th = p ? p.theta.toFixed(3) : '—';
          let al = p ? p.alpha.toFixed(3) : '—';
          let be = p ? p.beta.toFixed(3) : '—';
          let ga = p ? p.gamma.toFixed(3) : '—';
          let ta = p ? (p.thetaAlpha !== null && p.thetaAlpha !== undefined ? p.thetaAlpha.toFixed(3) : '∞') : '—';

          let hr = b ? b.hr : '—';
          let rr = b ? b.rr : '—';
          let spo2 = b && b.spo2 !== undefined ? b.spo2 : '—';
          let rsp = b && b.rsp !== undefined ? b.rsp : '—';

          rows.push([t, th, al, be, ga, ta, hr, rr, spo2, rsp]);
        });
      }
      break;
    }
    case 'com': {
      rows.push(['記錄時間', 'Action', 'Power']);
      if (comHistory.length === 0) {
        rows.push([now, '—', '—']);
      } else {
        // comHistory 是由新到舊，反轉後輸出由舊到新
        [...comHistory].reverse().forEach(h => {
          rows.push([h.time, h.action, (h.power * 100).toFixed(1) + '%']);
        });
      }
      break;
    }
    case 'fac': {
      rows.push(['記錄時間', 'Eye Action', 'Upper Action', 'Upper Power', 'Lower Action', 'Lower Power']);
      if (facHistory.length === 0) {
        rows.push([now, '—', '—', '—', '—', '—']);
      } else {
        facHistory.forEach(d => {
          rows.push([d.time, d.eyeAct, d.uAct, d.uPow, d.lAct, d.lPow]);
        });
      }
      break;
    }
    case 'sys': {
      rows.push(['記錄時間', 'Message', 'Tag']);
      if (sysHistory.length === 0) {
        rows.push([now, '尚無系統事件', '']);
      } else {
        sysHistory.forEach(d => {
          rows.push([d.time, d.msg, d.tag]);
        });
      }
      break;
    }
    default:
      return;
  }

  downloadCSV(`neurorest-${tab}-${ts}.csv`, rows);
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

    // DEMO 藍牙心跳 (更新頻率 1Hz)
    if (Math.random() < 0.1) {
      const hrEl = document.getElementById('hrValue');
      const rrEl = document.getElementById('rrValue');
      const batEl = document.getElementById('bleBatPct');
      const contactEl = document.getElementById('bleContactStatus');

      if (hrEl) hrEl.textContent = Math.floor(rand(60, 95)) + ' BPM';
      if (rrEl) {
        // 隨機產生 1~2 個 RR interval
        let rrs = [];
        let count = Math.random() > 0.5 ? 2 : 1;
        for (let i = 0; i < count; i++) rrs.push(Math.floor(rand(600, 1000)));
        rrEl.textContent = rrs.join(', ') + ' ms';
      }
      if (batEl) batEl.textContent = '100% (Demo)';
      if (contactEl) {
        contactEl.textContent = '已接觸';
        contactEl.style.color = '#10b981';
      }

      // DEMO ESP32 健康數據
      const espHrEl = document.getElementById('espHrValue');
      const espSpo2El = document.getElementById('espSpo2Value');
      const espRspEl = document.getElementById('espRspValue');
      if (espHrEl) espHrEl.textContent = Math.floor(rand(60, 95)) + ' BPM';
      if (espSpo2El) espSpo2El.textContent = Math.floor(rand(95, 100)) + ' %';
      if (espRspEl) espRspEl.textContent = Math.floor(rand(12, 20)) + ' 次/分';
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

  // ── 即時時鐘：每秒更新所有分頁按鈕下方的電腦時間 ──
  const CLOCK_IDS = ['eeg', 'mot', 'dev', 'met', 'pow', 'com', 'sys'];
  function tickClocks() {
    const t = getTimestamp();
    CLOCK_IDS.forEach(id => {
      const el = document.getElementById('clock-' + id);
      if (el) el.textContent = t;
    });

    // ── 每秒記錄一筆 BLE 心跳狀態到歷史紀錄並更新綜合表格 ──
    const hrEl = document.getElementById('hrValue');
    const rrEl = document.getElementById('rrValue');
      let hrValStr = '—', rrValStr = '—';

      // 取得 ESP32 數據
      const espSpo2El = document.getElementById('espSpo2Value');
      const espRspEl = document.getElementById('espRspValue');
      let espSpo2Str = espSpo2El ? espSpo2El.textContent.trim() : '—';
      let espRspStr = espRspEl ? espRspEl.textContent.trim() : '—';
      if (espSpo2Str === '— %') espSpo2Str = '—';
      if (espRspStr === '— 次/分') espRspStr = '—';

      if (hrEl && hrEl.textContent !== '—' && hrEl.textContent !== '— BPM') {
        const hrVal = parseFloat(hrEl.textContent.replace(' BPM', ''));
        if (!isNaN(hrVal)) {
          bleChartBuffer.push(hrVal);
          if (bleChartBuffer.length > BLE_CHART_HISTORY) bleChartBuffer.shift();
        }
        hrValStr = hrVal;
        rrValStr = rrEl ? rrEl.textContent.replace(' ms', '') : '—';
      }

      // 如果有取得 BLE 或 ESP32 資料，也記錄一份
      if (hrValStr !== '—' || espSpo2Str !== '—' || espRspStr !== '—') {
        const rec = {
          time: t,
          hr: hrValStr,
          rr: rrValStr,
          spo2: espSpo2Str,
          rsp: espRspStr
        };

        bleHistory.push(rec);
        drawBleChartCanvas();
      }

      // ── 記錄 Band Power 到歷史陣列 (與 BLE 時間對齊) ──
      if (Date.now() - lastPowTime < 2000 && latestPowData.valid) {
        powTableData.push({
          time: t,
          theta: latestPowData.theta,
          alpha: latestPowData.alpha,
          beta: latestPowData.beta,
          gamma: latestPowData.gamma,
          thetaAlpha: latestPowData.thetaAlpha
        });
      }

      // 更新綜合歷史表格
      const thEl = document.getElementById('avgTheta');
      const alEl = document.getElementById('avgAlpha');
      const beEl = document.getElementById('avgBeta');
      const gaEl = document.getElementById('avgGamma');
      const taEl = document.getElementById('avgThetaAlpha');

      let th = thEl ? thEl.textContent : '—';
      let al = alEl ? alEl.textContent : '—';
      let be = beEl ? beEl.textContent : '—';
      let ga = gaEl ? gaEl.textContent : '—';
      let ta = taEl ? taEl.textContent : '—';

      if (th !== '—' || hrValStr !== '—' || espSpo2Str !== '—') {
        const tbody = document.getElementById('powTableBody');
        if (tbody) {
          const empty = tbody.querySelector('.pow-table-empty');
          if (empty) empty.remove();
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${t}</td>
            <td style="color:#a855f7">${th}</td>
            <td style="color:#06b6d4">${al}</td>
            <td style="color:#10b981">${be}</td>
            <td style="color:#ef4444">${ga}</td>
            <td style="color:#f59e0b">${ta}</td>
            <td style="color:#ef4444">${hrValStr}</td>
            <td style="color:#f59e0b">${rrValStr}</td>
            <td style="color:#10b981">${espSpo2Str}</td>
            <td style="color:#06b6d4">${espRspStr}</td>
          `;
        tbody.prepend(tr);
        while (tbody.rows.length > 200) tbody.deleteRow(tbody.rows.length - 1);
      }
      const countEl = document.getElementById('powTableCount');
      if (countEl) countEl.textContent = Math.max(powTableData.length, bleHistory.length) + ' 筆';
    }
  }
  tickClocks(); // 立即顯示，不等第一秒
  setInterval(tickClocks, 1000);

  // ── 建立繪製心率圖表的函式 ──
  function drawBleChartCanvas() {
    const canvas = document.getElementById('bleChartCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // 取得 parent container width, 至少確保大於 1300
    let W = canvas.parentElement.offsetWidth;
    if (W < 1300) W = 1300;
    
    const H = canvas.parentElement.offsetHeight || 250;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    // 取得有數值的資料點
    const validData = bleChartBuffer.filter(v => v !== null);
    if (validData.length === 0) return;

    // 計算最大與最小值
    let minVal = Math.min(...validData) - 5;
    let maxVal = Math.max(...validData) + 5;
    if (maxVal - minVal < 10) {
      maxVal += 5;
      minVal -= 5;
    }
    const range = maxVal - minVal;

    // 畫網格與標籤
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '11px Inter';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const STEPS = 5;
    for (let i = 0; i <= STEPS; i++) {
      const y = H - (i / STEPS) * (H - 20) - 10;
      ctx.moveTo(35, y);
      ctx.lineTo(W, y);
      ctx.fillText(Math.round(minVal + (i / STEPS) * range), 5, y + 4);
    }

    // Y 軸線
    ctx.moveTo(35, 10);
    ctx.lineTo(35, H - 10);
    ctx.stroke();

    const startX = 35;
    const chartW = W - startX - 10;
    const chartH = H - 20;

    // 繪製紫色的線條與點 (模擬附圖風格)
    const lineColor = '#8b5cf6'; // 紫色

    // 畫線
    ctx.beginPath();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    let firstPoint = true;
    for (let i = 0; i < bleChartBuffer.length; i++) {
      const v = bleChartBuffer[i];
      if (v === null) continue;

      const px = startX + (i / (BLE_CHART_HISTORY - 1)) * chartW;
      const py = 10 + chartH - ((v - minVal) / range) * chartH;

      if (firstPoint) {
        ctx.moveTo(px, py);
        firstPoint = false;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    // 畫點 (正方形或圓形)
    ctx.fillStyle = lineColor;
    for (let i = 0; i < bleChartBuffer.length; i++) {
      const v = bleChartBuffer[i];
      if (v === null) continue;

      const px = startX + (i / (BLE_CHART_HISTORY - 1)) * chartW;
      const py = 10 + chartH - ((v - minVal) / range) * chartH;

      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Heart Rate BLE Init ──
  const bleBtn = document.getElementById('connectBleBtn');
  if (bleBtn) bleBtn.addEventListener('click', connectBLE);

  // ── ESP32 API Polling Init ──
  startESP32Polling();
});

// ─────────────────────────────────────────
// ESP32 DATA POLLING (via server /esp32 API)
// ─────────────────────────────────────────
function startESP32Polling() {
  setInterval(async () => {
    try {
      const resp = await fetch('/esp32');
      if (!resp.ok) return;
      const data = await resp.json();
      
      const dot = document.getElementById('espStatusDot');
      const txt = document.getElementById('espStatusText');
      
      if (data.connected) {
        if (dot) dot.style.background = '#10b981';
        if (txt) txt.textContent = '已連線';
        
        if (data.heart_rate !== null) {
          const el = document.getElementById('espHrValue');
          if (el) el.textContent = data.heart_rate.toFixed(1) + ' BPM';
        }
        if (data.spo2 !== null) {
          const el = document.getElementById('espSpo2Value');
          if (el) el.textContent = data.spo2.toFixed(1) + ' %';
        }
        if (data.rsp_rate !== null) {
          const el = document.getElementById('espRspValue');
          if (el) el.textContent = data.rsp_rate.toFixed(1) + ' 次/分';
        }
      } else {
        if (dot) dot.style.background = '#ef4444';
        if (txt) txt.textContent = '未連線';
      }
    } catch (e) {
      // server not reachable, ignore
    }
  }, 1000);
}

// 釋放佔用序列埠並重連
async function releaseAndConnectESP32() {
  const btn = document.getElementById('espReleaseBtn');
  const txt = document.getElementById('espStatusText');
  if (btn) { btn.textContent = '釋放中...'; btn.style.background = '#f59e0b'; }
  if (txt) txt.textContent = '釋放佔用程序…';
  
  try {
    const resp = await fetch('/esp32/release');
    const result = await resp.json();
    console.log('[ESP32 Release]', result);
    
    if (result.success) {
      if (txt) txt.textContent = result.message + '，準備連線…';
      if (btn) { btn.textContent = '✔ 已釋放並啟動'; btn.style.background = '#10b981'; }
      setTimeout(() => {
        if (btn) { btn.textContent = '▶ 釋放並啟動感測'; btn.style.background = '#7c3aed'; }
      }, 5000);
    } else {
      if (txt) txt.textContent = result.message;
      if (btn) { btn.textContent = '▶ 釋放並啟動感測'; btn.style.background = '#ef4444'; }
    }
  } catch (e) {
    if (txt) txt.textContent = '釋放請求失敗（後端未回應）';
    if (btn) { btn.textContent = '▶ 釋放並啟動感測'; btn.style.background = '#ef4444'; }
  }
}

// ─────────────────────────────────────────
// POLAR H9 BLE LOGIC (Web Bluetooth)
// ─────────────────────────────────────────
let bleDevice = null;
let bleHeartRateCharacteristic = null;
let bleBatteryCharacteristic = null;

async function connectBLE() {
  try {
    const btn = document.getElementById('connectBleBtn');
    btn.textContent = '連線中...';
    btn.style.background = '#f59e0b';

    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Polar H9' }],
      optionalServices: ['heart_rate', 'battery_service']
    });

    bleDevice.addEventListener('gattserverdisconnected', onBleDisconnected);

    const server = await bleDevice.gatt.connect();

    // Heart Rate Service
    const hrService = await server.getPrimaryService('heart_rate');
    bleHeartRateCharacteristic = await hrService.getCharacteristic('heart_rate_measurement');
    await bleHeartRateCharacteristic.startNotifications();
    bleHeartRateCharacteristic.addEventListener('characteristicvaluechanged', handleHeartRateMeasurement);

    // Battery Service
    try {
      const batteryService = await server.getPrimaryService('battery_service');
      bleBatteryCharacteristic = await batteryService.getCharacteristic('battery_level');
      let batteryValue = await bleBatteryCharacteristic.readValue();
      let batteryLevel = batteryValue.getUint8(0);
      const batEl = document.getElementById('bleBatPct');
      if (batEl) batEl.textContent = batteryLevel + '%';

      try {
        await bleBatteryCharacteristic.startNotifications();
        bleBatteryCharacteristic.addEventListener('characteristicvaluechanged', handleBatteryLevel);
      } catch (e) {
        console.log("Battery notification not supported");
      }
    } catch (err) {
      console.log('No Battery Service found.', err);
    }

    btn.textContent = '已連線';
    btn.style.background = '#10b981';

  } catch (error) {
    console.error("BLE Connect failed", error);
    const btn = document.getElementById('connectBleBtn');
    if (btn) {
      btn.textContent = '連線失敗';
      btn.style.background = '#ef4444';
      setTimeout(() => { btn.textContent = '連線裝置'; btn.style.background = '#ef4444'; }, 3000);
    }
  }
}

function onBleDisconnected() {
  const btn = document.getElementById('connectBleBtn');
  if (btn) {
    btn.textContent = '連線裝置';
    btn.style.background = '#ef4444';
  }
}

function handleBatteryLevel(event) {
  let batteryLevel = event.target.value.getUint8(0);
  const el = document.getElementById('bleBatPct');
  if (el) el.textContent = batteryLevel + '%';
}

function handleHeartRateMeasurement(event) {
  let value = event.target.value;
  let flags = value.getUint8(0);
  let rate16Bits = flags & 0x1;
  let hr = 0;
  let index = 1;

  if (rate16Bits) {
    hr = value.getUint16(index, true);
    index += 2;
  } else {
    hr = value.getUint8(index);
    index += 1;
  }

  const hrEl = document.getElementById('hrValue');
  if (hrEl) hrEl.textContent = hr + ' BPM';

  let contactDetected = flags & 0x6;
  let contactStatusText = '未知';
  const contactEl = document.getElementById('bleContactStatus');

  if (contactDetected === 0x4) {
    contactStatusText = '未接觸';
    if (contactEl) contactEl.style.color = '#ef4444';
  } else if (contactDetected === 0x6) {
    contactStatusText = '已接觸';
    if (contactEl) contactEl.style.color = '#10b981';
  } else {
    contactStatusText = '不支援/未知';
    if (contactEl) contactEl.style.color = 'var(--text-muted)';
  }
  if (contactEl) contactEl.textContent = contactStatusText;

  let energyExpendedStatus = flags & 0x8;
  if (energyExpendedStatus) {
    index += 2;
  }

  let rrIntervalPresent = flags & 0x10;
  if (rrIntervalPresent) {
    let rrIntervals = [];
    while (index + 1 < value.byteLength) {
      let rrValue = value.getUint16(index, true);
      let rrMs = Math.round((rrValue / 1024.0) * 1000);
      rrIntervals.push(rrMs);
      index += 2;
    }
    const rrEl = document.getElementById('rrValue');
    if (rrEl && rrIntervals.length > 0) {
      rrEl.textContent = rrIntervals.join(', ') + ' ms';
    }
  }
}
