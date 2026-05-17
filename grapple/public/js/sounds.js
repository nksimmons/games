// =====================================================================
// GRAPPLE AND GO — Sound Effects  (Web Audio API, no asset files)
// =====================================================================
let _audioCtx = null;

function _getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function playSound(type) {
  try {
    const ctx = _getAudioCtx();
    if      (type === 'fire')    _sfxFire(ctx);
    else if (type === 'attach')  _sfxAttach(ctx);
    else if (type === 'release') _sfxRelease(ctx);
    else if (type === 'death')   _sfxDeath(ctx);
  } catch (e) { /* non-fatal */ }
}

// Whoosh: hook flies through the air
function _sfxFire(ctx) {
  const t = ctx.currentTime;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(700, t);
  osc.frequency.exponentialRampToValueAtTime(160, t + 0.16);
  gain.gain.setValueAtTime(0.2, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.16);
}

// Clank: hook bites into rock ceiling
function _sfxAttach(ctx) {
  const t = ctx.currentTime;
  const bufLen = Math.ceil(ctx.sampleRate * 0.1);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.value = 2200;
  bpf.Q.value = 12;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  src.connect(bpf); bpf.connect(gain); gain.connect(ctx.destination);
  src.start(t); src.stop(t + 0.1);
}

// Snap: rope released, player goes flying
function _sfxRelease(ctx) {
  const t = ctx.currentTime;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(380, t);
  osc.frequency.exponentialRampToValueAtTime(90, t + 0.09);
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.09);
}

// Splat: player hits spikes or lava
function _sfxDeath(ctx) {
  const t = ctx.currentTime;
  // Low descending buzz
  const osc     = ctx.createOscillator();
  const gainOsc = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.5);
  gainOsc.gain.setValueAtTime(0.55, t);
  gainOsc.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(gainOsc); gainOsc.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.5);
  // Sharp crack of impact
  const bufLen = Math.ceil(ctx.sampleRate * 0.07);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
  const src       = ctx.createBufferSource();
  src.buffer      = buf;
  const gainNoise = ctx.createGain();
  gainNoise.gain.setValueAtTime(0.45, t);
  gainNoise.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  src.connect(gainNoise); gainNoise.connect(ctx.destination);
  src.start(t); src.stop(t + 0.07);
}
