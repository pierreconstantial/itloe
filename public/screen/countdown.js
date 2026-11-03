// Timed-mode countdown pill. Lives outside #app (re-renders don't touch it) and ticks on its own
// from the latest state; it only reads state.deadline, never decides the end (the server does).

import { secondsLeft, mmss } from './clock.js';
import { sfx } from './audio.js';

/** @typedef {import('../../shared/game.js').State} State */

/** Last seconds shown in urgent style, with a tick each second. */
export const URGENT_SECONDS = 10;
const TICK_MS = 200;

const el = /** @type {HTMLElement} */ (document.getElementById('countdown'));

/** @type {number | null} */
let deadline = null;
let lastWhole = Infinity;

/**
 * The deadline to count down to, or null when no countdown should show.
 * @param {State} s
 */
export function activeDeadline(s) {
  return s.phase === 'playing' && s.rules?.mode === 'timed' && typeof s.deadline === 'number' ? s.deadline : null;
}

/** Call on every view. @param {State} s */
export function updateCountdown(s) {
  const next = activeDeadline(s);
  if (next !== deadline) lastWhole = Infinity;
  deadline = next;
  el.hidden = deadline === null;
  document.body.classList.toggle('has-countdown', deadline !== null);
  draw();
}

function draw() {
  if (deadline === null) return;
  const left = secondsLeft(deadline);
  const whole = Math.max(0, Math.ceil(left));
  el.textContent = `⏱ ${mmss(left)}`;
  const urgent = left <= URGENT_SECONDS;
  el.classList.toggle('is-urgent', urgent);
  if (urgent && whole < lastWhole && whole > 0) sfx.tick(whole);
  lastWhole = whole;
}

setInterval(draw, TICK_MS);
