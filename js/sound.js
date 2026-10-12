// Чиптюн-звуки на WebAudio: квадратная волна и шум, как у 8-битных приставок.
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

function tone(freq, dur, { type = 'square', gain = 0.06, slide = 0, delay = 0 } = {}) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.setValueAtTime(gain, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { gain = 0.12, freq = 3000, delay = 0 } = {}) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  // «ступенчатый» шум — как у NES
  let v = 0;
  for (let i = 0; i < len; i++) {
    if (i % 24 === 0) v = Math.random() * 2 - 1;
    d[i] = v * (1 - i / len);
  }
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

const arp = (notes, step, opts) => notes.forEach((f, i) => tone(f, step, { ...opts, delay: i * step }));

export const sound = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem('arena.muted', muted ? '1' : '0'); } catch { /* ignore */ }
    if (!muted) this.select();
    return muted;
  },
  unlock() { ac(); },
  select() { tone(880, 0.03, { gain: 0.03 }); },
  move() { tone(330, 0.04, { gain: 0.05 }); tone(495, 0.05, { gain: 0.05, delay: 0.04 }); },
  capture() { noise(0.12, { gain: 0.18, freq: 2500 }); tone(220, 0.1, { gain: 0.05, slide: -120 }); },
  check() { arp([988, 740, 988], 0.07, { gain: 0.045 }); },
  start() { arp([523, 659, 784, 1046], 0.07, { gain: 0.05 }); },
  trigger(type) {
    if (type === 'lava') { noise(0.8, { gain: 0.2, freq: 500 }); arp([330, 262, 196, 147, 110], 0.09, { gain: 0.06 }); }
    else { arp([392, 523, 659, 784, 1046, 784, 659, 523], 0.05, { type: 'triangle', gain: 0.07 }); }
  },
  disco() {
    // «дискотечный» бит: бочка + арпеджио
    for (let i = 0; i < 8; i++) {
      tone(i % 2 ? 98 : 65, 0.08, { gain: 0.09, slide: -30, delay: i * 0.22 });
      noise(0.03, { gain: 0.05, freq: 6000, delay: i * 0.22 + 0.11 });
    }
    arp([523, 659, 784, 988, 784, 659, 523, 659, 784, 988, 1175, 988], 0.11, { gain: 0.035 });
  },
  boom() { noise(0.45, { gain: 0.3, freq: 900 }); tone(110, 0.3, { gain: 0.08, slide: -70 }); },
  end(win) {
    if (win) arp([523, 659, 784, 1046, 784, 1046], 0.1, { gain: 0.05 });
    else arp([660, 880], 0.08, { gain: 0.04 });
  },
};
