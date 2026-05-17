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

const GRAVITY         = 0.05;   // px/frame² (moon gravity: ~1/6 of Earth)
const RETRACT_SPEED   = 1.8;    // px/frame the rope shortens while held (leisurely climb)
const MIN_ROPE        = 40;     // rope stops retracting at this length

// Max rope scales with canvas height so the ceiling is always reachable
// from the lower half of the tunnel on any screen size.
// Tunnel spans ~80% of H in the worst case (floor at 88%, ceiling at 8%).
// 0.87 gives ~9% diagonal slack while still requiring skill to reach
// the very top from the floor — analogous to a Mario long-jump: you can
// always cross the screen, but maximum height still takes timing.
function maxRopeLen(canvasHeight) {
  return Math.max(440, canvasHeight * 0.87);
}
const DAMPING         = 0.998;  // angular damping (very low — mine air)
const PLAYER_RADIUS   = 14;
const GRAPPLE_SPEED   = 22;     // px/frame for the flying hook
const SWING_BOOST     = 0.03;   // angular velocity impulse per tap
const MAX_SWING_SPEED = 0.15;   // rad/frame cap on angular velocity
const TERMINAL_VY     = 5;      // max downward speed while falling (scaled to moon gravity)

// World geometry
const CHUNK_WIDTH        = 700;
const SEGMENTS_PER_CHUNK = 14;  // jagged ceiling/floor vertices per chunk
const SPIKE_HEIGHT       = 28;  // how tall spike clusters protrude from floor
const LAVA_HEIGHT        = 16;  // how tall lava pools sit above floor

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

  // No bolts — grapple attaches directly to the ceiling rock surface

  // Hazards on the floor — none in the first chunk (grace zone)
  const hazards = [];
  if (chunkIndex > 0) {
    // 2–3 spike clusters
    const nSpikes = 2 + (seededRand(chunkIndex * 7777 + 1) < 0.5 ? 1 : 0);
    for (let i = 0; i < nSpikes; i++) {
      const s  = seededRand(chunkIndex * 5555 + i * 31 + 7);
      const s2 = seededRand(chunkIndex * 5555 + i * 31 + 11);
      const hx = xStart + 60 + (i / nSpikes) * (CHUNK_WIDTH - 120) + s * (CHUNK_WIDTH / nSpikes) * 0.45;
      const hw = 28 + s2 * 28;  // width 28–56 px
      hazards.push({ type: 'spike', x: hx, width: hw });
    }
    // 0–1 lava pool (60% chance)
    if (seededRand(chunkIndex * 3333 + 55) > 0.4) {
      const s  = seededRand(chunkIndex * 3333 + 56);
      const s2 = seededRand(chunkIndex * 3333 + 57);
      const hx = xStart + 120 + s * (CHUNK_WIDTH - 240);
      const hw = 70 + s2 * 70;  // width 70–140 px
      hazards.push({ type: 'lava', x: hx, width: hw });
    }
  }

  return { ceilVerts, floorVerts, hazards };
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
    retracting: false,

    anchorX: 0, anchorY: 0,
    ropeLen: 0,
    angle: 0, angleVel: 0,

    grappleX: 0, grappleY: 0,
    grappleDX: 0, grappleDY: 0,
    grappleStartX: 0, grappleStartY: 0,

    aimAngle: -Math.PI * 0.55,

    ceilVerts: [],
    floorVerts: [],
    hazards: [],
    chunksGenerated: 0,

    pendingSounds: [],

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
    run.hazards.push(...chunk.hazards);
    run.chunksGenerated++;
  }
}

// ── Input handlers ────────────────────────────────────────────────────
function handleFireAction(run, angle) {
  if (run.dead) return;
  if (run.state === 'reeling') detach(run);
  if (run.state === 'firing')  { run.state = 'falling'; } // cancel in-flight
  run.state        = 'firing';
  run.grappleX     = run.px;
  run.grappleY     = run.py;
  run.grappleStartX = run.px;
  run.grappleStartY = run.py;
  run.grappleDX    = Math.cos(angle) * GRAPPLE_SPEED;
  run.grappleDY    = Math.sin(angle) * GRAPPLE_SPEED;
  run.retracting   = true;
}

function handleReleaseAction(run) {
  if (run.dead) return;
  run.retracting = false;
  if (run.state === 'reeling') detach(run);
  if (run.state === 'firing')  { run.state = 'falling'; }
}

// Legacy tap (combined.html) — fires hook toward tap position
// NOTE: does NOT handle 'reeling' state — combined.js dispatches that to handleSwingBoost.
function handleTap(run, tapX, tapY, canvasWidth, canvasHeight, cameraX) {
  if (run.state === 'firing')  { run.state = 'falling'; return; }
  const worldX = tapX + cameraX;
  const worldY = tapY;
  const dx = worldX - run.px, dy = worldY - run.py;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  run.state         = 'firing';
  run.grappleX      = run.px;
  run.grappleY      = run.py;
  run.grappleStartX = run.px;
  run.grappleStartY = run.py;
  run.grappleDX     = (dx / dist) * GRAPPLE_SPEED;
  run.grappleDY     = (dy / dist) * GRAPPLE_SPEED;
  run.retracting    = true;
  run.pendingSounds.push('fire');
}

// Apply a lateral swing impulse while hanging.
// direction: -1 = push left, +1 = push right
function handleSwingBoost(run, direction) {
  if (run.state !== 'reeling') return;
  run.angleVel = Math.max(-MAX_SWING_SPEED,
    Math.min(MAX_SWING_SPEED, run.angleVel + direction * SWING_BOOST));
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
  run.ropeLen  = Math.min(maxRopeLen(run.canvasHeight), Math.max(MIN_ROPE, Math.sqrt(dx * dx + dy * dy)));
  run.angle    = Math.atan2(dx, dy);           // 0 = hanging straight down
  // ω = (vx·cos θ − vy·sin θ) / L  (dot product of velocity with tangent)
  run.angleVel = (run.vx * Math.cos(run.angle) - run.vy * Math.sin(run.angle)) / run.ropeLen;
  run.vx = 0; run.vy = 0;
  run.pendingSounds.push('attach');
}

function detach(run) {
  if (run.state !== 'reeling') return;
  // vx =  ω·L·cos θ,  vy = −ω·L·sin θ  (tangential velocity)
  run.vx =  run.angleVel * run.ropeLen * Math.cos(run.angle);
  run.vy = -run.angleVel * run.ropeLen * Math.sin(run.angle);
  run.state = 'falling';
  run.retracting = false;
  run.pendingSounds.push('release');
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

  // Hazard collision — touching spikes or lava is instant death
  if (!run.dead) {
    for (const h of run.hazards) {
      if (Math.abs(run.px - h.x) > h.width / 2 + PLAYER_RADIUS + 20) continue;
      if (Math.abs(run.px - h.x) < h.width / 2 + PLAYER_RADIUS) {
        const hazardFloorY = floorAt(run, h.x);
        const hazardTop = hazardFloorY - (h.type === 'spike' ? SPIKE_HEIGHT : LAVA_HEIGHT);
        if (run.py > hazardTop - PLAYER_RADIUS) {
          run.dead = true;
          run.deathCause = h.type;
          run.pendingSounds.push('death');
          break;
        }
      }
    }
  }

  if (run.px > run.maxX) run.maxX = run.px;

  // Safety net: fell completely off the bottom
  const localFloor = floorAt(run, run.px);
  if (run.py > localFloor + PLAYER_RADIUS * 4) {
    run.dead = true;
    run.pendingSounds.push('death');
  }
}

function stepFalling(run) {
  run.vy += GRAVITY;
  if (run.vy > TERMINAL_VY) run.vy = TERMINAL_VY;  // soft landing
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

  // Cancel if hook has traveled more than maxRopeLen from its launch point.
  // (Do NOT measure from current player position — gravity pulls the player
  //  down while the hook flies up, inflating that distance prematurely.)
  const gdx = run.grappleX - run.grappleStartX, gdy = run.grappleY - run.grappleStartY;
  const gDist = Math.sqrt(gdx * gdx + gdy * gdy);
  if (gDist > maxRopeLen(run.canvasHeight) * 1.1) {
    run.state = 'falling';
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
  }
}

// ── Camera ────────────────────────────────────────────────────────────
function getCameraX(run, canvasWidth) {
  return Math.max(0, run.px - canvasWidth * 0.35);
}
