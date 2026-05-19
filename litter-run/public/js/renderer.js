// =====================================================================
// LITTER RUN — Renderer
// =====================================================================
// Draws the house top-down view on the host canvas.
// All coordinates are in logical WORLD_W × WORLD_H space;
// the renderer scales to fit the actual canvas size.
// =====================================================================

// ── Color palette ─────────────────────────────────────────────────────
const COL_FLOOR         = '#c8a97e';
const COL_FLOOR_DARK    = '#b8965c';
const COL_WALL          = '#6b4b28';
const COL_WALL_INNER    = '#8b6238';
const COL_KITCHEN_FLOOR = '#b8d4c0';
const COL_LITTERBOX     = '#d4bfa0';
const COL_LITTERBOX_DK  = '#b8a080';
const COL_CAT_BODY      = '#f4845f';
const COL_CAT_BELLY     = '#ffd6a5';
const COL_CAT_EAR_INNER = '#f8b4c8';

// ── Main draw ─────────────────────────────────────────────────────────
function drawScene(ctx, run, W, H, lureColor) {
  ctx.save();

  // Letterbox: maintain 800×560 aspect, centered
  const scaleX = W / WORLD_W;
  const scaleY = H / WORLD_H;
  const s = Math.min(scaleX, scaleY);
  const ox = (W - WORLD_W * s) / 2;
  const oy = (H - WORLD_H * s) / 2;

  ctx.translate(ox, oy);
  ctx.scale(s, s);

  _drawFloor(ctx);
  _drawObjects(ctx, run.objects);
  _drawLure(ctx, run.lure, lureColor || '#ff2244');
  _drawCat(ctx, run.cat);
  _drawPopups(ctx, run.popups);
  _drawTimerBar(ctx, run.timeLeft);

  ctx.restore();
}

// ── Floor & rooms ─────────────────────────────────────────────────────
function _drawFloor(ctx) {
  // Main floor — wood plank look
  ctx.fillStyle = COL_FLOOR;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Subtle plank lines
  ctx.strokeStyle = COL_FLOOR_DARK;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.35;
  for (let y = 40; y < WORLD_H; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Kitchen zone (top-left)
  ctx.fillStyle = COL_KITCHEN_FLOOR;
  ctx.globalAlpha = 0.42;
  ctx.fillRect(WALL_L, WALL_T, 390, 180);
  ctx.globalAlpha = 1;

  // Kitchen zone label
  ctx.font = '700 13px system-ui';
  ctx.fillStyle = '#5a8a70';
  ctx.globalAlpha = 0.6;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('KITCHEN', WALL_L + 10, WALL_T + 8);
  ctx.globalAlpha = 1;

  // Litter box alcove (bottom-right)
  ctx.fillStyle = COL_LITTERBOX;
  ctx.beginPath();
  _roundRect(ctx, 650, 425, 138, 120, 10);
  ctx.fill();
  ctx.strokeStyle = COL_LITTERBOX_DK;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Litter box sand texture (dots)
  ctx.fillStyle = COL_LITTERBOX_DK;
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 18; i++) {
    const px = 660 + (i % 6) * 20 + (Math.floor(i / 6) % 2) * 10;
    const py = 440 + Math.floor(i / 6) * 26;
    ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Litter box outline & label
  ctx.font = '600 11px system-ui';
  ctx.fillStyle = '#8a6040';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('🚽 LITTER BOX', WORLD_W - 81, WORLD_H - WALL_T - 4);

  // Outer walls
  ctx.strokeStyle = COL_WALL;
  ctx.lineWidth = 18;
  ctx.lineJoin = 'round';
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

  // Inner wall edge (lighter trim)
  ctx.strokeStyle = COL_WALL_INNER;
  ctx.lineWidth = 4;
  ctx.strokeRect(WALL_L - 3, WALL_T - 3, WORLD_W - (WALL_L - 3) * 2, WORLD_H - (WALL_T - 3) * 2);

  // Reset text baseline
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign    = 'left';
}

// ── Objects ───────────────────────────────────────────────────────────
function _drawObjects(ctx, objects) {
  for (const obj of objects) {
    ctx.save();
    ctx.translate(obj.x, obj.y);

    if (obj.broken) {
      // Knocked over: tilted, faded, debris marks
      ctx.globalAlpha = 0.5;
      ctx.rotate(0.55);
      ctx.font = `${_emojiSize(obj.r)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(obj.emoji, 0, 0);
      ctx.globalAlpha = 1;

      // X marks the spot
      ctx.strokeStyle = '#cc2200';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.moveTo(-7, -7); ctx.lineTo(7, 7);
      ctx.moveTo(7, -7);  ctx.lineTo(-7, 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      ctx.beginPath();
      ctx.ellipse(4, obj.r * 0.55 + 3, obj.r * 0.85, obj.r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();

      // Emoji
      ctx.font = `${_emojiSize(obj.r)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(obj.emoji, 0, 0);

      // Dollar value label
      ctx.font = '600 10px system-ui';
      ctx.fillStyle = '#6b4b28cc';
      ctx.fillText(`$${obj.damage}`, 0, obj.r + 12);
    }

    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
}

function _emojiSize(r) { return Math.round(r * 1.55 + 8); }

// ── Lure (laser dot) ─────────────────────────────────────────────────
function _drawLure(ctx, lure, color) {
  const r = 7;

  // Outer glow
  const grd = ctx.createRadialGradient(lure.x, lure.y, 0, lure.x, lure.y, r * 4.5);
  grd.addColorStop(0,   color + 'bb');
  grd.addColorStop(0.4, color + '55');
  grd.addColorStop(1,   color + '00');
  ctx.beginPath();
  ctx.arc(lure.x, lure.y, r * 4.5, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  // Core dot
  ctx.beginPath();
  ctx.arc(lure.x, lure.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Specular highlight
  ctx.beginPath();
  ctx.arc(lure.x - 2, lure.y - 2, r * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fill();
}

// ── Cat ───────────────────────────────────────────────────────────────
function _drawCat(ctx, cat) {
  ctx.save();
  ctx.translate(cat.x, cat.y);

  const dir = Math.atan2(cat.vy, cat.vx);
  ctx.rotate(dir + Math.PI / 2); // top of sprite faces direction of travel

  const r = CAT_RADIUS;

  // ── Tail ──
  ctx.save();
  ctx.translate(0, r * 0.7);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-r * 1.3, r * 1.5, r * 0.9, r * 2.4, 0, r * 3.1);
  ctx.strokeStyle = COL_CAT_BODY;
  ctx.lineWidth = r * 0.52;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  // ── Body shadow ──
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.beginPath();
  ctx.ellipse(3, 5, r * 1.1, r * 0.65, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Body ──
  ctx.fillStyle = COL_CAT_BODY;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 1.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Belly ──
  ctx.fillStyle = COL_CAT_BELLY;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.18, r * 0.56, r * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Head ──
  ctx.fillStyle = COL_CAT_BODY;
  ctx.beginPath();
  ctx.arc(0, -r, r * 0.72, 0, Math.PI * 2);
  ctx.fill();

  // ── Ears ──
  _catEar(ctx, -r * 0.42, -r * 1.6, -0.4);
  _catEar(ctx,  r * 0.42, -r * 1.6,  0.4);

  // ── Eyes ──
  ctx.fillStyle = '#fffde7';
  ctx.beginPath(); ctx.ellipse(-r * 0.24, -r * 1.08, r * 0.17, r * 0.21, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( r * 0.24, -r * 1.08, r * 0.17, r * 0.21, 0, 0, Math.PI * 2); ctx.fill();

  // Pupils
  ctx.fillStyle = '#1a1008';
  ctx.beginPath(); ctx.ellipse(-r * 0.24, -r * 1.08, r * 0.09, r * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( r * 0.24, -r * 1.08, r * 0.09, r * 0.14, 0, 0, Math.PI * 2); ctx.fill();

  // Eye shine
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.arc(-r * 0.19, -r * 1.13, r * 0.05, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( r * 0.29, -r * 1.13, r * 0.05, 0, Math.PI * 2); ctx.fill();

  // ── Nose ──
  ctx.fillStyle = '#e88';
  ctx.beginPath();
  ctx.moveTo(-r * 0.09, -r * 0.84);
  ctx.lineTo( r * 0.09, -r * 0.84);
  ctx.lineTo(0, -r * 0.74);
  ctx.closePath();
  ctx.fill();

  // ── Whiskers ──
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  [[-r*0.52, -r*0.82, -r*1.1, -r*0.76],
   [-r*0.52, -r*0.78, -r*1.1, -r*0.84],
   [ r*0.52, -r*0.82,  r*1.1, -r*0.76],
   [ r*0.52, -r*0.78,  r*1.1, -r*0.84]].forEach(([x1,y1,x2,y2]) => {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  });

  ctx.restore();
}

function _catEar(ctx, x, y, tilt) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.fillStyle = COL_CAT_BODY;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-6, 13);
  ctx.lineTo(6, 13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COL_CAT_EAR_INNER;
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(-3.2, 10);
  ctx.lineTo(3.2, 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Popups ────────────────────────────────────────────────────────────
function _drawPopups(ctx, popups) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of popups) {
    const alpha = 1 - p.age / p.maxAge;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 22px system-ui';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 4;
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = '#ff3311';
    ctx.fillText(p.text, p.x, p.y);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign    = 'left';
}

// ── Timer bar ─────────────────────────────────────────────────────────
function _drawTimerBar(ctx, timeLeft) {
  const frac = Math.max(0, timeLeft / RUN_DURATION);
  const bx = WALL_L;
  const by = WALL_T - 12;
  const bw = WORLD_W - WALL_L * 2;
  const bh = 8;

  // Track
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); _roundRect(ctx, bx, by, bw, bh, 4); ctx.fill();

  // Fill
  const fillColor = frac > 0.5 ? '#4caf50'
                  : frac > 0.25 ? '#ff9800'
                  : '#f44336';
  ctx.fillStyle = fillColor;
  ctx.beginPath(); _roundRect(ctx, bx, by, bw * frac, bh, 4); ctx.fill();
}

// ── Utility ───────────────────────────────────────────────────────────
function _roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
