// =====================================================================
// GRAPPLE AND GO — Main (combined host + player on one device)
// =====================================================================
// Turn-based: each player takes a solo run; furthest distance wins.
// Controls:
//   - Tap / click to fire grapple toward nearest anchor ring above you
//   - Tap again while swinging to release
//   - Avoid spikes and lava — touch them and you're done
// =====================================================================

const BG_COLORS   = ['#e63946','#457b9d','#2a9d8f','#e9c46a','#f4a261','#264653','#6a4c93','#1982c4'];
const PLAYER_COLORS = BG_COLORS;

// ── Game state ─────────────────────────────────────────────────────────
let gs = createFreshGs();

function createFreshGs() {
  return {
    phase: 'setup',   // 'setup' | 'countdown' | 'running' | 'runOver' | 'allDone'
    players: [],      // [{name, color, bestDist, currentRun}]
    currentPlayer: 0, // index into players
    countdownVal: 3,
    countdownTimer: null,
    animFrame: null,
    lastFrameTime: 0,
  };
}

function resetGames() {
  if (gs.countdownTimer) clearTimeout(gs.countdownTimer);
  if (gs.animFrame) cancelAnimationFrame(gs.animFrame);
  gs = createFreshGs();
  renderScreen();
}

// ── Canvas setup ────────────────────────────────────────────────────────
let canvas, ctx, canvasWidth, canvasHeight;

function initCanvas() {
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  canvasWidth  = container.clientWidth;
  canvasHeight = container.clientHeight;
  canvas.width  = canvasWidth  * window.devicePixelRatio;
  canvas.height = canvasHeight * window.devicePixelRatio;
  canvas.style.width  = canvasWidth  + 'px';
  canvas.style.height = canvasHeight + 'px';
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

// ── Screens ────────────────────────────────────────────────────────────
function renderScreen() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const id = `screen-${gs.phase}`;
  const el = document.getElementById(id);
  if (el) el.classList.add('active');

  if (gs.phase === 'setup')    renderSetup();
  if (gs.phase === 'allDone')  renderAllDone();
}

function renderSetup() {
  const list = document.getElementById('player-setup-list');
  if (!list) return;
  list.innerHTML = gs.players.map((p, i) => `
    <div class="player-setup-row">
      <div class="player-swatch" style="background:${p.color}"></div>
      <span class="player-setup-name">${esc(p.name)}</span>
      <button class="btn btn-sm remove-player-btn" data-idx="${i}">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.remove-player-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      gs.players.splice(Number(btn.dataset.idx), 1);
      renderSetup();
    });
  });
  document.getElementById('btn-start-game').disabled = gs.players.length < 1;
}

function renderAllDone() {
  const sorted = [...gs.players].sort((a, b) => b.bestDist - a.bestDist);
  const board = document.getElementById('final-scoreboard');
  board.innerHTML = sorted.map((p, i) => `
    <div class="score-row ${i === 0 ? 'winner' : ''}">
      <span class="score-rank">${i === 0 ? '🏆' : `#${i+1}`}</span>
      <div class="score-swatch" style="background:${p.color}"></div>
      <span class="score-name">${esc(p.name)}</span>
      <span class="score-dist">${Math.round(p.bestDist / 10)}m</span>
    </div>
  `).join('');
}

// ── Countdown → run ────────────────────────────────────────────────────
function startPlayerTurn() {
  const player = gs.players[gs.currentPlayer];
  gs.phase = 'countdown';
  gs.countdownVal = 3;
  renderScreen();

  // Show which player is up
  const whoEl = document.getElementById('countdown-who');
  if (whoEl) whoEl.textContent = `${player.name}'s turn`;
  const countEl = document.getElementById('countdown-num');

  function tick() {
    if (countEl) countEl.textContent = gs.countdownVal;
    if (gs.countdownVal <= 0) {
      startRun();
      return;
    }
    gs.countdownVal--;
    gs.countdownTimer = setTimeout(tick, 800);
  }
  tick();
}

function startRun() {
  const player = gs.players[gs.currentPlayer];

  gs.phase = 'running';
  renderScreen();

  // Now that the canvas container is visible, size correctly
  resizeCanvas();

  // Create a fresh run
  player.currentRun = createRunState(canvasWidth, canvasHeight);
  ensureChunks(player.currentRun, canvasWidth, canvasHeight);

  // Update run-screen player name
  const nameEl = document.getElementById('run-player-name');
  if (nameEl) {
    nameEl.textContent = player.name;
    nameEl.style.color = player.color;
  }

  // Start game loop
  gs.lastFrameTime = performance.now();
  gameLoop();
}

function gameLoop() {
  const now = performance.now();
  const dt = Math.min((now - gs.lastFrameTime) / 16.67, 3); // clamp to 3× speed max
  gs.lastFrameTime = now;

  const player = gs.players[gs.currentPlayer];
  const run = player.currentRun;

  if (!run || gs.phase !== 'running') return;

  // Multiple sub-steps for stable physics
  const steps = 2;
  for (let s = 0; s < steps; s++) {
    stepPhysics(run, canvasWidth, canvasHeight);
    ensureChunks(run, canvasWidth, canvasHeight);
  }

  // Draw
  const camX = getCameraX(run, canvasWidth);
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawWorld(ctx, run, camX, canvasWidth, canvasHeight, player.color);

  // Check run end
  if (run.dead) {
    if (run.maxX > (player.bestDist || 0)) player.bestDist = run.maxX;
    endRun();
    return;
  }

  gs.animFrame = requestAnimationFrame(gameLoop);
}

function endRun() {
  gs.phase = 'runOver';
  renderScreen();

  const player = gs.players[gs.currentPlayer];
  const dist = Math.round(player.bestDist / 10);

  const distEl = document.getElementById('run-over-dist');
  const nameEl = document.getElementById('run-over-name');
  const nextEl = document.getElementById('btn-next-player');
  const doneEl = document.getElementById('btn-see-results');
  if (nameEl) nameEl.textContent = player.name;
  if (distEl) distEl.textContent = `${dist}m`;

  const isLast = gs.currentPlayer >= gs.players.length - 1;
  if (nextEl) nextEl.style.display = isLast ? 'none' : '';
  if (doneEl) doneEl.style.display = isLast ? '' : 'none';
}

function advancePlayer() {
  gs.currentPlayer++;
  startPlayerTurn();
}

function showResults() {
  gs.phase = 'allDone';
  renderScreen();
}

// ── Input: tap/click on canvas ─────────────────────────────────────────
function setupCanvasInput() {
  function getXY(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return { cx: e.touches[0].clientX - rect.left, cy: e.touches[0].clientY - rect.top };
    }
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
  }

  // touchstart / mousedown:
  //   • While hanging  → pump swing left or right based on which side was tapped
  //   • While falling  → fire grapple toward tap point
  function onDown(e) {
    if (gs.phase !== 'running') return;
    e.preventDefault();
    const { cx, cy } = getXY(e);
    const player = gs.players[gs.currentPlayer];
    if (!player || !player.currentRun) return;
    const run = player.currentRun;
    if (run.state === 'reeling') {
      // Left half = push left, right half = push right
      handleSwingBoost(run, cx < canvasWidth / 2 ? -1 : 1);
    } else {
      const camX = getCameraX(run, canvasWidth);
      handleTap(run, cx, cy, canvasWidth, canvasHeight, camX);
    }
  }

  // touchend / mouseup:
  //   • While hanging → release the rope (detach at current swing momentum)
  function onUp(e) {
    if (gs.phase !== 'running') return;
    const player = gs.players[gs.currentPlayer];
    if (!player || !player.currentRun) return;
    const run = player.currentRun;
    if (run.state === 'reeling') handleReleaseAction(run);
  }

  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('mousedown',  onDown);
  canvas.addEventListener('touchend',   onUp);
  canvas.addEventListener('mouseup',    onUp);
}

// ── Add player form ────────────────────────────────────────────────────
function setupAddPlayer() {
  const input = document.getElementById('new-player-name');
  const btn   = document.getElementById('btn-add-player');

  function addPlayer() {
    const name = (input.value || '').trim();
    if (!name) { input.focus(); return; }
    if (gs.players.length >= 6) return;
    const colorIdx = gs.players.length % PLAYER_COLORS.length;
    gs.players.push({ name, color: PLAYER_COLORS[colorIdx], bestDist: 0, currentRun: null });
    input.value = '';
    input.focus();
    renderSetup();
  }

  btn.addEventListener('click', addPlayer);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });
}

// ── Button wiring ──────────────────────────────────────────────────────
function setupButtons() {
  document.getElementById('btn-start-game').addEventListener('click', () => {
    if (gs.players.length < 1) return;
    gs.currentPlayer = 0;
    startPlayerTurn();
  });

  document.getElementById('btn-next-player').addEventListener('click', advancePlayer);
  document.getElementById('btn-see-results').addEventListener('click', showResults);

  document.getElementById('btn-play-again').addEventListener('click', () => {
    gs.players.forEach(p => { p.bestDist = 0; p.currentRun = null; });
    gs.currentPlayer = 0;
    gs.phase = 'setup';
    renderSetup();
    renderScreen();
  });

  document.getElementById('btn-new-game').addEventListener('click', resetGames);
}

// ── Helpers ─────────────────────────────────────────────────────────────
function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function showQrCode(url) {
  const img = document.getElementById('setup-qr-img');
  const urlEl = document.getElementById('setup-qr-url');
  if (urlEl) urlEl.textContent = url;
  if (!img || typeof qrcode === 'undefined') return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    img.src = qr.createDataURL(4, 4);
  } catch (e) { console.warn('QR generation failed:', e); }
}

// ── Init ────────────────────────────────────────────────────────────────
initCanvas();
setupCanvasInput();
setupAddPlayer();
setupButtons();
renderScreen();
showQrCode(window.location.href);
