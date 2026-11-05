// Phone haptics. Android Chrome has the Vibration API; iOS Safari doesn't, so there
// every call is a silent no-op. Patterns are millisecond lists: on, off, on, …
import { KEYS, load, save } from './storage.js';

/** @typedef {'pickup' | 'place' | 'death' | 'bell' | 'win' | 'right' | 'wrong' | 'incarnate'} Haptic */

/** @type {Record<Haptic, number[]>} */
const PATTERNS = {
  pickup: [8],
  place: [25],
  death: [220, 90, 220],
  bell: [100, 60, 100, 60, 100],
  win: [60, 50, 60, 50, 200],
  right: [30, 50, 30], // quiz: a right answer (two light taps)
  wrong: [160],        // quiz: a wrong one (one heavier buzz)
  incarnate: [90, 910, 90, 910, 90],
};
const MAX_CLEAR_PULSES = 4;

export const supported = typeof navigator.vibrate === 'function';
let enabled = load(KEYS.vibrate) !== 'off';

export function isEnabled() { return enabled; }

/** @param {boolean} on */
export function setEnabled(on) {
  enabled = on;
  save(KEYS.vibrate, on ? 'on' : 'off');
}

/** Place thump, then one pulse per cleared line (capped). @param {number} lines @returns {number[]} */
export function clearPattern(lines) {
  const pattern = [PATTERNS.place[0]];
  for (let i = 0; i < Math.min(lines, MAX_CLEAR_PULSES); i++) pattern.push(50, 45);
  return pattern;
}

/** @param {number[]} pattern */
function play(pattern) {
  if (enabled && supported) navigator.vibrate(pattern);
}

/** @param {Haptic} kind */
export function buzz(kind) { play(PATTERNS[kind]); }

/** @param {number} lines */
export function buzzClear(lines) { play(clearPattern(lines)); }
