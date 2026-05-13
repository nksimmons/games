// trystero-peer.js — PeerJS-compatible wrapper around Trystero (BitTorrent signaling)
// No server needed. No accounts. Works on GitHub Pages.
// Uses public BitTorrent trackers for the WebRTC handshake, then data flows peer-to-peer.
(function () {
  'use strict';

  const TRYSTERO_CDN = 'https://esm.sh/trystero/torrent';
  let _modPromise = null;

  function _load() {
    if (!_modPromise) _modPromise = import(TRYSTERO_CDN);
    return _modPromise;
  }

  function _genCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }

  class Emitter {
    constructor() { this._h = {}; }
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; }
    _fire(ev, ...a) { (this._h[ev] || []).slice().forEach(fn => fn(...a)); }
  }

  // ── Host-side connection to one player ────────────────────────────────────
  class TrysteroHostConn extends Emitter {
    constructor(peerId, sendFn) {
      super();
      this.peer = peerId;
      this._sendFn = sendFn;
      this.open = false;
    }
    send(data) { if (this.open) this._sendFn(data); }
    _open() { this.open = true; this._fire('open'); }
    _recv(data) { this._fire('data', data); }
    _close() { this.open = false; this._fire('close'); this._fire('error', new Error('peer left')); }
  }

  // ── Host peer — generates room code, accepts incoming player connections ──
  //    new TrysteroHostPeer(appId)
  //    peer.on('open', roomCode => ...)         ← room code to share in QR/URL
  //    peer.on('connection', conn => ...)        ← one per player
  //    conn.send(data) / conn.on('data', fn) / conn.on('close', fn)
  class TrysteroHostPeer extends Emitter {
    constructor(appId) {
      super();
      _load().then(mod => {
        const roomCode = _genCode();
        const room = mod.joinRoom({ appId }, roomCode);
        const [h2p] = room.makeAction('h2p');
        const [, onP2H] = room.makeAction('p2h');
        const [announce] = room.makeAction('helo');
        const conns = new Map();

        onP2H((data, fromId) => {
          const c = conns.get(fromId);
          if (c) c._recv(data);
        });

        room.onPeerJoin(peerId => {
          // Tell the new player "I am the host" so they can identify us
          announce({ isHost: true }, peerId);
          const c = new TrysteroHostConn(peerId, d => h2p(d, peerId));
          conns.set(peerId, c);
          this._fire('connection', c);
          c._open();
        });

        room.onPeerLeave(peerId => {
          const c = conns.get(peerId);
          if (c) { c._close(); conns.delete(peerId); }
        });

        this._fire('open', roomCode);
      }).catch(err => this._fire('error', err));
    }
  }

  // ── Player-side connection to the host ────────────────────────────────────
  class TrysteroPlayerConn extends Emitter {
    constructor() {
      super();
      this._sendFn = null;
      this.open = false;
    }
    send(data) { if (this.open && this._sendFn) this._sendFn(data); }
    _open(sendFn) { this._sendFn = sendFn; this.open = true; this._fire('open'); }
    _recv(data) { this._fire('data', data); }
    _close() { this.open = false; this._fire('close'); this._fire('error', new Error('host left')); }
  }

  // ── Player peer — fires 'open' when ready, then call connect(roomCode) ────
  //    new TrysteroPlayerPeer(appId)
  //    peer.on('open', () => { conn = peer.connect(roomCode); ... })
  //    conn.on('open', fn) / conn.on('data', fn) / conn.on('close', fn) / conn.send(data)
  class TrysteroPlayerPeer extends Emitter {
    constructor(appId) {
      super();
      this._appId = appId;
      this._mod = null;
      _load().then(mod => {
        this._mod = mod;
        this._fire('open');
      }).catch(err => this._fire('error', err));
    }

    connect(roomCode) {
      const conn = new TrysteroPlayerConn();
      if (!this._mod) {
        // shouldn't happen if called from 'open' handler, but be safe
        _load().then(mod => { this._mod = mod; this._doConnect(roomCode, conn); });
      } else {
        this._doConnect(roomCode, conn);
      }
      return conn;
    }

    _doConnect(roomCode, conn) {
      const room = this._mod.joinRoom({ appId: this._appId }, roomCode);
      const [p2h] = room.makeAction('p2h');
      const [, onH2P] = room.makeAction('h2p');
      const [, onHelo] = room.makeAction('helo');
      let hostId = null;

      onH2P((data, fromId) => {
        if (fromId === hostId) conn._recv(data);
      });

      // Host sends 'helo' when we join — that identifies who the host is
      onHelo((_data, fromId) => {
        if (!hostId) {
          hostId = fromId;
          conn._open(d => p2h(d, fromId));
        }
      });

      room.onPeerLeave(peerId => {
        if (peerId === hostId) { hostId = null; conn._close(); }
      });
    }
  }

  window.TrysteroHostPeer = TrysteroHostPeer;
  window.TrysteroPlayerPeer = TrysteroPlayerPeer;
})();
