// =====================================================================
// GRAPPLE AND GO — Game Engine  (mine tunnel edition)
// =====================================================================
// Physics model:
//   - Player has position (px, py) and velocity (vx, vy).
//   - Gravity pulls down every frame.
//   - HOLD FIRE: fire grapple hook in aim direction.
//     When hook hits a ceiling bolt, transition to 'reeling' state:
//     the rope RETRACTS at a fixed speed, pulling the player upward.
//     While reeling, player swings as a pendulum AND the rope shortens
//     (angular momentum is conserved: ω * L = const, so spin increases
//     as L decreases — like a figure skater pulling in their arms).
//   - RELEASE FIRE: detach from bolt, fly as projectile.
//   - Player can re-fire mid-air to grab a new bolt.
//   - Run ends when player falls off the bottom of the tunnel.
// =====================================================================

const GRAVITY         = 0.5;    // px/frame²
const RETRACT_SPEED   = 3.5;    // px/frame the rope shortens while held
const MAX_ROPE        = 520;    // max initial rope length
const MIN_ROPE        = 40;     // rope stops retracting at this length
const DAMPING         = 0.998;  // angular damping (very low — mine air)
const PLAYER_RADIUS   = 14;
const BOLT_RADIUS     = 10;
const PICKUP_RADIUS   = 12;
const GRAPPLE_SPEED   = 22;     // px/frame for the flying hook

// World geometry
const CHUNK_WIDTH      = 700;
const BOLTS_PER_CHUNK  = 5;
const PICKUPS_PER_CHUNK = 2;
const SEGMENTS_PER_CHUNK = 14;  // jagged ceiling/floor vertices per chunk

// ── Seeded pseudo-random ───────────────────────────────────────────────
function seededRand(seed) {
  seed = (seed * 1664525 + 1013904223) & 0xffffffff;
  return (seed >>> 0) / 0x100000000;
}

// ── World generation ───────────────────────────────────────────────────
function generateChunk(chunkIndex) {
  const xStart = chunkIndex * CHUNK_WIDTH;
  const segW   = CHUNK_WIDTH / SEGMENTS_PER_CHUNK;

  const CEIL_BASE  = 0.08;
  const CEIL_VAR   = 0.10;
  const FLOOR_BASE = 0.80;
  const FLOOR_VAR  = 0.08;

  const ceilVerts  = [];
  const floorVerts = [];
  const flatStart  = chunkIndex === 0 ? 5 : 0;

  for (let i = 0; i <= SEGMENTS_PER_CHUNK; i++) {
    const s  = seededRand(chunkIndex * 10000 + i * 7 + 1);
    const sf = seededRand(chunkIndex * 10000 + i * 7 + 4);
    const flatFrac = chunkIndex === 0 ? Math.max(0, (flatStart - i) / flatStart) : 0;
    const cv = CEIL_BASE  + (s  - 0.5) * 2 * CEIL_VAR  * (1 - flatFrac);
    const fv = FLOOR_BASE + (sf - 0.5) * 2 * FLOOR_VAR * (1 - flatFrac);
    ceilVerts.push({ x: xStart + i * segW, yFrac: cv });
    floorVerts.push({ x: xStart + i * segW, yFrac: fv });
  }

  // Bolts embedded in the ceiling
  const bolts = [];
  for (let i = 0; i < BOLTS_PER_CHUNK; i++) {
    const s  = seededRand(chunkIndex * 9999 + i * 13 + 2);
    const s2 = seededRand(chunkIndex * 9999 + i * 13 + 5);
    const bx    = xStart + (i + 0.2 + s * 0.6) * (CHUNK_WIDTH / BOLTS_PER_CHUNK);
    const bYFrac = CEIL_BASE + 0.04 + s2 * 0.06;
    bolts.push({ x: bx, yFrac: bYFrac });
  }

  // Pickups float in the mid-tunnel
  const pickups = [];
  for (let i = 0; i < PICKUPS_PER_CHUNK; i++) {
    const s  = seededRand(chunkIndex * 8888 + i * 17 + 3);
    const s2 = seededRand(chunkIndex * 8888 + i * 17 + 6);
    const px2   = xStart + (i + 0.3 + s * 0.5) * (CHUNK_WIDTH / PICKUPS_PER_CHUNK);
    const pyFrac = 0.48 + (s2 - 0.5) * 0.12;
    pickups.push({ x: px2, yFrac: pyFrac, collected: false });
  }

  return { ceilVerts, floorVerts, bolts, pickups };
}

// ── Tunnel geometry helpers ────────────────────────────────────────────
function ceilAt(run, worldX) {
  return _tunnelY(run.ceilVerts, worldX, run.canvasHeight);
}
function floorAt(run, worldX) {
  return _tunnelY(run.floorVerts, worldX, run.canvasHeight);
}

function _tunnelY(verts, worldX, canvasHeight) {
  if (!verts || verts.length === 0) return 0;
  let lo = 0, hi = verts.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (verts[mid].x <= worldX) lo = mid; else hi = mid;
  }
  const v0 = verts[lo], v1 = verts[hi];
  if (!v1 || v0.x === v1.x) return v0.yFrac * canvasHeight;
  const t = (worldX - v0.x) / (v1.x - v0.x);
  return (v0.yFrac + t * (v1.yFrac - v0.yFrac)) * canvasHeight;
}

// ── Game state factory ─────────────────────────────────────────────────
function createRunState(canvasWidth, canvasHeight) {
  const run = {
    canvasWidth,
    canvasHeight,
    px: 80, py: 0,
    vx: 2,  vy: 0,

    state: 'falling',   // 'falling' | 'firing' | 'reeling'
    ropeUses: 5,
    retracting: false,

    anchorX: 0, anchorY: 0,
    ropeLen: 0,
    angle: 0, angleVel: 0,

    grappleX: 0, grappleY: 0,
    grappleDX: 0, grappleDY: 0,

    aimAngle: -Math.PI * 0.55,

    ceilVerts: [],
    floorVerts: [],
    bolts: [],
    pickups: [],
    chunksGenerated: 0,

    maxX: 80,
    dead: false,
  };

  ensureChunks(run, canvasWidth, canvasHeight);
  run.py = floorAt(run, run.px) - PLAYER_RADIUS - 2;
  return run;
}

function ensureChunks(run, canvasWidth, canvasHeight) {
  while (run.chunksGenerated * CHUNK_WIDTH < run.px + canvasWidth * 2.5) {
    const chunk = generateChunk(run.chunksGenerated);
    if (run.chunksGenerated === 0) {
      run.ceilVerts.push(...chunk.ceilVerts);
      run.floorVerts.push(...chunk.floorVerts);
    } else {
      run.ceilVerts.push(...chunk.ceilVerts.slice(1));
      run.floorVerts.push(...chunk.floorVerts.slice(1));
    }
    run.bolts.push(...chunk.bolts);
    run.pickups.push(...chunk.pickups);
    run.chunksGenerated++;
  }
}

// ── Input handlers ────────────────────────────────────────────────────
function handleFireAction(run, angle) {
  if (run.dead) return;
  if (run.state === 'reeling') detach(run);
  if (run.state === 'firing')  { run.state = 'falling'; run.ropeUses++; } // refund
  if (run.ropeUses <= 0) return;

  run.ropeUses--;
  run.state     = 'firing';
  run.grappleX  = run.px;
  run.grappleY  = run.py;
  run.grappleDX = Math.cos(angle) * GRAPPLE_SPEED;
  run.grappleDY = Math.sin(angle) * GRAPPLE_SPEED;
  run.retracting = true;
}

function handleReleaseAction(run) {
  if (run.dead) return;
  run.retracting = false;
  if (run.state === 'reeling') detach(run);
  if (run.state === 'firing')  { run.state = 'falling'; run.ropeUses++; } // refund
}

// Legacy tap (combined.html) — fires hook toward tap position
function handleTap(run, tapX, tapY, canvasWidth, canvasHeight, cameraX) {
  if (run.state === 'reeling') { detach(run); return; }
  if (run.state === 'firing')  { run.state = 'falling'; run.ropeUses++; return; }
  if (run.ropeUses <= 0) return;
  const worldX = tapX + cameraX;
  const worldY = tapY;
  const dx = worldX - run.px, dy = worldY - run.py;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  run.ropeUses--;
  run.state     = 'firing';
  run.grappleX  = run.px;
  run.grappleY  = run.py;
  run.grappleDX = (dx / dist) * GRAPPLE_SPEED;
  run.grappleDY = (dy / dist) * GRAPPLE_SPEED;
  run.retracting = true;
}

// Attach hook to ceiling surface at (bx, by).
// Pendulum convention: angle=0 → player directly below anchor.
//   px = anchorX + sin(angle) * ropeLen
//   py = anchorY + cos(angle) * ropeLen
function attachToCeiling(run, bx, by) {
  run.state   = 'reeling';
  run.anchorX = bx;
  run.anchorY = by;
  const dx = run.px - bx, dy = run.py - by;  // dy > 0: player is below anchor
  run.ropeLen  = Math.min(MAX_ROPE, Math.max(MIN_ROPE, Math.sqrt(dx * dx + dy * dy)));
  run.angle    = Math.atan2(dx, dy);           // 0 = hanging straight down
  // ω = (vx·cos θ − vy·sin θ) / L  (dot product of velocity with tangent)
  run.angleVel = (run.vx * Math.cos(run.angle) - run.vy * Math.sin(run.angle)) / run.ropeLen;
  run.vx = 0; run.vy = 0;
}

function detach(run) {
  if (run.state !== 'reeling') return;
  // vx =  ω·L·cos θ,  vy = −ω·L·sin θ  (tangential velocity)
  run.vx =  run.angleVel * run.ropeLen * Math.cos(run.angle);
  run.vy = -run.angleVel * run.ropeLen * Math.sin(run.angle);
  run.state = 'falling';
  run.retracting = false;
}

// ── Physics steps ─────────────────────────────────────────────────────
function stepPhysics(run, canvasWidth, canvasHeight) {
  if (run.dead) return;
  run.canvasWidth  = canvasWidth;
  run.canvasHeight = canvasHeight;

  switch (run.state) {
    case 'falling': stepFalling(run); break;
    case 'firing':  stepFiring(run);  break;
    case 'reeling': stepReeling(run); break;
  }

  // Pickups
  for (const p of run.pickups) {
    if (p.collected) continue;
    const py2 = p.yFrac * canvasHeight;
    const dx = run.px - p.x, dy = run.py - py2;
    if (Math.sqrt(dx * dx + dy * dy) < PLAYER_RADIUS + PICKUP_RADIUS) {
      p.collected = true;
      run.ropeUses = Math.min(run.ropeUses + 2, 7);
    }
  }

  if (run.px > run.maxX) run.maxX = run.px;

  const localFloor = floorAt(run, run.px);
  if (run.py > localFloor + PLAYER_RADIUS * 3) run.dead = true;
}

function stepFalling(run) {
  run.vy += GRAVITY;
  run.px += run.vx;
  run.py += run.vy;
  _clampTunnel(run);
  if (run.px < 60) { run.px = 60; run.vx = Math.max(0, run.vx); }
}

function stepFiring(run) {
  run.vy += GRAVITY;
  run.px += run.vx;
  run.py += run.vy;
  _clampTunnel(run);
  if (run.px < 60) { run.px = 60; run.vx = Math.max(0, run.vx); }

  run.grappleX += run.grappleDX;
  run.grappleY += run.grappleDY;

  // Attach when hook reaches the ceiling surface
  const hookCeil = ceilAt(run, run.grappleX);
  if (run.grappleY <= hookCeil) {
    attachToCeiling(run, run.grappleX, hookCeil);
    return;
  }

  // Cancel if hook flies too far without hitting anything
  const gdx = run.grappleX - run.px, gdy = run.grappleY - run.py;
  const gDist = Math.sqrt(gdx * gdx + gdy * gdy);
  if (gDist > MAX_ROPE * 1.1) {
    run.state = 'falling';
    run.ropeUses++; // refund missed shot
  }
}

function stepReeling(run) {
  // Pendulum gravity torque
  const angG = (GRAVITY / run.ropeLen) * Math.sin(run.angle);
  run.angleVel -= angG;
  run.angleVel *= DAMPING;

  // Retract: shorten rope while conserving angular momentum
  if (run.retracting && run.ropeLen > MIN_ROPE) {
    const newLen = Math.max(MIN_ROPE, run.ropeLen - RETRACT_SPEED);
    run.angleVel *= run.ropeLen / newLen;
    run.ropeLen   = newLen;
  }

  run.angle += run.angleVel;

  run.px = run.anchorX + Math.sin(run.angle) * run.ropeLen;
  run.py = run.anchorY + Math.cos(run.angle) * run.ropeLen;  // + = hang below

  // Ceiling bounce
  const localCeil = ceilAt(run, run.px);
  if (run.py < localCeil + PLAYER_RADIUS) {
    run.py = localCeil + PLAYER_RADIUS;
    run.angleVel *= -0.3;
  }

  // Floor: land
  const localFloor = floorAt(run, run.px);
  if (run.py >= localFloor - PLAYER_RADIUS) {
    run.py = localFloor - PLAYER_RADIUS;
    detach(run);
    run.vy = 0;
    run.vx *= 0.7;
  }
}

function _clampTunnel(run) {
  const localCeil  = ceilAt(run, run.px);
  const localFloor = floorAt(run, run.px);

  if (run.py < localCeil + PLAYER_RADIUS) {
    run.py = localCeil + PLAYER_RADIUS;
    if (run.vy < 0) run.vy = 0;
  }
  if (run.py > localFloor - PLAYER_RADIUS) {
    run.py = localFloor - PLAYER_RADIUS;
    run.vy = 0;
    run.vx *= 0.80;
    if (run.ropeUses <= 0 && Math.abs(run.vx) < 0.5) run.dead = true;
  }
}

// ── Camera ────────────────────────────────────────────────────────────
function getCameraX(run, canvasWidth) {
  return Math.max(0, run.px - canvasWidth * 0.35);
}
