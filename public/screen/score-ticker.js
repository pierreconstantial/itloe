// Animated score count-up. Survives full re-renders: values are kept per player id,
// and each render just re-binds the element to show them in.

import { formatScore } from './dom.js';

const DURATION_MS = 900;

/** @typedef {{ shown: number, from: number, target: number, t0: number, el: HTMLElement | null }} Counter */

/** @type {Map<string, Counter>} */
const counters = new Map();
let rafId = 0;

/** @param {number} k 0..1 */
const easeOutCubic = (k) => 1 - (1 - k) ** 3;

/**
 * Binds `el` to the player's counter and animates it towards `target`.
 * @param {string} playerId
 * @param {number} target
 * @param {HTMLElement} el
 */
export function bindScore(playerId, target, el) {
  let c = counters.get(playerId);
  if (!c) {
    c = { shown: 0, from: 0, target: 0, t0: 0, el: null };
    counters.set(playerId, c);
  }
  if (c.target !== target) {
    c.from = c.shown;
    c.target = target;
    c.t0 = performance.now();
  }
  c.el = el;
  el.textContent = formatScore(Math.round(c.shown));
  if (!rafId) rafId = requestAnimationFrame(tick);
}

/** Forgets every counter: the next bind of a player starts from 0. */
export function resetScores() {
  counters.clear();
}

function tick() {
  rafId = 0;
  const now = performance.now();
  let running = false;
  for (const c of counters.values()) {
    if (c.shown === c.target) continue;
    const k = Math.min(1, (now - c.t0) / DURATION_MS);
    c.shown = k >= 1 ? c.target : c.from + (c.target - c.from) * easeOutCubic(k);
    if (c.el) c.el.textContent = formatScore(Math.round(c.shown));
    if (k < 1) running = true;
  }
  if (running) rafId = requestAnimationFrame(tick);
}
