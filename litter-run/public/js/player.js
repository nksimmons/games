// =====================================================================
// LITTER RUN — Player (phone controller)
// =====================================================================

const STICK_MAX_R = 60;

let conn     = null;
let myIdx    = -1;
let myColor  = '#e63946';
let lastPhase = null;

// ── Device ID ─────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('lr-device-id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('lr-device-id', id); }
  return id;
}

// ── Sanitize ──────────────────────────────────────────────────────────
function sanitize(str) {
  return String(str || '').replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Connection ────────────────────────────────────────────────────────
function isLanMode() {
  return !!(window.SERVER_LAN_IP && window.SERVER_PORT);
}

function connect(roomId) {
  if (isLanMode()) {
    conn = new LocalPlayerPeer(roomId);
  } else {
    conn = new TrysteroPlayerPeer('nksimmons-litter-run', roomId);
  }
  conn.on('open',  ()    => { /* ready */ });
  conn.on('data',  msg   => handleServerMsg(msg));
  conn.on('close', ()    => showJoinError('Disconnected from host.'));
  conn.on('error', err   => showJoinError('Connection error: ' + err.message));
}

function send(msg) {
  try { if (conn) conn.send(msg); } catch(e) {}
}

// ── Server messages ───────────────────────────────────────────────────
let lastState = null;

function handleServerMsg(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'joined': {
      myIdx = msg.myIdx;
      lastState && render(lastState);
      break;
    }
    case 'error': {
      showJoinError(sanitize(msg.message || 'Something went wrong.'));
      break;
    }
    case 'state': {
      lastState = msg.data;
      render(msg.data);
      break;
    }
  }
}

// ── Rendering ─────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function render(state) {
  if (!state) return;
  const { phase, players, currentPlayerIdx, countdown, run } = state;
  const me = players?.[myIdx];
  if (me?.color) myColor = me.color;

  switch (phase) {
    case 'lobby':     renderLobby(state);     break;
    case 'countdown': renderCountdown(state); break;
    case 'running':   renderRunning(state);   break;
    case 'roundOver': renderRoundOver(state); break;
    case 'allDone':   renderAllDone(state);   break;
  }
  lastPhase = phase;
}

function renderLobby(state) {
  showScreen('screen-join');
  const { players } = state;
  const me = players?.[myIdx];

  // Show player list
  const listEl = document.getElementById('joined-player-list');
  if (listEl) {
    listEl.innerHTML = players.map(p => `
      <div class="lobby-player-row">
        <span class="player-dot" style="background:${p.color}"></span>
        <span>${sanitize(p.name)}</span>
        ${p.isHostPlayer ? '<span class="host-badge">HOST</span>' : ''}
      </div>`).join('');
  }

  // Show start button only for host player
  const startBtn = document.getElementById('btn-start');
  if (startBtn) startBtn.style.display = me?.isHostPlayer ? 'inline-flex' : 'none';
}

function renderCountdown(state) {
  showScreen('screen-game-player');
  const { players, currentPlayerIdx, countdown } = state;
  const me = players?.[myIdx];
  const cur = players?.[currentPlayerIdx];
  const isMyTurn = myIdx === currentPlayerIdx;

  const cntEl = document.getElementById('countdown-num');
  if (cntEl) cntEl.textContent = countdown > 0 ? String(countdown) : 'GO!';
  const whoEl = document.getElementById('p-countdown-who');
  if (whoEl) whoEl.textContent = isMyTurn ? 'Your turn!' : `${sanitize(cur?.name || '')}'s turn`;

  document.getElementById('countdown-overlay-p')?.style.setProperty('display', 'flex');
  document.getElementById('joystick-zone')?.style.setProperty('display', 'none');
  document.getElementById('watching-overlay')?.style.setProperty('display', 'none');
}

function renderRunning(state) {
  showScreen('screen-game-player');
  const { players, currentPlayerIdx, run } = state;
  const isMyTurn = myIdx === currentPlayerIdx;
  const cur = players?.[currentPlayerIdx];

  // Hide countdown
  document.getElementById('countdown-overlay-p')?.style.setProperty('display', 'none');

  if (isMyTurn) {
    document.getElementById('joystick-zone')?.style.setProperty('display', 'flex');
    document.getElementById('watching-overlay')?.style.setProperty('display', 'none');
  } else {
    document.getElementById('joystick-zone')?.style.setProperty('display', 'none');
    const wo = document.getElementById('watching-overlay');
    if (wo) wo.style.display = 'flex';
    const wn = document.getElementById('watching-name');
    if (wn) wn.textContent = sanitize(cur?.name || '');
  }

  // Update HUD
  const hdmg = document.getElementById('hud-damage');
  if (hdmg) hdmg.textContent = `$${(run?.damage ?? 0).toLocaleString()}`;
  const htime = document.getElementById('hud-time');
  if (htime) htime.textContent = `${run?.timeLeft ?? 0}s`;
}

function renderRoundOver(state) {
  showScreen('screen-game-player');
  const { players, currentPlayerIdx, run } = state;
  const cur = players?.[currentPlayerIdx];

  document.getElementById('joystick-zone')?.style.setProperty('display', 'none');
  document.getElementById('countdown-overlay-p')?.style.setProperty('display', 'none');
  document.getElementById('watching-overlay')?.style.setProperty('display', 'none');

  const wo = document.getElementById('roundover-overlay-p');
  if (wo) {
    wo.style.display = 'flex';
    const title = wo.querySelector('.roundover-title');
    const dmg   = wo.querySelector('.roundover-damage');
    const name  = wo.querySelector('.roundover-name');
    if (title) title.textContent = "TIME'S UP!";
    if (dmg)   dmg.textContent   = `$${(run?.damage ?? 0).toLocaleString()} damage`;
    if (name)  name.textContent  = sanitize(cur?.name || '');
  }
}

function renderAllDone(state) {
  showScreen('screen-alldone-player');
  const me = state.players?.[myIdx];
  const sorted = [...(state.players || [])].sort((a, b) => a.totalDamage - b.totalDamage);
  const list = document.getElementById('p-final-scores');
  if (list) {
    list.innerHTML = sorted.map((p, i) => `
      <div class="score-row ${i === 0 ? 'winner' : ''}">
        <span class="score-rank">${i === 0 ? '🏆' : `#${i + 1}`}</span>
        <span class="player-dot" style="background:${p.color}"></span>
        <span class="score-name">${sanitize(p.name)}</span>
        <span class="score-damage">$${p.totalDamage.toLocaleString()}</span>
      </div>`).join('');
  }
  const rBtn = document.getElementById('btn-play-again');
  if (rBtn) rBtn.style.display = me?.isHostPlayer ? 'inline-flex' : 'none';
}

// ── Join form ─────────────────────────────────────────────────────────
function showJoinError(msg) {
  const el = document.getElementById('join-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function doJoin() {
  const nameInput = document.getElementById('input-name');
  const name = (nameInput?.value || '').trim().slice(0, 16);
  if (!name) { showJoinError('Please enter your name.'); return; }
  const checked = document.querySelector('.color-swatch.selected');
  const color = checked?.dataset?.color || '#e63946';
  const errEl = document.getElementById('join-error');
  if (errEl) errEl.style.display = 'none';
  send({ type: 'join', name, color, deviceId: getDeviceId() });
}

// ── Joystick ──────────────────────────────────────────────────────────
let stickOrigin = null;
let lastDx = 0, lastDy = 0;

function setupJoystick() {
  const zone = document.getElementById('joystick-zone');
  const knob = document.getElementById('stick-knob');
  if (!zone || !knob) return;

  function getXY(e) {
    const src = e.changedTouches ? e.changedTouches[0] : e;
    return { x: src.clientX, y: src.clientY };
  }

  function onStart(e) {
    e.preventDefault();
    const { x, y } = getXY(e);
    stickOrigin = { x, y };
    updateStick(x, y);
  }

  function onMove(e) {
    e.preventDefault();
    if (!stickOrigin) return;
    const { x, y } = getXY(e);
    updateStick(x, y);
  }

  function onEnd(e) {
    stickOrigin = null;
    knob.style.transform = 'translate(-50%, -50%)';
    lastDx = 0; lastDy = 0;
    send({ type: 'move', dx: 0, dy: 0 });
  }

  function updateStick(x, y) {
    if (!stickOrigin) return;
    let dx = x - stickOrigin.x;
    let dy = y - stickOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > STICK_MAX_R) {
      dx = dx / dist * STICK_MAX_R;
      dy = dy / dist * STICK_MAX_R;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const ndx = dx / STICK_MAX_R;
    const ndy = dy / STICK_MAX_R;
    if (Math.abs(ndx - lastDx) > 0.02 || Math.abs(ndy - lastDy) > 0.02) {
      lastDx = ndx; lastDy = ndy;
      send({ type: 'move', dx: ndx, dy: ndy });
    }
  }

  zone.addEventListener('touchstart', onStart, { passive: false });
  zone.addEventListener('touchmove',  onMove,  { passive: false });
  zone.addEventListener('touchend',   onEnd,   { passive: false });
  zone.addEventListener('touchcancel',onEnd,   { passive: false });
  zone.addEventListener('mousedown',  onStart);
  window.addEventListener('mousemove', e => { if (stickOrigin) onMove(e); });
  window.addEventListener('mouseup',   onEnd);
}

// ── Color swatches ────────────────────────────────────────────────────
function setupColorPicker() {
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
    });
  });
  // Select first by default
  document.querySelector('.color-swatch')?.classList.add('selected');
}

// ── Init ──────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room');
  if (!roomId) { showScreen('screen-no-room'); return; }

  setupColorPicker();
  setupJoystick();
  connect(roomId);

  document.getElementById('btn-join')?.addEventListener('click', doJoin);
  document.getElementById('input-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doJoin();
  });
  document.getElementById('btn-start')?.addEventListener('click', () => {
    send({ type: 'start' });
  });
  document.getElementById('btn-play-again')?.addEventListener('click', () => {
    send({ type: 'restart' });
  });
});
