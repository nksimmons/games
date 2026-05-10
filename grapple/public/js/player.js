// =====================================================================
// GRAPPLE AND GO — Player (PeerJS, static / GitHub Pages)
// =====================================================================
// Connects to the host via PeerJS. Room ID from URL: ?room=<peerId>
// The first player to join is the "host player" and can start the game.
// =====================================================================

let peer = null;
let conn = null;
let myIdx = null;
let isHostPlayer = false;
let state = null;
let hasJoined = false;

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

  peer = new Peer();
  peer.on('open', () => {
    conn = peer.connect(roomId, { reliable: true });
    conn.on('open', () => {
      // Connected — if already joined (page refresh), try to rejoin
      if (hasJoined) {
        const savedName = localStorage.getItem('grapple-name') || 'Player';
        send({ type: 'join', name: savedName, deviceId });
      }
      // Otherwise show join screen so user can enter name
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

  if (myTurnEl) myTurnEl.style.display = isMyTurn ? '' : 'none';
  if (watchEl)  watchEl.style.display  = isMyTurn ? 'none' : '';

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

    // Tap button style + hint
    const tapBtn = document.getElementById('btn-tap');
    const hint   = document.getElementById('run-state-hint');
    if (tapBtn) {
      tapBtn.classList.toggle('swinging', run.runState === 'swinging');
    }
    if (hint) {
      hint.textContent = run.runState === 'swinging'
        ? 'Tap to release!'
        : run.runState === 'firing'
        ? 'Grapple flying…'
        : 'Tap to fire your grapple!';
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

// ── Tap input ─────────────────────────────────────────────────────────
function setupTapButton() {
  const btn = document.getElementById('btn-tap');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (state?.phase !== 'running') return;
    if (state.currentPlayerIdx !== myIdx) return;
    send({ type: 'tap' });
    // Haptic feedback
    try { navigator.vibrate?.(30); } catch(e) {}
  });
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
    send({ type: 'join', name, deviceId });
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
setupJoinForm();
setupTapButton();
setupButtons();
connect();
