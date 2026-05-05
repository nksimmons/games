const basePath = location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
const params = new URLSearchParams(location.search);
const useRtc = params.get('transport') === 'webrtc';
let ws;
let state = null;
let rtcRoomCode = null;
const rtcPeers = new Map(); // peerId -> { pc, channel }

function sendWs(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function forwardToRtcPeer(peerId, payload) {
  const peer = rtcPeers.get(peerId);
  if (!peer || !peer.channel || peer.channel.readyState !== 'open') {
    return;
  }

  peer.channel.send(JSON.stringify({ type: 'server-direct', payload }));
}

async function createRtcPeerForPlayer(playerPeerId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  const channel = pc.createDataChannel('boggle-game');
  channel.onopen = () => {
    console.log('[rtc][host] datachannel open ->', playerPeerId);
    channel.send(JSON.stringify({ type: 'host-hello', roomCode: rtcRoomCode }));
  };
  channel.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'client-action' && msg.payload) {
        sendWs({
          type: 'rtc-relay-action',
          fromPeerId: playerPeerId,
          action: msg.payload,
        });
        return;
      }

      console.log('[rtc][host] channel message from', playerPeerId, msg.type || 'unknown');
    } catch {
      console.log('[rtc][host] channel message from', playerPeerId);
    }
  };
  channel.onclose = () => {
    console.log('[rtc][host] datachannel closed ->', playerPeerId);
  };

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    sendWs({ type: 'rtc-signal', to: playerPeerId, signal: { type: 'candidate', candidate: event.candidate } });
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'failed' || st === 'closed' || st === 'disconnected') {
      rtcPeers.delete(playerPeerId);
    }
  };

  rtcPeers.set(playerPeerId, { pc, channel });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendWs({ type: 'rtc-signal', to: playerPeerId, signal: { type: 'offer', sdp: offer.sdp } });
}

async function handleRtcSignal(msg) {
  const from = msg.from;
  const signal = msg.signal || {};
  if (!from || !signal.type) return;

  const peer = rtcPeers.get(from);
  if (!peer) {
    return;
  }

  if (signal.type === 'answer') {
    await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
    return;
  }

  if (signal.type === 'candidate' && signal.candidate) {
    try {
      await peer.pc.addIceCandidate(signal.candidate);
    } catch (err) {
      console.warn('[rtc][host] candidate add failed:', err.message);
    }
  }
}

function connectHost() {
  ws = new WebSocket(`${wsProtocol}://${location.host}${basePath}`);

  ws.onopen = () => {
    sendWs({ type: 'host-join' });
    document.getElementById('join-url').textContent = `${location.origin}${basePath}player`;

    if (useRtc) {
      sendWs({ type: 'rtc-host-open', roomCode: params.get('room') || undefined });
    }
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'state':
        console.log('[host] State received, phase:', msg.data.phase, 'players:', msg.data.players?.length);
        state = msg.data;
        render();
        break;
      case 'timer':
        updateTimer(msg.remaining);
        break;
      case 'rtc-host-opened': {
        rtcRoomCode = msg.roomCode;
        const joinUrl = `${location.origin}${basePath}player?transport=webrtc&room=${encodeURIComponent(rtcRoomCode)}`;
        document.getElementById('join-url').textContent = joinUrl;
        console.log('[rtc][host] room open:', rtcRoomCode);
        break;
      }
      case 'rtc-player-joined':
        await createRtcPeerForPlayer(msg.playerPeerId);
        break;
      case 'rtc-signal':
        await handleRtcSignal(msg);
        break;
      case 'rtc-peer-left':
        if (rtcPeers.has(msg.peerId)) {
          const peer = rtcPeers.get(msg.peerId);
          try { peer.pc.close(); } catch {}
          rtcPeers.delete(msg.peerId);
        }
        break;
      case 'rtc-error':
        console.warn('[rtc][host] signaling error:', msg.message);
        break;
      case 'rtc-forward':
        if (msg.toPeerId && msg.payload) {
          forwardToRtcPeer(msg.toPeerId, msg.payload);
        }
        break;
    }
  };

  ws.onclose = () => {
    console.log('[host] WebSocket closed, reconnecting in 1.5s...');
    setTimeout(connectHost, 1500);
  };

  ws.onerror = (e) => {
    console.error('[host] WebSocket error:', e);
  };
}

connectHost();

// Poll for state every 3 seconds as a backup in case a WS message is missed
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendWs({ type: 'get-state' });
  }
}, 3000);

function render() {
  if (!state) return;

  // Show correct screen
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screenId = `screen-${state.phase}`;
  const screen = document.getElementById(screenId);
  if (screen) screen.classList.add('active');

  // Reset animation tracking if we've moved past roundEnd
  if (state.phase !== 'roundEnd' && state.phase !== 'gameOver') {
    scoringAnimationActive = false;
    scoringAnimationDoneForRound = -1;
  }

  switch (state.phase) {
    case 'lobby': renderLobby(); break;
    case 'playing': renderPlaying(); break;
    case 'roundEnd':
      if (!scoringAnimationActive && scoringAnimationDoneForRound !== state.round) renderRoundEnd();
      break;
    case 'gameOver': renderGameOver(); break;
  }
}

// --- LOBBY ---
function renderLobby() {
  const container = document.getElementById('lobby-players');
  container.innerHTML = state.players.map(p => `
    <div class="player-card">
      <div class="avatar" style="background:${p.avatar.bgColor || '#4a3a6e'}">${renderAvatarContent(p.avatar, p.roundWins)}</div>
      <div class="player-name">${esc(p.name)}</div>
    </div>
  `).join('');
}

// --- PLAYING ---
function renderPlaying() {
  document.getElementById('round-num').textContent = state.round;
  document.getElementById('max-rounds').textContent = state.maxRounds;
  renderBoard();
  renderScoreboard(document.getElementById('scoreboard'));
}

function renderBoard() {
  const container = document.getElementById('board');
  if (!state.board) return;
  container.innerHTML = state.board.flat().map(letter => `
    <div class="tile">${letter}</div>
  `).join('');
}

let previousWordCounts = {};

function renderScoreboard(container) {
  const leader = state.players[0];
  container.innerHTML = state.players.map(p => {
    const wordCount = state.playerWordCounts ? (state.playerWordCounts[p.id] || 0) : '';
    const isLeader = p === leader && p.totalScore > 0;
    const prevCount = previousWordCounts[p.id] || 0;
    const isNew = wordCount !== '' && wordCount > prevCount;
    return `
      <div class="player-card ${isLeader ? 'leader' : ''}" ${!p.connected ? 'style="opacity:0.4"' : ''} id="host-player-${p.id}">
        <div class="avatar" style="background:${p.avatar.bgColor || '#4a3a6e'}">${renderAvatarContent(p.avatar, p.roundWins)}</div>
        <div class="player-name">${esc(p.name)}</div>
        <div class="player-score">${p.totalScore}</div>
        ${wordCount !== '' ? `<div class="player-words-count ${isNew ? 'word-count-bump' : ''}">${wordCount} words</div>` : ''}
      </div>
    `;
  }).join('');

  // Track counts for next render
  if (state.playerWordCounts) {
    previousWordCounts = { ...state.playerWordCounts };
  }
}

function updateTimer(remaining) {
  const el = document.getElementById('timer');
  if (!el) return;
  el.textContent = remaining;
  el.className = 'timer';
  if (remaining <= 10) el.classList.add('danger');
  else if (remaining <= 30) el.classList.add('warning');
}

// --- ROUND END (animated scoring) ---
let scoringAnimationActive = false;
let scoringAnimationDoneForRound = -1;

function renderRoundEnd() {
  document.getElementById('round-end-num').textContent = state.round;
  const container = document.getElementById('round-results');
  const standingsCard = document.getElementById('standings').closest('.card') || document.getElementById('standings').parentElement;

  // Hide standings during animation
  if (standingsCard) standingsCard.style.display = 'none';

  // Build the scoring animation area
  container.innerHTML = `
    <div id="scoring-animation">
      <div id="scoring-players" class="scoring-players"></div>
      <div id="scoring-phase-label" class="scoring-phase-label"></div>
      <div id="scoring-words" class="scoring-words"></div>
    </div>
  `;

  // Render player score cards for animation
  const playersEl = document.getElementById('scoring-players');
  playersEl.innerHTML = state.players.map(p => `
    <div class="scoring-player-card" id="scoring-player-${p.id}">
      <div class="avatar" style="background:${p.avatar.bgColor || '#4a3a6e'}">${renderAvatarContent(p.avatar, p.roundWins)}</div>
      <div class="player-name">${esc(p.name)}</div>
      <div class="scoring-player-score" id="score-display-${p.id}">${p.totalScore - getRoundScore(p.id)}</div>
      <div class="score-float-container" id="float-${p.id}"></div>
    </div>
  `).join('');

  if (state.scoringPhases) {
    scoringAnimationActive = true;
    animateScoring(state.scoringPhases, () => {
      scoringAnimationActive = false;
      scoringAnimationDoneForRound = state.round;
      // Update to final scores
      state.players.forEach(p => {
        const el = document.getElementById(`score-display-${p.id}`);
        if (el) el.textContent = p.totalScore;
      });
      // Show standings
      if (standingsCard) standingsCard.style.display = '';
      renderScoreboard(document.getElementById('standings'));
    });
  } else {
    renderScoreboard(document.getElementById('standings'));
    if (standingsCard) standingsCard.style.display = '';
  }
}

function getRoundScore(playerId) {
  if (!state.roundResults) return 0;
  const words = state.roundResults[playerId] || [];
  return words.reduce((s, w) => s + (w.finalScore || 0), 0);
}

function animateScoring(phases, onComplete) {
  const commonPhase = phases.find(p => p.phase === 'common');
  const uniquePhase = phases.find(p => p.phase === 'unique');

  const runningScores = {};
  state.players.forEach(p => {
    runningScores[p.id] = p.totalScore - getRoundScore(p.id);
  });

  const phaseLabel = document.getElementById('scoring-phase-label');
  const wordsEl = document.getElementById('scoring-words');

  // Phase 1: Common words
  phaseLabel.textContent = '🤝 Common Words';
  phaseLabel.className = 'scoring-phase-label fade-in';
  wordsEl.innerHTML = '';

  let delay = 600;

  if (commonPhase && commonPhase.items.length > 0) {
    // Show common words one by one
    commonPhase.items.forEach((item, i) => {
      setTimeout(() => {
        const tag = document.createElement('span');
        tag.className = 'word-tag common pop-in';
        tag.innerHTML = `${esc(item.word.toUpperCase())} <span class="score">+${item.score}</span>`;
        wordsEl.appendChild(tag);

        // Float score to each player who found it
        item.playerIds.forEach(pid => {
          runningScores[pid] += item.score;
          floatScore(pid, `+${item.score}`, runningScores[pid]);
        });
      }, delay + i * 400);
    });
    delay += commonPhase.items.length * 400 + 1200;
  } else {
    setTimeout(() => {
      wordsEl.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:1rem">No common words this round!</div>';
    }, delay);
    delay += 1500;
  }

  // Phase 2: Unique words
  setTimeout(() => {
    phaseLabel.textContent = '⭐ Unique Words (+' + UNIQUE_BONUS + ' bonus each)';
    phaseLabel.className = 'scoring-phase-label fade-in';
    wordsEl.innerHTML = '';

    if (uniquePhase && uniquePhase.items.length > 0) {
      uniquePhase.items.forEach((item, i) => {
        setTimeout(() => {
          const playerName = state.players.find(p => p.id === item.playerId);
          const tag = document.createElement('span');
          tag.className = 'word-tag valid pop-in';
          const bonusText = item.lengthBonus > 0 ? ` (${item.baseScore}+${item.lengthBonus}+${item.uniqueBonus})` : '';
          tag.innerHTML = `${esc(item.word.toUpperCase())} <span class="score">+${item.totalScore}${bonusText}</span>`;
          wordsEl.appendChild(tag);

          runningScores[item.playerId] += item.totalScore;
          floatScore(item.playerId, `+${item.totalScore}`, runningScores[item.playerId]);
        }, i * 350);
      });

      setTimeout(onComplete, uniquePhase.items.length * 350 + 1500);
    } else {
      wordsEl.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:1rem">No unique words this round!</div>';
      setTimeout(onComplete, 1500);
    }
  }, delay);
}

const UNIQUE_BONUS = 2; // must match server

function floatScore(playerId, text, newTotal) {
  const container = document.getElementById(`float-${playerId}`);
  const scoreEl = document.getElementById(`score-display-${playerId}`);
  if (!container) return;

  const float = document.createElement('div');
  float.className = 'score-float';
  float.textContent = text;
  container.appendChild(float);
  setTimeout(() => float.remove(), 1200);

  // Update displayed score
  if (scoreEl) {
    setTimeout(() => { scoreEl.textContent = newTotal; }, 400);
  }
}

function renderResults(container) {
  if (!state.roundResults) return;
  container.innerHTML = state.players.map(p => {
    const words = state.roundResults[p.id] || [];
    const roundScore = words.reduce((s, w) => s + (w.finalScore || 0), 0);
    return `
      <div class="result-card">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem">
          <div class="avatar" style="background:${p.avatar.bgColor || '#4a3a6e'};width:40px;height:40px;font-size:1.2rem">${renderAvatarContent(p.avatar, p.roundWins)}</div>
          <div class="name">${esc(p.name)}</div>
          <div class="round-score" style="margin-left:auto">+${roundScore}</div>
        </div>
        <ul class="word-list">
          ${words.map(w => {
            let cls = 'invalid';
            if (w.reason === 'unique') cls = 'valid';
            else if (w.reason === 'common') cls = 'common';
            return `<li class="word-tag ${cls}">${esc(w.word)}${w.finalScore ? `<span class="score">+${w.finalScore}</span>` : ''}</li>`;
          }).join('')}
        </ul>
      </div>
    `;
  }).join('');
}

// --- GAME OVER ---
function renderGameOver() {
  const sorted = [...state.players].sort((a, b) => b.totalScore - a.totalScore);
  const podium = document.getElementById('podium');

  const places = [
    { cls: 'first', rank: '🥇', label: 'gold' },
    { cls: 'second', rank: '🥈', label: 'silver' },
    { cls: 'third', rank: '🥉', label: 'bronze' },
  ];

  podium.innerHTML = sorted.slice(0, 3).map((p, i) => `
    <div class="podium-place ${places[i].cls}">
      <div class="avatar avatar-large" style="background:${p.avatar.bgColor || '#4a3a6e'}">${renderAvatarContent(p.avatar, p.roundWins)}</div>
      <div class="podium-rank ${places[i].label}">${places[i].rank}</div>
      <div class="player-name">${esc(p.name)}</div>
      <div class="player-score">${p.totalScore}</div>
    </div>
  `).join('');

  renderScoreboard(document.getElementById('final-scores'));
  renderResults(document.getElementById('final-round-results'));
}

// --- UTILS ---
function renderAvatarContent(avatar, roundWins) {
  const crown = roundWins > 0 ? '<span class="avatar-crown">👑</span>' : '';
  if (avatar.drawing) {
    return crown + `<img src="${avatar.drawing}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  }
  return crown + '🎲';
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
