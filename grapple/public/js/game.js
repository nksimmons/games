// =====================================================================
// GRAPPLE AND GO — Game Engine
// =====================================================================
// Physics model:
//   - Player has position (x, y) and velocity (vx, vy).
//   - Gravity applies every frame when not anchored.
//   - When anchored: player swings as a pendulum from the anchor point.
//     We track (angle, angleVel) relative to the anchor.
//   - On tap: fire grapple upward toward the nearest valid anchor ring.
//     If it hits, transition to pendulum mode.
//   - On release (or second tap): detach and become a projectile again.
//   - Run ends when player falls below the floor.
// =====================================================================

const GRAVITY        = 0.45;   // pixels/frame²
const MAX_ROPE       = 600;    // max rope length
const MIN_ROPE       = 80;
const DAMPING        = 0.992;  // angular damping (friction)
const PLAYER_RADIUS  = 18;
const RING_RADIUS    = 14;
const PICKUP_RADIUS  = 12;
const FLOOR_Y_FRAC   = 0.88;   // floor at 88% of canvas height
const GRAPPLE_SPEED  = 18;     // pixels/frame for grapple projectile
const WORLD_WIDTH    = 12000;  // total world width
const CHUNK_WIDTH    = 800;    // rings generated per chunk
const RINGS_PER_CHUNK = 4;
const PICKUPS_PER_CHUNK = 2;
const MAX_ROPE_USES  = 5;      // starts with this many grapples

// ── World generation ───────────────────────────────────────────────────

function generateChunk(chunkIndex, canvasHeight) {
  const floorY = canvasHeight * FLOOR_Y_FRAC;
  const startX = chunkIndex * CHUNK_WIDTH + (chunkIndex === 0 ? 50 : 200);
  const rings = [];
  const pickups = [];

  for (let i = 0; i < RINGS_PER_CHUNK; i++) {
    rings.push({
      x: startX + (i + 0.3 + Math.random() * 0.5) * (CHUNK_WIDTH / RINGS_PER_CHUNK),
      y: floorY * (0.25 + Math.random() * 0.35),
    });
  }
  for (let i = 0; i < PICKUPS_PER_CHUNK; i++) {
    pickups.push({
      x: startX + (i + 0.6 + Math.random() * 0.4) * (CHUNK_WIDTH / PICKUPS_PER_CHUNK),
      y: floorY * (0.35 + Math.random() * 0.35),
      collected: false,
    });
  }
  return { rings, pickups };
}

// ── Game state factory ─────────────────────────────────────────────────

function createRunState(canvasWidth, canvasHeight) {
  const floorY = canvasHeight * FLOOR_Y_FRAC;
  return {
    // Player
    px: 80,
    py: floorY - PLAYER_RADIUS - 2,
    vx: 4,
    vy: -2,  // slight upward start so player bounces into position

    // Grapple
    state: 'falling',   // 'falling' | 'firing' | 'swinging'
    ropeUses: MAX_ROPE_USES,

    // Anchor (when swinging)
    anchorX: 0,
    anchorY: 0,
    ropeLen: 0,
    angle: 0,           // radians from anchor, 0 = straight down
    angleVel: 0,

    // Grapple projectile (when firing)
    grappleX: 0,
    grappleY: 0,
    grappleDX: 0,
    grappleDY: 0,
    grappleTarget: null, // { x, y } of ring we're aiming at (legacy combined mode)

    // Gamepad aim angle (radians, 0=right, -π/2=up)
    aimAngle: -Math.PI / 3,

    // World
    chunks: [],
    chunksGenerated: 0,
    rings: [],           // { x, y }
    pickups: [],         // { x, y, collected }
    floorY,

    // Score
    maxX: 80,
    dead: false,
    won: false,
  };
}

function ensureChunks(run, canvasWidth, canvasHeight) {
  // Generate enough chunks to fill ahead of the player
  while (run.chunksGenerated * CHUNK_WIDTH < run.px + canvasWidth * 2) {
    const chunk = generateChunk(run.chunksGenerated, canvasHeight);
    run.rings.push(...chunk.rings);
    run.pickups.push(...chunk.pickups);
    run.chunksGenerated++;
  }
}

// ── Input handlers ────────────────────────────────────────────────────

// Gamepad controls: fire in a specific direction angle (radians)
function handleFireAction(run, angle) {
  if (run.dead) return;
  // Detach/cancel any current state so we can re-fire
  if (run.state === 'swinging') detach(run);
  if (run.state === 'firing')   run.state = 'falling';
  if (run.ropeUses <= 0) return;
  run.ropeUses--;
  run.state = 'firing';
  run.grappleX = run.px;
  run.grappleY = run.py;
  run.grappleDX = Math.cos(angle) * GRAPPLE_SPEED;
  run.grappleDY = Math.sin(angle) * GRAPPLE_SPEED;
  run.grappleTarget = null; // proximity-based: hit whatever ring the hook passes through
}

// Gamepad controls: release fire button
function handleReleaseAction(run) {
  if (run.dead) return;
  if (run.state === 'swinging') detach(run);
  if (run.state === 'firing')   run.state = 'falling';
}

// Legacy tap handler (used by combined.html single-device mode)
function handleTap(run, tapX, tapY, canvasWidth, canvasHeight, cameraX) {
  // tapX/tapY are canvas (screen) coordinates; convert to world coords
  const worldX = tapX + cameraX;
  const worldY = tapY;

  if (run.state === 'swinging') {
    // Release
    detach(run);
    return;
  }

  if (run.state === 'firing') {
    // Cancel and fall
    run.state = 'falling';
    return;
  }

  // State is 'falling' — try to fire
  if (run.ropeUses <= 0) return;

  // Find nearest ring within reach above the player
  const target = nearestRing(run, worldX, worldY);
  if (!target) return;

  run.ropeUses--;
  run.state = 'firing';
  run.grappleX = run.px;
  run.grappleY = run.py;
  const dx = target.x - run.px;
  const dy = target.y - run.py;
  const dist = Math.sqrt(dx * dx + dy * dy);
  run.grappleDX = (dx / dist) * GRAPPLE_SPEED;
  run.grappleDY = (dy / dist) * GRAPPLE_SPEED;
  run.grappleTarget = target;
}

function nearestRing(run, tapWorldX, tapWorldY) {
  // Prefer rings above the player, within max rope distance
  let best = null;
  let bestScore = Infinity;
  for (const ring of run.rings) {
    if (ring.y >= run.py) continue; // must be above player
    const dx = ring.x - run.px;
    const dy = ring.y - run.py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > MAX_ROPE || dist < MIN_ROPE) continue;
    // Score: prefer rings roughly in the tap direction, and close
    const tapDX = tapWorldX - run.px;
    const tapDY = tapWorldY - run.py;
    const tapLen = Math.sqrt(tapDX * tapDX + tapDY * tapDY) || 1;
    const dot = (dx / dist) * (tapDX / tapLen) + (dy / dist) * (tapDY / tapLen);
    const score = dist - dot * 150; // favor direction match + closeness
    if (score < bestScore) { bestScore = score; best = ring; }
  }
  return best;
}

function attachToRing(run, ring) {
  run.state = 'swinging';
  run.anchorX = ring.x;
  run.anchorY = ring.y;
  const dx = run.px - ring.x;
  const dy = run.py - ring.y;
  run.ropeLen = Math.min(MAX_ROPE, Math.max(MIN_ROPE, Math.sqrt(dx * dx + dy * dy)));
  // Convert current position to angle
  run.angle = Math.atan2(dx, -dy); // 0 = directly below anchor
  // Convert current velocity to angular velocity
  // vx = L*cos(θ)*θ', vy = L*sin(θ)*θ'  → θ' = (vx*cos(θ) + vy*sin(θ)) / L
  run.angleVel = (run.vx * Math.cos(run.angle) + run.vy * Math.sin(run.angle)) / run.ropeLen;
  run.vx = 0; run.vy = 0;
}

function detach(run) {
  if (run.state !== 'swinging') return;
  // vx = L*cos(θ)*θ', vy = L*sin(θ)*θ'
  run.vx = run.angleVel * run.ropeLen * Math.cos(run.angle);
  run.vy = run.angleVel * run.ropeLen * Math.sin(run.angle);
  run.state = 'falling';
}

// ── Physics step ───────────────────────────────────────────────────────

function stepPhysics(run, canvasWidth, canvasHeight) {
  if (run.dead) return;

  switch (run.state) {
    case 'falling':
      stepFalling(run, canvasWidth, canvasHeight);
      break;
    case 'firing':
      stepFiring(run, canvasWidth, canvasHeight);
      break;
    case 'swinging':
      stepSwinging(run, canvasWidth, canvasHeight);
      break;
  }

  // Check pickups
  for (const p of run.pickups) {
    if (p.collected) continue;
    const dx = run.px - p.x, dy = run.py - p.y;
    if (Math.sqrt(dx * dx + dy * dy) < PLAYER_RADIUS + PICKUP_RADIUS) {
      p.collected = true;
      run.ropeUses = Math.min(run.ropeUses + 2, MAX_ROPE_USES + 2);
    }
  }

  // Track max distance
  if (run.px > run.maxX) run.maxX = run.px;

  // Death: fall below floor or go too far left
  if (run.py > run.floorY + PLAYER_RADIUS * 2) {
    run.dead = true;
  }
  // Death: stuck swinging with no rope uses left (can never progress)
  if (run.state === 'swinging' && run.ropeUses <= 0 &&
      Math.abs(run.angleVel) < 0.003) {
    run.dead = true;
  }
}

function stepFalling(run, canvasWidth, canvasHeight) {
  run.vy += GRAVITY;
  run.px += run.vx;
  run.py += run.vy;
  // Clamp to floor
  if (run.py >= run.floorY - PLAYER_RADIUS) {
    run.py = run.floorY - PLAYER_RADIUS;
    run.vy = 0;
    run.vx *= 0.85; // friction on ground
    if (run.ropeUses <= 0 && Math.abs(run.vx) < 0.5) {
      run.dead = true; // stopped with no rope
    }
  }
  // Prevent sliding backward past start
  if (run.px < 80) {
    run.px = 80;
    run.vx = Math.max(0, run.vx);
  }
}

function stepFiring(run, canvasWidth, canvasHeight) {
  // Player continues as projectile while grapple flies
  run.vy += GRAVITY;
  run.px += run.vx;
  run.py += run.vy;
  if (run.py >= run.floorY - PLAYER_RADIUS) {
    run.py = run.floorY - PLAYER_RADIUS;
    run.vy = 0;
    // Don't cancel grapple — let it keep flying even when player is on ground
  }

  // Prevent sliding backward past start
  if (run.px < 80) {
    run.px = 80;
    run.vx = Math.max(0, run.vx);
  }

  // Move grapple projectile
  run.grappleX += run.grappleDX;
  run.grappleY += run.grappleDY;

  // Check proximity to any ring (gamepad mode: no specific target)
  const hitR = RING_RADIUS + 8;
  for (const ring of run.rings) {
    const dx = run.grappleX - ring.x;
    const dy = run.grappleY - ring.y;
    if (Math.sqrt(dx * dx + dy * dy) < hitR) {
      attachToRing(run, ring);
      return;
    }
  }
  // Legacy: also check explicit target (combined.html tap mode)
  const t = run.grappleTarget;
  if (t) {
    const dx = run.grappleX - t.x;
    const dy = run.grappleY - t.y;
    if (Math.sqrt(dx * dx + dy * dy) < RING_RADIUS + 4) {
      attachToRing(run, t);
      return;
    }
  }

  // Cancel if grapple goes too far from player
  const gdx = run.grappleX - run.px;
  const gdy = run.grappleY - run.py;
  if (Math.sqrt(gdx * gdx + gdy * gdy) > MAX_ROPE * 1.2) {
    run.state = 'falling';
  }
}

function stepSwinging(run, canvasWidth, canvasHeight) {
  // Pendulum physics: α = -(g/L) * sin(θ)
  // angle=0 → directly below anchor
  const angularGravity = (GRAVITY / run.ropeLen) * Math.sin(run.angle);
  run.angleVel -= angularGravity;
  run.angleVel *= DAMPING;
  run.angle += run.angleVel;

  // Update player position from angle
  // angle=0 → below anchor: px=anchorX, py=anchorY+ropeLen
  run.px = run.anchorX + Math.sin(run.angle) * run.ropeLen;
  run.py = run.anchorY - Math.cos(run.angle) * run.ropeLen;

  // Auto-detach if touching floor
  if (run.py >= run.floorY - PLAYER_RADIUS) {
    run.py = run.floorY - PLAYER_RADIUS;
    detach(run);
    run.vy = 0;
    run.vx *= 0.85;
    run.state = 'falling';
  }
}

// ── Camera ─────────────────────────────────────────────────────────────

function getCameraX(run, canvasWidth) {
  // Keep player at ~35% from left
  return Math.max(0, run.px - canvasWidth * 0.35);
}
