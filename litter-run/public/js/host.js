// =====================================================================
// LITTER RUN — Host
// =====================================================================
// Runs on the dedicated host screen (laptop/TV).
// Players join via QR code → player.html?room=<id>
// Turn-based: each player gets one 60-second run.
// Lowest total damage wins.
// =====================================================================

const PLAYER_COLORS = ['#e63946','#457b9d','#2a9d8f','#e9c46a','#f4a261','#264653','#6a4c93'];

// ── Global state ──────────────────────────────────────────────────────
let gs       = freshGs();
let peer     = null;
let conns    = new Map();   // peerId → DataConnection
let canvas, ctx;
let canvasW = 0, canvasH = 0;

function freshGs() {
  return {
    phase: 'lobby',  // lobby | countdown | running | roundOver | allDone
    players: [],
    currentPlayer: 0,
    countdownVal: 3,
    countdownTimer: null,
    animFrame: null,
    lastTick: 0,
    lureInput: { dx: 0, dy: 0 },
  };
}

// ── Sanitize ──────────────────────────────────────────────────────────
function sanitize(str) {
  return String(str || '').replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isLanMode() {
  return !!(window.SERVER_LAN_IP && window.SERVER_PORT);
}

// ── Peer init ─────────────────────────────────────────────────────────
function buildPlayerUrl(id) {
  if (isLanMode()) return `http://${SERVER_LAN_IP}:${SERVER_PORT}/player.html?room=${id}`;
  const base = new URL('player.html', location.href);
  base.searchParams.set('room', id);
  return base.toString();
}

function showQr(url) {
  const img = document.getElementById('qr-img');
  if (!img || typeof qrcode === 'undefined') return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url); qr.make();
    img.src = qr.createDataURL(4, 4);
    img.style.display = '';
  } catch(e) {}
}

function initPeer() {
  if (isLanMode()) { _initLan(); return; }
  _initTrystero();
}

function _initTrystero() {
  const urlEl = document.getElementById('lobby-url');
  if (urlEl) urlEl.textContent = 'Connecting…';
  peer = new TrysteroHostPeer('nksimmons-litter-run');
  peer.on('open', id => {
    const url = buildPlayerUrl(id);
    if (urlEl) urlEl.textContent = url;
    showQr(url);
  });
  peer.on('connection', conn => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      conn.on('data',  msg => handleMsg(conn, msg));
      conn.on('close', ()  => handleDisconnect(conn));
      conn.on('error', ()  => handleDisconnect(conn));
    });
  });
  peer.on('error', e => console.warn('Trystero error:', e));
}

function _initLan() {
  const urlEl = document.getElementById('lobby-url');
  if (urlEl) urlEl.textContent = 'Starting…';
  peer = new LocalHostPeer();
  peer.on('open', id => {
    const url = buildPlayerUrl(id);
    if (urlEl) urlEl.textContent = url;
    showQr(url);
  });
  peer.on('connection', conn => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      conn.on('data',  msg => handleMsg(conn, msg));
      conn.on('close', ()  => handleDisconnect(conn));
      conn.on('error', ()  => handleDisconnect(conn));
    });
  });
}

// ── Broadcast ─────────────────────────────────────────────────────────
function sendTo(conn, msg) {
  try { if (conn?.open) conn.send(msg); } catch(e) {}
}

function broadcastAll() {
  const st = buildState();
  for (const c of conns.values()) sendTo(c, { type: 'state', data: st });
  renderHost();
}

function buildState() {
  const cur = gs.players[gs.currentPlayer];
  const run = cur?.currentRun;
  return {
    phase:            gs.phase,
    players:          gs.players.map(p => ({
      name:         p.name,
      color:        p.color,
      totalDamage:  p.totalDamage,
      connected:    p.connected,
      isHostPlayer: p.isHostPlayer,
    })),
    currentPlayerIdx: gs.currentPlayer,
    countdown:        gs.countdownVal,
    run: run ? {
      timeLeft:    Math.ceil(run.timeLeft),
      damage:      run.damage,
      lastBroken:  run.lastBroken,
      damageLog:   run.damageLog,
    } : null,
  };
}

// ── Message handling ──────────────────────────────────────────────────
function handleMsg(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'join':    handleJoin(conn, msg);   break;
    case 'start':   handleStart(conn);       break;
    case 'move':    handleMove(conn, msg);   break;
    case 'restart': handleRestart(conn);     break;
  }
}

function handleDisconnect(conn) {
  const p = gs.players.find(pl => pl.peerId === conn.peer);
  if (p) { p.connected = false; broadcastAll(); }
  conns.delete(conn.peer);
}

function handleJoin(conn, msg) {
  const dId = String(msg.deviceId || '');

  // Reconnect by deviceId during lobby
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
    sendTo(conn, { type: 'error', message: 'Game is already in progress.' });
    return;
  }
  if (gs.players.length >= 6) {
    sendTo(conn, { type: 'error', message: 'Game is full (6 players max).' });
    return;
  }

  const name         = String(msg.name || 'Player').replace(/[<>&"']/g, '').slice(0, 16) || 'Player';
  const isHostPlayer = gs.players.filter(p => p.connected).length === 0;
  const rawColor     = String(msg.color || '');
  const color        = /^#[0-9a-fA-F]{6}$/.test(rawColor)
    ? rawColor
    : PLAYER_COLORS[gs.players.length % PLAYER_COLORS.length];

  const player = {
    name, color, totalDamage: 0, currentRun: null,
    connected: true, peerId: conn.peer, isHostPlayer, deviceId: dId,
  };
  const myIdx = gs.players.length;
  gs.players.push(player);
  sendTo(conn, { type: 'joined', myIdx, isHostPlayer });
  broadcastAll();
}

function handleStart(conn) {
  const p = gs.players.find(pl => pl.peerId === conn.peer);
  if (!p?.isHostPlayer || gs.phase !== 'lobby') return;
  if (gs.players.filter(pl => pl.connected).length < 1) return;
  startCountdown();
}

function handleMove(conn, msg) {
  if (gs.phase !== 'running') return;
  const cur = gs.players[gs.currentPlayer];
  if (cur?.peerId !== conn.peer) return;
  gs.lureInput.dx = Math.max(-1, Math.min(1, Number(msg.dx) || 0));
  gs.lureInput.dy = Math.max(-1, Math.min(1, Number(msg.dy) || 0));
}

function handleRestart(conn) {
  const p = gs.players.find(pl => pl.peerId === conn.peer);
  if (!p?.isHostPlayer || gs.phase !== 'allDone') return;
  restartGame();
}

// ── Game flow ─────────────────────────────────────────────────────────
function startCountdown() {
  gs.phase = 'countdown';
  gs.countdownVal = 3;
  gs.lureInput = { dx: 0, dy: 0 };
  showScreen('screen-game');
  broadcastAll();
  playCountdown(gs.countdownVal);
  gs.countdownTimer = setInterval(() => {
    gs.countdownVal--;
    broadcastAll();
    if (gs.countdownVal > 0) {
      playCountdown(gs.countdownVal);
    } else {
      clearInterval(gs.countdownTimer);
      gs.countdownTimer = null;
      playCountdown(0); // GO!
      startRun();
    }
  }, 1000);
}

function startRun() {
  gs.phase = 'running';
  const cur = gs.players[gs.currentPlayer];
  cur.currentRun = freshRun();
  gs.lastTick = performance.now();
  gs.lureInput = { dx: 0, dy: 0 };
  broadcastAll();
  gs.animFrame = requestAnimationFrame(gameTick);
}

function gameTick(now) {
  const dt = Math.min((now - gs.lastTick) / 1000, 0.05);
  gs.lastTick = now;
  if (gs.phase !== 'running') return;

  const cur = gs.players[gs.currentPlayer];
  const run = cur?.currentRun;
  if (!run) return;

  const prevDamage = run.damage;
  stepRun(run, dt, gs.lureInput.dx, gs.lureInput.dy);

  // Crash sound on new damage
  if (run.lastBroken && run.damage !== prevDamage) {
    playCrash(run.lastBroken.damage);
    run.lastBroken = null;
  }

  broadcastAll();

  if (run.dead) {
    endRound();
    return;
  }
  gs.animFrame = requestAnimationFrame(gameTick);
}

function endRound() {
  gs.phase = 'roundOver';
  const cur = gs.players[gs.currentPlayer];
  if (cur?.currentRun) cur.totalDamage = cur.currentRun.damage;
  playTimeUp();
  broadcastAll();
  renderHost();

  setTimeout(() => {
    const nextIdx = gs.currentPlayer + 1;
    if (nextIdx < gs.players.length) {
      gs.currentPlayer = nextIdx;
      gs.lureInput = { dx: 0, dy: 0 };
      startCountdown();
    } else {
      gs.phase = 'allDone';
      broadcastAll();
      renderHost();
      playAllDone();
    }
  }, 3500);
}

function restartGame() {
  if (gs.countdownTimer) clearInterval(gs.countdownTimer);
  if (gs.animFrame) cancelAnimationFrame(gs.animFrame);
  gs.players.forEach(p => { p.totalDamage = 0; p.currentRun = null; });
  gs.currentPlayer = 0;
  gs.phase = 'lobby';
  gs.lureInput = { dx: 0, dy: 0 };
  showScreen('screen-lobby');
  broadcastAll();
}

// ── Screen management ─────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const s = document.getElementById(id);
  if (s) s.classList.add('active');
}

// ── Rendering ─────────────────────────────────────────────────────────
function sizeCanvas() {
  const container = document.getElementById('canvas-container');
  if (!container || !canvas) return;
  const r = container.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return;
  const dpr = window.devicePixelRatio || 1;
  canvasW = Math.floor(r.width);
  canvasH = Math.floor(r.height);
  canvas.style.width  = canvasW + 'px';
  canvas.style.height = canvasH + 'px';
  canvas.width  = canvasW * dpr;
  canvas.height = canvasH * dpr;
  ctx.scale(dpr, dpr);
}

function renderHost() {
  switch (gs.phase) {
    case 'lobby':     renderLobby();    break;
    case 'countdown': renderGameScreen(); break;
    case 'running':   renderGameScreen(); break;
    case 'roundOver': renderGameScreen(); break;
    case 'allDone':   renderAllDone();  break;
  }
}

function renderLobby() {
  const list = document.getElementById('lobby-player-list');
  if (!list) return;
  if (gs.players.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:0.9rem">Waiting for players to scan the QR code…</p>';
  } else {
    list.innerHTML = gs.players.map(p => `
      <div class="lobby-player-row">
        <span class="player-dot" style="background:${p.color}"></span>
        <span>${sanitize(p.name)}</span>
        ${p.isHostPlayer ? '<span class="host-badge">HOST</span>' : ''}
        ${!p.connected ? '<span style="color:var(--text-dim);font-size:0.78rem">(disconnected)</span>' : ''}
      </div>`).join('');
  }
  const countEl = document.getElementById('lobby-count');
  if (countEl) countEl.textContent = gs.players.length;
}

function renderGameScreen() {
  if (!canvas || !ctx) return;

  const cur = gs.players[gs.currentPlayer];
  const run = cur?.currentRun;

  // Clear
  ctx.clearRect(0, 0, canvasW, canvasH);

  if (gs.phase === 'countdown') {
    // Draw a static house (fresh run for layout) with countdown overlay
    if (run) {
      drawScene(ctx, run, canvasW, canvasH, cur.color);
    } else {
      const tmp = freshRun();
      tmp.cat.vx = 0; tmp.cat.vy = 0;
      tmp.lure.x = WORLD_W / 2; tmp.lure.y = WORLD_H / 2;
      drawScene(ctx, tmp, canvasW, canvasH, cur?.color || '#e63946');
    }
    // Overlay
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, canvasW, canvasH);
    // Who's turn
    const who = document.getElementById('countdown-who');
    if (who) who.textContent = `${sanitize(cur?.name || '')} — get ready!`;
    const numEl = document.getElementById('countdown-num');
    if (numEl) numEl.textContent = gs.countdownVal > 0 ? String(gs.countdownVal) : 'GO!';
    const overlay = document.getElementById('countdown-overlay');
    if (overlay) overlay.style.display = 'flex';
    const roOverlay = document.getElementById('roundover-overlay');
    if (roOverlay) roOverlay.style.display = 'none';
    updateSidebar();
    return;
  }

  const cntOverlay = document.getElementById('countdown-overlay');
  if (cntOverlay) cntOverlay.style.display = 'none';

  if (!run) return;
  drawScene(ctx, run, canvasW, canvasH, cur.color);

  if (gs.phase === 'roundOver') {
    const roOverlay = document.getElementById('roundover-overlay');
    if (roOverlay) {
      roOverlay.style.display = 'flex';
      const title = roOverlay.querySelector('.roundover-title');
      const dmg   = roOverlay.querySelector('.roundover-damage');
      const name  = roOverlay.querySelector('.roundover-name');
      if (title) title.textContent = "TIME'S UP!";
      if (dmg)   dmg.textContent   = `$${run.damage.toLocaleString()} damage`;
      if (name)  name.textContent  = sanitize(cur?.name || '');
    }
  } else {
    const roOverlay = document.getElementById('roundover-overlay');
    if (roOverlay) roOverlay.style.display = 'none';
  }

  updateSidebar();
}

function updateSidebar() {
  const cur = gs.players[gs.currentPlayer];
  const run = cur?.currentRun;

  // Current player name + timer
  const turnEl = document.getElementById('sidebar-turn');
  if (turnEl) {
    turnEl.innerHTML = `<span class="player-dot" style="background:${cur?.color || '#888'}"></span>
      <span style="font-weight:700;color:${cur?.color || '#fff'}">${sanitize(cur?.name || '')}</span>`;
  }
  const timeEl = document.getElementById('sidebar-time');
  if (timeEl) timeEl.textContent = run ? `${Math.ceil(run.timeLeft)}s` : '—';
  const dmgEl = document.getElementById('sidebar-damage');
  if (dmgEl) dmgEl.textContent = run ? `$${run.damage.toLocaleString()}` : '$0';

  // Player list
  const listEl = document.getElementById('run-player-list');
  if (listEl) {
    listEl.innerHTML = gs.players.map((p, i) => {
      const isCur = i === gs.currentPlayer;
      const dmg = p.currentRun ? p.currentRun.damage : (p.totalDamage || '—');
      return `<div class="run-player-row ${isCur ? 'current' : ''}">
        <span class="player-dot" style="background:${p.color}"></span>
        <span>${sanitize(p.name)}</span>
        <span class="run-player-damage">${isCur && p.currentRun ? '$' + p.currentRun.damage : (p.totalDamage ? '$' + p.totalDamage : '—')}</span>
      </div>`;
    }).join('');
  }

  // Damage log (last 6 items)
  const logEl = document.getElementById('damage-log');
  if (logEl && run) {
    const recent = [...(run.damageLog || [])].reverse().slice(0, 6);
    logEl.innerHTML = recent.map(item =>
      `<div class="damage-log-item">
        <span>${item.label}</span>
        <span class="item-cost">-$${item.damage}</span>
      </div>`
    ).join('') || '<span style="opacity:0.4;font-size:0.8rem">Nothing broken yet!</span>';
  }
}

function renderAllDone() {
  showScreen('screen-alldone');
  const sorted = [...gs.players].sort((a, b) => a.totalDamage - b.totalDamage);
  const list = document.getElementById('final-scores');
  if (!list) return;
  list.innerHTML = sorted.map((p, i) => `
    <div class="score-row ${i === 0 ? 'winner' : ''}">
      <span class="score-rank">${i === 0 ? '🏆' : `#${i + 1}`}</span>
      <span class="player-dot" style="background:${p.color}"></span>
      <span class="score-name">${sanitize(p.name)}</span>
      <span class="score-damage">$${p.totalDamage.toLocaleString()}</span>
    </div>`).join('');

  const restartBtn = document.getElementById('btn-play-again');
  if (restartBtn) {
    const hp = gs.players.find(p => p.isHostPlayer && p.connected);
    restartBtn.style.display = hp ? 'inline-flex' : 'none';
  }
}

// ── Init ──────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas?.getContext('2d');
  sizeCanvas();
  window.addEventListener('resize', () => { sizeCanvas(); renderHost(); });
  document.getElementById('btn-play-again')?.addEventListener('click', () => {
    const hp = gs.players.find(p => p.isHostPlayer && p.connected);
    if (hp) restartGame();
  });
  initPeer();
  renderHost();
});
