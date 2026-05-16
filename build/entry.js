// Bundle entry: imports trystero/nostr and sets up TrysteroHostPeer / TrysteroPlayerPeer
// as globals, replacing the CDN-dependent dynamic-import version.
import { joinRoom, selfId } from 'trystero/nostr';

(function () {
  'use strict';

  function _genCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }

  // sharedId = ROOMCODE(6) + '-' + selfId
  function encodeSharedId(roomCode, sid) { return roomCode + '-' + sid; }
  function decodeSharedId(sharedId) {
    return { roomCode: sharedId.slice(0, 6), hostId: sharedId.slice(7) };
  }

  class Emitter {
    constructor() { this._h = {}; }
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; }
    _fire(ev, ...a) { (this._h[ev] || []).slice().forEach(fn => fn(...a)); }
  }

  // ── Host-side handle for one player connection ──────────────────────
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

  // ── Host peer ───────────────────────────────────────────────────────
  class TrysteroHostPeer extends Emitter {
    constructor(appId) {
      super();
      try {
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

        // Fire 'open' async so callers can attach listeners first
        setTimeout(() => this._fire('open', encodeSharedId(roomCode, selfId)), 0);
      } catch (err) {
        setTimeout(() => this._fire('error', err), 0);
      }
    }
  }

  // ── Player-side connection handle ────────────────────────────────────
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

  // ── Player peer ──────────────────────────────────────────────────────
  class TrysteroPlayerPeer extends Emitter {
    constructor(appId) {
      super();
      this._appId = appId;
      // Fire 'open' async so callers can attach listeners first
      setTimeout(() => this._fire('open'), 0);
    }

    connect(sharedId) {
      const conn = new TrysteroPlayerConn();
      const { roomCode, hostId } = decodeSharedId(sharedId);
      const room = joinRoom({ appId: this._appId }, roomCode);
      const [sendP2H] = room.makeAction('p2h');
      const [, onH2P] = room.makeAction('h2p');

      onH2P((data, fromId) => {
        if (fromId === hostId) conn._recv(data);
      });

      room.onPeerJoin(peerId => {
        if (peerId === hostId && !conn.open) {
          conn._open(data => sendP2H(data, hostId));
        }
      });

      room.onPeerLeave(peerId => {
        if (peerId === hostId) conn._close();
      });

      return conn;
    }
  }

  window.TrysteroHostPeer = TrysteroHostPeer;
  window.TrysteroPlayerPeer = TrysteroPlayerPeer;
})();
