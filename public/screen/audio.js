// Screen-only sound: tiny WebAudio synths, no binary assets.
// Browsers block audio until a user gesture on THIS page (the host starts from the phone),
// so the screen shows a hint until someone clicks / presses a key; M toggles mute.

/** @type {AudioContext | null} */
let ctx = null;
/** @type {GainNode | null} */
let master = null;
let muted = false;

/** @type {Set<(state: 'locked' | 'on' | 'muted') => void>} */
const listeners = new Set();

/** @returns {'locked' | 'on' | 'muted'} */
export function audioState() {
  if (!ctx || ctx.state !== 'running') return 'locked';
  return muted ? 'muted' : 'on';
}

/** @param {(state: 'locked' | 'on' | 'muted') => void} fn */
export function onAudioState(fn) {
  listeners.add(fn);
  fn(audioState());
}

function emit() {
  const s = audioState();
  for (const fn of listeners) fn(s);
}

/** Call once at startup: unlocks on the first gesture, M toggles mute. */
export function installAudioUnlock() {
  const unlock = async () => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state !== 'running') await ctx.resume();
    emit();
  };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
    }
    unlock();
  });
}

// ---- synth primitives ----------------------------------------------------------

/**
 * @param {{ freq: number, to?: number, dur: number, type?: OscillatorType, gain?: number, at?: number }} o
 */
function tone({ freq, to, dur, type = 'sine', gain = 0.3, at = 0 }) {
  if (!ctx || !master || ctx.state !== 'running') return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/**
 * Filtered white-noise whoosh.
 * @param {{ dur: number, from: number, to: number, gain?: number, at?: number }} o
 */
function whoosh({ dur, from, to, gain = 0.25, at = 0 }) {
  if (!ctx || !master || ctx.state !== 'running') return;
  const t = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

/** semitones above A4 → Hz */
const note = (/** @type {number} */ s) => 440 * 2 ** (s / 12);

// ---- game sounds -----------------------------------------------------------------

export const sfx = {
  place() {
    tone({ freq: 520, to: 360, dur: 0.07, type: 'triangle', gain: 0.22 });
  },
  /** @param {number} lines */
  clear(lines) {
    whoosh({ dur: 0.35 + 0.08 * lines, from: 600, to: 4000, gain: 0.18 + 0.05 * lines });
    const steps = Math.min(2 + lines, 6);
    for (let i = 0; i < steps; i++) {
      tone({ freq: note(3 + i * 4), dur: 0.16, type: 'square', gain: 0.07, at: i * 0.05 });
    }
  },
  /** @param {number} streak */
  combo(streak) {
    const base = 7 + Math.min(streak, 8) * 2;
    [0, 4, 7, 12].forEach((s, i) => tone({ freq: note(base + s), dur: 0.22, type: 'sawtooth', gain: 0.06, at: 0.12 + i * 0.06 }));
  },
  cleanBoard() {
    [0, 4, 7, 11, 14].forEach((s, i) => tone({ freq: note(3 + s), dur: 0.9, type: 'triangle', gain: 0.12, at: 0.15 + i * 0.07 }));
    whoosh({ dur: 1.0, from: 300, to: 6000, gain: 0.15, at: 0.1 });
  },
  done() {
    [0, -3, -7].forEach((s, i) => tone({ freq: note(-5 + s), dur: 0.3, type: 'sawtooth', gain: 0.08, at: i * 0.18 }));
    tone({ freq: 110, to: 55, dur: 0.6, type: 'sine', gain: 0.25, at: 0.5 });
  },
  joined() {
    tone({ freq: note(10), dur: 0.12, type: 'triangle', gain: 0.18 });
    tone({ freq: note(17), dur: 0.18, type: 'triangle', gain: 0.18, at: 0.08 });
  },
  start() {
    [0, 5, 9, 12].forEach((s, i) => tone({ freq: note(s), dur: 0.2, type: 'square', gain: 0.07, at: i * 0.09 }));
  },
  /** one podium step (3rd, 2nd…) */
  reveal() {
    tone({ freq: note(-2), dur: 0.25, type: 'triangle', gain: 0.2 });
    whoosh({ dur: 0.3, from: 2000, to: 500, gain: 0.08 });
  },
  fanfare() {
    const seq = [[0, 0.16], [4, 0.16], [7, 0.16], [12, 0.7]];
    let at = 0;
    for (const [s, d] of seq) {
      tone({ freq: note(3 + s), dur: d + 0.1, type: 'sawtooth', gain: 0.09, at });
      tone({ freq: note(-9 + s), dur: d + 0.1, type: 'triangle', gain: 0.12, at });
      at += d;
    }
    whoosh({ dur: 1.2, from: 400, to: 7000, gain: 0.12, at: 0.45 });
  },
};
