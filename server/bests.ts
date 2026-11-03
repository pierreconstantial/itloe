// Q3 — solo best scores per (size, mode), recorded outside the reducer when a solo game finishes.
// Views carry best: { score, previous } in solo; `previous` = the record before the game on show
// (0 when there was none), so a client shows "New best!" when its score > previous.

import { loadBests, saveBests, type Game } from './store.ts';
import type { State } from './rules.ts';

const keyOf = (s: State): string => `${s.rules.size}:${s.rules.mode}`;
const isSolo = (s: State): boolean => s.order.length === 1;

export function makeBests(game: Game) {
  const bests = loadBests();
  const recordOf = (s: State): number => bests[keyOf(s)]?.score ?? 0;

  return {
    /** Change hook: records a finished solo game; forgets `previous` once that game is left. */
    onChange(prev: State, next: State): void {
      if (prev.phase === 'finished' && next.phase !== 'finished') game.bestPrevious = null;
      if (!(prev.phase === 'playing' && next.phase === 'finished' && isSolo(next))) return;
      const p = next.players[next.order[0]];
      const before = recordOf(next);
      game.bestPrevious = before;
      if (p.score > before) {
        bests[keyOf(next)] = { score: p.score, name: p.name, at: new Date().toISOString() };
        saveBests(bests);
      }
    },

    /** The view's `best` sibling, or undefined outside solo. */
    view(s: State): { score: number, previous: number } | undefined {
      if (!isSolo(s)) return undefined;
      const score = recordOf(s);
      return { score, previous: s.phase === 'finished' && game.bestPrevious != null ? game.bestPrevious : score };
    },
  };
}
