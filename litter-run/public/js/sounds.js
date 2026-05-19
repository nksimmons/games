// =====================================================================
// LITTER RUN — Sounds (Web Audio API, no external files)
// =====================================================================
let _ac = null;
function _ctx() {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  return _ac;
}

function _tone(freq, type, dur, vol = 0.25, startFreq) {
  const c = _ctx();
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.connect(g); g.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(startFreq ?? freq, c.currentTime);
  if (startFreq) osc.frequency.exponentialRampToValueAtTime(freq, c.currentTime + dur * 0.5);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  osc.start(); osc.stop(c.currentTime + dur);
}

function _noise(dur, vol = 0.4, hipass = 200) {
  const c   = _ctx();
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const g   = c.createGain();
  const hp  = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = hipass;
  src.connect(hp); hp.connect(g); g.connect(c.destination);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  src.start(); src.stop(c.currentTime + dur);
}

// Cat meow — FM-ish pitched squeak
function playMeow() {
  const c = _ctx();
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.connect(g); g.connect(c.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(820, c.currentTime);
  osc.frequency.linearRampToValueAtTime(1050, c.currentTime + 0.08);
  osc.frequency.exponentialRampToValueAtTime(680, c.currentTime + 0.22);
  osc.frequency.linearRampToValueAtTime(780, c.currentTime + 0.32);
  g.gain.setValueAtTime(0.0, c.currentTime);
  g.gain.linearRampToValueAtTime(0.28, c.currentTime + 0.04);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.38);
  osc.start(); osc.stop(c.currentTime + 0.4);
}

// Object crash — severity based on damage tier
function playCrash(damage) {
  if (damage >= 500) {
    // Catastrophic (TV, Mom's dish, laptop)
    _noise(0.65, 0.55, 150);
    _tone(70, 'sawtooth', 0.45, 0.28);
    setTimeout(playMeow, 250);
  } else if (damage >= 100) {
    // Medium crash (lamp, vase, bookshelf)
    _noise(0.38, 0.42, 300);
    _tone(160, 'square', 0.22, 0.18);
  } else {
    // Small bump (mug, glass, controller)
    _noise(0.18, 0.28, 500);
    _tone(380, 'square', 0.1, 0.12);
  }
}

// Countdown beep — n=3,2,1 → high; n=0 → "GO!" chord
function playCountdown(n) {
  if (n === 0) {
    // "GO!" — triumphant little chord
    [523, 659, 784].forEach((f, i) => {
      setTimeout(() => _tone(f, 'triangle', 0.35, 0.25), i * 55);
    });
  } else {
    _tone(880, 'sine', 0.2, 0.3);
  }
}

// Quick zoomies burst sound (cat escaping lure)
function playZoomies() {
  _tone(1400, 'sawtooth', 0.07, 0.12);
  setTimeout(() => _tone(1700, 'sawtooth', 0.07, 0.09), 70);
}

// Round over jingle
function playTimeUp() {
  [880, 660, 440].forEach((f, i) => {
    setTimeout(() => _tone(f, 'triangle', 0.28, 0.25), i * 140);
  });
}

// Game over / results fanfare
function playAllDone() {
  const c = _ctx();
  [523, 659, 784, 1047].forEach((f, i) => {
    setTimeout(() => _tone(f, 'sine', 0.4, 0.22), i * 120);
  });
}
