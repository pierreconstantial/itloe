// The block game, server side: its messages to actions, its view, and solo best scores (Q3) per (size,
// mode), recorded outside the reducer when a solo game finishes. The pure rules are in shared/game.js.
// The view carries best: { score, previous } in solo; `previous` = the record before the game on show
// (0 when there was none), so a client shows "New best!" when its score > previous.

import { loadBests, saveBests, type Game } from './store.ts';
import type { ServerAction, State } from './rules.ts';
import type { MinigameServer } from './minigames.ts';

const keyOf = (s: State): string => `${s.rules.size}:${s.rules.mode}`;
const isSolo = (s: State): boolean => s.order.length === 1;

export function makeBlockServer(game: Game): MinigameServer<State, ServerAction> {
  const bests = loadBests();
  const recordOf = (s: State): number => bests[keyOf(s)]?.score ?? 0;

  /** The view's `best`, or undefined outside solo. */
  const best = (s: State): { score: number, previous: number } | undefined => {
    if (!isSolo(s)) return undefined;
    const score = recordOf(s);
    return { score, previous: s.phase === 'finished' && game.bestPrevious != null ? game.bestPrevious : score };
  };

  return {
    // actions are rebuilt field by field: server-only inputs (now, deadline, timeUp) never come from the wire
    message(m, { id, now, state: s }) {
      const host = id === s.hostId;
      // a round button answers alike in every minigame: a guest's → not-host, the host's at the wrong moment → refused
      const refusal = host ? 'refused' : 'not-host';
      switch (m.t) {
        case 'start':
        case 'again':
          return { action: { t: m.t, id, now }, refused: refusal };

        case 'endGame':
          // host stops the game (someone dropped while not stuck)
          return { action: { t: 'endGame', id }, refused: refusal };

        case 'retire':
          // host takes one player out (done, still ranked, keeps seat + character); a host's no-op while
          // playing (unknown / already done / left target) is not an error, like config
          if (typeof m.target !== 'string') return null;
          return { action: { t: 'retire', id, target: m.target }, refused: !host ? 'not-host' : s.phase === 'playing' ? undefined : 'refused' };

        case 'newGame':
          // podium → block lobby inside the same tableau
          return { action: { t: 'newGame', id }, refused: refusal };

        case 'place':
          if ((m.piece !== 0 && m.piece !== 1 && m.piece !== 2) || typeof m.x !== 'number' || typeof m.y !== 'number') {
            return { refused: 'bad-place' };
          }
          return { action: { t: 'place', id, piece: m.piece, x: m.x, y: m.y }, refused: s.phase === 'playing' ? 'bad-place' : 'not-playing' };

        default: // not a block-game thing (a quiz's answer, …)
          return { refused: 'not-playing' };
      }
    },

    view: (s) => ({ ...s, best: best(s) }),

    /** Records a finished solo game; forgets `previous` once that game is left. */
    onChange(prev, next) {
      if (!next || (prev?.phase === 'finished' && next.phase !== 'finished')) game.bestPrevious = null;
      if (!(prev?.phase === 'playing' && next?.phase === 'finished' && isSolo(next))) return;
      const p = next.players[next.order[0]];
      const before = recordOf(next);
      game.bestPrevious = before;
      if (p.score > before) {
        bests[keyOf(next)] = { score: p.score, name: p.name, at: new Date().toISOString() };
        saveBests(bests);
      }
    },
  };
}
