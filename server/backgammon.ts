// Backgammon, server side: the round's messages to actions, and its view. The pure rules are in
// shared/backgammon.js.

import type { BackgammonAction, BackgammonState } from '../shared/backgammon.js';
import type { RoundServer } from './minigames.ts';

/** Backgammon's round server code. */
export function makeBackgammonServer(): RoundServer<BackgammonState, BackgammonAction> {
  return {
    // actions are rebuilt field by field: ids and the time never come from the wire
    message(m, { id, now, gameMasterId }) {
      switch (m.t) {
        case 'roll':
        case 'undo':
        case 'done':
          return { action: { t: m.t, id }, refused: 'refused' };

        case 'move':
          if (!Number.isInteger(m.from) || !Number.isInteger(m.to)) return { refused: 'refused' };
          return { action: { t: 'move', id, from: m.from, to: m.to }, refused: 'refused' };

        case 'nextRound':
          return { action: { t: 'nextRound', id, now }, refused: id === gameMasterId ? 'refused' : 'not-gm' };

        default: // not a backgammon thing (place, answer, …)
          return { refused: 'not-playing' };
      }
    },

    // the dice come from the seed and the rolls so far: without them, a phone can't tell the next roll
    view: ({ seed: _seed, rolls: _rolls, ...shown }) => shown,
  };
}
