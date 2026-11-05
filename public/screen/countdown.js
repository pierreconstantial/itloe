// Timed-mode countdown pill of a block game's TV screen. Lives outside #app (re-renders don't touch it)
// and ticks on its own from the latest state; it only reads state.deadline, never decides the end (the
// server does).

import { secondsLeft, mmss } from '../commun/clock.js';
import { sfx } from './audio.js';

/** @typedef {import('../../shared/game.js').State} State */

/** Last seconds shown in urgent style, with a tick each second. */
export const URGENT_SECONDS = 10;
const TICK_MS = 200;

/**
 * The deadline to count down to, or null when no countdown should show.
 * @param {State} s
 */
export function activeDeadline(s) {
  return s.phase === 'playing' && s.rules?.mode === 'timed' && typeof s.deadline === 'number' ? s.deadline : null;
}

/** The pill, added to the page until `stop` removes it with its timer. */
export function createCountdown() {
  const el = document.createElement('div');
  el.id = 'countdown';
  el.hidden = true;
  document.body.append(el);

  /** @type {number | null} */
  let deadline = null;
  let lastWhole = Infinity;

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
  const timer = setInterval(draw, TICK_MS);

  return {
    /** Call on every view. @param {State} s */
    update(s) {
      const next = activeDeadline(s);
      if (next !== deadline) lastWhole = Infinity;
      deadline = next;
      el.hidden = deadline === null;
      document.body.classList.toggle('has-countdown', deadline !== null);
      draw();
    },
    stop() {
      clearInterval(timer);
      el.remove();
      document.body.classList.remove('has-countdown');
    },
  };
}
