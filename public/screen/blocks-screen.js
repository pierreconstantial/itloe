// The block game's TV screen, mounted by the frame (./minigames.js) while a block round runs: one board per
// player (game-view.js), with the juice — sounds, particles, call-outs, shake — reacting to events derived
// from consecutive views, the danger pulse and the timed countdown. The podium is the frame's; the block
// game holds it back while "Time's up!" plays.

import { renderGame } from './game-view.js';
import { detectEvents, calloutsFor } from './events.js';
import { sfx } from './audio.js';
import * as fx from './fx.js';
import { createCountdown } from './countdown.js';
import { legalPlacementCount } from '../../shared/board.js';
import { summarizeSettings } from '../commun/settings-text.js';
import { addStylesheet } from './dom.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('./events.js').ScreenEvent} ScreenEvent */

/** How long "Time's up!" holds the screen before the podium reveal starts. */
const TIMES_UP_MS = 2600;
/** Fewer legal placements than this (and more than 0) → the board frame pulses. */
const DANGER_BELOW = 3;

addStylesheet(new URL('./blocks.css', import.meta.url));

/** @param {State} s @returns {Set<string>} */
function playersInDanger(s) {
  return new Set(s.order.filter((id) => {
    const p = s.players[id];
    if (p.done) return false;
    const n = legalPlacementCount(p.board, s.size, p.hand, DANGER_BELOW);
    return n > 0 && n < DANGER_BELOW;
  }));
}

/** @param {ScreenEvent} e @param {State} s */
function react(e, s) {
  switch (e.t) {
    case 'joined':
      sfx.joined();
      break;
    case 'start':
      sfx.start();
      break;
    case 'move': {
      const m = e.move;
      sfx.place();
      fx.scoreFloater(m.id, m.gained);
      if (m.lines === 0) break;
      fx.clearEffect(m, s.size);
      fx.shake(m.lines);
      sfx.clear(m.lines);
      if (m.streak >= 2) sfx.combo(m.streak);
      if (m.cleanBoard) sfx.cleanBoard();
      fx.callout(m.id, calloutsFor(m), m.color);
      break;
    }
    case 'done':
      sfx.done();
      break;
    case 'finished':
      if (e.reason === 'time') {
        sfx.bell();
        fx.timesUp(TIMES_UP_MS);
      }
      break;
  }
}

/**
 * @param {HTMLElement} root @param {import('./minigames.js').TvIo} io
 * @returns {import('./minigames.js').Mounted}
 */
function mount(root, io) {
  /** The block game in the last view this screen showed. @type {State | null} */
  let view = null;
  const countdown = createCountdown();

  return {
    update(round) {
      const next = /** @type {State} */ (round.view);
      // after a gap (reconnect, page load) the previous view is stale: render, but don't replay what was missed
      const prev = io.continuous() ? view : null;
      const first = view === null;
      view = next;
      const events = prev ? detectEvents(prev, next)
        : first && io.continuous() && next.phase === 'playing' ? [{ t: /** @type {const} */ ('start') }] : [];
      countdown.update(next);
      if (next.phase === 'playing') root.replaceChildren(renderGame(next, prev, { danger: playersInDanger(next) }));
      // the game ending in this very view (bell, the game master's endGame) marks everyone done at once:
      // its own sound covers it, so no pile of per-player "done" sounds
      const endsNow = events.some((e) => e.t === 'finished');
      for (const e of events) if (!(endsNow && e.t === 'done')) react(e, next);
    },
    message() {},
    unmount() {
      countdown.stop();
      root.replaceChildren();
    },
  };
}

/** The block game's entry in the TV's list (./minigames.js). @type {import('./minigames.js').TvScreen} */
export const BLOCK_SCREEN = {
  title: 'ITLOE',
  settings: { summarize: summarizeSettings },
  mount,
  /** Time ran out: "Time's up!" holds the screen before the podium reveal. */
  podium: (round) => ({ delayMs: round.view.endReason === 'time' ? TIMES_UP_MS : 0 }),
};
