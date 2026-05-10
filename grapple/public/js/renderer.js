// =====================================================================
// GRAPPLE AND GO — Renderer
// =====================================================================

const STONE_COLORS = ['#e63946','#457b9d','#2a9d8f','#e9c46a','#f4a261','#264653'];
const BG_SKY    = '#1a1a2e';
const BG_FAR    = '#16213e';
const BG_MID    = '#0f3460';
const FLOOR_COLOR = '#2d6a4f';
const FLOOR_TOP   = '#40916c';
const RING_COLOR  = '#ffd166';
const RING_STROKE = '#f77f00';
const ROPE_COLOR  = '#f8edeb';
const PICKUP_COLOR = '#06d6a0';
const PICKUP_GLOW  = '#80ffdb';
const GRAPPLE_COLOR = '#ffd166';

function drawWorld(ctx, run, cameraX, canvasWidth, canvasHeight, playerColor) {
  // Sky background
  ctx.fillStyle = BG_SKY;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Parallax layers (looping bg)
  drawParallax(ctx, cameraX, canvasWidth, canvasHeight);

  // Floor
  const fy = run.floorY;
  ctx.fillStyle = FLOOR_COLOR;
  ctx.fillRect(0, fy, canvasWidth, canvasHeight - fy);
  ctx.fillStyle = FLOOR_TOP;
  ctx.fillRect(0, fy, canvasWidth, 6);

  // Distance markers
  drawDistanceMarkers(ctx, cameraX, canvasWidth, fy);

  // Rings
  for (const ring of run.rings) {
    const sx = ring.x - cameraX;
    if (sx < -40 || sx > canvasWidth + 40) continue;
    drawRing(ctx, sx, ring.y);
  }

  // Pickups
  for (const p of run.pickups) {
    if (p.collected) continue;
    const sx = p.x - cameraX;
    if (sx < -40 || sx > canvasWidth + 40) continue;
    drawPickup(ctx, sx, p.y, Date.now());
  }

  // Rope (when swinging or firing)
  if (run.state === 'swinging') {
    const ax = run.anchorX - cameraX;
    ctx.beginPath();
    ctx.moveTo(ax, run.anchorY);
    ctx.lineTo(run.px - cameraX, run.py);
    ctx.strokeStyle = ROPE_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (run.state === 'firing') {
    const ax = run.grappleX - cameraX;
    ctx.beginPath();
    ctx.moveTo(run.px - cameraX, run.py);
    ctx.lineTo(ax, run.grappleY);
    ctx.strokeStyle = GRAPPLE_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Grapple hook tip
    ctx.beginPath();
    ctx.arc(ax, run.grappleY, 5, 0, Math.PI * 2);
    ctx.fillStyle = GRAPPLE_COLOR;
    ctx.fill();
  }

  // Player
  const px = run.px - cameraX;
  drawPlayer(ctx, px, run.py, playerColor, run.dead);

  // HUD
  drawHUD(ctx, run, canvasWidth);
}

function drawParallax(ctx, cameraX, canvasWidth, canvasHeight) {
  const fy = canvasHeight * FLOOR_Y_FRAC;
  // Far mountains (slow parallax)
  const offset1 = (cameraX * 0.1) % canvasWidth;
  ctx.fillStyle = BG_FAR;
  for (let i = -1; i <= 2; i++) {
    const bx = i * canvasWidth - offset1;
    ctx.beginPath();
    ctx.moveTo(bx, fy * 0.9);
    ctx.lineTo(bx + canvasWidth * 0.15, fy * 0.45);
    ctx.lineTo(bx + canvasWidth * 0.3, fy * 0.7);
    ctx.lineTo(bx + canvasWidth * 0.45, fy * 0.3);
    ctx.lineTo(bx + canvasWidth * 0.6, fy * 0.55);
    ctx.lineTo(bx + canvasWidth * 0.75, fy * 0.35);
    ctx.lineTo(bx + canvasWidth * 0.9, fy * 0.6);
    ctx.lineTo(bx + canvasWidth, fy * 0.8);
    ctx.lineTo(bx + canvasWidth, fy);
    ctx.lineTo(bx, fy);
    ctx.closePath();
    ctx.fill();
  }
  // Near hills (faster parallax)
  const offset2 = (cameraX * 0.25) % canvasWidth;
  ctx.fillStyle = BG_MID;
  for (let i = -1; i <= 2; i++) {
    const bx = i * canvasWidth - offset2;
    ctx.beginPath();
    ctx.moveTo(bx, fy);
    ctx.bezierCurveTo(bx + canvasWidth * 0.2, fy * 0.65, bx + canvasWidth * 0.4, fy * 0.72, bx + canvasWidth * 0.5, fy * 0.60);
    ctx.bezierCurveTo(bx + canvasWidth * 0.6, fy * 0.48, bx + canvasWidth * 0.8, fy * 0.68, bx + canvasWidth, fy);
    ctx.closePath();
    ctx.fill();
  }
}

function drawDistanceMarkers(ctx, cameraX, canvasWidth, floorY) {
  const step = 400;
  const firstMarker = Math.floor(cameraX / step) * step;
  ctx.textAlign = 'center';
  ctx.font = '13px monospace';
  for (let x = firstMarker; x < cameraX + canvasWidth + step; x += step) {
    const sx = x - cameraX;
    const meters = Math.round(x / 10);
    // Vertical tick line
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, floorY);
    ctx.stroke();
    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText(`${meters}m`, sx, floorY - 8);
  }
}

function drawRing(ctx, sx, sy) {
  // Outer glow
  const grd = ctx.createRadialGradient(sx, sy, RING_RADIUS * 0.3, sx, sy, RING_RADIUS * 1.8);
  grd.addColorStop(0, 'rgba(255,209,102,0.3)');
  grd.addColorStop(1, 'rgba(255,209,102,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(sx, sy, RING_RADIUS * 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Ring donut
  ctx.beginPath();
  ctx.arc(sx, sy, RING_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = RING_STROKE;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx, sy, RING_RADIUS - 4, 0, Math.PI * 2);
  ctx.fillStyle = RING_COLOR;
  ctx.fill();
}

function drawPickup(ctx, sx, sy, now) {
  // Bobbing animation
  const bob = Math.sin(now / 500) * 5;
  const cy = sy + bob;

  // Glow
  const grd = ctx.createRadialGradient(sx, cy, 2, sx, cy, PICKUP_RADIUS * 2.5);
  grd.addColorStop(0, 'rgba(6,214,160,0.5)');
  grd.addColorStop(1, 'rgba(6,214,160,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(sx, cy, PICKUP_RADIUS * 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Diamond shape for rope pickup
  ctx.save();
  ctx.translate(sx, cy);
  ctx.rotate(now / 1200);
  ctx.beginPath();
  const outerR = PICKUP_RADIUS;
  const innerR = PICKUP_RADIUS * 0.42;
  const points = 4;
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 4;
    const r = i % 2 === 0 ? outerR : innerR;
    if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fillStyle = PICKUP_COLOR;
  ctx.fill();
  ctx.strokeStyle = PICKUP_GLOW;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(ctx, sx, sy, color, dead) {
  ctx.globalAlpha = dead ? 0.5 : 1.0;
  // Shadow
  ctx.beginPath();
  ctx.ellipse(sx, sy + PLAYER_RADIUS, PLAYER_RADIUS * 0.8, PLAYER_RADIUS * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  // Body
  ctx.beginPath();
  ctx.arc(sx, sy, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Eyes
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(sx - 6, sy - 5, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx + 6, sy - 5, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(sx - 5, sy - 5, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx + 7, sy - 5, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHUD(ctx, run, canvasWidth) {
  // Rope uses remaining
  const pips = run.ropeUses;
  const pipR = 8, gap = 24, startX = 16, pipY = 50;
  for (let i = 0; i < Math.max(pips, 0); i++) {
    ctx.beginPath();
    ctx.arc(startX + i * gap, pipY, pipR, 0, Math.PI * 2);
    ctx.fillStyle = PICKUP_COLOR;
    ctx.fill();
    ctx.strokeStyle = PICKUP_GLOW;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // Label
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '13px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('ROPE', startX, 38);

  // Distance
  const dist = Math.round(run.maxX / 10);
  ctx.textAlign = 'right';
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = 'white';
  ctx.fillText(`${dist}m`, canvasWidth - 14, 42);
  ctx.font = '12px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('DISTANCE', canvasWidth - 14, 56);
}
