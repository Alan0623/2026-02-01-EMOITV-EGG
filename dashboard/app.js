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
  // 追加歷史記錄
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
  const thetaAlphaEl = document.getElementById('avgThetaAlpha');
  if (thetaAlphaEl) thetaAlphaEl.textContent = avgAlpha > 0 ? (avgTheta / avgAlpha).toFixed(3) : '∞';

  // Push to ring buffers
  const push = (key, v) => { powAvgBuffer[key].push(v); if (powAvgBuffer[key].length > POW_HISTORY) powAvgBuffer[key].shift(); };
  push('theta', avgTheta);
  push('alpha', avgAlpha);
  push('beta', avgBeta);
  push('gamma', avgGamma);
  push('thetaAlpha', avgAlpha > 0 ? avgTheta / avgAlpha : 0);

  drawPowAvgCanvas();

  // ── 追加到歷史表格（節流：每秒最多 1 筆，避免資料爆炸）──
  var now_ms = Date.now();
  if (now_ms - lastPowRecordTime >= 1000) {
    lastPowRecordTime = now_ms;
    var timeStr = getTimestamp();
    var thetaAlpha = avgAlpha > 0 ? avgTheta / avgAlpha : null;
    var row = { time: timeStr, theta: avgTheta, alpha: avgAlpha, beta: avgBeta, gamma: avgGamma, thetaAlpha: thetaAlpha };
    powTableData.push(row);

    var tbody = document.getElementById('powTableBody');
    if (tbody) {
      var empty = tbody.querySelector('.pow-table-empty');
      if (empty) empty.remove();
      // DOM 中只保留最近 200 列，避免 DOM 過重
      var tr = document.createElement('tr');
      var taStr = thetaAlpha !== null ? thetaAlpha.toFixed(3) : '∞';
      tr.innerHTML = '<td>' + timeStr + '</td>'
        + '<td style="color:#a855f7">' + avgTheta.toFixed(3) + '</td>'
        + '<td style="color:#06b6d4">' + avgAlpha.toFixed(3) + '</td>'
        + '<td style="color:#10b981">' + avgBeta.toFixed(3) + '</td>'
        + '<td style="color:#ef4444">' + avgGamma.toFixed(3) + '</td>'
        + '<td style="color:#f59e0b">' + taStr + '</td>';
      tbody.prepend(tr);
      while (tbody.rows.length > 200) tbody.deleteRow(tbody.rows.length - 1);
    }
    // 更新計數（顯示完整歷史筆數，非 DOM 截斷後數量）
    var countEl = document.getElementById('powTableCount');
    if (countEl) countEl.textContent = powTableData.length + ' 筆';
  }
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
        + '<td style="color:#a78bfa">' + lPow + '</td>';
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
      rows.push(['記錄時間', 'Q0', 'Q1', 'Q2', 'Q3', 'AccX', 'AccY', 'AccZ', 'MagX', 'MagY', 'MagZ']);
      if (motHistory.length === 0) {
        rows.push([now, '—', '—', '—', '—', '—', '—', '—', '—', '—', '—']);
      } else {
        motHistory.forEach(d => {
          rows.push([d.time,
          d.q0.toFixed(4), d.q1.toFixed(4), d.q2.toFixed(4), d.q3.toFixed(4),
          d.accX.toFixed(4), d.accY.toFixed(4), d.accZ.toFixed(4),
          d.magX.toFixed(4), d.magY.toFixed(4), d.magZ.toFixed(4)
          ]);
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
      // 匯出歷史表格中累積的全部 Theta/Alpha/Beta/Gamma/θα 記錄
      rows.push(['記錄時間', 'Theta', 'Alpha', 'Beta', 'Gamma', 'θ/α']);
      if (powTableData.length === 0) {
        rows.push([now, '—', '—', '—', '—', '—']);
      } else {
        powTableData.forEach(function (d) {
          var ta = d.thetaAlpha !== null && d.thetaAlpha !== undefined
            ? d.thetaAlpha.toFixed(4) : '∞';
          rows.push([d.time, d.theta.toFixed(4), d.alpha.toFixed(4), d.beta.toFixed(4), d.gamma.toFixed(4), ta]);
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
  const CLOCK_IDS = ['eeg', 'mot', 'dev', 'met', 'pow', 'com', 'fac', 'sys'];
  function tickClocks() {
    const t = getTimestamp();
    CLOCK_IDS.forEach(id => {
      const el = document.getElementById('clock-' + id);
      if (el) el.textContent = t;
    });
  }
  tickClocks(); // 立即顯示，不等第一秒
  setInterval(tickClocks, 1000);
});
