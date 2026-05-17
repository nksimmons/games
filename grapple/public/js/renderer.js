// =====================================================================
// GRAPPLE AND GO — Renderer  (mine tunnel edition)
// =====================================================================

// Mine color palette
const BG_ROCK        = '#1c1610';  // very dark brown — tunnel walls
const BG_DEEP        = '#120e09';  // deeper background
const CEIL_COLOR     = '#3d2e1e';  // ceiling rock face
const CEIL_EDGE      = '#5a4228';  // bright edge of ceiling (cave roof)
const FLOOR_COLOR    = '#2a1f11';  // floor rock
const FLOOR_EDGE     = '#4a3520';  // floor top edge
const TUNNEL_BG      = '#0f0c08';  // tunnel interior background
const ROPE_COLOR     = '#d4b896';  // hemp/manila rope
const HOOK_COLOR     = '#b0b8c0';  // metal hook
const LANTERN_COLOR  = '#ffb347';
const SPIKE_COLOR    = '#8a9caa';  // cold steel spikes
const SPIKE_TIP      = '#d0dde6';
const LAVA_COLOR     = '#ff4400';  // molten lava
const LAVA_HOT       = '#ffaa00';

// ── Main draw function ─────────────────────────────────────────────────
function drawWorld(ctx, run, cameraX, canvasWidth, canvasHeight, playerColor, playerSprite) {
  // 1. Fill the tunnel interior
  ctx.fillStyle = TUNNEL_BG;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // 2. Draw parallax rock background (before tunnel cutout)
  drawParallax(ctx, cameraX, canvasWidth, canvasHeight);

  // 3. Draw floor and ceiling as solid rock shapes
  drawTunnel(ctx, run, cameraX, canvasWidth, canvasHeight);

  // 4. Distance markers
  const ceilMid = canvasHeight * 0.44;
  drawDistanceMarkers(ctx, cameraX, canvasWidth, ceilMid);

  // 5. Hazards (spikes and lava on the floor)
  drawHazards(ctx, run, cameraX, canvasWidth, canvasHeight);

  // 6. Rope / grapple line
  if (run.state === 'reeling') {
    const ax = run.anchorX - cameraX;
    ctx.beginPath();
    ctx.moveTo(ax, run.anchorY);
    ctx.lineTo(run.px - cameraX, run.py);
    ctx.strokeStyle = ROPE_COLOR;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.stroke();
    // Hook tip where rope meets ceiling
    ctx.beginPath();
    ctx.arc(ax, run.anchorY, 5, 0, Math.PI * 2);
    ctx.fillStyle = HOOK_COLOR;
    ctx.fill();
  } else if (run.state === 'firing') {
    const gx = run.grappleX - cameraX;
    ctx.beginPath();
    ctx.moveTo(run.px - cameraX, run.py);
    ctx.lineTo(gx, run.grappleY);
    ctx.strokeStyle = ROPE_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Hook tip
    ctx.beginPath();
    ctx.arc(gx, run.grappleY, 5, 0, Math.PI * 2);
    ctx.fillStyle = HOOK_COLOR;
    ctx.fill();
  }

  // 8. Aim indicator (while falling/free)
  if ((run.state === 'falling' || run.state === 'firing') &&
      typeof run.aimAngle === 'number') {
    const px2 = run.px - cameraX;
    const aimLen = 180;
    const ex = px2 + Math.cos(run.aimAngle) * aimLen;
    const ey = run.py + Math.sin(run.aimAngle) * aimLen;
    ctx.beginPath();
    ctx.moveTo(px2, run.py);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(ex, ey, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
  }

  // 9. Player
  drawPlayer(ctx, run.px - cameraX, run.py, playerColor, run.dead, playerSprite);

  // 10. Swing hint: semi-transparent arrows when hanging with little momentum
  if (run.state === 'reeling' && Math.abs(run.angleVel) < 0.04) {
    drawSwingHint(ctx, canvasWidth, canvasHeight);
  }

  // 11. HUD
  drawHUD(ctx, run, canvasWidth);
}

// ── Tunnel drawing ─────────────────────────────────────────────────────
function drawTunnel(ctx, run, cameraX, canvasWidth, canvasHeight) {
  const ceilVerts  = run.ceilVerts;
  const floorVerts = run.floorVerts;
  if (!ceilVerts || ceilVerts.length < 2) return;

  // Clamp x range to what's visible (+ margin)
  const xMin = cameraX - 100;
  const xMax = cameraX + canvasWidth + 100;

  // --- CEILING (solid rock above) ---
  ctx.beginPath();
  ctx.moveTo(-200, 0);  // top-left corner of canvas (above everything)
  ctx.lineTo(canvasWidth + 200, 0);
  // Walk ceiling verts right-to-left across visible range
  const visC = ceilVerts.filter(v => v.x >= xMin && v.x <= xMax);
  if (visC.length > 0) {
    // Connect from right edge
    ctx.lineTo(visC[visC.length - 1].x - cameraX, visC[visC.length - 1].yFrac * canvasHeight);
    for (let i = visC.length - 2; i >= 0; i--) {
      ctx.lineTo(visC[i].x - cameraX, visC[i].yFrac * canvasHeight);
    }
  }
  ctx.lineTo(-200, 0);
  ctx.closePath();
  ctx.fillStyle = CEIL_COLOR;
  ctx.fill();

  // Bright lower edge of ceiling
  if (visC.length > 1) {
    ctx.beginPath();
    ctx.moveTo(visC[0].x - cameraX, visC[0].yFrac * canvasHeight);
    for (let i = 1; i < visC.length; i++) {
      ctx.lineTo(visC[i].x - cameraX, visC[i].yFrac * canvasHeight);
    }
    ctx.strokeStyle = CEIL_EDGE;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // --- FLOOR (solid rock below) ---
  const visF = floorVerts.filter(v => v.x >= xMin && v.x <= xMax);
  if (visF.length > 0) {
    ctx.beginPath();
    ctx.moveTo(visF[0].x - cameraX, visF[0].yFrac * canvasHeight);
    for (let i = 1; i < visF.length; i++) {
      ctx.lineTo(visF[i].x - cameraX, visF[i].yFrac * canvasHeight);
    }
    ctx.lineTo(canvasWidth + 200, canvasHeight + 50);
    ctx.lineTo(-200, canvasHeight + 50);
    ctx.closePath();
    ctx.fillStyle = FLOOR_COLOR;
    ctx.fill();

    // Bright top edge of floor
    ctx.beginPath();
    ctx.moveTo(visF[0].x - cameraX, visF[0].yFrac * canvasHeight);
    for (let i = 1; i < visF.length; i++) {
      ctx.lineTo(visF[i].x - cameraX, visF[i].yFrac * canvasHeight);
    }
    ctx.strokeStyle = FLOOR_EDGE;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Rock texture: scattered pebbles/cracks on ceiling and floor
  drawRockDetail(ctx, cameraX, canvasWidth, canvasHeight, ceilVerts, floorVerts);
}

function drawRockDetail(ctx, cameraX, canvasWidth, canvasHeight, ceilVerts, floorVerts) {
  // Small lanterns hanging from ceiling every ~350px
  const spacing = 350;
  const first = Math.floor(cameraX / spacing) * spacing;
  for (let lx = first; lx < cameraX + canvasWidth + spacing; lx += spacing) {
    const sx = lx - cameraX;
    const cy = _tunnelYFromVerts(ceilVerts, lx, canvasHeight);
    drawLantern(ctx, sx, cy);
  }
}

function _tunnelYFromVerts(verts, worldX, canvasHeight) {
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

function drawLantern(ctx, sx, cy) {
  const flicker = 0.85 + Math.sin(Date.now() / 300 + sx) * 0.15;
  const alpha   = 0.55 * flicker;
  // Chain
  ctx.strokeStyle = `rgba(140,120,80,0.7)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, cy);
  ctx.lineTo(sx, cy + 22);
  ctx.stroke();
  // Lantern body
  ctx.fillStyle = `rgba(120,80,20,0.9)`;
  ctx.fillRect(sx - 7, cy + 22, 14, 18);
  // Glow
  const grd = ctx.createRadialGradient(sx, cy + 31, 4, sx, cy + 31, 70);
  grd.addColorStop(0, `rgba(255,180,60,${alpha})`);
  grd.addColorStop(1, 'rgba(255,180,60,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(sx, cy + 31, 70, 0, Math.PI * 2);
  ctx.fill();
  // Light source dot
  ctx.fillStyle = `rgba(255,220,100,${0.9 * flicker})`;
  ctx.beginPath();
  ctx.arc(sx, cy + 31, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawParallax(ctx, cameraX, canvasWidth, canvasHeight) {
  // Subtle deep-rock layers parallax
  const offset1 = (cameraX * 0.05) % canvasWidth;
  ctx.fillStyle = '#1a1208';
  for (let i = -1; i <= 2; i++) {
    const bx = i * canvasWidth - offset1;
    ctx.beginPath();
    ctx.moveTo(bx, canvasHeight * 0.1);
    ctx.lineTo(bx + canvasWidth * 0.3, canvasHeight * 0.18);
    ctx.lineTo(bx + canvasWidth * 0.55, canvasHeight * 0.09);
    ctx.lineTo(bx + canvasWidth * 0.8, canvasHeight * 0.16);
    ctx.lineTo(bx + canvasWidth, canvasHeight * 0.11);
    ctx.lineTo(bx + canvasWidth, canvasHeight * 0.85);
    ctx.lineTo(bx + canvasWidth * 0.7, canvasHeight * 0.78);
    ctx.lineTo(bx + canvasWidth * 0.4, canvasHeight * 0.84);
    ctx.lineTo(bx + canvasWidth * 0.15, canvasHeight * 0.79);
    ctx.lineTo(bx, canvasHeight * 0.83);
    ctx.closePath();
    ctx.fill();
  }
}

function drawDistanceMarkers(ctx, cameraX, canvasWidth, midY) {
  const step = 400;
  const first = Math.floor(cameraX / step) * step;
  ctx.textAlign = 'center';
  ctx.font = '11px monospace';
  for (let x = first; x < cameraX + canvasWidth + step; x += step) {
    const sx = x - cameraX;
    const meters = Math.round(x / 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, canvasHeight);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillText(`${meters}m`, sx, midY);
  }
}

function drawBolt() { /* removed — grapple attaches to ceiling surface directly */ }
function drawPickup() { /* removed — pickups replaced by hazards */ }

function drawPlayer(ctx, sx, sy, color, dead, sprite) {
  ctx.globalAlpha = dead ? 0.45 : 1.0;
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    const sz = PLAYER_RADIUS * 2.6;
    ctx.drawImage(sprite, sx - sz / 2, sy - sz / 2, sz, sz);
    ctx.globalAlpha = 1;
    return;
  }
  // Default circle character
  // Shadow on floor
  ctx.beginPath();
  ctx.ellipse(sx, sy + PLAYER_RADIUS - 2, PLAYER_RADIUS * 0.7, PLAYER_RADIUS * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();
  // Body
  ctx.beginPath();
  ctx.arc(sx, sy, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Eyes
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(sx - 5, sy - 4, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx + 5, sy - 4, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(sx - 4, sy - 4, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(sx + 6, sy - 4, 2, 0, Math.PI * 2); ctx.fill();
  // Helmet light
  ctx.fillStyle = `rgba(255,230,100,0.9)`;
  ctx.beginPath();
  ctx.arc(sx, sy - PLAYER_RADIUS + 4, 4, 0, Math.PI * 2);
  ctx.fill();
  const hgrd = ctx.createRadialGradient(sx, sy - PLAYER_RADIUS + 4, 2, sx, sy - PLAYER_RADIUS + 4, 40);
  hgrd.addColorStop(0, 'rgba(255,230,100,0.3)');
  hgrd.addColorStop(1, 'rgba(255,230,100,0)');
  ctx.fillStyle = hgrd;
  ctx.beginPath();
  ctx.arc(sx, sy - PLAYER_RADIUS + 4, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawSwingHint(ctx, canvasWidth, canvasHeight) {
  const midY = canvasHeight * 0.5;
  const alpha = 0.18 + 0.07 * Math.sin(Date.now() / 400);
  // Left arrow zone
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.font = 'bold 40px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('◀', canvasWidth * 0.15, midY);
  // Right arrow zone
  ctx.fillText('▶', canvasWidth * 0.85, midY);
  ctx.textAlign = 'left';
}

function drawHazards(ctx, run, cameraX, canvasWidth, canvasHeight) {
  const now = Date.now();
  for (const h of run.hazards) {
    const sx = h.x - cameraX;
    if (sx < -h.width - 20 || sx > canvasWidth + h.width + 20) continue;
    const fy = _tunnelYFromVerts(run.floorVerts, h.x, canvasHeight);
    if (h.type === 'spike') {
      drawSpikes(ctx, sx, fy, h.width);
    } else {
      drawLava(ctx, sx, fy, h.width, now);
    }
  }
}

function drawSpikes(ctx, sx, fy, totalWidth) {
  const count = Math.max(3, Math.round(totalWidth / 10));
  const pitch = totalWidth / count;
  const left  = sx - totalWidth / 2;
  ctx.fillStyle = SPIKE_COLOR;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const tx = left + i * pitch + pitch / 2;
    ctx.moveTo(tx - pitch * 0.45, fy);
    ctx.lineTo(tx, fy - SPIKE_HEIGHT);
    ctx.lineTo(tx + pitch * 0.45, fy);
  }
  ctx.closePath();
  ctx.fill();
  // Bright tips
  ctx.strokeStyle = SPIKE_TIP;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    const tx = left + i * pitch + pitch / 2;
    ctx.beginPath();
    ctx.moveTo(tx - 2, fy - SPIKE_HEIGHT + 5);
    ctx.lineTo(tx, fy - SPIKE_HEIGHT);
    ctx.lineTo(tx + 2, fy - SPIKE_HEIGHT + 5);
    ctx.stroke();
  }
}

function drawLava(ctx, sx, fy, totalWidth, now) {
  const left = sx - totalWidth / 2;
  const pulse = 0.7 + 0.3 * Math.sin(now / 400);
  // Outer glow
  const grd = ctx.createLinearGradient(sx, fy - LAVA_HEIGHT - 20, sx, fy);
  grd.addColorStop(0, 'rgba(255,100,0,0)');
  grd.addColorStop(0.5, `rgba(255,100,0,${0.35 * pulse})`);
  grd.addColorStop(1, `rgba(255,68,0,${0.6 * pulse})`);
  ctx.fillStyle = grd;
  ctx.fillRect(left - 10, fy - LAVA_HEIGHT - 20, totalWidth + 20, LAVA_HEIGHT + 20);
  // Lava surface
  ctx.fillStyle = LAVA_COLOR;
  ctx.fillRect(left, fy - LAVA_HEIGHT, totalWidth, LAVA_HEIGHT);
  // Hot bright stripe on top
  ctx.fillStyle = LAVA_HOT;
  ctx.fillRect(left, fy - LAVA_HEIGHT, totalWidth, 4);
  // Bubbles
  for (let i = 0; i < 3; i++) {
    const bx = left + (i + 0.5) * (totalWidth / 3);
    const br = 3 + 2 * Math.sin(now / 300 + i * 2.1);
    const by = fy - LAVA_HEIGHT - br + 2 * Math.sin(now / 250 + i);
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = LAVA_HOT;
    ctx.fill();
  }
}

function drawHUD(ctx, run, canvasWidth) {
  // Distance readout
  const dist = Math.round(run.maxX / 10);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${dist}m`, canvasWidth - 12, 24);
}
