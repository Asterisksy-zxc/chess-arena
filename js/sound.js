// Небольшой синтезатор звуков на WebAudio — без внешних файлов.
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('arena.muted') === '1'; } catch { /* приватный режим */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', gain = 0.12, slide = 0, delay = 0 } = {}) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { gain = 0.15, freq = 1500, delay = 0 } = {}) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const sound = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem('arena.muted', muted ? '1' : '0'); } catch { /* ignore */ }
    if (!muted) this.select();
    return muted;
  },
  unlock() { ac(); },
  select() { tone(740, 0.04, { gain: 0.04 }); },
  move() { noise(0.05, { gain: 0.25, freq: 2400 }); tone(420, 0.05, { type: 'triangle', gain: 0.06 }); },
  capture() { noise(0.12, { gain: 0.35, freq: 1200 }); tone(200, 0.12, { type: 'square', gain: 0.05, slide: -80 }); },
  check() { tone(880, 0.09, { type: 'sawtooth', gain: 0.05 }); tone(660, 0.16, { type: 'sawtooth', gain: 0.05, delay: 0.09 }); },
  magic() { [660, 880, 1320].forEach((f, i) => tone(f, 0.16, { gain: 0.06, delay: i * 0.06 })); },
  freeze() { [1600, 1200, 900].forEach((f, i) => tone(f, 0.12, { type: 'triangle', gain: 0.05, delay: i * 0.05 })); },
  warp() { tone(300, 0.35, { gain: 0.08, slide: 900 }); },
  announce() { tone(392, 0.22, { type: 'triangle', gain: 0.09 }); tone(523, 0.3, { type: 'triangle', gain: 0.09, delay: 0.18 }); },
  event() { tone(180, 0.7, { gain: 0.12, slide: 360 }); noise(0.6, { gain: 0.06, freq: 700 }); },
  boom() { noise(0.6, { gain: 0.5, freq: 500 }); tone(90, 0.45, { gain: 0.3, slide: -50 }); },
  end() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.08, delay: i * 0.12 })); },
};
