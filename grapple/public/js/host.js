// =====================================================================
// GRAPPLE AND GO — Host (PeerJS, static / GitHub Pages)
// =====================================================================
// Runs on the dedicated host screen (laptop/TV).
// Players join by scanning the QR code → player.html?room=<peerId>
// The first player to join can start the game.
// =====================================================================

const PLAYER_COLORS = ['#e63946','#457b9d','#2a9d8f','#e9c46a','#f4a261','#264653','#6a4c93','#1982c4'];

// ── State ─────────────────────────────────────────────────────────────
let gs = freshGs();
let peer = null;
let conns = new Map(); // peerId (string) → DataConnection
let canvas, ctx, canvasWidth = 0, canvasHeight = 0;
let broadcastTick = 0;

function freshGs() {
  return {
    phase: 'lobby',     // lobby | countdown | running | runOver | allDone
    players: [],        // [{name,color,bestDist,currentRun,connected,peerId,isHostPlayer,deviceId}]
    currentPlayer: 0,
    countdownVal: 3,
    countdownTimer: null,
    animFrame: null,
  };
}

// ── Sanitize ──────────────────────────────────────────────────────────
function sanitize(str) {
  return String(str || '').replace(/[<>&"']/g, c =>
    ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── PeerJS ────────────────────────────────────────────────────────────
function buildPlayerUrl(peerId) {
  const base = new URL('player.html', location.href);
  base.searchParams.set('room', peerId);
  return base.toString();
}

function showQr(url) {
  const img = document.getElementById('qr-img');
  if (!img || typeof qrcode === 'undefined') return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    img.src = qr.createDataURL(4, 4);
    img.style.display = '';
  } catch(e) { console.warn('QR failed:', e); }
}

function makePeerOptions() {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '') {
    // file:// or localhost — use the local PeerJS server
    return { host: 'localhost', port: 9000, path: '/peerjs' };
  }
  return {};
}

let _peerRetries = 0;
let _peerConnectTimer = null;

function setLobbyStatus(msg) {
  const el = document.getElementById('lobby-url');
  if (el && el.textContent !== msg && !el.textContent.startsWith('http')) el.textContent = msg;
}

function initPeer() {
  if (peer) { try { peer.destroy(); } catch(e) {} peer = null; }

  const urlEl = document.getElementById('lobby-url');
  if (urlEl && !urlEl.textContent.startsWith('http')) {
    urlEl.textContent = _peerRetries > 0 ? `Retrying… (${_peerRetries})` : 'Connecting…';
  }

  clearTimeout(_peerConnectTimer);
  _peerConnectTimer = setTimeout(() => {
    if (!peer || !peer.id) {
      _peerRetries++;
      setLobbyStatus(`No connection — retrying (${_peerRetries})…`);
      initPeer();
    }
  }, 8000);

  peer = new Peer(undefined, makePeerOptions());

  peer.on('open', id => {
    clearTimeout(_peerConnectTimer);
    _peerRetries = 0;
    const url = buildPlayerUrl(id);
    const el = document.getElementById('lobby-url');
    if (el) el.textContent = url;
    showQr(url);
  });
  peer.on('connection', conn => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      conn.on('data', msg => handleMsg(conn, msg));
      conn.on('close', () => handleDisconnect(conn));
      conn.on('error', () => handleDisconnect(conn));
    });
  });
  peer.on('error', err => {
    clearTimeout(_peerConnectTimer);
    const delay = Math.min(2000 * Math.pow(1.5, _peerRetries), 15000);
    _peerRetries++;
    setLobbyStatus(`Connection failed — retrying in ${Math.round(delay/1000)}s…`);
    setTimeout(initPeer, delay);
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch(e) {} });
}

function sendTo(conn, msg) {
  try { if (conn?.open) conn.send(msg); } catch(e) {}
}

function broadcastAll() {
  const st = buildState();
  for (const c of conns.values()) sendTo(c, { type: 'state', data: st });
  renderHost();
}

function buildState() {
  const curRun = gs.phase === 'running'
    ? gs.players[gs.currentPlayer]?.currentRun
    : null;
  return {
    phase: gs.phase,
    players: gs.players.map(p => ({
      name: p.name,
      color: p.color,
      bestDist: p.bestDist,
      connected: p.connected,
      isHostPlayer: p.isHostPlayer,
    })),
    currentPlayerIdx: gs.currentPlayer,
    countdown: gs.countdownVal,
    run: curRun ? {
      ropeUses: curRun.ropeUses,
      dist: Math.round(curRun.maxX / 10),
      runState: curRun.state,         // 'falling' | 'firing' | 'reeling'
      retracting: curRun.retracting,
    } : null,
  };
}

// ── Message handling ──────────────────────────────────────────────────
function handleMsg(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'join':     handleJoin(conn, msg);     break;
    case 'start':    handleStart(conn);         break;
    case 'tap':      handleTapMsg(conn);        break; // legacy combined.html compat
    case 'aim':      handleAimMsg(conn, msg);   break;
    case 'fireDown': handleFireDownMsg(conn, msg); break;
    case 'fireUp':   handleFireUpMsg(conn);     break;
    case 'restart':  handleRestart(conn);       break;
  }
}

function handleDisconnect(conn) {
  const p = gs.players.find(pl => pl.peerId === conn.peer);
  if (p) { p.connected = false; broadcastAll(); }
  conns.delete(conn.peer);
}

function handleJoin(conn, msg) {
  // Reconnect by deviceId during lobby
  const dId = String(msg.deviceId || '');
  if (dId && gs.phase === 'lobby') {
    const existing = gs.players.find(p => p.deviceId === dId);
    if (existing) {
      existing.connected = true;
      existing.peerId = conn.peer;
      conns.set(conn.peer, conn);
      const myIdx = gs.players.indexOf(existing);
      sendTo(conn, { type: 'joined', myIdx, isHostPlayer: existing.isHostPlayer });
      broadcastAll();
      return;
    }
  }

  if (gs.phase !== 'lobby') {
    sendTo(conn, { type: 'error', message: 'Game already in progress' });
    return;
  }
  if (gs.players.length >= 6) {
    sendTo(conn, { type: 'error', message: 'Game is full (6 players max)' });
    return;
  }

  const name = String(msg.name || 'Player').replace(/[<>&"']/g, '').slice(0, 16) || 'Player';
  const isHostPlayer = gs.players.filter(p => p.connected).length === 0;
  const color = PLAYER_COLORS[gs.players.length % PLAYER_COLORS.length];
  const player = {
    name, color, bestDist: 0, currentRun: null,
    connected: true, peerId: conn.peer,
    isHostPlayer, deviceId: dId,
  };
  const myIdx = gs.players.length;
  gs.players.push(player);
  sendTo(conn, { type: 'joined', myIdx, isHostPlayer });
  broadcastAll();
}

function handleStart(conn) {
  const p = gs.players.find(pl => pl.peerId === conn.peer);
  if (!p?.isHostPlayer) return;
  if (gs.phase !== 'lobby') return;
  if (gs.players.filter(pl => pl.connected).length < 1) return;
  startGame();
}

function handleTapMsg(conn) {
  if (gs.phase !== 'running') return;
  const cur = gs.players[gs.currentPlayer];
  if (cur?.peerId !== conn.peer) return;
  const run = cur.currentRun;
  if (!run || run.dead) return;
  // Legacy combined.html tap: aim upper-right to bias grapple forward
  const camX = getCameraX(run, canvasWidth);
  handleTap(run, canvasWidth * 0.8, canvasHeight * 0.15, canvasWidth, canvasHeight, camX);
}

function handleAimMsg(conn, msg) {
  if (gs.phase !== 'running') return;
  const cur = gs.players[gs.currentPlayer];
  if (cur?.peerId !== conn.peer) return;
  const run = cur.currentRun;
  if (!run || run.dead) return;
  if (typeof msg.angle === 'number') run.aimAngle = msg.angle;
}

function handleFireDownMsg(conn, msg) {
  if (gs.phase !== 'running') return;
  const cur = gs.players[gs.currentPlayer];
  if (cur?.peerId !== conn.peer) return;
  const run = cur.currentRun;
  if (!run || run.dead) return;
  const angle = typeof msg.angle === 'number' ? msg.angle : (run.aimAngle ?? -Math.PI / 3);
  run.aimAngle = angle;
  handleFireAction(run, angle);
}

function handleFireUpMsg(conn) {
  if (gs.phase !== 'running') return;
  const cur = gs.players[gs.currentPlayer];
  if (cur?.peerId !== conn.peer) return;
  const run = cur.currentRun;
  if (!run || run.dead) return;
  handleReleaseAction(run);
}

function handleRestart(conn) {
  const p = gs.players.find(pl => pl.peerId === conn.peer);
  if (!p?.isHostPlayer || gs.phase !== 'allDone') return;
  gs.players.forEach(pl => { pl.bestDist = 0; pl.currentRun = null; });
  gs.currentPlayer = 0;
  gs.phase = 'lobby';
  broadcastAll();
}

// ── Game flow ─────────────────────────────────────────────────────────
function startGame() {
  gs.currentPlayer = 0;
  gs.players.forEach(p => { p.bestDist = 0; p.currentRun = null; });
  startCountdown();
}

function startCountdown() {
  if (gs.countdownTimer) clearTimeout(gs.countdownTimer);
  gs.phase = 'countdown';
  gs.countdownVal = 3;
  broadcastAll();

  const whoEl = document.getElementById('countdown-who');
  const numEl = document.getElementById('countdown-num');
  if (whoEl) whoEl.textContent = `${gs.players[gs.currentPlayer].name}'s turn`;

  function tick() {
    if (numEl) numEl.textContent = gs.countdownVal;
    broadcastAll();
    if (gs.countdownVal <= 0) { startRun(); return; }
    gs.countdownVal--;
    gs.countdownTimer = setTimeout(tick, 800);
  }
  tick();
}

function startRun() {
  const player = gs.players[gs.currentPlayer];
  gs.phase = 'running';
  renderHost();        // show canvas screen first
  resizeCanvas();      // measure container now that it's visible
  player.currentRun = createRunState(canvasWidth, canvasHeight);
  ensureChunks(player.currentRun, canvasWidth, canvasHeight);
  broadcastAll();
  broadcastTick = 0;
  gs.animFrame = requestAnimationFrame(gameLoop);
}

function gameLoop() {
  const player = gs.players[gs.currentPlayer];
  const run = player?.currentRun;
  if (!run || gs.phase !== 'running') return;

  for (let s = 0; s < 2; s++) {
    stepPhysics(run, canvasWidth, canvasHeight);
    ensureChunks(run, canvasWidth, canvasHeight);
  }

  const camX = getCameraX(run, canvasWidth);
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawWorld(ctx, run, camX, canvasWidth, canvasHeight, player.color);

  // Update sidebar live
  renderRunSidebar();

  // Broadcast to players at ~20fps
  broadcastTick++;
  if (broadcastTick % 3 === 0) {
    const st = buildState();
    for (const c of conns.values()) sendTo(c, { type: 'state', data: st });
  }

  if (run.dead) { endRun(); return; }
  gs.animFrame = requestAnimationFrame(gameLoop);
}

function endRun() {
  if (gs.animFrame) cancelAnimationFrame(gs.animFrame);
  const player = gs.players[gs.currentPlayer];
  if (player.currentRun.maxX > player.bestDist) {
    player.bestDist = player.currentRun.maxX;
  }
  gs.phase = 'runOver';
  broadcastAll();

  const nameEl = document.getElementById('run-over-name');
  const distEl = document.getElementById('run-over-dist');
  if (nameEl) nameEl.textContent = player.name;
  if (distEl) distEl.textContent = `${Math.round(player.bestDist / 10)}m`;

  setTimeout(() => {
    gs.currentPlayer++;
    if (gs.currentPlayer >= gs.players.filter((_, i) => i < gs.players.length).length) {
      gs.phase = 'allDone';
      broadcastAll();
      renderHost();
    } else {
      startCountdown();
    }
  }, 2500);
}

// ── Canvas ────────────────────────────────────────────────────────────
function initCanvas() {
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');
  window.addEventListener('resize', () => {
    if (gs.phase === 'running') resizeCanvas();
  });
}

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  if (!container || !canvas) return;
  canvasWidth  = container.clientWidth;
  canvasHeight = container.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvasWidth  * dpr;
  canvas.height = canvasHeight * dpr;
  canvas.style.width  = canvasWidth  + 'px';
  canvas.style.height = canvasHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Render host UI ─────────────────────────────────────────────────────
function renderHost() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${gs.phase}`);
  if (el) el.classList.add('active');

  if (gs.phase === 'lobby')   renderLobby();
  if (gs.phase === 'running') renderRunSidebar();
  if (gs.phase === 'allDone') renderAllDone();
}

function renderLobby() {
  const list  = document.getElementById('lobby-player-list');
  const count = document.getElementById('lobby-count');
  const connected = gs.players.filter(p => p.connected);
  if (count) count.textContent = connected.length;
  if (!list) return;
  if (gs.players.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:0.9rem">Waiting for players to scan the QR code…</p>';
    return;
  }
  list.innerHTML = gs.players.map(p => `
    <div class="lobby-player-row">
      <div class="player-swatch" style="background:${p.color}"></div>
      <span class="player-setup-name">${sanitize(p.name)}</span>
      ${p.isHostPlayer ? '<span class="host-badge">host</span>' : ''}
      ${!p.connected ? '<span style="color:var(--text-dim);font-size:0.8rem;margin-left:auto">(away)</span>' : ''}
    </div>
  `).join('');
}

function renderRunSidebar() {
  const list = document.getElementById('run-player-list');
  const badge = document.getElementById('run-phase-badge');
  if (!list) return;
  list.innerHTML = gs.players.map((p, i) => `
    <div class="run-player-row ${i === gs.currentPlayer ? 'current' : ''}">
      <div class="player-swatch" style="background:${p.color};width:14px;height:14px;flex-shrink:0"></div>
      <span class="score-name" style="font-size:0.88rem">${sanitize(p.name)}</span>
      <span class="run-player-dist">${p.bestDist ? Math.round(p.bestDist / 10) + 'm' : '—'}</span>
    </div>
  `).join('');
  const run = gs.players[gs.currentPlayer]?.currentRun;
  if (badge && run) {
    const dist = Math.round(run.maxX / 10);
    badge.textContent = `${gs.players[gs.currentPlayer].name}: ${dist}m`;
  }
}

function renderAllDone() {
  const sorted = [...gs.players].sort((a, b) => b.bestDist - a.bestDist);
  const el = document.getElementById('final-scoreboard');
  if (!el) return;
  el.innerHTML = sorted.map((p, i) => `
    <div class="score-row ${i === 0 ? 'winner' : ''}">
      <span class="score-rank">${i === 0 ? '🏆' : '#' + (i + 1)}</span>
      <div class="score-swatch" style="background:${p.color}"></div>
      <span class="score-name">${sanitize(p.name)}</span>
      <span class="score-dist">${Math.round(p.bestDist / 10)}m</span>
    </div>
  `).join('');
}

// ── Init ──────────────────────────────────────────────────────────────
initCanvas();
initPeer();
renderHost();

document.getElementById('btn-play-again')?.addEventListener('click', () => {
  gs.players.forEach(p => { p.bestDist = 0; p.currentRun = null; });
  gs.currentPlayer = 0;
  gs.phase = 'lobby';
  broadcastAll();
});
