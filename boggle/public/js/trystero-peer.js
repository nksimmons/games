// trystero-peer.js — PeerJS-compatible wrapper around Trystero (Nostr signaling)
// No server needed. No accounts. Works on GitHub Pages.
// Uses public Nostr relays for the WebRTC handshake, then data flows peer-to-peer.
//
// Protocol: host generates ROOMCODE (6 chars). The shared ID given to players is
// ROOMCODE + '-' + hostSelfId (fixed 6-char prefix) so players can address the
// host directly without a timing-sensitive announcement round-trip.
(function () {
  'use strict';

  // Nostr strategy — most reliable, hundreds of public relays
  const TRYSTERO_CDN = 'https://esm.sh/trystero@0.24.0';
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

  // sharedId = ROOMCODE(6) + '-' + selfId
  // selfId may contain hyphens (UUID-like) so we split at fixed position 6
  function encodeSharedId(roomCode, selfId) { return roomCode + '-' + selfId; }
  function decodeSharedId(sharedId) {
    return { roomCode: sharedId.slice(0, 6), hostId: sharedId.slice(7) };
  }

  class Emitter {
    constructor() { this._h = {}; }
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; }
    _fire(ev, ...a) { (this._h[ev] || []).slice().forEach(fn => fn(...a)); }
  }

  // ── Host-side handle for one player connection ────────────────────────────
  class TrysteroHostConn extends Emitter {
    constructor(peerId, sendFn) {
      super();
      this.peer = peerId;
      this._sendFn = sendFn;
      this.open = true;
    }
    send(data) { if (this._sendFn) this._sendFn(data); }
    _recv(data) { this._fire('data', data); }
    _close() { this._sendFn = null; this._fire('close'); this._fire('error', new Error('peer left')); }
  }

  // ── Host peer — generates room code, accepts incoming player connections ──
  //    new TrysteroHostPeer(appId)
  //    peer.on('open', sharedId => ...)         ← sharedId to encode in QR/URL
  //    peer.on('connection', conn => ...)        ← one per player
  //    conn.send(data) / conn.on('data', fn) / conn.on('close', fn)
  class TrysteroHostPeer extends Emitter {
    constructor(appId) {
      super();
      _load().then(({ joinRoom, selfId }) => {
        const roomCode = _genCode();
        const room = joinRoom({ appId }, roomCode);
        const [sendH2P] = room.makeAction('h2p');
        const [, onP2H] = room.makeAction('p2h');
        const conns = new Map();

        room.onPeerJoin(peerId => {
          const conn = new TrysteroHostConn(peerId, data => sendH2P(data, peerId));
          conns.set(peerId, conn);
          this._fire('connection', conn);
          conn._fire('open');
        });

        onP2H((data, fromId) => {
          const conn = conns.get(fromId);
          if (conn) conn._recv(data);
        });

        room.onPeerLeave(peerId => {
          const conn = conns.get(peerId);
          if (conn) { conn._close(); conns.delete(peerId); }
        });

        this._fire('open', encodeSharedId(roomCode, selfId));
      }).catch(err => this._fire('error', err));
    }
  }

  // ── Player-side connection handle ─────────────────────────────────────────
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

  // ── Player peer — fires 'open' when ready, then call connect(sharedId) ────
  //    new TrysteroPlayerPeer(appId)
  //    peer.on('open', () => { conn = peer.connect(sharedId); ... })
  //    conn.on('open', fn) / conn.on('data', fn) / conn.on('close', fn) / conn.send(data)
  class TrysteroPlayerPeer extends Emitter {
    constructor(appId) {
      super();
      this._appId = appId;
      this._mod = null;
      _load().then(mod => { this._mod = mod; this._fire('open'); })
             .catch(err => this._fire('error', err));
    }

    connect(sharedId) {
      const conn = new TrysteroPlayerConn();
      const doConnect = (mod) => {
        const { roomCode, hostId } = decodeSharedId(sharedId);
        const room = mod.joinRoom({ appId: this._appId }, roomCode);
        const [sendP2H] = room.makeAction('p2h');
        const [, onH2P] = room.makeAction('h2p');

        onH2P((data, fromId) => {
          if (fromId === hostId) conn._recv(data);
        });

        // onPeerJoin replays already-present peers immediately per Trystero docs,
        // so this fires even if the host joined the room before we did
        room.onPeerJoin(peerId => {
          if (peerId === hostId && !conn.open) {
            conn._open(data => sendP2H(data, hostId));
          }
        });

        room.onPeerLeave(peerId => {
          if (peerId === hostId) conn._close();
        });
      };
      if (this._mod) doConnect(this._mod);
      else _load().then(doConnect).catch(err => this._fire('error', err));
      return conn;
    }
  }

  window.TrysteroHostPeer = TrysteroHostPeer;
  window.TrysteroPlayerPeer = TrysteroPlayerPeer;
})();
