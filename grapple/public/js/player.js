// =====================================================================
// GRAPPLE AND GO — Player (PeerJS, static / GitHub Pages)
// =====================================================================
// Connects to the host via PeerJS. Room ID from URL: ?room=<peerId>
// The first player to join is the "host player" and can start the game.
const SIGNAL_HOST = 'nksimmons-games-signaling.onrender.com'; // unused, kept for reference
// =====================================================================

let peer = null;
let conn = null;
let myIdx = null;
let isHostPlayer = false;
let state = null;
let hasJoined = false;

// ── Character customization state ────────────────────────────────────
let charColor = '#e63946';
let charSpriteDataUrl = null;

// Draw modal
let _drawCtx2d     = null;
let _drawColor2    = '#111111';
let _drawLineWidth = 4;
let _drawing       = false;
let _lastDX = 0, _lastDY = 0;

function setupCharCustomization() {
  const colorTrigger = document.getElementById('char-color-trigger');
  const colorInput   = document.getElementById('char-color-input');
  const drawBtn      = document.getElementById('char-draw-btn');

  colorTrigger?.addEventListener('click', () => colorInput?.click());
  colorInput?.addEventListener('input', e => {
    charColor = e.target.value;
    if (colorTrigger) colorTrigger.style.background = charColor;
  });
  drawBtn?.addEventListener('click', openDrawModal);

  const canvas = document.getElementById('draw-canvas');
  if (!canvas) return;

  function getPos(e) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const src    = (e.touches && e.touches[0]) || e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  }
  function startDraw(e) {
    e.preventDefault(); _drawing = true;
    const { x, y } = getPos(e);
    _lastDX = x; _lastDY = y;
    if (_drawColor2 === 'erase') {
      _drawCtx2d.globalCompositeOperation = 'destination-out';
      _drawCtx2d.beginPath(); _drawCtx2d.arc(x, y, _drawLineWidth, 0, Math.PI*2); _drawCtx2d.fill();
      _drawCtx2d.globalCompositeOperation = 'source-over';
    } else {
      _drawCtx2d.beginPath(); _drawCtx2d.arc(x, y, _drawLineWidth/2, 0, Math.PI*2);
      _drawCtx2d.fillStyle = _drawColor2; _drawCtx2d.fill();
    }
  }
  function moveDraw(e) {
    if (!_drawing) return; e.preventDefault();
    const { x, y } = getPos(e);
    if (_drawColor2 === 'erase') {
      _drawCtx2d.globalCompositeOperation = 'destination-out';
      _drawCtx2d.beginPath(); _drawCtx2d.arc(x, y, _drawLineWidth, 0, Math.PI*2); _drawCtx2d.fill();
      _drawCtx2d.globalCompositeOperation = 'source-over';
    } else {
      _drawCtx2d.globalCompositeOperation = 'source-over';
      _drawCtx2d.beginPath(); _drawCtx2d.moveTo(_lastDX, _lastDY); _drawCtx2d.lineTo(x, y);
      _drawCtx2d.strokeStyle = _drawColor2; _drawCtx2d.lineWidth = _drawLineWidth;
      _drawCtx2d.lineCap = 'round'; _drawCtx2d.lineJoin = 'round'; _drawCtx2d.stroke();
    }
    _lastDX = x; _lastDY = y;
  }
  function stopDraw() { _drawing = false; }
  canvas.addEventListener('mousedown',  startDraw);
  canvas.addEventListener('mousemove',  moveDraw);
  canvas.addEventListener('mouseup',    stopDraw);
  canvas.addEventListener('mouseleave', stopDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove',  moveDraw,  { passive: false });
  canvas.addEventListener('touchend',   stopDraw);

  document.querySelectorAll('.draw-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _drawColor2    = btn.dataset.color;
      _drawLineWidth = _drawColor2 === 'erase' ? 18 : 4;
      document.querySelectorAll('.draw-color-btn').forEach(b =>
        b.classList.toggle('draw-active', b.dataset.color === _drawColor2));
    });
  });
  document.getElementById('draw-clear-btn')?.addEventListener('click', () =>
    _drawCtx2d?.clearRect(0, 0, canvas.width, canvas.height));
  document.getElementById('draw-cancel-btn')?.addEventListener('click', closeDrawModal);
  document.getElementById('draw-save-btn')?.addEventListener('click', saveDrawing);
}

function openDrawModal() {
  const modal  = document.getElementById('draw-modal');
  const canvas = document.getElementById('draw-canvas');
  if (!modal || !canvas) return;
  _drawCtx2d = canvas.getContext('2d');
  _drawCtx2d.clearRect(0, 0, canvas.width, canvas.height);
  if (charSpriteDataUrl) {
    const img = new Image();
    img.onload = () => _drawCtx2d.drawImage(img, 0, 0);
    img.src    = charSpriteDataUrl;
  }
  _drawColor2    = '#111111';
  _drawLineWidth = 4;
  document.querySelectorAll('.draw-color-btn').forEach(b =>
    b.classList.toggle('draw-active', b.dataset.color === _drawColor2));
  modal.style.display = 'flex';
}

function closeDrawModal() {
  const modal = document.getElementById('draw-modal');
  if (modal) modal.style.display = 'none';
}

function saveDrawing() {
  const canvas = document.getElementById('draw-canvas');
  if (!canvas) return;
  charSpriteDataUrl = canvas.toDataURL();
  // Update preview swatch with a tiny version
  const trigger = document.getElementById('char-color-trigger');
  if (trigger) trigger.style.backgroundImage = `url(${charSpriteDataUrl})`;
  closeDrawModal();
}

// ── Device identity ───────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('grapple-device-id');
  if (!id) {
    id = (crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem('grapple-device-id', id);
  }
  return id;
}
const deviceId = getDeviceId();

// ── Network ───────────────────────────────────────────────────────────
function send(msg) {
  try { if (conn?.open) conn.send(msg); } catch(e) {}
}

function connect() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room');
  if (!roomId) { showScreen('no-room'); return; }

  if (isLanMode()) {
    peer = new LocalPlayerPeer();
    peer.on('open', () => {
      conn = peer.connect(roomId, { reliable: true });
      conn.on('open', () => {
        if (hasJoined) {
          const savedName = localStorage.getItem('grapple-name') || 'Player';
          send({ type: 'join', name: savedName, deviceId });
        }
      });
      conn.on('data', handleMsg);
      conn.on('close', () => { if (!hasJoined) return; showScreen('disconnected'); });
      conn.on('error', () => showScreen('disconnected'));
    });
    peer.on('error', () => showScreen('disconnected'));
    return;
  }
  // Trystero: BitTorrent-signaled WebRTC, no server needed
  peer = new TrysteroPlayerPeer('nksimmons-grapple');
  peer.on('open', () => {
    conn = peer.connect(roomId);
    conn.on('open', () => {
      if (hasJoined) {
        const savedName = localStorage.getItem('grapple-name') || 'Player';
        send({ type: 'join', name: savedName, deviceId });
      }
    });
    conn.on('data', handleMsg);
    conn.on('close', () => { if (!hasJoined) return; showScreen('disconnected'); });
    conn.on('error', () => showScreen('disconnected'));
  });
  peer.on('error', () => showScreen('disconnected'));
}

function handleMsg(msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'joined') {
    myIdx = msg.myIdx;
    isHostPlayer = msg.isHostPlayer;
    hasJoined = true;
    // Lobby will be shown when first state arrives
    // But show it immediately if no state yet
    if (!state) showScreen('lobby');
    renderLobby();
  }

  if (msg.type === 'state') {
    state = msg.data;
    render();
  }

  if (msg.type === 'error') {
    const errEl = document.getElementById('join-error');
    if (errEl) { errEl.textContent = msg.message; errEl.style.display = ''; }
  }
}

// ── Render ────────────────────────────────────────────────────────────
function render() {
  if (!state) return;

  const screenMap = {
    lobby:    'lobby',
    countdown:'countdown',
    running:  'running',
    runOver:  'runOver',
    allDone:  'allDone',
  };
  showScreen(screenMap[state.phase] || 'lobby');

  if (state.phase === 'lobby')    renderLobby();
  if (state.phase === 'countdown') renderCountdown();
  if (state.phase === 'running')  renderRunning();
  if (state.phase === 'runOver')  renderRunOver();
  if (state.phase === 'allDone')  renderAllDone();
}

function renderLobby() {
  const list = document.getElementById('player-lobby-list');
  const startBtn = document.getElementById('btn-start-game');
  const msg = document.getElementById('lobby-msg');

  if (startBtn) {
    startBtn.style.display = isHostPlayer ? '' : 'none';
  }
  if (msg) {
    msg.textContent = isHostPlayer
      ? 'You\'re the host — start the game when everyone is ready!'
      : 'Waiting for the host to start the game…';
  }
  if (!list || !state) return;
  const players = state.players || [];
  list.innerHTML = players.map((p, i) => `
    <div class="player-setup-row">
      <div class="player-swatch" style="background:${p.color}"></div>
      <span class="player-setup-name">${esc(p.name)}${i === myIdx ? ' (you)' : ''}</span>
      ${p.isHostPlayer ? '<span style="font-size:0.75rem;color:var(--success);font-weight:700">host</span>' : ''}
      ${!p.connected ? '<span style="font-size:0.75rem;color:var(--text-dim)">(away)</span>' : ''}
    </div>
  `).join('') || '<p style="color:var(--text-dim);font-size:0.9rem">Just you so far…</p>';
}

function renderCountdown() {
  if (!state) return;
  const whoEl = document.getElementById('p-countdown-who');
  const numEl = document.getElementById('p-countdown-num');
  const players = state.players || [];
  const cur = players[state.currentPlayerIdx];
  if (whoEl) whoEl.textContent = cur ? `${cur.name}'s turn` : '';
  if (numEl) numEl.textContent = state.countdown ?? '';
}

function renderRunning() {
  if (!state) return;
  const players = state.players || [];
  const isMyTurn = state.currentPlayerIdx === myIdx;
  const myTurnEl = document.getElementById('run-my-turn');
  const watchEl  = document.getElementById('run-watching');

  if (myTurnEl) myTurnEl.style.display = isMyTurn ? 'flex' : 'none';
  if (watchEl)  watchEl.style.display  = isMyTurn ? 'none' : 'flex';

  const run = state.run;
  if (isMyTurn && run) {
    const distEl = document.getElementById('run-dist-my');
    if (distEl) distEl.textContent = `${run.dist}m`;

    // Rope pips
    const pipsEl = document.getElementById('run-rope-pips');
    if (pipsEl) {
      const total = 5;
      pipsEl.innerHTML = Array.from({ length: total }, (_, i) =>
        `<div class="rope-pip${i >= run.ropeUses ? ' used' : ''}"></div>`
      ).join('');
    }

    // FIRE button visual: lit up while reeling in
    const fireBtn = document.getElementById('fire-btn');
    if (fireBtn) {
      fireBtn.classList.toggle('pressed', run.retracting === true);
    }
  } else if (!isMyTurn) {
    const cur = players[state.currentPlayerIdx];
    const nameEl = document.getElementById('run-watching-name');
    const distEl = document.getElementById('run-dist-watch');
    if (nameEl) nameEl.textContent = cur?.name ?? '';
    if (distEl) distEl.textContent = run ? `${run.dist}m` : '—';
  }
}

function renderRunOver() {
  if (!state) return;
  const players = state.players || [];
  const cur = players[state.currentPlayerIdx];
  const nameEl = document.getElementById('p-runover-name');
  const distEl = document.getElementById('p-runover-dist');
  if (nameEl) nameEl.textContent = cur?.name ?? '';
  if (distEl) distEl.textContent = cur ? `${Math.round(cur.bestDist / 10)}m` : '';
}

function renderAllDone() {
  if (!state) return;
  const sorted = [...(state.players || [])].sort((a, b) => b.bestDist - a.bestDist);
  const el = document.getElementById('p-final-scoreboard');
  if (el) {
    el.innerHTML = sorted.map((p, i) => `
      <div class="score-row ${i === 0 ? 'winner' : ''}">
        <span class="score-rank">${i === 0 ? '🏆' : '#' + (i + 1)}</span>
        <div class="score-swatch" style="background:${p.color}"></div>
        <span class="score-name">${esc(p.name)}</span>
        <span class="score-dist">${Math.round(p.bestDist / 10)}m</span>
      </div>
    `).join('');
  }
  // Host player gets "play again" button
  const btn = document.getElementById('btn-play-again');
  if (btn) btn.style.display = isHostPlayer ? '' : 'none';
}

// ── Screen helper ─────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${id}`);
  if (el) el.classList.add('active');
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = String(str || '');
  return el.innerHTML;
}

// ── Gamepad input ─────────────────────────────────────────────────────
function setupGamepad() {
  const stickZone = document.getElementById('stick-zone');
  const track     = document.getElementById('stick-track');
  const knob      = document.getElementById('stick-knob');
  const fireBtn   = document.getElementById('fire-btn');
  if (!stickZone || !fireBtn) return;

  const TRACK_R = 52; // clamping radius (track visual is 130px wide → 65px half)
  let aimAngle  = -Math.PI / 3; // default: up-right
  let stickTouchId = null;
  let lastAimSend  = 0;

  function getTrackCenter() {
    const r = track.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  function updateKnob(clientX, clientY) {
    const { cx, cy } = getTrackCenter();
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clamped = Math.min(dist, TRACK_R);
    const nx = dist > 0 ? (dx / dist) * clamped : 0;
    const ny = dist > 0 ? (dy / dist) * clamped : 0;
    knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    if (dist > 10) {
      aimAngle = Math.atan2(dy, dx);
      // Throttle aim messages to ~20/s
      const now = Date.now();
      if (now - lastAimSend > 50) {
        send({ type: 'aim', angle: aimAngle });
        lastAimSend = now;
      }
    }
  }

  function resetKnob() {
    stickTouchId = null;
    knob.style.transform = 'translate(-50%, -50%)';
  }

  stickZone.addEventListener('touchstart', e => {
    e.preventDefault();
    if (stickTouchId !== null) return;
    const t = e.changedTouches[0];
    stickTouchId = t.identifier;
    updateKnob(t.clientX, t.clientY);
  }, { passive: false });

  stickZone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === stickTouchId) updateKnob(t.clientX, t.clientY);
    }
  }, { passive: false });

  stickZone.addEventListener('touchend', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === stickTouchId) resetKnob();
    }
  }, { passive: false });

  stickZone.addEventListener('touchcancel', e => { e.preventDefault(); resetKnob(); }, { passive: false });

  // Mouse fallback for desktop testing
  let mouseDown = false;
  stickZone.addEventListener('mousedown', e => {
    mouseDown = true; updateKnob(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', e => {
    if (mouseDown) updateKnob(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', () => { if (mouseDown) { mouseDown = false; resetKnob(); } });

  // ── Fire button ──
  function doFireDown() {
    if (state?.phase !== 'running' || state.currentPlayerIdx !== myIdx) return;
    send({ type: 'fireDown', angle: aimAngle });
    try { navigator.vibrate?.(30); } catch(_) {}
    fireBtn.classList.add('pressed');
  }
  function doFireUp() {
    if (state?.phase !== 'running' || state.currentPlayerIdx !== myIdx) return;
    send({ type: 'fireUp' });
    fireBtn.classList.remove('pressed');
  }

  fireBtn.addEventListener('touchstart',  e => { e.preventDefault(); doFireDown(); }, { passive: false });
  fireBtn.addEventListener('touchend',    e => { e.preventDefault(); doFireUp();   }, { passive: false });
  fireBtn.addEventListener('touchcancel', e => { e.preventDefault(); doFireUp();   }, { passive: false });
  // Mouse fallback
  fireBtn.addEventListener('mousedown', doFireDown);
  fireBtn.addEventListener('mouseup',   doFireUp);
}

// ── Join form ─────────────────────────────────────────────────────────
function setupJoinForm() {
  const input = document.getElementById('player-name');
  const btn   = document.getElementById('btn-join');
  const errEl = document.getElementById('join-error');

  // Pre-fill from localStorage
  const saved = localStorage.getItem('grapple-name');
  if (saved && input) input.value = saved;

  function doJoin() {
    const name = (input?.value || '').trim();
    if (!name) { input?.focus(); return; }
    if (errEl) errEl.style.display = 'none';
    localStorage.setItem('grapple-name', name);
    // Scale sprite down to 64×64 before sending to keep payload small
    let spriteDataUrl = null;
    if (charSpriteDataUrl) {
      try {
        const off = document.createElement('canvas');
        off.width = 64; off.height = 64;
        const offCtx = off.getContext('2d');
        const img = new Image();
        img.src = charSpriteDataUrl;
        offCtx.drawImage(img, 0, 0, 64, 64);
        spriteDataUrl = off.toDataURL();
      } catch(e) { spriteDataUrl = charSpriteDataUrl; }
    }
    send({ type: 'join', name, deviceId, color: charColor, spriteDataUrl });
    if (btn) btn.disabled = true;
  }

  btn?.addEventListener('click', doJoin);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
}

// ── Start / Play Again buttons ────────────────────────────────────────
function setupButtons() {
  document.getElementById('btn-start-game')?.addEventListener('click', () => {
    send({ type: 'start' });
  });
  document.getElementById('btn-play-again')?.addEventListener('click', () => {
    send({ type: 'restart' });
  });
}

// ── Init ──────────────────────────────────────────────────────────────
setupCharCustomization();
setupJoinForm();
setupGamepad();
setupButtons();
connect();
