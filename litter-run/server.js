/**
 * Litter Run — local game server
 * Serves game files over HTTP and relays player↔host messages over WebSockets.
 * No internet required — works purely on your local network.
 *
 * Usage:
 *   node server.js            (default port 3000)
 *   PORT=4000 node server.js
 *
 * Then open http://localhost:PORT/host.html on your screen,
 * and players scan the QR code or visit the URL shown.
 */
'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { WebSocketServer } = require('ws');

const PORT   = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME   = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

function getLanIp() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ── HTTP ──────────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/server-info.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(`window.SERVER_LAN_IP='${getLanIp()}';window.SERVER_PORT=${PORT};`);
  }
  const fp = path.resolve(PUBLIC, '.' + (urlPath === '/' ? '/host.html' : urlPath));
  if (!fp.startsWith(PUBLIC + path.sep) && fp !== PUBLIC) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
    res.end(data);
  });
});

// ── WebSocket relay ───────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
let hostWs  = null;
let nextCid = 1;
const players = new Map();

wss.on('connection', ws => {
  ws._role = null;
  ws._cid  = null;

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (m.t === 'host') {
      ws._role = 'host'; hostWs = ws;
      ws.send(JSON.stringify({ t: 'ready', id: 'local' }));
    } else if (m.t === 'player') {
      ws._role = 'player'; ws._cid = String(nextCid++);
      players.set(ws._cid, ws);
      if (hostWs?.readyState === 1)
        hostWs.send(JSON.stringify({ t: 'join', cid: ws._cid }));
    } else if (m.t === 'msg' && ws._role === 'player') {
      if (hostWs?.readyState === 1)
        hostWs.send(JSON.stringify({ t: 'msg', cid: ws._cid, d: m.d }));
    } else if (m.t === 'send' && ws._role === 'host') {
      const pw = players.get(m.cid);
      if (pw?.readyState === 1) pw.send(JSON.stringify({ t: 'msg', d: m.d }));
    }
  });

  ws.on('close', () => {
    if (ws._role === 'player' && ws._cid) {
      players.delete(ws._cid);
      if (hostWs?.readyState === 1)
        hostWs.send(JSON.stringify({ t: 'leave', cid: ws._cid }));
    } else if (ws._role === 'host') {
      hostWs = null;
    }
  });

  ws.on('error', () => {});
});

// ── Start ─────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  const lan = getLanIp();
  console.log('\n🐱  Litter Run — local server ready\n');
  console.log(`   Host screen : http://localhost:${PORT}/host.html`);
  console.log(`   Players join: http://${lan}:${PORT}/player.html`);
  console.log(`\n   Share that URL (or QR code) with players on the same WiFi.\n`);
});
