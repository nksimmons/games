// =====================================================================
// LITTER RUN — Game Engine
// =====================================================================
// The cat just used the litter box and has the ZOOMIES.
// One player at a time controls a laser pointer (lure) to try to
// redirect the cat away from breakable household objects.
// Less property damage = better score.
// =====================================================================

const WORLD_W = 800;   // logical canvas width
const WORLD_H = 560;   // logical canvas height
const WALL_L  = 16;    // left boundary
const WALL_R  = WORLD_W - 16;
const WALL_T  = 16;
const WALL_B  = WORLD_H - 16;

const CAT_RADIUS      = 18;    // px — collision radius
const CAT_SPEED_BASE  = 220;   // px/s — normal zoomies
const CAT_SPEED_BURST = 380;   // px/s — panic/escape burst
const LURE_SPEED      = 280;   // px/s — how fast the laser dot moves
const LURE_ATTRACT_R  = 230;   // px — range within which cat can notice lure
const RUN_DURATION    = 60;    // seconds per player's turn

// ── Litter box (cat starting position) ───────────────────────────────
const LITTER_X = 745;
const LITTER_Y = 495;

// ── House objects (all in logical px coords) ─────────────────────────
// r = hit radius. Objects are destroyed when cat center comes within
// (CAT_RADIUS + r) of the object center.
const HOUSE_OBJECTS = [
  { id: 'tv',         x: 125, y: 215, r: 40, damage: 800,  emoji: '📺', label: 'TV'              },
  { id: 'laptop',     x: 370, y: 295, r: 28, damage: 1200, emoji: '💻', label: 'Laptop'           },
  { id: 'lamp',       x:  68, y: 108, r: 20, damage: 150,  emoji: '🪔', label: 'Lamp'             },
  { id: 'vase',       x: 690, y:  88, r: 18, damage: 200,  emoji: '🏺', label: 'Vase'             },
  { id: 'plant1',     x: 715, y: 445, r: 24, damage:  75,  emoji: '🪴', label: 'Plant'            },
  { id: 'plant2',     x:  88, y: 415, r: 20, damage:  75,  emoji: '🪴', label: 'Plant'            },
  { id: 'bookshelf',  x: 698, y: 228, r: 34, damage: 350,  emoji: '📚', label: 'Bookshelf'        },
  { id: 'frame',      x: 310, y:  62, r: 20, damage:  80,  emoji: '🖼️', label: 'Picture Frame'    },
  { id: 'glass',      x: 510, y: 138, r: 14, damage:  45,  emoji: '🥂', label: 'Wine Glass'       },
  { id: 'mug',        x: 248, y: 455, r: 14, damage:  15,  emoji: '☕', label: 'Coffee Mug'       },
  { id: 'controller', x: 182, y: 398, r: 18, damage:  60,  emoji: '🎮', label: 'Controller'       },
  { id: 'dish',       x: 558, y: 335, r: 22, damage: 500,  emoji: '🍽️', label: "Mom's Dish"       },
];

// ── Run state factory ─────────────────────────────────────────────────
function freshRun() {
  // Start the cat at the litter box, heading roughly toward the middle of the house
  const angle = Math.PI + (Math.random() - 0.5) * 1.4;
  const spd   = CAT_SPEED_BASE;
  return {
    cat: {
      x: LITTER_X,
      y: LITTER_Y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      speed: spd,
      state: 'zooming',     // 'zooming' | 'chasing'
      nextChaosIn: 0.4 + Math.random() * 0.6,  // sec until next random direction change
      lureCooldown: 0,      // ignore lure for this many seconds (post-escape)
    },
    lure: {
      x: WORLD_W / 2,
      y: WORLD_H / 2,
    },
    objects: HOUSE_OBJECTS.map(o => ({ ...o, broken: false })),
    damage:      0,
    timeLeft:    RUN_DURATION,
    popups:      [],   // { x, y, text, age, maxAge, vy }
    lastBroken:  null, // { label, damage } — consumed after one broadcast
    damageLog:   [],   // { label, damage } ordered
    dead:        false,
  };
}

// ── Physics step ──────────────────────────────────────────────────────
// lureDx, lureDy are normalized joystick values in [-1, 1]
function stepRun(run, dt, lureDx, lureDy) {
  if (run.dead) return;

  // Tick timer
  run.timeLeft -= dt;
  if (run.timeLeft <= 0) {
    run.timeLeft = 0;
    run.dead = true;
    return;
  }

  const cat  = run.cat;
  const lure = run.lure;

  // ── Move lure ────────────────────────────────────────────────────
  const mag = Math.hypot(lureDx, lureDy);
  if (mag > 0.01) {
    const nx = lureDx / Math.max(mag, 1);
    const ny = lureDy / Math.max(mag, 1);
    lure.x = clamp(lure.x + nx * LURE_SPEED * dt, WALL_L + 12, WALL_R - 12);
    lure.y = clamp(lure.y + ny * LURE_SPEED * dt, WALL_T + 12, WALL_B - 12);
  }

  // ── Cat AI timers ─────────────────────────────────────────────────
  cat.nextChaosIn  -= dt;
  cat.lureCooldown  = Math.max(0, cat.lureCooldown - dt);

  const dx2lure  = lure.x - cat.x;
  const dy2lure  = lure.y - cat.y;
  const distLure = Math.hypot(dx2lure, dy2lure);

  if (cat.state === 'zooming') {
    // Random direction change (chaos timer)
    if (cat.nextChaosIn <= 0) {
      const a    = Math.random() * Math.PI * 2;
      const burst = Math.random() < 0.3;
      cat.speed = burst ? CAT_SPEED_BURST : CAT_SPEED_BASE + Math.random() * 60;
      cat.vx = Math.cos(a) * cat.speed;
      cat.vy = Math.sin(a) * cat.speed;
      cat.nextChaosIn = 1.0 + Math.random() * 1.5;
    }
    // Notice lure? (60%/sec chance when within range)
    if (cat.lureCooldown <= 0 && distLure < LURE_ATTRACT_R) {
      if (Math.random() < 0.60 * dt) {
        cat.state = 'chasing';
      }
    }

  } else { // 'chasing'
    // Steer toward lure
    const curAngle    = Math.atan2(cat.vy, cat.vx);
    const targetAngle = Math.atan2(dy2lure, dx2lure);
    let dA = targetAngle - curAngle;
    // Wrap to [-π, π]
    if (dA >  Math.PI) dA -= Math.PI * 2;
    if (dA < -Math.PI) dA += Math.PI * 2;
    const rotRate = 3.0 * dt;
    const newAngle = curAngle + Math.sign(dA) * Math.min(Math.abs(dA), rotRate);
    cat.vx = Math.cos(newAngle) * cat.speed;
    cat.vy = Math.sin(newAngle) * cat.speed;

    // Reached lure → escape burst
    if (distLure < 40) {
      cat.state = 'zooming';
      cat.lureCooldown = 1.2 + Math.random() * 0.8;
      cat.speed = CAT_SPEED_BURST;
      const esc = Math.atan2(cat.y - lure.y, cat.x - lure.x) + (Math.random() - 0.5) * 1.2;
      cat.vx = Math.cos(esc) * cat.speed;
      cat.vy = Math.sin(esc) * cat.speed;
      cat.nextChaosIn = 0.6 + Math.random() * 0.8;
    }

    // Random give-up (35%/sec)
    if (Math.random() < 0.35 * dt) {
      cat.state = 'zooming';
      cat.nextChaosIn = 0.2 + Math.random() * 0.4;
    }
  }

  // ── Move cat ──────────────────────────────────────────────────────
  cat.x += cat.vx * dt;
  cat.y += cat.vy * dt;

  // ── Wall bounces ──────────────────────────────────────────────────
  if (cat.x < WALL_L + CAT_RADIUS) {
    cat.x = WALL_L + CAT_RADIUS;
    cat.vx = Math.abs(cat.vx);
    cat.nextChaosIn = Math.min(cat.nextChaosIn, 0.15);
  }
  if (cat.x > WALL_R - CAT_RADIUS) {
    cat.x = WALL_R - CAT_RADIUS;
    cat.vx = -Math.abs(cat.vx);
    cat.nextChaosIn = Math.min(cat.nextChaosIn, 0.15);
  }
  if (cat.y < WALL_T + CAT_RADIUS) {
    cat.y = WALL_T + CAT_RADIUS;
    cat.vy = Math.abs(cat.vy);
    cat.nextChaosIn = Math.min(cat.nextChaosIn, 0.15);
  }
  if (cat.y > WALL_B - CAT_RADIUS) {
    cat.y = WALL_B - CAT_RADIUS;
    cat.vy = -Math.abs(cat.vy);
    cat.nextChaosIn = Math.min(cat.nextChaosIn, 0.15);
  }

  // ── Object collision ──────────────────────────────────────────────
  for (const obj of run.objects) {
    if (obj.broken) continue;
    const dist = Math.hypot(cat.x - obj.x, cat.y - obj.y);
    if (dist < CAT_RADIUS + obj.r) {
      obj.broken = true;
      run.damage += obj.damage;
      run.lastBroken = { label: obj.label, damage: obj.damage };
      run.damageLog.push({ label: obj.label, damage: obj.damage });

      // Floating damage popup
      run.popups.push({
        x: obj.x, y: obj.y,
        text: `-$${obj.damage}`,
        age: 0, maxAge: 2.2,
        vy: -55,
      });

      // Bounce cat away from object
      const bx = cat.x - obj.x;
      const by = cat.y - obj.y;
      const bd = Math.hypot(bx, by) || 1;
      cat.speed = Math.min(cat.speed * 1.15, CAT_SPEED_BURST);
      cat.vx = (bx / bd) * cat.speed;
      cat.vy = (by / bd) * cat.speed;
      cat.state = 'zooming';
      cat.nextChaosIn = 0.25 + Math.random() * 0.5;
    }
  }

  // ── Age & float popups ────────────────────────────────────────────
  run.popups = run.popups.filter(p => {
    p.age += dt;
    p.y   += p.vy * dt;
    p.vy  *= 0.92;          // decelerate
    return p.age < p.maxAge;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
